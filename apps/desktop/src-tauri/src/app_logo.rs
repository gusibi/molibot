use crate::desktop_preferences;
use serde_json::{Map, Value};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager};

struct LogoAsset {
    id: &'static str,
    dock: &'static [u8],
    tray: &'static [u8],
}

// The picker and embedded native assets share one manifest.
include!(concat!(env!("OUT_DIR"), "/app_logos.rs"));

fn asset(id: &str) -> Result<&'static LogoAsset, String> {
    LOGOS
        .iter()
        .find(|logo| logo.id == id)
        .ok_or_else(|| "Unknown application logo.".into())
}

fn load(path: &Path) -> &'static str {
    fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .and_then(|values| {
            values
                .get("appLogo")
                .and_then(Value::as_str)
                .and_then(|id| asset(id).ok())
                .map(|logo| logo.id)
        })
        .unwrap_or("molibot")
}

fn save(path: &Path, id: &str) -> Result<(), String> {
    asset(id)?;
    let mut values = match fs::read(path) {
        Ok(data) => match serde_json::from_slice(&data) {
            Ok(Value::Object(values)) => values,
            _ => {
                return Err(
                    "Desktop preferences are invalid JSON; application logo was not saved.".into(),
                )
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.to_string()),
    };
    values.insert("appLogo".into(), Value::String(id.into()));
    let directory = path
        .parent()
        .ok_or("Desktop preferences have no parent directory.")?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!(".app-logo-{}.tmp", uuid::Uuid::new_v4()));
    let result = fs::write(
        &temporary,
        serde_json::to_vec_pretty(&values).map_err(|error| error.to_string())?,
    )
    .and_then(|_| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

fn change(
    path: &Path,
    id: &str,
    mut apply: impl FnMut(&LogoAsset) -> Result<(), String>,
) -> Result<String, String> {
    let next = asset(id)?;
    let previous = asset(load(path))?;
    // Both system surfaces and persistence must succeed before the UI confirms a choice.
    if let Err(error) = apply(next).and_then(|_| save(path, id)) {
        return match apply(previous) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!(
                "{error}; restoring the previous application icon also failed: {rollback}"
            )),
        };
    }
    Ok(id.into())
}

#[cfg(target_os = "macos")]
fn set_application_icon(bytes: &[u8]) -> Result<(), String> {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let main =
        MainThreadMarker::new().ok_or("Application icons must be updated on the main thread.")?;
    let data = NSData::with_bytes(bytes);
    let image =
        NSImage::initWithData(NSImage::alloc(), &data).ok_or("Cannot decode application icon.")?;
    unsafe {
        NSApplication::sharedApplication(main).setApplicationIconImage(Some(&image));
    }
    Ok(())
}

fn apply(app: &AppHandle, logo: &LogoAsset) -> Result<(), String> {
    let tray_icon =
        tauri::image::Image::from_bytes(logo.tray).map_err(|error| error.to_string())?;
    let tray = app
        .tray_by_id("molibot-tray")
        .ok_or("The Molibot menu bar icon is unavailable.")?;
    #[cfg(target_os = "macos")]
    set_application_icon(logo.dock)?;
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("chat") {
        window
            .set_icon(
                tauri::image::Image::from_bytes(logo.dock).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    tray.set_icon(Some(tray_icon))
        .map_err(|error| error.to_string())
}

fn preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(desktop_preferences::PREFERENCES_FILE))
        .map_err(|error| error.to_string())
}

pub fn restore(app: &AppHandle) -> Result<String, String> {
    let id = load(&preferences_path(app)?);
    apply(app, asset(id)?)?;
    Ok(id.into())
}

// Synchronous Tauri commands run on the main thread, serializing native icon changes
// with the other desktop-preference writes and AppKit's main-thread requirement.
#[tauri::command]
pub fn get_app_logo(app: AppHandle) -> Result<String, String> {
    restore(&app)
}

#[tauri::command]
pub fn set_app_logo(app: AppHandle, id: String) -> Result<String, String> {
    change(&preferences_path(&app)?, &id, |logo| apply(&app, logo))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!("molibot-logo-{}", uuid::Uuid::new_v4()))
            .join(desktop_preferences::PREFERENCES_FILE)
    }

    #[test]
    fn selection_round_trip_preserves_the_entire_preferences_object() {
        let path = fixture();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = serde_json::json!({"closeBehavior":"quit","notificationPreference":"enabled","hapticPreference":"off","nested":{"supported":true}});
        fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        assert_eq!(change(&path, "waving", |_| Ok(())).unwrap(), "waving");
        assert_eq!(load(&path), "waving");
        desktop_preferences::save_close_behavior(
            &path,
            desktop_preferences::CloseBehavior::Background,
        )
        .unwrap();
        assert_eq!(load(&path), "waving");
        let mut expected = original;
        expected["appLogo"] = "waving".into();
        expected["closeBehavior"] = "background".into();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(),
            expected
        );
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn failure_rolls_back_both_icons_and_does_not_persist_a_partial_update() {
        let path = fixture();
        save(&path, "sleeping").unwrap();
        let before = fs::read(&path).unwrap();
        let mut calls = Vec::new();
        assert!(change(&path, "waving", |logo| {
            calls.push(logo.id);
            if logo.id == "waving" {
                Err("tray failed".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err()
        .contains("tray failed"));
        assert_eq!(calls, ["waving", "sleeping"]);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(change(&path, "../outside", |_| panic!(
            "invalid ID must never reach AppKit"
        ))
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn failed_save_restores_icons_and_keeps_corrupt_preferences_for_diagnosis() {
        let path = fixture();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "invalid-json").unwrap();
        let mut calls = Vec::new();
        assert!(change(&path, "happy", |logo| {
            calls.push(logo.id);
            Ok(())
        })
        .is_err());
        assert_eq!(calls, ["happy", "molibot"]);
        assert_eq!(fs::read_to_string(&path).unwrap(), "invalid-json");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn rollback_failure_is_reported_without_saving_the_failed_choice() {
        let path = fixture();
        save(&path, "sleeping").unwrap();
        let message = change(&path, "happy", |_| Err("native unavailable".into())).unwrap_err();
        assert!(message.contains("restoring the previous application icon also failed"));
        assert_eq!(load(&path), "sleeping");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn every_picker_choice_embeds_decodable_dock_and_retina_tray_assets() {
        assert_eq!(LOGOS.len(), 17);
        for logo in LOGOS {
            let dock = tauri::image::Image::from_bytes(logo.dock).unwrap();
            let tray = tauri::image::Image::from_bytes(logo.tray).unwrap();
            assert_eq!((dock.width(), dock.height()), (512, 512), "{}", logo.id);
            assert_eq!((tray.width(), tray.height()), (44, 44), "{}", logo.id);
            assert_eq!(dock.rgba()[3], 0, "{} needs transparent corners", logo.id);
            assert_eq!(tray.rgba()[3], 0, "{} needs transparent margins", logo.id);
        }
    }
}
