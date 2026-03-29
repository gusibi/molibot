---
name: tts-voice
description: 提供文字转语音（TTS）能力。当用户要求"用语音回复"、"转成语音"、"返回音频"、"语音播报"、"读出来"、"朗读"、"念出来"或有类似输出语音需求时必须触发。
---

# TTS 语音生成

基于自动路由设计的智能文字转语音技能。该技能会自动检测你的系统环境，智能选取最适合的转换模块向下兼容。部分依赖模块会在后台自动检测并下载，无需繁琐的手动配置。

## 功能特性

- **自动路由与降级**：
  1. 首选项（最高优先级）：`Qwen3-TTS`。该大模型具备顶尖的中英混读音色。但因其体积庞大，系统**不会自动安装**，如果未检测到环境会自动跳过，将安装主导权交给用户。
  2. 极速响应（如果可用）：`Mac 内置 TTS`。如果在 macOS 上且未配置 Qwen，则无缝回调零延迟的内置 Mac/Siri 语音。
  3. 全平台网络方案：`Microsoft Edge TTS`。如果在以上都不可用的系统（比如 Linux）上，系统将自动回退到 Edge 接口。
- 自动安装依赖模块（包括 ffmpeg 与 edge-tts 库等，Qwen 例外）。
- 统一输出通用音频格式（OGG/Opus），兼容大多数播放器。
- 高度模块化：具体转换逻辑已经拆分到 `scripts/qwen_tts.sh`、`scripts/mac_tts.sh` 和 `scripts/edge_tts.sh`。

## 使用方法

只需要执行统一入口脚本：
```bash
{baseDir}/tts.sh "要转换的文字内容" [输出文件名]
```

### 示例
```bash
# 默认智能路由
{baseDir}/tts.sh "你好，这是自动选择引擎生成的语音" reply_audio
```

## 环境定制：Qwen3-TTS（本地大模型高阶玩法）

如果你希望拥有最好的声音效果和中英文混合效果，并且电脑显存充足，可以通过配置 `qwen3-tts` 虚拟环境来激活**首选项**。
**我们不会替你主动安装这个笨重的大型环境**，请查阅 `README.md` 阅读完整的安装步骤。当按照文档配置好后，`tts.sh` 即可实现全自动调用！

## 语音定制（可选环境变量）

默认情况下一切会自动进行，但你也可以手动覆盖：

### 强制指定引擎（TTS_ENGINE）
可设置 `auto` (默认), `qwen`, `mac` 或 `edge`：
```bash
TTS_ENGINE=edge {baseDir}/tts.sh "强制使用Edge"
```

### 定制语音播报员（TTS_VOICE）

#### 1. Mac TTS 音色
如果触发了 Mac 模块，可通过 `say -v \?` 查看你系统支持的可用声音：
- `Ting-Ting` - 婷婷 (中文)
- `Mei-Jia` - 美佳 (中文)
- `Samantha` - 英文

更换示例：
```bash
TTS_VOICE="Samantha" {baseDir}/tts.sh "This is a test" test_audio
```

#### 2. Edge TTS 音色
如果触发了 Edge 模块：
- `zh-CN-XiaoxiaoNeural` - 晓晓（默认女声）
- `zh-CN-YunxiNeural` - 云希（男声）
- `zh-CN-YunjianNeural` - 云健（男声）

更换示例：
```bash
TTS_VOICE="zh-CN-YunxiNeural" {baseDir}/tts.sh "云希的声音" edge_audio
```

*(Qwen-TTS 目前代码写死了使用 `female` 作为推荐的混读播报系统，但也支持调整内置 Python 模块实现自定义。)*

## 输出格式与存放

- 格式：OGG/Opus
- 采样率：48000 Hz
- 声道：单声道
- 码率：32 kbps
- 产出路径：`{baseDir}/output/[文件名].ogg`
