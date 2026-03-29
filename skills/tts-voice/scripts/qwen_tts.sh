#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
mkdir -p "$OUTPUT_DIR"

TEXT="${1:-你好}"
FILENAME="${2:-voice}"

TEMP_FILE="$OUTPUT_DIR/${FILENAME}_qwen.wav"
OGG_FILE="$OUTPUT_DIR/${FILENAME}.ogg"
VENV_PYTHON="$SCRIPT_DIR/qwen3-tts/bin/python"

# 检查环境，为了避免下载巨大的模型，不自动安装该包
if [ ! -f "$VENV_PYTHON" ] || ! "$VENV_PYTHON" -c "import qwen_tts" &> /dev/null; then
    echo "⚠️ 未检测到 Qwen3-TTS 虚拟环境或相关依赖包未安装。" >&2
    echo "ℹ️ 如果您想启用更高质量的大模型中英混读 TTS，请参阅 README.md 进行手动安装配置。" >&2
    exit 1
fi

echo "🎙️ Qwen Voice model: Qwen3-TTS-12Hz-0.6B-VoiceDesign"
if ! "$VENV_PYTHON" "$SCRIPT_DIR/scripts/qwen_tts.py" "$TEXT" "$TEMP_FILE"; then
    echo "❌ 生成 Qwen3-TTS 失败。" >&2
    exit 1
fi

# Auto-install ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "📦 未检测到 ffmpeg，正在自动安装..."
    if command -v brew &> /dev/null; then
        brew install ffmpeg
    elif command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y ffmpeg
    else
        echo "❌ 无法自动安装 ffmpeg，请手动配置环境。" >&2
        exit 1
    fi
fi

if ! ffmpeg -i "$TEMP_FILE" -c:a libopus -b:a 32k -ar 48000 -ac 1 "$OGG_FILE" -y -loglevel error; then
    echo "❌ 格式转换失败。" >&2
    rm -f "$TEMP_FILE"
    exit 1
fi

rm -f "$TEMP_FILE"
echo "✅ Qwen3-TTS 生成完毕: $OGG_FILE"
