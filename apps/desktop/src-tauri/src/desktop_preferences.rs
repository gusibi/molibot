use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

pub const PREFERENCES_FILE: &str = "desktop-preferences.json";

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    Background,
    Quit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationPreference {
    Off,
    Enabled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HapticPreference {
    Off,
    System,
}

impl CloseBehavior {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Background => "background",
            Self::Quit => "quit",
        }
    }

    fn from_value(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str) {
            Some("quit") => Self::Quit,
            _ => Self::Background,
        }
    }
}

impl serde::Serialize for CloseBehavior {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl HapticPreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::System => "system",
        }
    }

    fn from_value(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str) {
            Some("off") => Self::Off,
            _ => Self::System,
        }
    }
}

impl serde::Serialize for HapticPreference {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

pub fn load_haptic_preference(path: &Path) -> HapticPreference {
    let Ok(contents) = fs::read_to_string(path) else {
        return HapticPreference::System;
    };
    let Ok(Value::Object(values)) = serde_json::from_str::<Value>(&contents) else {
        return HapticPreference::System;
    };
    HapticPreference::from_value(values.get("hapticPreference"))
}

pub fn save_haptic_preference(path: &Path, preference: HapticPreference) -> Result<(), String> {
    let mut values = match fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<Value>(&contents) {
            Ok(Value::Object(values)) => values,
            _ => Map::new(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.to_string()),
    };
    values.insert("hapticPreference".into(), Value::String(preference.as_str().into()));
    let parent = path.parent().ok_or_else(|| "desktop preferences path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(path, serde_json::to_vec_pretty(&Value::Object(values)).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

impl NotificationPreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Enabled => "enabled",
        }
    }

    fn from_value(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str) {
            Some("enabled") => Self::Enabled,
            _ => Self::Off,
        }
    }
}

impl serde::Serialize for NotificationPreference {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

pub fn load_notification_preference(path: &Path) -> NotificationPreference {
    let Ok(contents) = fs::read_to_string(path) else {
        return NotificationPreference::Off;
    };
    let Ok(Value::Object(values)) = serde_json::from_str::<Value>(&contents) else {
        return NotificationPreference::Off;
    };
    NotificationPreference::from_value(values.get("notificationPreference"))
}

pub fn save_notification_preference(path: &Path, preference: NotificationPreference) -> Result<(), String> {
    let mut values = match fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<Value>(&contents) {
            Ok(Value::Object(values)) => values,
            _ => Map::new(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.to_string()),
    };
    values.insert("notificationPreference".into(), Value::String(preference.as_str().into()));
    let parent = path.parent().ok_or_else(|| "desktop preferences path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(path, serde_json::to_vec_pretty(&Value::Object(values)).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub fn load_close_behavior(path: &Path) -> CloseBehavior {
    let Ok(contents) = fs::read_to_string(path) else {
        return CloseBehavior::Background;
    };
    let Ok(Value::Object(values)) = serde_json::from_str::<Value>(&contents) else {
        return CloseBehavior::Background;
    };
    CloseBehavior::from_value(values.get("closeBehavior"))
}

pub fn save_close_behavior(path: &Path, behavior: CloseBehavior) -> Result<(), String> {
    let mut values = match fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<Value>(&contents) {
            Ok(Value::Object(values)) => values,
            _ => Map::new(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.to_string()),
    };
    values.insert("closeBehavior".into(), Value::String(behavior.as_str().into()));
    let parent = path.parent().ok_or_else(|| "desktop preferences path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(path, serde_json::to_vec_pretty(&Value::Object(values)).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs::{read_to_string, remove_dir_all, write};
    use uuid::Uuid;

    fn fixture_path() -> (std::path::PathBuf, std::path::PathBuf) {
        let directory = env::temp_dir().join(format!("molibot-desktop-preferences-{}", Uuid::new_v4()));
        (directory.join(PREFERENCES_FILE), directory)
    }

    #[test]
    fn defaults_to_background_for_missing_or_malformed_preferences() {
        let (path, directory) = fixture_path();
        assert_eq!(load_close_behavior(&path), CloseBehavior::Background);
        fs::create_dir_all(&directory).expect("create fixture directory");
        write(&path, "not-json").expect("write malformed preferences");
        assert_eq!(load_close_behavior(&path), CloseBehavior::Background);
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn preserves_notification_preference_and_unknown_values_across_preference_updates() {
        let (path, directory) = fixture_path();
        fs::create_dir_all(&directory).expect("create fixture directory");
        write(&path, r#"{"otherPreference":true,"nested":{"keep":"value"}}"#)
            .expect("write fixture preferences");

        save_notification_preference(&path, NotificationPreference::Enabled)
            .expect("save notification preference");
        save_haptic_preference(&path, HapticPreference::Off).expect("save haptic preference");
        save_close_behavior(&path, CloseBehavior::Quit).expect("save close behavior");

        assert_eq!(load_notification_preference(&path), NotificationPreference::Enabled);
        assert_eq!(load_haptic_preference(&path), HapticPreference::Off);
        assert_eq!(load_close_behavior(&path), CloseBehavior::Quit);
        let values: Value = serde_json::from_str(&read_to_string(&path).expect("read preferences"))
            .expect("parse saved preferences");
        assert_eq!(values["otherPreference"], true);
        assert_eq!(values["nested"]["keep"], "value");
        assert_eq!(values["notificationPreference"], "enabled");
        assert_eq!(values["hapticPreference"], "off");
        assert_eq!(values["closeBehavior"], "quit");
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn defaults_notification_preference_to_off() {
        let (path, directory) = fixture_path();
        assert_eq!(load_notification_preference(&path), NotificationPreference::Off);
        fs::create_dir_all(&directory).expect("create fixture directory");
        write(&path, "not-json").expect("write malformed preferences");
        assert_eq!(load_notification_preference(&path), NotificationPreference::Off);
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn defaults_haptic_preference_to_system() {
        let (path, directory) = fixture_path();
        assert_eq!(load_haptic_preference(&path), HapticPreference::System);
        fs::create_dir_all(&directory).expect("create fixture directory");
        write(&path, "not-json").expect("write malformed preferences");
        assert_eq!(load_haptic_preference(&path), HapticPreference::System);
        remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn updates_only_close_behavior_and_survives_restart() {
        let (path, directory) = fixture_path();
        fs::create_dir_all(&directory).expect("create fixture directory");
        write(&path, r#"{"otherPreference":true,"nested":{"keep":"value"}}"#)
            .expect("write fixture preferences");

        save_close_behavior(&path, CloseBehavior::Quit).expect("save close behavior");

        assert_eq!(load_close_behavior(&path), CloseBehavior::Quit);
        let values: Value = serde_json::from_str(&read_to_string(&path).expect("read preferences"))
            .expect("parse saved preferences");
        assert_eq!(values["otherPreference"], true);
        assert_eq!(values["nested"]["keep"], "value");
        assert_eq!(values["closeBehavior"], "quit");
        remove_dir_all(directory).expect("remove fixture directory");
    }
}
