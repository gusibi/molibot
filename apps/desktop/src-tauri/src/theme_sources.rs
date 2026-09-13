//! Known local theme directories for the "open theme folder" buttons.
//!
//! Opening a folder is an allowlisted action: the webview sends an id, Rust
//! resolves it against these constants and opens the path. No path ever comes
//! from the webview, so this cannot be turned into an arbitrary-path opener.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeDirectoryKind {
    /// A built-in theme folder shipped inside an editor's app bundle.
    Builtin,
    /// A user extensions folder where marketplace themes are installed.
    Extensions,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSourceDirectory {
    pub id: String,
    pub kind: ThemeDirectoryKind,
    pub path: String,
    /// True when the folder exists and holds at least one extension that
    /// actually contributes a color theme. A folder of unrelated extensions
    /// (or an empty one) is hidden, so the UI never offers a dead end.
    pub has_themes: bool,
}

/// Editor app bundles under `/Applications`, by a stable short id.
#[cfg(target_os = "macos")]
const BUILTIN_THEME_DIRS: &[(&str, &str)] = &[
    ("vscode", "Visual Studio Code"),
    ("vscode-insiders", "Visual Studio Code - Insiders"),
    ("antigravity", "Antigravity IDE"),
    ("cursor", "Cursor"),
    ("vscodium", "VSCodium"),
    ("windsurf", "Windsurf"),
];

/// User-level extension folders, relative to the home directory.
const USER_EXTENSION_DIRS: &[(&str, &str)] = &[
    ("vscode-extensions", ".vscode/extensions"),
    ("vscode-insiders-extensions", ".vscode-insiders/extensions"),
    ("cursor-extensions", ".cursor/extensions"),
    ("vscodium-extensions", ".vscode-oss/extensions"),
    ("windsurf-extensions", ".windsurf/extensions"),
];

fn entry(id: &str, kind: ThemeDirectoryKind, path: PathBuf) -> ThemeSourceDirectory {
    let has_themes = path.is_dir() && has_theme_extensions(&path);
    ThemeSourceDirectory {
        id: id.to_string(),
        kind,
        path: path.to_string_lossy().into_owned(),
        has_themes,
    }
}

/// Scans a folder of installed extensions for one whose `package.json`
/// contributes a color theme. Icon-only extensions are ignored.
fn has_theme_extensions(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return false;
    };
    for entry in entries.flatten() {
        let package = entry.path().join("package.json");
        if !package.is_file() {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&package) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) else {
            continue;
        };
        let contributes_themes = value
            .get("contributes")
            .and_then(|contributes| contributes.get("themes"))
            .and_then(|themes| themes.as_array())
            .is_some_and(|themes| !themes.is_empty());
        if contributes_themes {
            return true;
        }
    }
    false
}

pub fn directories(home: Option<PathBuf>) -> Vec<ThemeSourceDirectory> {
    let mut directories = Vec::new();
    #[cfg(target_os = "macos")]
    for (id, app) in BUILTIN_THEME_DIRS {
        let path = PathBuf::from("/Applications")
            .join(format!("{app}.app"))
            .join("Contents/Resources/app/extensions");
        directories.push(entry(id, ThemeDirectoryKind::Builtin, path));
    }
    if let Some(home) = home {
        for (id, relative) in USER_EXTENSION_DIRS {
            directories.push(entry(id, ThemeDirectoryKind::Extensions, home.join(relative)));
        }
    }
    directories
}

pub fn find<'a>(directories: &'a [ThemeSourceDirectory], id: &str) -> Option<&'a ThemeSourceDirectory> {
    directories.iter().find(|directory| directory.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/Users/example")
    }

    #[test]
    fn ids_are_unique_and_resolvable() {
        let directories = directories(Some(home()));
        assert!(!directories.is_empty());
        for directory in &directories {
            assert!(!directory.id.is_empty());
            assert_eq!(directories.iter().filter(|other| other.id == directory.id).count(), 1);
            assert_eq!(find(&directories, &directory.id).map(|found| found.id.as_str()), Some(directory.id.as_str()));
        }
    }

    #[test]
    fn user_extension_paths_live_under_home() {
        let directories = directories(Some(home()));
        let insiders = find(&directories, "vscode-insiders-extensions").expect("insiders extensions entry");
        assert_eq!(insiders.path, home().join(".vscode-insiders/extensions").to_string_lossy());
        assert!(matches!(insiders.kind, ThemeDirectoryKind::Extensions));
    }

    #[test]
    fn unknown_ids_are_not_found() {
        let directories = directories(Some(home()));
        assert!(find(&directories, "definitely-not-a-directory").is_none());
    }

    #[test]
    fn theme_folder_detection_requires_a_theme_contribution() {
        let root = std::env::temp_dir().join(format!("molibot-theme-sources-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("acme.utility-1.0.0")).expect("create utility directory");
        fs::write(root.join("acme.utility-1.0.0/package.json"), r#"{"contributes":{"commands":[]}}"#)
            .expect("write utility package");
        assert!(!has_theme_extensions(&root), "an unrelated extension is not a theme folder");

        fs::create_dir_all(root.join("acme.theme-1.0.0")).expect("create theme directory");
        fs::write(root.join("acme.theme-1.0.0/package.json"), r#"{"contributes":{"themes":[{"path":"./themes/x.json"}]}}"#)
            .expect("write theme package");
        assert!(has_theme_extensions(&root), "a contributed color theme is detected");

        fs::remove_dir_all(root).expect("remove fixture directory");
    }
}
