#!/usr/bin/env python3
"""Export original logo artwork as transparent runtime PNGs (requires Pillow)."""
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1] / "apps/desktop"


def export_icon(image, path, canvas_size, artwork_size):
    artwork = ImageOps.contain(image, (artwork_size, artwork_size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size))
    canvas.paste(artwork, ((canvas_size - artwork.width) // 2, (canvas_size - artwork.height) // 2))
    canvas.save(path, optimize=True)


def main():
    dock_dir = ROOT / "public/app-icons"
    tray_dir = ROOT / "src-tauri/icons/logos"
    dock_dir.mkdir(parents=True, exist_ok=True)
    tray_dir.mkdir(parents=True, exist_ok=True)
    for logo in json.loads((ROOT / "src/lib/stores/appLogos.json").read_text()):
        source = ROOT / "public" / logo["src"].lstrip("/")
        image = Image.open(source).convert("RGBA")
        export_icon(image, dock_dir / f'{logo["id"]}.png', 512, 512)
        export_icon(image, tray_dir / f'{logo["id"]}-tray.png', 44, 36)


if __name__ == "__main__":
    main()
