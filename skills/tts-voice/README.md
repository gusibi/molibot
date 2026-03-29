# TTS Voice 工具包

本地文本转语音工具包，基于智能路由架构。支持优先调用本地高质量大模型引擎，并具备自动环境检测以进行服务降级（支持 Qwen3-TTS大模型、Mac 内核 Siri 语音、Edge-TTS 网络服务）。最终统一生成通用格式（OGG/Opus）语音消息。

## 功能特性

- 智能引擎选择（降级机制）：`Qwen3-TTS` -> `Mac 内置 TTS` -> `Edge-TTS`。
- 全自动系统环境识别：如果没有 Qwen3-TTS 环境，自动尝试系统自带的 Siri 发音以确保零延迟响应；如果没有 Mac，则自动下载 Edge 依赖执行网络合成。
- 无论采用何种引擎，最终统一输出标准的 OGG/Opus 音频格式。

## 高阶玩法：安装 Qwen3-TTS 高质量大模型（仅供高阶用户）

系统虽然首选 Qwen3-TTS，但考虑到模型体积和运行要求（建议 8GB+ 显存/内存），我们**不会**自动为您安装此模块。如果没有安装，会自动使用下一级引擎。如果您想要使用该引擎，请按以下步骤手动配置（以 Apple Silicon M系列芯片为例）：

```bash
# 1. 确保安装 ffmpeg
brew install ffmpeg

# 2. 创建并激活专用的虚拟环境
cd 技能根目录/tts-voice
python3 -m venv qwen3-tts
source qwen3-tts/bin/activate

# 3. 安装依赖（注意苹果 M 系列建议用 cpu 后端即可）
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install qwen-tts transformers accelerate sentencepiece
```

**说明**：安装完成后，`tts.sh` 后续便会自动探测到 `qwen3-tts` 虚拟环境，并使用具有中英混读功能的 Qwen 模型处理您的 TTS 请求！

## 基础使用方法

执行入口脚本：
```bash
./tts.sh "要转换的文字内容" [输出文件名]
```

### 示例

**生成带有默认文件名的语音（输出为 output/voice.ogg）：**
```bash
./tts.sh "你好，这是一条测试消息"
```

**指定输出文件名（输出为 output/reply.ogg）：**
```bash
./tts.sh "收到" reply
```

**更换指定的引擎（可强制避开某些引擎）：**
```bash
# 强制使用 Edge
TTS_ENGINE="edge" ./tts.sh "测试"
```

## 关于 Skill

本目录同时作为一个 AI Agent Skill (`SKILL.md`)，用于赋予 AI 助手直接使用脚本生成语音文件的能力。所有对 AI 大模型的指令，请参阅本目录下的 `SKILL.md` 文件。
