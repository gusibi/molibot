use std::{env, fs, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let manifest = root.join("../src/lib/stores/appLogos.json");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let logos: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(manifest).unwrap()).unwrap();
    let mut source = String::from("static LOGOS: &[LogoAsset] = &[\n");
    for logo in logos {
        let id = logo["id"].as_str().unwrap();
        assert!(id.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'));
        let dock = root.join(format!("../public/app-icons/{id}.png"));
        let tray = root.join(format!("icons/logos/{id}-tray.png"));
        for path in [&dock, &tray] {
            assert!(
                path.is_file(),
                "Missing application icon: {}",
                path.display()
            );
            println!("cargo:rerun-if-changed={}", path.display());
        }
        source.push_str(&format!("LogoAsset {{ id: {id:?}, dock: include_bytes!({dock:?}), tray: include_bytes!({tray:?}) }},\n"));
    }
    source.push_str("];\n");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("app_logos.rs"),
        source,
    )
    .unwrap();
    tauri_build::build()
}
