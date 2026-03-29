#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
mkdir -p "$OUTPUT_DIR"

TEXT="${1:-你好}"
FILENAME="${2:-voice}"
VOICE="${TTS_VOICE:-Ting-Ting}" # Default Mac Chinese voice

TEMP_FILE="$OUTPUT_DIR/${FILENAME}.aiff"
OGG_FILE="$OUTPUT_DIR/${FILENAME}.ogg"

# Auto-install ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "📦 未检测到 ffmpeg，正在安装..."
    if command -v brew &> /dev/null; then
        brew install ffmpeg
    else
        echo "❌ 无法安装 ffmpeg，请手动配置环境。" >&2
        exit 1
    fi
fi

echo "🎙️ Mac Voice model: $VOICE"
if ! say -v "$VOICE" "$TEXT" -o "$TEMP_FILE"; then
    echo "❌ 生产 Mac TTS 失败。" >&2
    exit 1
fi

if ! ffmpeg -i "$TEMP_FILE" -c:a libopus -b:a 32k -ar 48000 -ac 1 "$OGG_FILE" -y -loglevel error; then
    echo "❌ 格式转换失败。" >&2
    rm -f "$TEMP_FILE"
    exit 1
fi

rm -f "$TEMP_FILE"
echo "✅ Mac TTS 生成完毕: $OGG_FILE"
