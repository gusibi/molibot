#!/bin/bash
# TTS Voice Generator - Generate OGG voice file from text
# Usage: tts.sh "text content" [output_filename]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
mkdir -p "$OUTPUT_DIR"

# Parameters
TEXT="${1:-你好}"
FILENAME="${2:-voice}"
VOICE="zh-CN-XiaoxiaoNeural"

MP3_FILE="$OUTPUT_DIR/${FILENAME}.mp3"
OGG_FILE="$OUTPUT_DIR/${FILENAME}.ogg"

echo "Generating voice for: $TEXT"

# Generate MP3 using edge-tts
python3 -m edge_tts --voice "$VOICE" --text "$TEXT" --write-media "$MP3_FILE"

# Convert to OGG/Opus for Telegram
ffmpeg -i "$MP3_FILE" -c:a libopus -b:a 32k -ar 48000 -ac 1 "$OGG_FILE" -y 2>/dev/null

# Clean up MP3
rm -f "$MP3_FILE"

echo "Voice generated: $OGG_FILE"
