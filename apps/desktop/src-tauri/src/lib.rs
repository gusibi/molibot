mod app_menu;
mod audio;
mod desktop_preferences;
mod native_feedback;
pub mod service;
mod supervisor;

use serde::Serialize;
use service::{ServiceOwnership, ServiceStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, Url, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_dialog::DialogExt;
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
    close_behavior: desktop_preferences::CloseBehavior,
    notification_preference: desktop_preferences::NotificationPreference,
    haptic_preference: desktop_preferences::HapticPreference,
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn execute_native_command(app: AppHandle, id: String) -> Result<(), String> {
    app_menu::execute(&app, &id)
}

#[tauri::command]
fn sync_native_command_menu(app: AppHandle, commands: Vec<app_menu::CommandMenuEntry>) {
    app_menu::sync(&app, commands);
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_window(&app, "chat");
}

/// Opens the native folder picker as a window-modal sheet on the calling window.
///
/// Shelling out to `osascript "choose folder"` used to take seconds (process spawn plus
/// Apple-event round trip) and produced a dialog owned by another process, so the webview
/// stayed clickable and a second click spawned a second picker. The native panel opens
/// immediately and blocks its parent window, which makes duplicates impossible.
#[tauri::command]
async fn pick_project_directory(window: tauri::Window) -> Result<Option<String>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .pick_folder(move |picked| {
            let _ = sender.send(picked);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|_| "The folder picker closed unexpectedly.".to_string())?;
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
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
        close_behavior: desktop_preferences::load_close_behavior(&desktop_preferences_path(&app)?),
        notification_preference: desktop_preferences::load_notification_preference(&desktop_preferences_path(&app)?),
        haptic_preference: desktop_preferences::load_haptic_preference(&desktop_preferences_path(&app)?),
    })
}

fn desktop_preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(desktop_preferences::PREFERENCES_FILE))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_close_behavior(app: AppHandle, close_behavior: desktop_preferences::CloseBehavior) -> Result<desktop_preferences::CloseBehavior, String> {
    desktop_preferences::save_close_behavior(&desktop_preferences_path(&app)?, close_behavior)?;
    Ok(close_behavior)
}

#[tauri::command]
fn set_haptic_preference(
    app: AppHandle,
    haptic_preference: desktop_preferences::HapticPreference,
) -> Result<desktop_preferences::HapticPreference, String> {
    desktop_preferences::save_haptic_preference(&desktop_preferences_path(&app)?, haptic_preference)?;
    Ok(haptic_preference)
}

#[tauri::command]
fn perform_haptic_feedback() {
    native_feedback::perform_commit();
}

#[tauri::command]
fn set_notification_preference(
    app: AppHandle,
    notification_preference: desktop_preferences::NotificationPreference,
) -> Result<desktop_preferences::NotificationPreference, String> {
    desktop_preferences::save_notification_preference(&desktop_preferences_path(&app)?, notification_preference)?;
    Ok(notification_preference)
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
fn desktop_logs(query: supervisor::ServiceLogQuery) -> Result<supervisor::ServiceLogPage, String> {
    supervisor::query_desktop_service_log(query)
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

fn validated_external_url(value: &str) -> Result<&str, String> {
    let parsed = Url::parse(value).map_err(|_| "Invalid external URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(value),
        _ => Err("Only HTTP and HTTPS links can be opened".into()),
    }
}

#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let safe_url = validated_external_url(&url)?;
    app.opener()
        .open_url(safe_url, None::<&str>)
        .map_err(|error| error.to_string())
}

fn close_to_hide_window_labels() -> [&'static str; 1] {
    ["chat"]
}

fn configure_window_close_behavior(app: &tauri::App) {
    for label in close_to_hide_window_labels() {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        let app_handle = app.handle().clone();
        let window_handle = window.clone();
        window.on_window_event(move |window_event| {
            if let WindowEvent::CloseRequested { api, .. } = window_event {
                api.prevent_close();
                let behavior = desktop_preferences_path(&app_handle)
                    .map(|path| desktop_preferences::load_close_behavior(&path))
                    .unwrap_or(desktop_preferences::CloseBehavior::Background);
                if behavior == desktop_preferences::CloseBehavior::Background {
                    let _ = window_handle.hide();
                } else {
                    app_handle.exit(0);
                }
            }
        });
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(DesktopState::default()))
        .manage(audio::AudioState::default())
        .invoke_handler(tauri::generate_handler![
            execute_native_command,
            sync_native_command_menu,
            show_main_window,
            pick_project_directory,
            desktop_status,
            set_login_start,
            set_close_behavior,
            perform_haptic_feedback,
            set_haptic_preference,
            set_notification_preference,
            restart_service,
            desktop_logs,
            desktop_log_path,
            open_desktop_log,
            open_external_url,
            audio::start_recording,
            audio::stop_recording,
            audio::cancel_recording
        ])
        .setup(|app| {
            app_menu::install(app)?;
            configure_window_close_behavior(app);
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

#[cfg(test)]
mod window_close_tests {
    use super::{close_to_hide_window_labels, validated_external_url};

    #[test]
    fn close_to_hide_covers_chat_window() {
        assert_eq!(close_to_hide_window_labels(), ["chat"]);
    }

    #[test]
    fn external_url_validation_allows_web_links_only() {
        assert!(validated_external_url("https://example.com/oauth").is_ok());
        assert!(validated_external_url("http://localhost:1455/auth/callback").is_ok());
        assert!(validated_external_url("file:///tmp/secret").is_err());
        assert!(validated_external_url("javascript:alert(1)").is_err());
    }
}
