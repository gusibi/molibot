---
name: tts-voice
description: Text-to-Speech (TTS) voice generation using edge-tts. Generate Chinese voice messages from text, convert to Telegram-compatible OGG/Opus format.
---

# TTS Voice

Text-to-Speech voice generation skill using Microsoft Edge TTS (free, no API key required).

## Features

- Generate Chinese voice from text
- Convert to Telegram voice message format (OGG/Opus)
- Send directly via Telegram Bot API

## Prerequisites

Install dependencies:
```bash
cd {baseDir}
pip3 install edge-tts
```

Also requires `ffmpeg` for audio conversion:
```bash
brew install ffmpeg
```

## Usage

### Generate voice file

```bash
{baseDir}/tts.sh "要转换的文字内容" [output_filename]
```

Examples:
```bash
{baseDir}/tts.sh "你好，这是一条测试消息"
{baseDir}/tts.sh "收到了" reply
```

Output: `{baseDir}/output/[filename].ogg`

### Send voice message directly

```bash
{baseDir}/tts-send.sh "要发送的文字内容" [telegram_chat_id]
```

Examples:
```bash
{baseDir}/tts-send.sh "今天天气不错"
{baseDir}/tts-send.sh "收到了" 7706709760
```

## Voice Options

Default voice: `zh-CN-XiaoxiaoNeural` (中文女声)

Available Chinese voices:
- `zh-CN-XiaoxiaoNeural` - 晓晓 (女声，默认)
- `zh-CN-YunxiNeural` - 云希 (男声)
- `zh-CN-YunjianNeural` - 云健 (男声)
- `zh-TW-HsiaoChenNeural` - 台湾女声

To change voice, edit the scripts and modify the `--voice` parameter.

## Output Format

- Format: OGG/Opus
- Sample rate: 48000 Hz
- Channels: Mono
- Bitrate: 32 kbps
- Compatible with Telegram voice messages
