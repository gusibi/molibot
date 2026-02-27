#!/bin/bash
# TTS Voice Sender - Generate and send voice message via Telegram
# Usage: tts-send.sh "text content" [chat_id]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
mkdir -p "$OUTPUT_DIR"

# Parameters
TEXT="${1:-你好}"
CHAT_ID="${2:-7706709760}"
VOICE="zh-CN-XiaoxiaoNeural"
BOT_TOKEN="8360884712:AAHuCEHnlaiRbhdWfTi1d2mS8WK7H_9tVeM"

TIMESTAMP=$(date +%s)
MP3_FILE="$OUTPUT_DIR/voice_${TIMESTAMP}.mp3"
OGG_FILE="$OUTPUT_DIR/voice_${TIMESTAMP}.ogg"

echo "Generating voice for: $TEXT"

# Generate MP3 using edge-tts
python3 -m edge_tts --voice "$VOICE" --text "$TEXT" --write-media "$MP3_FILE"

# Convert to OGG/Opus for Telegram
ffmpeg -i "$MP3_FILE" -c:a libopus -b:a 32k -ar 48000 -ac 1 "$OGG_FILE" -y 2>/dev/null

# Clean up MP3
rm -f "$MP3_FILE"

echo "Sending voice message..."

# Send via Telegram Bot API
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendVoice" \
  -F "chat_id=${CHAT_ID}" \
  -F "voice=@${OGG_FILE}"

echo ""
echo "Voice message sent!"

# Clean up OGG after sending
rm -f "$OGG_FILE"
