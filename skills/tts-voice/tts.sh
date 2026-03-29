#!/bin/bash
# TTS Voice Router - Auto selects the best TTS engine for your environment
# Usage: ./tts.sh "text content" [output_filename]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Usage help
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: ./tts.sh \"text content\" [output_filename]"
    echo "Example: ./tts.sh \"你好世界\" my_voice"
    echo "Environment Variables (Optional):"
    echo "  TTS_ENGINE: 'qwen', 'mac', 'edge', or 'auto' (default)"
    echo "  TTS_VOICE: Voice model (engine specific)"
    exit 0
fi

TEXT="${1:-你好}"
FILENAME="${2:-voice}"
ENGINE="${TTS_ENGINE:-auto}" 

echo "🗣️ Generating voice for: $TEXT"

if [ "$ENGINE" = "auto" ] || [ "$ENGINE" = "qwen" ]; then
    # Try Qwen3-TTS first (highest quality, but requires manual install)
    if bash "$SCRIPT_DIR/scripts/qwen_tts.sh" "$TEXT" "$FILENAME"; then
        exit 0
    else
        if [ "$ENGINE" = "qwen" ]; then
            echo "❌ Error: Qwen3-TTS execution failed." >&2
            exit 1
        fi
        echo "⚠️ 自动跳过 Qwen3-TTS，尝试下一级引擎..."
    fi
fi

if [ "$ENGINE" = "auto" ] || [ "$ENGINE" = "mac" ]; then
    # Try Mac TTS first if on macOS
    if [[ "$(uname -s)" == "Darwin" ]] && command -v say &> /dev/null; then
        echo "🍎 检测到 macOS 环境，优先尝试 Mac 内置 TTS..."
        if bash "$SCRIPT_DIR/scripts/mac_tts.sh" "$TEXT" "$FILENAME"; then
            exit 0
        else
            echo "⚠️ Mac TTS 执行失败..."
        fi
    else
        if [ "$ENGINE" = "mac" ]; then
            echo "❌ Error: 'say' command is not available. This engine requires macOS." >&2
            exit 1
        fi
    fi
fi

if [ "$ENGINE" = "auto" ] || [ "$ENGINE" = "edge" ]; then
    echo "☁️ 使用 Edge TTS 引擎..."
    exec bash "$SCRIPT_DIR/scripts/edge_tts.sh" "$TEXT" "$FILENAME"
fi

echo "❌ 无可用的 TTS 引擎。" >&2
exit 1
