mod audio;
pub mod service;
mod supervisor;

use serde::Serialize;
use service::{ServiceOwnership, ServiceStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_opener::OpenerExt;

struct DesktopState {
    service: Arc<Mutex<ServiceStatus>>,
    control: Mutex<Option<std::sync::mpsc::Sender<supervisor::ServiceCommand>>>,
    exit_after_stop: AtomicBool,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            service: Arc::new(Mutex::new(ServiceStatus::default())),
            control: Mutex::new(None),
            exit_after_stop: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    service: ServiceStatus,
    launch_at_login: bool,
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_window(&app, "settings");
}

#[tauri::command]
async fn pick_project_directory() -> Result<Option<String>, String> {
    let output = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", "POSIX path of (choose folder)"])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!path.is_empty()).then_some(path));
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if error.contains("-128") || error.to_lowercase().contains("canceled") {
        return Ok(None);
    }
    Err(if error.is_empty() { "Unable to open the folder picker.".into() } else { error })
}

#[tauri::command]
fn desktop_status(
    app: AppHandle,
    state: tauri::State<'_, Mutex<DesktopState>>,
) -> Result<DesktopStatus, String> {
    let desktop = state.lock().map_err(|_| "desktop state is unavailable")?;
    let service = desktop
        .service
        .lock()
        .map_err(|_| "service state is unavailable")?
        .clone();
    let launch_at_login = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())?;
    Ok(DesktopStatus {
        service,
        launch_at_login,
    })
}

#[tauri::command]
fn set_login_start(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|error| error.to_string())?;
    } else {
        autostart.disable().map_err(|error| error.to_string())?;
    }
    autostart.is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
fn restart_service(state: tauri::State<'_, Mutex<DesktopState>>) -> Result<(), String> {
    let desktop = state.lock().map_err(|_| "desktop state is unavailable")?;
    if !matches!(
        desktop.service.lock().map_err(|_| "service state is unavailable")?.ownership,
        Some(ServiceOwnership::Managed)
    ) {
        return Err("Only a desktop-managed service can be restarted here.".into());
    }
    supervisor::request_restart(&desktop.control);
    Ok(())
}

#[tauri::command]
fn desktop_logs() -> Result<String, String> {
    supervisor::read_service_log(2000)
}

#[tauri::command]
fn desktop_log_path() -> Result<String, String> {
    supervisor::service_log_path().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_desktop_log(app: AppHandle) -> Result<(), String> {
    let path = supervisor::service_log_path()?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "打开 Molibot / Open Molibot").build(app)?;
    let open_web = MenuItemBuilder::with_id("open_web", "打开 Web / Open Web").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "设置 / Settings").build(app)?;
    let restart =
        MenuItemBuilder::with_id("restart", "重新启动服务 / Restart Service").build(app)?;
    let diagnostics = MenuItemBuilder::with_id("diagnostics", "查看诊断 / Diagnostics")
        .enabled(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 Molibot / Quit Molibot").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &open_web, &settings])
        .separator()
        .items(&[&restart, &diagnostics])
        .separator()
        .item(&quit)
        .build()?;

    let mut tray = TrayIconBuilder::with_id("molibot-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Molibot")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app, "chat"),
            "settings" => show_window(app, "settings"),
            "open_web" => {
                let endpoint = app
                    .state::<Mutex<DesktopState>>()
                    .lock()
                    .ok()
                    .and_then(|state| state.service.lock().ok()?.endpoint.clone());
                if let Some(endpoint) = endpoint {
                    let _ = app.opener().open_url(endpoint, None::<&str>);
                }
            }
            "restart" => {
                if let Ok(state) = app.state::<Mutex<DesktopState>>().lock() {
                    supervisor::request_restart(&state.control);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn configure_close_to_background(app: &tauri::App) {
    for label in ["chat", "settings"] {
        if let Some(window) = app.get_webview_window(label) {
            let window_handle = window.clone();
            window.on_window_event(move |window_event| {
                if let WindowEvent::CloseRequested { api, .. } = window_event {
                    api.prevent_close();
                    let _ = window_handle.hide();
                }
            });
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app, "chat");
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(DesktopState::default()))
        .manage(audio::AudioState::default())
        .invoke_handler(tauri::generate_handler![
            open_settings,
            pick_project_directory,
            desktop_status,
            set_login_start,
            restart_service,
            desktop_logs,
            desktop_log_path,
            open_desktop_log,
            audio::start_recording,
            audio::stop_recording,
            audio::cancel_recording
        ])
        .setup(|app| {
            install_tray(app)?;
            configure_close_to_background(app);
            let app_handle = app.handle().clone();
            if let Ok(state) = app.state::<Mutex<DesktopState>>().lock() {
                let status = state.service.clone();
                let control = supervisor::initialize(app_handle, status);
                if let Ok(mut current) = state.control.lock() {
                    *current = Some(control);
                }
            }
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("failed to build Molibot desktop host")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                show_window(app, "chat");
            }
            if let RunEvent::ExitRequested { api, .. } = event {
                let mut control = None;
                if let Ok(state) = app.state::<Mutex<DesktopState>>().lock() {
                    if state.exit_after_stop.load(Ordering::SeqCst) {
                        return;
                    }
                    if state.control.lock().is_ok_and(|control| control.is_some()) {
                        api.prevent_exit();
                        if !state.exit_after_stop.swap(true, Ordering::SeqCst) {
                            control = state.control.lock().ok().and_then(|value| value.clone());
                        }
                    }
                }
                if let Some(control) = control {
                    supervisor::stop_sender_and_wait(control, Duration::from_secs(5));
                    app.exit(0);
                }
            }
        });
}
