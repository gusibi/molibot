use crate::service::{
    is_compatible_handshake, ServiceHandshake, ServiceOwnership, ServiceState, ServiceStatus,
};
use file_rotate::{
    compression::Compression,
    suffix::AppendCount,
    ContentLimit,
    FileRotate,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::ffi::OsString;
use std::collections::BTreeSet;
use std::fs::{create_dir_all, metadata, read_to_string, remove_dir_all, rename, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::os::unix::fs::PermissionsExt;
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
    /// Directory holding the bundled `rg`/`fd` that back the agent's `grep` and
    /// `find` tools, prepended to the spawned runtime's PATH. `None` outside a
    /// bundle, where the developer's own installation is used instead.
    search_tools_dir: Option<PathBuf>,
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

struct ManagedChild {
    process: Child,
    log_pumps: Vec<thread::JoinHandle<()>>,
}

impl ManagedChild {
    fn finish_log_pumps(&mut self) {
        for pump in self.log_pumps.drain(..) {
            let _ = pump.join();
        }
    }

    fn has_exited(&mut self) -> bool {
        if matches!(self.process.try_wait(), Ok(Some(_))) {
            self.finish_log_pumps();
            true
        } else {
            false
        }
    }
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

/// Upper bound on how many bytes we pull from the tail of the log before
/// slicing it down to `max_lines`. Comfortably holds a few thousand log lines
/// while keeping the read cheap even when the file has grown to tens of MB.
const LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;
const LOG_ROTATE_BYTES: u64 = 20 * 1024 * 1024;
const LOG_ROTATE_GENERATIONS: usize = 5;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServiceLogQuery {
    pub levels: Vec<String>,
    pub categories: Vec<String>,
    pub statuses: Vec<String>,
    pub event: Option<String>,
    pub keyword: Option<String>,
    pub run_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tool: Option<String>,
    pub subagent: Option<String>,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogOptions {
    pub levels: Vec<String>,
    pub categories: Vec<String>,
    pub statuses: Vec<String>,
    pub events: Vec<String>,
    pub providers: Vec<String>,
    pub models: Vec<String>,
    pub tools: Vec<String>,
    pub subagents: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogRecord {
    pub id: String,
    pub ts: Option<String>,
    pub level: String,
    pub category: String,
    pub event: String,
    pub schema_version: Option<u64>,
    pub scope: Option<String>,
    pub status: Option<String>,
    pub message: Option<String>,
    pub raw: String,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub chat_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tool: Option<String>,
    pub tool_call_id: Option<String>,
    pub subagent: Option<String>,
    pub delegation_id: Option<String>,
    pub duration_ms: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogPage {
    pub items: Vec<ServiceLogRecord>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub scanned_lines: usize,
    pub truncated: bool,
    pub has_raw_lines: bool,
    pub options: ServiceLogOptions,
}

pub fn service_log_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("runtime/desktop-sidecar.log"))
}

pub fn query_desktop_service_log(query: ServiceLogQuery) -> Result<ServiceLogPage, String> {
    query_service_log(&service_log_path()?, query)
}

fn read_log_window(path: &Path) -> Result<(String, bool), String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((String::new(), false)),
        Err(error) => return Err(error.to_string()),
    };
    let length = file.metadata().map_err(|error| error.to_string())?.len();
    let truncated = length > LOG_TAIL_BYTES;
    if truncated {
        file.seek(SeekFrom::Start(length - LOG_TAIL_BYTES)).map_err(|error| error.to_string())?;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    let text = if truncated { text.split_once('\n').map(|(_, tail)| tail).unwrap_or("") } else { text.as_ref() };
    Ok((strip_ansi(text), truncated))
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| value.get(*key)).and_then(|value| match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    })
}

fn category_for(scope: &str, event: &str) -> String {
    let event = event.to_ascii_lowercase();
    if event.starts_with("llm_")
        || event.starts_with("model_")
        || event.starts_with("assistant_")
        || event == "api_key_resolve"
        || event == "empty_response_retry"
    { return "llm".into(); }
    if event.starts_with("subagent_") || event.starts_with("skill_draft_subagent_") { return "subagent".into(); }
    if event.starts_with("tool_") || event.contains("host_bash") { return "tool".into(); }
    if event.contains("approval") { return "approval".into(); }
    if event.contains("sandbox") { return "sandbox".into(); }
    if event.contains("queue") || event.contains("lease") { return "queue".into(); }
    if event.contains("prompt") || event.contains("context") || event.contains("compact") { return "context".into(); }
    if event.starts_with("skill_") { return "skill".into(); }
    if event.contains("message") || event.contains("send") || event.contains("outbound") { return "delivery".into(); }
    if matches!(scope, "telegram" | "feishu" | "qq" | "weixin" | "web") { return "channel".into(); }
    "runtime".into()
}

fn inferred_level(event: &str) -> String {
    let event = event.to_ascii_lowercase();
    if event.contains("failed") || event.contains("failure") || event.contains("error") { "error".into() }
    else if event.contains("warn") || event.contains("retry") || event.contains("timeout") || event.contains("blocked") { "warn".into() }
    else { "info".into() }
}

fn inferred_status(event: &str) -> Option<String> {
    let event = event.to_ascii_lowercase();
    if event.contains("blocked") || event.contains("denied") { Some("blocked".into()) }
    else if event.contains("timeout") { Some("timeout".into()) }
    else if event.contains("retry") { Some("retrying".into()) }
    else if event.contains("failed") || event.contains("failure") || event.contains("error") { Some("error".into()) }
    else if event.ends_with("_start") || event.ends_with("_started") { Some("started".into()) }
    else if event.ends_with("_end") || event.ends_with("_success") || event.ends_with("_completed") { Some("success".into()) }
    else { None }
}

fn parse_pretty_fields(text: &str) -> std::collections::BTreeMap<String, String> {
    text.split_whitespace().filter_map(|part| {
        let (key, value) = part.split_once('=')?;
        Some((key.to_string(), value.trim_matches('"').to_string()))
    }).collect()
}

fn parse_service_log_line(line: &str, index: usize) -> ServiceLogRecord {
    let raw = line.trim().to_string();
    let json_text = raw.strip_prefix("[mom-t] ").filter(|value| value.starts_with('{'));
    if let Some(json_text) = json_text {
        if let Ok(value) = serde_json::from_str::<Value>(json_text) {
            let event = value_string(&value, &["event"]).unwrap_or_else(|| "service.record".into());
            let scope = value_string(&value, &["scope"]);
            return ServiceLogRecord {
                id: format!("line-{index}"),
                ts: value_string(&value, &["ts"]),
                level: value_string(&value, &["level"]).unwrap_or_else(|| inferred_level(&event)),
                category: value_string(&value, &["category"]).unwrap_or_else(|| category_for(scope.as_deref().unwrap_or("service"), &event)),
                event: event.clone(),
                schema_version: value.get("schemaVersion").and_then(Value::as_u64),
                scope,
                status: value_string(&value, &["status"]).or_else(|| inferred_status(&event)),
                message: value_string(&value, &["message", "errorMessage", "reason", "resultPreview"]),
                raw,
                run_id: value_string(&value, &["runId"]),
                session_id: value_string(&value, &["sessionId"]),
                chat_id: value_string(&value, &["chatId"]),
                provider: value_string(&value, &["provider", "modelProvider"]),
                model: value_string(&value, &["model", "modelId"]),
                tool: value_string(&value, &["tool", "toolName"]),
                tool_call_id: value_string(&value, &["toolCallId"]),
                subagent: value_string(&value, &["agent", "subagent"]),
                delegation_id: value_string(&value, &["delegationId"]),
                duration_ms: value.get("durationMs").and_then(Value::as_f64),
            };
        }
    }

    let parts: Vec<&str> = raw.split_whitespace().collect();
    if parts.len() >= 7 && parts[0] == "[mom-t]" && parts[1].len() == 10 && parts[1].as_bytes().get(4) == Some(&b'-') {
        let scope = parts[3].to_string();
        let event = parts[5].to_string();
        let fields = parse_pretty_fields(&parts[6..].join(" "));
        return ServiceLogRecord {
            id: format!("line-{index}"),
            ts: Some(format!("{}T{}", parts[1], parts[2])),
            level: inferred_level(&event),
            category: category_for(&scope, &event),
            event: event.clone(),
            schema_version: None,
            scope: Some(scope),
            status: fields.get("status").cloned().or_else(|| inferred_status(&event)),
            message: fields.get("message").cloned().or_else(|| fields.get("error").cloned()),
            raw,
            run_id: fields.get("run").or_else(|| fields.get("runId")).cloned(),
            session_id: fields.get("session").or_else(|| fields.get("sessionId")).cloned(),
            chat_id: fields.get("chat").or_else(|| fields.get("chatId")).cloned(),
            provider: fields.get("provider").or_else(|| fields.get("modelProvider")).cloned(),
            model: fields.get("modelId").or_else(|| fields.get("model")).cloned(),
            tool: fields.get("tool").cloned(),
            tool_call_id: fields.get("toolCallId").cloned(),
            subagent: fields.get("agent").cloned(),
            delegation_id: fields.get("delegationId").cloned(),
            duration_ms: fields.get("durationMs").and_then(|value| value.parse().ok()),
        };
    }

    ServiceLogRecord {
        id: format!("line-{index}"), ts: None, level: "info".into(), category: "external".into(),
        event: "external.raw_line".into(), schema_version: None, scope: None, status: None,
        message: if raw.is_empty() { None } else { Some(raw.clone()) }, raw, run_id: None,
        session_id: None, chat_id: None, provider: None, model: None, tool: None,
        tool_call_id: None, subagent: None, delegation_id: None, duration_ms: None,
    }
}

fn matches_term(value: Option<&str>, query: Option<&str>) -> bool {
    match query.map(str::trim).filter(|value| !value.is_empty()) {
        None => true,
        Some(query) => value.unwrap_or("").to_ascii_lowercase().contains(&query.to_ascii_lowercase()),
    }
}

fn query_service_log(path: &Path, query: ServiceLogQuery) -> Result<ServiceLogPage, String> {
    let (text, truncated) = read_log_window(path)?;
    let records: Vec<ServiceLogRecord> = text.lines().enumerate().map(|(index, line)| parse_service_log_line(line, index)).collect();
    let has_raw_lines = records.iter().any(|record| record.category == "external");
    let options = ServiceLogOptions {
        levels: records.iter().map(|record| record.level.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        categories: records.iter().map(|record| record.category.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        statuses: records.iter().filter_map(|record| record.status.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        events: records.iter().map(|record| record.event.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        providers: records.iter().filter_map(|record| record.provider.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        models: records.iter().filter_map(|record| record.model.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        tools: records.iter().filter_map(|record| record.tool.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
        subagents: records.iter().filter_map(|record| record.subagent.clone()).collect::<BTreeSet<_>>().into_iter().collect(),
    };
    let keyword = query.keyword.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(str::to_ascii_lowercase);
    let mut filtered: Vec<ServiceLogRecord> = records.into_iter().filter(|record| {
        (query.levels.is_empty() || query.levels.iter().any(|value| value == &record.level))
            && (query.categories.is_empty() || query.categories.iter().any(|value| value == &record.category))
            && (query.statuses.is_empty() || record.status.as_ref().is_some_and(|status| query.statuses.iter().any(|value| value == status)))
            && matches_term(Some(&record.event), query.event.as_deref())
            && matches_term(record.run_id.as_deref(), query.run_id.as_deref())
            && matches_term(record.provider.as_deref(), query.provider.as_deref())
            && matches_term(record.model.as_deref(), query.model.as_deref())
            && matches_term(record.tool.as_deref(), query.tool.as_deref())
            && matches_term(record.subagent.as_deref(), query.subagent.as_deref())
            && keyword.as_ref().is_none_or(|keyword| record.raw.to_ascii_lowercase().contains(keyword))
    }).collect();
    filtered.reverse();
    let total = filtered.len();
    let page = query.page.max(1);
    let page_size = query.page_size.clamp(10, 200);
    let start = (page - 1).saturating_mul(page_size);
    let items = filtered.into_iter().skip(start).take(page_size).collect();
    Ok(ServiceLogPage { items, total, page, page_size, scanned_lines: text.lines().count(), truncated, has_raw_lines, options })
}

/// Removes terminal control sequences (ANSI CSI/OSC colour codes, stray C0
/// control bytes) so the log renders as plain readable text in the WebView.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.peek() {
                // CSI sequence: ESC [ ... final byte in 0x40..=0x7E (e.g. colours "…m").
                Some('[') => {
                    chars.next();
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if ('\u{40}'..='\u{7e}').contains(&next) {
                            break;
                        }
                    }
                }
                // OSC sequence: ESC ] ... terminated by BEL or ST (ESC \).
                Some(']') => {
                    chars.next();
                    while let Some(next) = chars.next() {
                        if next == '\u{07}' {
                            break;
                        }
                        if next == '\u{1b}' {
                            chars.next();
                            break;
                        }
                    }
                }
                // Any other escape: drop the lone ESC.
                _ => {}
            },
            // Keep tab and newline; drop other non-printable C0 control bytes.
            '\t' | '\n' => out.push(c),
            _ if (c as u32) < 0x20 => {}
            _ => out.push(c),
        }
    }
    out
}

fn materialize_bundled_runtime(resource_dir: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let archive = resource_dir.join("molibot-runtime.tar.gz");
    let version = read_to_string(resource_dir.join("molibot-runtime.version"))
        .map_err(|error| format!("failed to read bundled runtime version: {error}"))?;
    let version_slug = version.trim();
    if version_slug.is_empty()
        || !version_slug
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
    {
        return Err("bundled runtime version contains unsupported characters".into());
    }
    // Runtime generations are immutable. An adopted sidecar may still have the
    // previous manifest in memory and lazy-load its hashed chunks after the new
    // Desktop app starts, so replacing a shared directory would break that live
    // process with ERR_MODULE_NOT_FOUND.
    let runtime_cache = data_dir
        .join("runtime")
        .join(format!("desktop-runtime-{version_slug}"));
    let marker = runtime_cache.join(".molibot-runtime-version");
    if read_to_string(&marker).ok().as_deref() == Some(version_slug)
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
    std::fs::write(staged_runtime.join(".molibot-runtime-version"), version_slug)
        .map_err(|error| error.to_string())?;
    let _ = remove_dir_all(&runtime_cache);
    rename(&staged_runtime, &runtime_cache).map_err(|error| error.to_string())?;
    let _ = remove_dir_all(&staging_parent);
    Ok(runtime_cache)
}

fn is_executable_file(path: &Path) -> bool {
    metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// `molibot-tools/` is staged by `scripts/prepare-desktop-runtime.mjs` and
/// bundled by `tauri.bundle.conf.json`. Both binaries must be present and
/// executable before the directory is worth putting on PATH — a partial bundle
/// should leave `grep`/`find` reporting a missing binary, which is what pi does
/// under `PI_OFFLINE=1`, rather than failing later with an exec error.
fn bundled_search_tools_dir(resource_dir: &Path) -> Option<PathBuf> {
    let tools_dir = resource_dir.join("molibot-tools");
    if is_executable_file(&tools_dir.join("rg")) && is_executable_file(&tools_dir.join("fd")) {
        return Some(tools_dir);
    }
    None
}

/// Prepends `tools_dir` to `inherited`, dropping any existing copy so repeated
/// restarts cannot grow PATH. Returns `None` if the entries cannot be joined
/// (a path containing `:`), in which case the caller leaves PATH untouched.
fn search_tools_path(tools_dir: &Path, inherited: Option<OsString>) -> Option<OsString> {
    let mut entries = vec![tools_dir.to_path_buf()];
    if let Some(inherited) = inherited.as_ref() {
        entries.extend(env::split_paths(inherited).filter(|entry| entry != tools_dir));
    }
    env::join_paths(entries).ok()
}

fn runtime_layout(app: &AppHandle, data_dir: &Path) -> Result<RuntimeLayout, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let bundled_runtime = resource_dir.join("molibot-runtime");
    let bundled_node = resource_dir.join("molibot-node");
    let search_tools_dir = bundled_search_tools_dir(&resource_dir);
    if resource_dir.join("molibot-runtime.tar.gz").is_file()
        && resource_dir.join("molibot-runtime.version").is_file()
        && bundled_node.is_file()
    {
        return Ok(RuntimeLayout {
            node_binary: bundled_node,
            runtime_root: materialize_bundled_runtime(&resource_dir, data_dir)?,
            search_tools_dir,
        });
    }
    if bundled_runtime.join("scripts/start-server.mjs").is_file() && bundled_node.is_file() {
        return Ok(RuntimeLayout {
            node_binary: bundled_node,
            runtime_root: bundled_runtime,
            search_tools_dir,
        });
    }

    let runtime_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let node_binary = env::var_os("MOLIBOT_NODE_BINARY")
        .or_else(|| env::var_os("NODE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    // Dev runs use whatever rg/fd the developer has installed, so PATH is left
    // exactly as inherited.
    Ok(RuntimeLayout {
        node_binary,
        runtime_root,
        search_tools_dir: None,
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

struct RecordRollingWriter {
    writer: FileRotate<AppendCount>,
    max_bytes: usize,
    current_bytes: usize,
}

impl RecordRollingWriter {
    fn write_record(&mut self, record: &[u8]) -> io::Result<()> {
        if record.len() <= self.max_bytes
            && self.current_bytes > 0
            && self.current_bytes + record.len() > self.max_bytes
        {
            self.writer.rotate()?;
            self.current_bytes = 0;
        }

        let mut remaining = record;
        while !remaining.is_empty() {
            if self.current_bytes >= self.max_bytes {
                self.writer.rotate()?;
                self.current_bytes = 0;
            }
            let write_len = remaining.len().min(self.max_bytes - self.current_bytes);
            self.writer.write_all(&remaining[..write_len])?;
            self.current_bytes += write_len;
            remaining = &remaining[write_len..];
        }
        Ok(())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

type RollingLogWriter = Arc<Mutex<RecordRollingWriter>>;

fn open_rolling_log(
    data_dir: &Path,
    max_bytes: usize,
    archive_count: usize,
) -> Result<RollingLogWriter, String> {
    if max_bytes == 0 {
        return Err("service log maximum size must be greater than zero".into());
    }
    let runtime_dir = data_dir.join("runtime");
    create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
    let path = runtime_dir.join("desktop-sidecar.log");
    // Fail service startup with a useful error if the log path is not writable.
    // FileRotate opens lazily and otherwise treats open failures as dropped output.
    OpenOptions::new()
        .read(true)
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let current_bytes = metadata(&path)
        .map(|metadata| metadata.len() as usize)
        .unwrap_or(0);
    Ok(Arc::new(Mutex::new(RecordRollingWriter {
        writer: FileRotate::new(
            path,
            AppendCount::new(archive_count),
            ContentLimit::None,
            Compression::None,
            None,
        ),
        max_bytes,
        current_bytes,
    })))
}

fn spawn_log_pump<R>(reader: R, writer: RollingLogWriter) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut record = Vec::new();
        loop {
            record.clear();
            match reader.read_until(b'\n', &mut record) {
                Ok(0) => break,
                Ok(_) => {
                    let result = writer
                        .lock()
                        .map_err(|_| "rolling log writer lock was poisoned".to_string())
                        .and_then(|mut writer| writer.write_record(&record).map_err(|error| error.to_string()));
                    if let Err(error) = result {
                        eprintln!("[desktop] failed to write service log: {error}");
                        break;
                    }
                }
                Err(error) => {
                    eprintln!("[desktop] failed to read service output: {error}");
                    break;
                }
            }
        }
        if let Ok(mut writer) = writer.lock() {
            let _ = writer.flush();
        }
    })
}

fn spawn_child(layout: &RuntimeLayout, data_dir: &Path, port: u16) -> Result<ManagedChild, String> {
    let log = open_rolling_log(
        data_dir,
        LOG_ROTATE_BYTES as usize,
        LOG_ROTATE_GENERATIONS,
    )?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut command = Command::new(&layout.node_binary);
    command
        .arg(layout.runtime_root.join("scripts/start-server.mjs"))
        .current_dir(&layout.runtime_root)
        .env("DATA_DIR", data_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("MOLIBOT_DESKTOP_MANAGED", "1")
        .env("MOM_LOG_PRETTY", "0")
        .env("MOLIBOT_DESKTOP_TOKEN", token);
    // pi's `getToolPath` probes PATH for `rg`/`fd`, so exposing the bundled
    // directory is all the agent's `grep`/`find` tools need. Prepending keeps
    // the bundled, version-pinned binaries ahead of any host installation while
    // leaving the rest of PATH intact for the `bash` tool.
    if let Some(tools_dir) = layout.search_tools_dir.as_ref() {
        match search_tools_path(tools_dir, env::var_os("PATH")) {
            Some(path) => {
                command.env("PATH", path);
            }
            None => eprintln!(
                "molibot: could not add {} to PATH; grep/find will report a missing binary",
                tools_dir.display()
            ),
        }
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("service stdout pipe is unavailable")?;
    let stderr = child.stderr.take().ok_or("service stderr pipe is unavailable")?;
    let stdout_pump = spawn_log_pump(stdout, Arc::clone(&log));
    let stderr_pump = spawn_log_pump(stderr, log);
    Ok(ManagedChild {
        process: child,
        log_pumps: vec![stdout_pump, stderr_pump],
    })
}

fn stop_child(child: &mut ManagedChild) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.process.id() as i32, libc::SIGTERM);
    }
    for _ in 0..50 {
        match child.process.try_wait() {
            Ok(Some(_)) => {
                child.finish_log_pumps();
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    let _ = child.process.kill();
    let _ = child.process.wait();
    child.finish_log_pumps();
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
    child: &mut ManagedChild,
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
        if child.has_exited() {
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
        if child.has_exited() {
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
    fn log_reader_strips_ansi_and_control_sequences() {
        let path = env::temp_dir().join(format!("molibot-log-ansi-{}", Uuid::new_v4()));
        // Bold + colour codes, an OSC title sequence, and a stray BEL around CJK text.
        write(
            &path,
            "\u{1b}[1m[mom-t]\u{1b}[0m \u{1b}[33mtelegram\u{1b}[0m \u{07}环境诊断\u{1b}]0;title\u{07}done\n",
        )
        .expect("write log fixture");
        let (text, truncated) = read_log_window(&path).expect("read log window");
        assert!(!truncated);
        assert_eq!(text.trim(), "[mom-t] telegram 环境诊断done");
        std::fs::remove_file(path).expect("remove log fixture");
    }

    #[test]
    fn structured_log_query_parses_filters_and_paginates_mixed_lines() {
        let path = env::temp_dir().join(format!("molibot-log-query-{}", Uuid::new_v4()));
        write(
            &path,
            concat!(
                "third party boot line\n",
                "[mom-t] 2026-07-29 10:00:00 runner 🏃 run_start run=run-1 chat=chat-1\n",
                "[mom-t] {\"ts\":\"2026-07-29T10:00:01.000Z\",\"level\":\"info\",\"category\":\"llm\",\"event\":\"llm_request_sent\",\"schemaVersion\":1,\"runId\":\"run-1\",\"provider\":\"openai\",\"model\":\"gpt-test\"}\n",
                "[mom-t] {\"ts\":\"2026-07-29T10:00:02.000Z\",\"level\":\"error\",\"category\":\"tool\",\"event\":\"tool_end\",\"schemaVersion\":1,\"runId\":\"run-1\",\"tool\":\"bash\",\"status\":\"error\"}\n"
            )
        )
        .expect("write structured log fixture");

        let page = query_service_log(
            &path,
            ServiceLogQuery {
                categories: vec!["llm".into()],
                run_id: Some("run-1".into()),
                page: 1,
                page_size: 1,
                ..ServiceLogQuery::default()
            },
        )
        .expect("query service log");

        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].event, "llm_request_sent");
        assert_eq!(page.items[0].provider.as_deref(), Some("openai"));
        assert!(page.has_raw_lines);
        std::fs::remove_file(path).expect("remove log fixture");
    }

    #[test]
    fn log_rotation_bounds_active_file_and_keeps_recent_history() {
        let temp_dir = env::temp_dir().join(format!("molibot-log-rotate-{}", Uuid::new_v4()));
        let active = temp_dir.join("runtime/desktop-sidecar.log");
        let writer = open_rolling_log(&temp_dir, 80, 2).expect("open rolling log");
        let records = (0..12)
            .map(|index| format!("record-{index:02}-complete\n"))
            .collect::<String>();
        let pump = spawn_log_pump(std::io::Cursor::new(records.clone()), writer);
        pump.join().expect("join log pump");

        assert!(active.exists());
        assert!(temp_dir.join("runtime/desktop-sidecar.log.1").exists());
        assert!(temp_dir.join("runtime/desktop-sidecar.log.2").exists());
        assert!(!temp_dir.join("runtime/desktop-sidecar.log.3").exists());
        for path in [&active, &temp_dir.join("runtime/desktop-sidecar.log.1"), &temp_dir.join("runtime/desktop-sidecar.log.2")] {
            assert!(metadata(path).expect("read rolling log metadata").len() <= 80);
            let text = read_to_string(path).expect("read rolling log generation");
            assert!(text.lines().all(|line| line.starts_with("record-") && line.ends_with("-complete")));
        }

        let reconstructed = [
            temp_dir.join("runtime/desktop-sidecar.log.2"),
            temp_dir.join("runtime/desktop-sidecar.log.1"),
            active.clone(),
        ]
        .iter()
        .map(|path| read_to_string(path).expect("read ordered rolling generation"))
        .collect::<String>();
        assert_eq!(reconstructed, records);

        let restarted = query_service_log(&active, ServiceLogQuery::default())
            .expect("query restarted active log");
        assert!(!restarted.items.is_empty());
        remove_dir_all(temp_dir).expect("remove rotation fixture");
    }

    #[test]
    fn managed_log_pumps_flush_both_streams_before_restart() {
        let temp_dir = env::temp_dir().join(format!("molibot-log-pumps-{}", Uuid::new_v4()));
        let writer = open_rolling_log(&temp_dir, 1024, 2).expect("open rolling log");
        let mut process = Command::new("sh")
            .arg("-c")
            .arg("printf 'stdout-record\\n'; printf 'stderr-record\\n' >&2")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn output fixture");
        let stdout = process.stdout.take().expect("take stdout");
        let stderr = process.stderr.take().expect("take stderr");
        let mut child = ManagedChild {
            process,
            log_pumps: vec![
                spawn_log_pump(stdout, Arc::clone(&writer)),
                spawn_log_pump(stderr, writer),
            ],
        };

        while !child.has_exited() {
            thread::sleep(Duration::from_millis(10));
        }

        assert!(child.log_pumps.is_empty());
        let text = read_to_string(temp_dir.join("runtime/desktop-sidecar.log"))
            .expect("read flushed service log");
        assert!(text.contains("stdout-record\n"));
        assert!(text.contains("stderr-record\n"));
        remove_dir_all(temp_dir).expect("remove log pump fixture");
    }

    #[test]
    fn oversized_single_log_record_still_respects_the_hard_file_limit() {
        let temp_dir = env::temp_dir().join(format!("molibot-log-oversized-{}", Uuid::new_v4()));
        let writer = open_rolling_log(&temp_dir, 80, 3).expect("open rolling log");
        let record = vec![b'x'; 180];
        spawn_log_pump(std::io::Cursor::new(record.clone()), writer)
            .join()
            .expect("join oversized record pump");

        let paths = [
            temp_dir.join("runtime/desktop-sidecar.log.2"),
            temp_dir.join("runtime/desktop-sidecar.log.1"),
            temp_dir.join("runtime/desktop-sidecar.log"),
        ];
        let mut reconstructed = Vec::new();
        for path in paths {
            assert!(metadata(&path).expect("read oversized generation metadata").len() <= 80);
            reconstructed.extend(std::fs::read(path).expect("read oversized generation"));
        }
        assert_eq!(reconstructed, record);
        remove_dir_all(temp_dir).expect("remove oversized record fixture");
    }

    #[test]
    fn managed_child_receives_sigterm_before_force_kill() {
        let temp_dir = env::temp_dir().join(format!("molibot-supervisor-{}", Uuid::new_v4()));
        create_dir_all(&temp_dir).expect("create temp dir");
        let marker = temp_dir.join("terminated");
        let process = Command::new("sh")
            .arg("-c")
            .arg("trap 'printf term > \"$MARKER\"; exit 0' TERM; while :; do sleep 0.1; done")
            .env("MARKER", &marker)
            .spawn()
            .expect("spawn signal fixture");
        let mut child = ManagedChild {
            process,
            log_pumps: Vec::new(),
        };
        thread::sleep(Duration::from_millis(100));
        stop_child(&mut child);
        assert_eq!(read_to_string(&marker).expect("SIGTERM marker"), "term");
        remove_dir_all(temp_dir).expect("remove temp dir");
    }

    fn write_tool(dir: &Path, name: &str, mode: u32) {
        let path = dir.join(name);
        write(&path, "#!/bin/sh\n").expect("write tool fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
            .expect("set tool mode");
    }

    #[test]
    fn bundled_search_tools_require_both_binaries_to_be_executable() {
        let temp_dir = env::temp_dir().join(format!("molibot-tools-{}", Uuid::new_v4()));
        let tools_dir = temp_dir.join("molibot-tools");
        create_dir_all(&tools_dir).expect("create tools fixture");

        // Nothing staged yet.
        assert_eq!(bundled_search_tools_dir(&temp_dir), None);

        // Only rg present: still unusable, `find` would fail at exec time.
        write_tool(&tools_dir, "rg", 0o755);
        assert_eq!(bundled_search_tools_dir(&temp_dir), None);

        // Both present but fd lost its executable bit in packaging.
        write_tool(&tools_dir, "fd", 0o644);
        assert_eq!(bundled_search_tools_dir(&temp_dir), None);

        write_tool(&tools_dir, "fd", 0o755);
        assert_eq!(bundled_search_tools_dir(&temp_dir), Some(tools_dir));

        remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn search_tools_path_prepends_without_dropping_or_duplicating_entries() {
        let tools_dir = PathBuf::from("/Applications/Molibot.app/Contents/Resources/molibot-tools");

        let composed = search_tools_path(&tools_dir, Some(OsString::from("/usr/bin:/bin")))
            .expect("compose PATH");
        assert_eq!(
            env::split_paths(&composed).collect::<Vec<_>>(),
            vec![
                tools_dir.clone(),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ]
        );

        // A restart must not grow PATH with a second copy of the tools dir.
        let repeated = search_tools_path(&tools_dir, Some(composed)).expect("recompose PATH");
        assert_eq!(
            env::split_paths(&repeated).collect::<Vec<_>>(),
            vec![
                tools_dir.clone(),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ]
        );

        // No inherited PATH at all still yields a usable single-entry PATH.
        let bare = search_tools_path(&tools_dir, None).expect("compose bare PATH");
        assert_eq!(
            env::split_paths(&bare).collect::<Vec<_>>(),
            vec![tools_dir]
        );
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

    #[test]
    fn bundled_runtime_upgrade_keeps_chunks_used_by_the_previous_generation() {
        let temp_dir = env::temp_dir().join(format!("molibot-runtime-upgrade-{}", Uuid::new_v4()));
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
        write(resources.join("molibot-runtime.version"), "1.0.0\n").expect("write v1 version");
        let archive = resources.join("molibot-runtime.tar.gz");
        let first_tar = Command::new("/usr/bin/tar")
            .args(["-czf"])
            .arg(&archive)
            .arg("-C")
            .arg(temp_dir.join("source"))
            .arg("molibot-runtime")
            .status()
            .expect("create v1 runtime archive");
        assert!(first_tar.success());

        let first = materialize_bundled_runtime(&resources, &data_dir).expect("materialize v1");
        let old_chunk = first.join("build/server/chunks/old-route.js");
        create_dir_all(old_chunk.parent().expect("old chunk parent")).expect("create old chunks");
        write(&old_chunk, "export const oldRoute = true;\n").expect("write old chunk");

        write(resources.join("molibot-runtime.version"), "1.0.1\n").expect("write v2 version");
        let second_tar = Command::new("/usr/bin/tar")
            .args(["-czf"])
            .arg(&archive)
            .arg("-C")
            .arg(temp_dir.join("source"))
            .arg("molibot-runtime")
            .status()
            .expect("create v2 runtime archive");
        assert!(second_tar.success());

        let second = materialize_bundled_runtime(&resources, &data_dir).expect("materialize v2");
        assert_ne!(
            first, second,
            "each runtime version needs an immutable directory"
        );
        assert!(
            old_chunk.is_file(),
            "the running v1 manifest still needs its old chunk"
        );
        remove_dir_all(temp_dir).expect("remove temp dir");
    }
}
