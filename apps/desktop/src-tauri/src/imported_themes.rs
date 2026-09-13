//! On-disk store for imported VSCode color themes.
//!
//! Each imported theme is one JSON file under the app data directory's
//! `themes/` folder, named `<id>.json`. The frontend parses and maps a VSCode
//! theme into a flat token map, then persists the result here. The id is
//! slug-shaped and validated before it ever touches the filesystem, so a
//! crafted id cannot escape the themes directory.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const THEMES_DIR: &str = "themes";

/// One imported theme. The original file contents are stored verbatim and
/// re-parsed by the frontend on every load, so improvements to the VSCode →
/// product token mapping apply to already-imported themes without a re-import.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTheme {
    pub id: String,
    pub imported_at: String,
    pub raw: String,
}

/// Ids become filenames, so they are restricted to a filename-safe alphabet.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && !id.starts_with('-')
        && !id.ends_with('-')
}

fn theme_path(directory: &Path, id: &str) -> PathBuf {
    directory.join(format!("{id}.json"))
}

/// Reads every well-formed theme in the directory. A missing directory is an
/// empty store; an unreadable or malformed file is skipped rather than fatal,
/// so one bad import cannot hide the rest.
pub fn list(directory: &Path) -> Result<Vec<ImportedTheme>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(theme) = serde_json::from_str::<ImportedTheme>(&contents) else {
            continue;
        };
        if !is_valid_id(&theme.id) {
            continue;
        }
        themes.push(theme);
    }
    themes.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(themes)
}

pub fn save(directory: &Path, theme: &ImportedTheme) -> Result<(), String> {
    if !is_valid_id(&theme.id) {
        return Err("Invalid theme id.".into());
    }
    if theme.raw.trim().is_empty() {
        return Err("The theme file is empty.".into());
    }
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let payload = serde_json::to_vec_pretty(theme).map_err(|error| error.to_string())?;
    fs::write(theme_path(directory, &theme.id), payload).map_err(|error| error.to_string())
}

/// Deletes a theme. Deleting one that is already gone is a no-op so the UI can
/// be retried idempotently.
pub fn delete(directory: &Path, id: &str) -> Result<(), String> {
    if !is_valid_id(id) {
        return Err("Invalid theme id.".into());
    }
    match fs::remove_file(theme_path(directory, id)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs::remove_dir_all;
    use uuid::Uuid;

    fn fixture_directory() -> PathBuf {
        env::temp_dir().join(format!("molibot-imported-themes-{}", Uuid::new_v4()))
    }

    fn sample_theme(id: &str) -> ImportedTheme {
        ImportedTheme {
            id: id.into(),
            imported_at: "2026-01-01T00:00:00.000Z".into(),
            raw: r##"{"name":"One Dark Pro","type":"dark","colors":{"editor.background":"#282c34"}}"##.into(),
        }
    }

    #[test]
    fn valid_ids_are_filename_safe() {
        assert!(is_valid_id("one-dark-pro"));
        assert!(is_valid_id("theme-1a2b3c"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("../escape"));
        assert!(!is_valid_id("with/slash"));
        assert!(!is_valid_id("Uppercase"));
        assert!(!is_valid_id("-leading"));
        assert!(!is_valid_id("trailing-"));
        assert!(!is_valid_id(&"a".repeat(65)));
    }

    #[test]
    fn save_then_list_round_trips() {
        let directory = fixture_directory();
        save(&directory, &sample_theme("one-dark-pro")).expect("save theme");
        let themes = list(&directory).expect("list themes");
        assert_eq!(themes, vec![sample_theme("one-dark-pro")]);
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn list_of_missing_directory_is_empty() {
        let directory = fixture_directory();
        assert_eq!(list(&directory).expect("list missing directory"), Vec::new());
    }

    #[test]
    fn list_skips_malformed_files() {
        let directory = fixture_directory();
        fs::create_dir_all(&directory).expect("create fixture directory");
        fs::write(directory.join("broken.json"), "not-json").expect("write malformed file");
        fs::write(directory.join("ignored.txt"), "{}").expect("write ignored file");
        save(&directory, &sample_theme("good-theme")).expect("save theme");
        let themes = list(&directory).expect("list themes");
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].id, "good-theme");
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn delete_is_idempotent_and_rejects_escaping_ids() {
        let directory = fixture_directory();
        save(&directory, &sample_theme("one-dark-pro")).expect("save theme");
        delete(&directory, "one-dark-pro").expect("delete theme");
        assert_eq!(list(&directory).expect("list themes"), Vec::new());
        delete(&directory, "one-dark-pro").expect("delete missing theme is a no-op");
        assert!(delete(&directory, "../desktop-preferences").is_err());
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn save_rejects_invalid_id_and_empty_raw() {
        let directory = fixture_directory();
        let mut theme = sample_theme("bad id");
        assert!(save(&directory, &theme).is_err());
        theme.id = "ok-id".into();
        theme.raw = "   ".into();
        assert!(save(&directory, &theme).is_err());
        assert_eq!(list(&directory).expect("list themes"), Vec::new());
        assert!(!directory.exists(), "rejected saves must not create the store");
    }
}
