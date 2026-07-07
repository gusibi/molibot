use crate::service::{
    is_compatible_handshake, ServiceHandshake, ServiceOwnership, ServiceState, ServiceStatus,
};
use serde::Deserialize;
use std::env;
use std::fs::{create_dir_all, read_to_string, remove_dir_all, rename, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const SUPPORTED_PROTOCOL_VERSION: u32 = 1;
const DEFAULT_PORT: u16 = 3000;
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTHY_RESET_AFTER: Duration = Duration::from_secs(60);
const MAX_CONSECUTIVE_FAILURES: usize = 5;

#[derive(Clone, Debug)]
pub enum ServiceCommand {
    Restart,
    Stop(Sender<()>),
}

#[derive(Debug)]
struct RuntimeLayout {
    node_binary: PathBuf,
    runtime_root: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStateFile {
    status: String,
    endpoint: String,
    #[serde(default)]
    pid: Option<u32>,
    #[serde(default)]
    managed_by_desktop: bool,
}

fn discovered_ownership(
    runtime_state: &RuntimeStateFile,
    handshake: &ServiceHandshake,
) -> ServiceOwnership {
    if runtime_state.managed_by_desktop && handshake.managed_by_desktop {
        ServiceOwnership::Managed
    } else {
        ServiceOwnership::External
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettingsFile {
    server_port: Option<u16>,
}

enum ChildOutcome {
    Restart,
    Stop,
    Exited,
}

fn set_status(status: &Arc<Mutex<ServiceStatus>>, next: ServiceStatus) {
    if let Ok(mut current) = status.lock() {
        *current = next;
    }
}

fn data_dir() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("DATA_DIR").filter(|value| !value.is_empty()) {
        let value = PathBuf::from(value);
        if value.starts_with("~") {
            let home = env::var_os("HOME").ok_or("HOME is not available")?;
            return Ok(PathBuf::from(home).join(value.strip_prefix("~").unwrap_or(&value)));
        }
        return Ok(value);
    }
    let home = env::var_os("HOME").ok_or("HOME is not available")?;
    Ok(PathBuf::from(home).join(".molibot"))
}

fn materialize_bundled_runtime(resource_dir: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let archive = resource_dir.join("molibot-runtime.tar.gz");
    let version = read_to_string(resource_dir.join("molibot-runtime.version"))
        .map_err(|error| format!("failed to read bundled runtime version: {error}"))?;
    let runtime_cache = data_dir.join("runtime/desktop-runtime");
    let marker = runtime_cache.join(".molibot-runtime-version");
    if read_to_string(&marker).ok().as_deref() == Some(version.as_str())
        && runtime_cache.join("scripts/start-server.mjs").is_file()
        && runtime_cache
            .join("node_modules/dotenv/package.json")
            .is_file()
    {
        return Ok(runtime_cache);
    }

    let runtime_parent = data_dir.join("runtime");
    let staging_parent = runtime_parent.join(format!("desktop-runtime-{}", Uuid::new_v4()));
    create_dir_all(&staging_parent).map_err(|error| error.to_string())?;
    let result = Command::new("/usr/bin/tar")
        .args(["-xzf"])
        .arg(&archive)
        .arg("-C")
        .arg(&staging_parent)
        .status()
        .map_err(|error| format!("failed to extract bundled runtime: {error}"));
    match result {
        Ok(status) if status.success() => {}
        Ok(status) => {
            let _ = remove_dir_all(&staging_parent);
            return Err(format!("bundled runtime extraction exited with {status}"));
        }
        Err(error) => {
            let _ = remove_dir_all(&staging_parent);
            return Err(error);
        }
    }
    let staged_runtime = staging_parent.join("molibot-runtime");
    if !staged_runtime.join("scripts/start-server.mjs").is_file()
        || !staged_runtime
            .join("node_modules/dotenv/package.json")
            .is_file()
    {
        let _ = remove_dir_all(&staging_parent);
        return Err("bundled runtime archive is incomplete".into());
    }
    std::fs::write(staged_runtime.join(".molibot-runtime-version"), &version)
        .map_err(|error| error.to_string())?;
    let _ = remove_dir_all(&runtime_cache);
    rename(&staged_runtime, &runtime_cache).map_err(|error| error.to_string())?;
    let _ = remove_dir_all(&staging_parent);
    Ok(runtime_cache)
}

fn runtime_layout(app: &AppHandle, data_dir: &Path) -> Result<RuntimeLayout, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let bundled_runtime = resource_dir.join("molibot-runtime");
    let bundled_node = resource_dir.join("molibot-node");
    if resource_dir.join("molibot-runtime.tar.gz").is_file()
        && resource_dir.join("molibot-runtime.version").is_file()
        && bundled_node.is_file()
    {
        return Ok(RuntimeLayout {
            node_binary: bundled_node,
            runtime_root: materialize_bundled_runtime(&resource_dir, data_dir)?,
        });
    }
    if bundled_runtime.join("scripts/start-server.mjs").is_file() && bundled_node.is_file() {
        return Ok(RuntimeLayout {
            node_binary: bundled_node,
            runtime_root: bundled_runtime,
        });
    }

    let runtime_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let node_binary = env::var_os("MOLIBOT_NODE_BINARY")
        .or_else(|| env::var_os("NODE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    Ok(RuntimeLayout {
        node_binary,
        runtime_root,
    })
}

fn read_runtime_state(data_dir: &Path) -> Option<RuntimeStateFile> {
    let contents = read_to_string(data_dir.join("runtime/service-state.json")).ok()?;
    serde_json::from_str(&contents).ok()
}

fn local_endpoint_port(endpoint: &str) -> Option<u16> {
    let address = endpoint
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| endpoint.strip_prefix("http://localhost:"))?;
    address.trim_end_matches('/').parse().ok()
}

fn probe_handshake(endpoint: &str) -> Option<ServiceHandshake> {
    let port = local_endpoint_port(endpoint)?;
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let mut stream =
        TcpStream::connect_timeout(&address.into(), Duration::from_millis(500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .ok()?;
    stream
        .write_all(
            b"GET /api/desktop/handshake HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        )
        .ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let response = String::from_utf8(response).ok()?;
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return None;
    }
    serde_json::from_str(body).ok()
}

fn wait_for_handshake(endpoint: &str, timeout: Duration) -> Option<ServiceHandshake> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(handshake) = probe_handshake(endpoint) {
            return Some(handshake);
        }
        thread::sleep(Duration::from_millis(250));
    }
    None
}

fn choose_port(preferred: u16) -> Result<u16, String> {
    for port in preferred..=u16::MAX {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            drop(listener);
            return Ok(port);
        }
    }
    Err(format!(
        "no available loopback service port from {preferred} through {}",
        u16::MAX
    ))
}

fn preferred_port(data_dir: &Path) -> u16 {
    read_to_string(data_dir.join("settings.json"))
        .ok()
        .and_then(|contents| serde_json::from_str::<RuntimeSettingsFile>(&contents).ok())
        .and_then(|settings| settings.server_port)
        .filter(|port| *port >= 1024)
        .unwrap_or(DEFAULT_PORT)
}

fn open_log(data_dir: &Path) -> Result<File, String> {
    let runtime_dir = data_dir.join("runtime");
    create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(runtime_dir.join("desktop-sidecar.log"))
        .map_err(|error| error.to_string())
}

fn spawn_child(layout: &RuntimeLayout, data_dir: &Path, port: u16) -> Result<Child, String> {
    let log = open_log(data_dir)?;
    let stderr = log.try_clone().map_err(|error| error.to_string())?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    Command::new(&layout.node_binary)
        .arg(layout.runtime_root.join("scripts/start-server.mjs"))
        .current_dir(&layout.runtime_root)
        .env("DATA_DIR", data_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("MOLIBOT_DESKTOP_MANAGED", "1")
        .env("MOLIBOT_DESKTOP_TOKEN", token)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| error.to_string())
}

fn stop_child(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    for _ in 0..50 {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn stop_process(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
        for _ in 0..50 {
            if libc::kill(pid as i32, 0) != 0 {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

fn supervise_adopted(
    layout: RuntimeLayout,
    data_dir: PathBuf,
    pid: u32,
    status: Arc<Mutex<ServiceStatus>>,
    commands: Receiver<ServiceCommand>,
) {
    loop {
        match commands.recv_timeout(Duration::from_millis(250)) {
            Ok(ServiceCommand::Restart) => {
                stop_process(pid);
                supervise(layout, data_dir, status, commands);
                return;
            }
            Ok(ServiceCommand::Stop(ack)) => {
                stop_process(pid);
                let _ = ack.send(());
                return;
            }
            Err(RecvTimeoutError::Disconnected) => {
                stop_process(pid);
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn supervise_child(
    child: &mut Child,
    endpoint: &str,
    status: &Arc<Mutex<ServiceStatus>>,
    commands: &Receiver<ServiceCommand>,
) -> ChildOutcome {
    let ready_started = Instant::now();
    while ready_started.elapsed() < READY_TIMEOUT {
        match commands.recv_timeout(Duration::from_millis(250)) {
            Ok(ServiceCommand::Restart) => {
                stop_child(child);
                return ChildOutcome::Restart;
            }
            Ok(ServiceCommand::Stop(ack)) => {
                stop_child(child);
                let _ = ack.send(());
                return ChildOutcome::Stop;
            }
            Err(RecvTimeoutError::Disconnected) => {
                stop_child(child);
                return ChildOutcome::Stop;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            return ChildOutcome::Exited;
        }
        if let Some(handshake) = probe_handshake(endpoint) {
            if !is_compatible_handshake(&handshake, SUPPORTED_PROTOCOL_VERSION) {
                set_status(
                    status,
                    ServiceStatus {
                        endpoint: Some(endpoint.into()),
                        ownership: Some(ServiceOwnership::Managed),
                        state: ServiceState::Incompatible,
                        version: Some(handshake.version),
                    },
                );
                stop_child(child);
                return ChildOutcome::Stop;
            }
            set_status(
                status,
                ServiceStatus {
                    endpoint: Some(endpoint.into()),
                    ownership: Some(ServiceOwnership::Managed),
                    state: ServiceState::Ready,
                    version: Some(handshake.version),
                },
            );
            break;
        }
    }

    if ready_started.elapsed() >= READY_TIMEOUT {
        stop_child(child);
        return ChildOutcome::Exited;
    }

    loop {
        match commands.recv_timeout(Duration::from_millis(250)) {
            Ok(ServiceCommand::Restart) => {
                stop_child(child);
                return ChildOutcome::Restart;
            }
            Ok(ServiceCommand::Stop(ack)) => {
                stop_child(child);
                let _ = ack.send(());
                return ChildOutcome::Stop;
            }
            Err(RecvTimeoutError::Disconnected) => {
                stop_child(child);
                return ChildOutcome::Stop;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            return ChildOutcome::Exited;
        }
    }
}

fn backoff_delay(failures: usize) -> Duration {
    Duration::from_secs(1_u64 << failures.saturating_sub(1).min(4))
}

fn supervise(
    layout: RuntimeLayout,
    data_dir: PathBuf,
    status: Arc<Mutex<ServiceStatus>>,
    commands: Receiver<ServiceCommand>,
) {
    let mut failures = 0;
    loop {
        let port = match choose_port(preferred_port(&data_dir)) {
            Ok(port) => port,
            Err(error) => {
                set_status(
                    &status,
                    ServiceStatus {
                        state: ServiceState::Error,
                        ..ServiceStatus::default()
                    },
                );
                eprintln!("[desktop] failed to select service port: {error}");
                return;
            }
        };
        let endpoint = format!("http://127.0.0.1:{port}");
        set_status(
            &status,
            ServiceStatus {
                endpoint: Some(endpoint.clone()),
                ownership: Some(ServiceOwnership::Managed),
                state: ServiceState::Disconnected,
                version: None,
            },
        );
        let started = Instant::now();
        let mut child = match spawn_child(&layout, &data_dir, port) {
            Ok(child) => child,
            Err(error) => {
                eprintln!("[desktop] failed to start bundled service: {error}");
                failures += 1;
                if failures >= MAX_CONSECUTIVE_FAILURES {
                    set_status(
                        &status,
                        ServiceStatus {
                            endpoint: Some(endpoint),
                            ownership: Some(ServiceOwnership::Managed),
                            state: ServiceState::Error,
                            version: None,
                        },
                    );
                    return;
                }
                thread::sleep(backoff_delay(failures));
                continue;
            }
        };

        match supervise_child(&mut child, &endpoint, &status, &commands) {
            ChildOutcome::Stop => return,
            ChildOutcome::Restart => failures = 0,
            ChildOutcome::Exited => {
                failures = if started.elapsed() >= HEALTHY_RESET_AFTER {
                    1
                } else {
                    failures + 1
                };
                if failures >= MAX_CONSECUTIVE_FAILURES {
                    set_status(
                        &status,
                        ServiceStatus {
                            endpoint: Some(endpoint),
                            ownership: Some(ServiceOwnership::Managed),
                            state: ServiceState::Error,
                            version: None,
                        },
                    );
                    return;
                }
                match commands.recv_timeout(backoff_delay(failures)) {
                    Ok(ServiceCommand::Stop(ack)) => {
                        let _ = ack.send(());
                        return;
                    }
                    Ok(ServiceCommand::Restart) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    }
}

fn initialize_worker(
    app: AppHandle,
    status: Arc<Mutex<ServiceStatus>>,
    commands: Receiver<ServiceCommand>,
) {
    let data_dir = match data_dir() {
        Ok(data_dir) => data_dir,
        Err(error) => {
            eprintln!("[desktop] failed to resolve data directory: {error}");
            set_status(
                &status,
                ServiceStatus {
                    state: ServiceState::Error,
                    ..ServiceStatus::default()
                },
            );
            return;
        }
    };

    if let Some(runtime_state) = read_runtime_state(&data_dir) {
        let wait = if runtime_state.status == "starting" && runtime_state.pid.is_some() {
            Duration::from_secs(20)
        } else {
            Duration::from_secs(2)
        };
        if let Some(handshake) = wait_for_handshake(&runtime_state.endpoint, wait) {
            let compatible = is_compatible_handshake(&handshake, SUPPORTED_PROTOCOL_VERSION);
            let ownership = discovered_ownership(&runtime_state, &handshake);
            set_status(
                &status,
                ServiceStatus {
                    endpoint: Some(runtime_state.endpoint),
                    ownership: Some(ownership.clone()),
                    state: if compatible {
                        ServiceState::Ready
                    } else {
                        ServiceState::Incompatible
                    },
                    version: Some(handshake.version),
                },
            );
            if compatible && ownership == ServiceOwnership::Managed {
                if let (Some(pid), Ok(layout)) =
                    (runtime_state.pid, runtime_layout(&app, &data_dir))
                {
                    supervise_adopted(layout, data_dir, pid, status, commands);
                }
            }
            return;
        }
    }

    let layout = match runtime_layout(&app, &data_dir) {
        Ok(layout) => layout,
        Err(error) => {
            eprintln!("[desktop] failed to resolve bundled runtime: {error}");
            set_status(
                &status,
                ServiceStatus {
                    state: ServiceState::Error,
                    ..ServiceStatus::default()
                },
            );
            return;
        }
    };
    supervise(layout, data_dir, status, commands);
}

pub fn initialize(app: AppHandle, status: Arc<Mutex<ServiceStatus>>) -> Sender<ServiceCommand> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || initialize_worker(app, status, receiver));
    sender
}

pub fn request_restart(control: &Mutex<Option<Sender<ServiceCommand>>>) {
    if let Ok(control) = control.lock() {
        if let Some(sender) = control.as_ref() {
            let _ = sender.send(ServiceCommand::Restart);
        }
    }
}

pub fn stop_sender_and_wait(sender: Sender<ServiceCommand>, timeout: Duration) {
    let (ack_sender, ack_receiver) = mpsc::channel();
    if sender.send(ServiceCommand::Stop(ack_sender)).is_ok() {
        let _ = ack_receiver.recv_timeout(timeout);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{read_to_string, remove_dir_all, write};

    #[test]
    fn endpoint_parser_accepts_only_loopback_http() {
        assert_eq!(local_endpoint_port("http://127.0.0.1:3100"), Some(3100));
        assert_eq!(local_endpoint_port("http://localhost:3200/"), Some(3200));
        assert_eq!(local_endpoint_port("https://127.0.0.1:3100"), None);
        assert_eq!(local_endpoint_port("http://example.com:3100"), None);
    }

    #[test]
    fn rediscovered_desktop_sidecar_remains_managed() {
        let state = RuntimeStateFile {
            status: "ready".into(),
            endpoint: "http://127.0.0.1:3000".into(),
            pid: Some(42),
            managed_by_desktop: true,
        };
        let handshake = ServiceHandshake {
            service: "molibot".into(),
            version: "test".into(),
            protocol_version: SUPPORTED_PROTOCOL_VERSION,
            instance_id: None,
            managed_by_desktop: true,
            capabilities: vec!["service-ownership-v1".into()],
        };
        assert_eq!(
            discovered_ownership(&state, &handshake),
            ServiceOwnership::Managed
        );
    }

    #[test]
    fn restart_backoff_is_bounded() {
        assert_eq!(backoff_delay(1), Duration::from_secs(1));
        assert_eq!(backoff_delay(4), Duration::from_secs(8));
        assert_eq!(backoff_delay(8), Duration::from_secs(16));
    }

    #[test]
    fn managed_child_receives_sigterm_before_force_kill() {
        let temp_dir = env::temp_dir().join(format!("molibot-supervisor-{}", Uuid::new_v4()));
        create_dir_all(&temp_dir).expect("create temp dir");
        let marker = temp_dir.join("terminated");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("trap 'printf term > \"$MARKER\"; exit 0' TERM; while :; do sleep 0.1; done")
            .env("MARKER", &marker)
            .spawn()
            .expect("spawn signal fixture");
        thread::sleep(Duration::from_millis(100));
        stop_child(&mut child);
        assert_eq!(read_to_string(&marker).expect("SIGTERM marker"), "term");
        remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn bundled_runtime_is_materialized_once_with_production_dependencies() {
        let temp_dir = env::temp_dir().join(format!("molibot-runtime-{}", Uuid::new_v4()));
        let resources = temp_dir.join("resources");
        let source = temp_dir.join("source/molibot-runtime");
        let data_dir = temp_dir.join("data");
        create_dir_all(source.join("scripts")).expect("create scripts fixture");
        create_dir_all(source.join("node_modules/dotenv")).expect("create dependency fixture");
        create_dir_all(&resources).expect("create resources fixture");
        write(source.join("scripts/start-server.mjs"), "// fixture\n")
            .expect("write server fixture");
        write(source.join("node_modules/dotenv/package.json"), "{}")
            .expect("write dependency fixture");
        write(resources.join("molibot-runtime.version"), "test-version\n").expect("write version");
        let status = Command::new("/usr/bin/tar")
            .args(["-czf"])
            .arg(resources.join("molibot-runtime.tar.gz"))
            .arg("-C")
            .arg(temp_dir.join("source"))
            .arg("molibot-runtime")
            .status()
            .expect("create runtime archive");
        assert!(status.success());

        let runtime =
            materialize_bundled_runtime(&resources, &data_dir).expect("materialize runtime");
        write(runtime.join("preserved"), "yes").expect("write idempotency marker");
        let second = materialize_bundled_runtime(&resources, &data_dir).expect("reuse runtime");
        assert_eq!(runtime, second);
        assert_eq!(
            read_to_string(second.join("preserved")).expect("preserved marker"),
            "yes"
        );
        remove_dir_all(temp_dir).expect("remove temp dir");
    }
}
