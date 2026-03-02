# Molibot

<p align="center">
  <img src="./Voldemomo_compressed.jpg" alt="Molibot logo" width="160" />
</p>

<p align="center">
  A simpler OpenClaw-style personal AI assistant.
</p>

Molibot 是 [OpenClaw](https://github.com/openclaw/openclaw) 风格的个人 AI 助手精简版。

它保留了 “your personal AI assistant” 这个方向，但去掉了更重的外壳，收敛成一个更适合本地运行、长期调教和自己维护的版本。当前支持这些入口：

- Telegram Bot
- Feishu Bot
- Web Chat（SvelteKit）
- CLI

## Status

当前状态：

- 已实际验证主用通道：Telegram
- 已实现并可启动：Feishu、Web Chat、CLI
- 当前核心形态：单仓库、单进程 SvelteKit、服务端统一 runtime

## Features

已经具备的核心能力：

- 多通道接入：Telegram、Feishu、Web、CLI
- 统一 agent runtime：消息进入同一套 runner / tools / prompt / memory 流程
- 多模型路由：`text` / `vision` / `stt` / `tts`
- 语音转写：OpenAI-compatible STT
- 图片理解：渠道图片会进入 vision 输入
- 文件处理：渠道附件会保存到工作区并暴露给 agent
- 多会话支持：新建、切换、清理、删除会话
- Skills 体系：全局技能 + chat 局部技能
- Memory 插件：统一 gateway，支持可替换 backend
- Web 设置中心：AI、Telegram、Feishu、Memory、Skills、Plugins

当前实现上的一个重要边界：

- Telegram 的运行时能力最完整
- Feishu 已支持文件/图片/音频入站与出站，但线程化回复、typing 状态这类体验能力还没有做深

## Architecture

Molibot 现在是单进程 SvelteKit 架构：

- `src/routes/*` 提供 Web 页面和 API
- `src/lib/server/*` 放服务端专用 runtime
- Telegram / Feishu 在服务端生命周期中启动
- Web Chat 和 CLI 复用同一套后端能力

核心后端模块：

- `app`：启动、环境配置、runtime 装配
- `agent`：prompt、runner、tools、workspace、events
- `channels`：Telegram / Feishu / shared channel logic
- `memory`：memory gateway、backend、importers
- `sessions`：会话持久化
- `settings`：运行时设置 schema、默认值、存储
- `providers`：模型/provider 调用适配
- `infra`：基础设施能力

保留 `src/lib/server/` 这一层是刻意的：它明确表达“这些模块只能在服务端使用”，避免 runtime 代码被前端误引用。

## Getting Started

### Requirements

- Node.js `>= 22`
- npm

### Install

```bash
npm install
npm link
```

### Configure

从模板复制环境变量文件：

```bash
cp .env.example .env
```

最常用的配置项：

- `PORT`：Web 服务端口，默认 `3000`
- `DATA_DIR`：数据根目录，默认 `~/.molibot`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `AI_PROVIDER_MODE=pi|custom`
- `PI_MODEL_PROVIDER` / `PI_MODEL_NAME`
- `CUSTOM_AI_BASE_URL` / `CUSTOM_AI_API_KEY` / `CUSTOM_AI_MODEL` / `CUSTOM_AI_PATH`
- `TELEGRAM_STT_BASE_URL` / `TELEGRAM_STT_API_KEY` / `TELEGRAM_STT_MODEL`

说明：

- 运行时最终以 `${DATA_DIR}/settings.json` 为准
- Web Settings 页面会覆盖并持久化运行时设置

### Initialize Workspace

首次建议执行：

```bash
molibot init
```

这会在 `${DATA_DIR:-~/.molibot}` 下初始化：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `USER.md`
- `skills/`

## Usage

### Development

```bash
molibot
# 等价于:
# molibot dev
```

### Production

```bash
molibot build
molibot start
```

### CLI

```bash
molibot cli
```

### Local Service Scripts

```bash
./bin/molibot-service.sh start
./bin/molibot-service.sh stop
./bin/molibot-service.sh status
./bin/molibot-service.sh restart
```

## Web UI

主要页面：

- `/`：Web Chat
- `/settings`：设置总览
- `/settings/ai`：模型、Provider、路由
- `/settings/telegram`：Telegram Bot 配置
- `/settings/feishu`：Feishu Bot 配置
- `/settings/plugins`：插件与 memory backend
- `/settings/memory`：memory 管理
- `/settings/skills`：skills 清单
- `/settings/tasks`：任务查看

## Telegram Commands

- `/chatid`
- `/stop`
- `/new`
- `/clear`
- `/sessions`
- `/sessions <index|sessionId>`
- `/delete_sessions`
- `/delete_sessions <index|sessionId>`
- `/models`
- `/models <index|key>`
- `/models <text|vision|stt|tts>`
- `/models <text|vision|stt|tts> <index|key>`
- `/skills`
- `/help`

## Data Layout

默认数据目录：`~/.molibot`

主要结构：

```text
~/.molibot/
  settings.json
  sessions/
  skills/
  memory/
  moli-t/
  moli-f/
```

其中：

- `sessions/`：Web / 多端会话持久化
- `skills/`：全局 skills
- `memory/`：统一 memory 根目录
- `moli-t/`：Telegram 运行区
- `moli-f/`：Feishu 运行区

## Project Structure

```text
src/
  routes/
  lib/
    shared/
    server/
      app/
      agent/
      channels/
      infra/
      memory/
      providers/
      sessions/
      settings/
bin/
package/
docs/
```

目录说明：

- `src/routes/`：SvelteKit 页面与 API
- `src/lib/shared/`：跨端共享类型或纯工具
- `src/lib/server/`：服务端 runtime 主体
- `bin/`：`molibot` 启动器与运维脚本
- `package/mory/`：独立 memory SDK 包
- `docs/`：补充设计与开发文档

## API

当前主要接口：

- `GET /health`
- `POST /api/chat`
- `POST /api/stream`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/memory`

## Skills

`molibot init` 只会初始化 skills 目录，不会自动安装项目里的示例 skills。

如果你想把仓库内 `skills/` 安装到全局目录，可以手动复制：

```bash
cp -R /Users/gusi/Github/molipibot/skills/. ~/.molibot/skills/
```

如果你使用自定义 `DATA_DIR`，请改成 `${DATA_DIR}/skills`。

## Documentation

- `prd.md`：产品范围、优先级、验收标准
- `features.md`：已实现能力与更新日志
- `architecture.md`：架构说明
- `docs/plugin-development.md`：插件开发说明
- `AGENTS.md`：协作规则

## Known Limitations

- Telegram 是当前最完整、最稳定的通道
- Feishu 已补齐基础媒体收发，但交互体验还没有像 Telegram 那样细化
- Web Chat 和 CLI 已实现，但 README 中不把它们表述成“已充分实战验证”
- 历史文档中少量早期表述可能仍保留旧设计，优先以 `features.md` 和当前代码为准
