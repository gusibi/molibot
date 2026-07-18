use crate::{show_window, supervisor, DesktopState};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

pub const COMMAND_EVENT: &str = "native-command";

pub struct NativeMenuState<R: Runtime> {
    items: Mutex<Vec<MenuItem<R>>>,
}

impl<R: Runtime> Default for NativeMenuState<R> {
    fn default() -> Self {
        Self {
            items: Mutex::new(Vec::new()),
        }
    }
}

#[derive(Deserialize)]
pub struct CommandMenuEntry {
    id: String,
    label: String,
    enabled: bool,
}

pub fn command_id(menu_id: &str) -> Option<&'static str> {
    match menu_id {
        "app.open-chat" => Some("app.open-chat"),
        "app.open-settings" => Some("app.open-settings"),
        "app.open-web" => Some("app.open-web"),
        "app.quit" => Some("app.quit"),
        "chat.new" => Some("chat.new"),
        "chat.search" => Some("chat.search"),
        "service.restart" => Some("service.restart"),
        "diagnostics.open" => Some("diagnostics.open"),
        _ => None,
    }
}

fn item(
    app: &App,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    let builder = MenuItemBuilder::with_id(id, text);
    let builder = if let Some(accelerator) = accelerator {
        builder.accelerator(accelerator)
    } else {
        builder
    };
    builder.build(app)
}

fn register_items(app: &App, items: &[MenuItem<tauri::Wry>]) {
    let state = app.state::<NativeMenuState<tauri::Wry>>();
    let mut registered = match state.items.lock() {
        Ok(registered) => registered,
        Err(_) => return,
    };
    registered.extend(items.iter().cloned());
}

pub fn install(app: &App) -> tauri::Result<()> {
    app.manage(NativeMenuState::<tauri::Wry>::default());

    let app_settings = item(
        app,
        "app.open-settings",
        "Open Settings",
        Some("CmdOrCtrl+,"),
    )?;
    let app_window_settings = item(
        app,
        "app.open-settings",
        "Open Settings",
        Some("CmdOrCtrl+,"),
    )?;
    let app_quit = item(app, "app.quit", "Quit Molibot", Some("CmdOrCtrl+Q"))?;
    let app_new_chat = item(app, "chat.new", "New Chat", Some("CmdOrCtrl+N"))?;
    let app_search = item(
        app,
        "chat.search",
        "Search Conversations",
        Some("CmdOrCtrl+F"),
    )?;
    let app_open_chat = item(app, "app.open-chat", "Open Molibot", None)?;
    let app_diagnostics = item(app, "diagnostics.open", "Diagnostics", None)?;

    let app_menu = SubmenuBuilder::new(app, "Molibot")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&app_settings)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .separator()
        .item(&app_quit)
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&app_new_chat)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&app_search)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&app_open_chat)
        .item(&app_window_settings)
        .separator()
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&app_diagnostics)
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;

    let tray_open_chat = item(app, "app.open-chat", "Open Molibot", None)?;
    let tray_open_web = item(app, "app.open-web", "Open Web", None)?;
    let tray_settings = item(app, "app.open-settings", "Open Settings", None)?;
    let tray_restart = item(app, "service.restart", "Restart Service", None)?;
    let tray_diagnostics = item(app, "diagnostics.open", "Diagnostics", None)?;
    let tray_quit = item(app, "app.quit", "Quit Molibot", None)?;
    let tray_menu = MenuBuilder::new(app)
        .items(&[&tray_open_chat, &tray_open_web, &tray_settings])
        .separator()
        .items(&[&tray_restart, &tray_diagnostics])
        .separator()
        .item(&tray_quit)
        .build()?;
    let mut tray = TrayIconBuilder::with_id("molibot-tray")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .tooltip("Molibot");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    register_items(
        app,
        &[
            app_settings,
            app_window_settings,
            app_quit,
            app_new_chat,
            app_search,
            app_open_chat,
            app_diagnostics,
            tray_open_chat,
            tray_open_web,
            tray_settings,
            tray_restart,
            tray_diagnostics,
            tray_quit,
        ],
    );
    app.on_menu_event(|app, event| {
        let _ = execute(app, event.id().as_ref());
    });
    Ok(())
}

pub fn sync(app: &AppHandle, commands: Vec<CommandMenuEntry>) {
    let state = app.state::<NativeMenuState<tauri::Wry>>();
    let Ok(items) = state.items.lock() else {
        return;
    };
    for command in commands {
        for item in items.iter().filter(|item| item.id().as_ref() == command.id) {
            let _ = item.set_text(&command.label);
            let _ = item.set_enabled(command.enabled);
        }
    }
}

pub fn execute(app: &AppHandle, menu_id: &str) -> Result<(), String> {
    let Some(command) = command_id(menu_id) else {
        return Err("Unknown native command.".into());
    };
    match command {
        "app.open-chat" => show_window(app, "chat"),
        "app.open-settings" => show_window(app, "settings"),
        "app.open-web" => {
            let endpoint = app
                .state::<Mutex<DesktopState>>()
                .lock()
                .ok()
                .and_then(|state| state.service.lock().ok()?.endpoint.clone())
                .ok_or_else(|| "There is no service address to open.".to_string())?;
            app.opener()
                .open_url(endpoint, None::<&str>)
                .map_err(|error| error.to_string())?;
        }
        "service.restart" => {
            let desktop = app.state::<Mutex<DesktopState>>();
            let state = desktop.lock().map_err(|_| "desktop state is unavailable")?;
            if !matches!(
                state
                    .service
                    .lock()
                    .map_err(|_| "service state is unavailable")?
                    .ownership,
                Some(crate::service::ServiceOwnership::Managed)
            ) {
                return Err("Only a desktop-managed service can be restarted here.".into());
            }
            supervisor::request_restart(&state.control);
        }
        "app.quit" => app.exit(0),
        command => {
            if matches!(command, "chat.new" | "chat.search") {
                show_window(app, "chat");
            }
            if command == "diagnostics.open" {
                show_window(app, "settings");
            }
            app.emit_to("chat", COMMAND_EVENT, command)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_only_stable_product_command_ids() {
        assert_eq!(command_id("app.open-chat"), Some("app.open-chat"));
        assert_eq!(command_id("service.restart"), Some("service.restart"));
        assert_eq!(command_id("open"), None);
        assert_eq!(command_id("quit"), None);
    }
}
