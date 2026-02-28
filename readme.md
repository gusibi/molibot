# Molibot

Molibot 是一个多端 AI 助手项目，当前入口实现覆盖：
- Telegram Bot
- Web Chat (SvelteKit)
- CLI (`molibot cli`)

## 当前状态（基于 `prd.md` + `features.md`）

已验证可用：
- Telegram Bot（当前主用通道）

部分实现但未在本项目实际使用中验证：
- Web Chat (SvelteKit)
- CLI (`molibot cli`)

已完成核心能力：
- 统一消息路由（Telegram / Web / CLI）
- Telegram mom-t 运行时（队列、可中断、多会话、事件调度、工具调用）
- Web 聊天与流式回复
- CLI 多轮对话
- JSON 文件持久化（settings / sessions）
- 多 Bot Telegram 配置
- 多模型路由（text / vision / stt / tts）
- 语音转写（OpenAI-compatible STT）
- Skills 两级仓库（global + chat）
- Memory 插件（gateway + json-file core）

最近修复：
- Telegram 图片回复优先使用 `sendPhoto`，避免图片被当成不可预览的数据文件发送。

## 技术架构

单进程 SvelteKit：
- 前端页面：`/`、`/settings/*`
- 服务端 API：`/api/*`
- Telegram Runtime：在服务端生命周期中启动

关键目录：
- `src/lib/server/`：后端核心（runtime、telegram adapter、mom、memory、settings）
- `src/routes/`：Web 页面与 API 路由
- `bin/`：`molibot` 启动器与服务运维脚本

## 安装

```bash
npm install
npm link
```

Node 要求：`>= 22`

## 启动与构建

开发：
```bash
molibot
# 等价于 molibot dev
```

生产构建：
```bash
molibot build
molibot start
```

CLI 模式：
```bash
molibot cli
```

## 初始化工作区

```bash
molibot init
```

默认初始化目录：`~/.molibot`（可用 `DATA_DIR` 覆盖）。

会创建：
- `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`BOOTSTRAP.md`、`IDENTITY.md`、`USER.md`
  - 都从 `src/lib/server/mom/prompts/*.template.md` 拷贝
  - 这些模板基于当前全局 profile 结构，适合新用户首次初始化后继续编辑
- `${DATA_DIR}/skills`（全局技能目录）

说明：
- `molibot init` 不会自动安装项目内置 skills；是否安装由用户自行决定。

## Skills 安装（手动）

如果你想使用项目目录内常用 skills（`/Users/gusi/Github/molipibot/skills`），可手动复制到全局 skills 目录：

```bash
cp -R /Users/gusi/Github/molipibot/skills/. ~/.molibot/skills/
```

如果你使用自定义 `DATA_DIR`，请替换目标路径为 `${DATA_DIR}/skills`。

## Web 管理页面

- `/settings`：设置总览
- `/settings/ai`：Provider / Models / 路由（text/vision/stt/tts）
- `/settings/telegram`：多 Bot 配置
- `/settings/plugins`：插件开关（含 memory）
- `/settings/memory`：memory 管理
- `/settings/skills`：skills 清单（global/chat/workspace-legacy）

## Telegram 命令

- `/chatid`：查看当前 chat id 与白名单状态
- `/stop`：停止当前运行任务
- `/new`：新建并切换 session
- `/clear`：清空当前 session 上下文
- `/sessions`：列出并查看当前 session
- `/sessions <index|sessionId>`：切换 session
- `/delete_sessions`：查看可删除 session
- `/delete_sessions <index|sessionId>`：删除 session
- `/models`：查看 text 路由模型
- `/models <index|key>`：切换 text 模型
- `/models <text|vision|stt|tts>`：查看指定路由模型
- `/models <text|vision|stt|tts> <index|key>`：切换指定路由模型
- `/skills`：查看当前加载技能
- `/help`：命令帮助

## 配置（.env）

从 `.env.example` 复制：
```bash
cp .env.example .env
```

常用项：
- `PORT`：Web 服务端口（默认 `3000`）
- `DATA_DIR`：数据根目录（默认 `~/.molibot`）
- `TELEGRAM_BOT_TOKEN`：Telegram Bot Token
- `TELEGRAM_ALLOWED_CHAT_IDS`：可选白名单（逗号分隔）
- `AI_PROVIDER_MODE=pi|custom`
- `PI_MODEL_PROVIDER` / `PI_MODEL_NAME`
- `CUSTOM_AI_BASE_URL` / `CUSTOM_AI_API_KEY` / `CUSTOM_AI_MODEL` / `CUSTOM_AI_PATH`
- `TELEGRAM_STT_BASE_URL` / `TELEGRAM_STT_API_KEY` / `TELEGRAM_STT_MODEL`
- `MEMORY_ENABLED` / `MEMORY_CORE`

说明：运行时设置最终以 `${DATA_DIR}/settings.json` 为准（Web 设置页可在线修改并持久化）。

## 数据目录结构（默认 `~/.molibot`）

- `settings.json`：运行时设置
- `sessions/`：Web/多端会话持久化
- `moli-t/`：Telegram 运行区
  - `bots/<botId>/<chatId>/scratch/`：会话工作目录
  - `bots/<botId>/<chatId>/contexts/`：session context
- `skills/`：全局 skills
- `memory/`：统一 memory 文件根目录

## 服务运维（后台）

推荐统一脚本：
```bash
./bin/molibot-service.sh start
./bin/molibot-service.sh stop
./bin/molibot-service.sh status
./bin/molibot-service.sh restart
```

兼容别名：
```bash
./bin/start-molibot.sh
./bin/stop-molibot.sh
./bin/status-molibot.sh
./bin/restart-molibot.sh
```

默认：
- 日志：`~/logs/molibot.log`
- PID：`~/.molibot/molibot.pid`

实时日志：
```bash
tail -f ~/logs/molibot.log
```

## API 概览

- `GET /health`
- `POST /api/chat`
- `POST /api/stream`
- `GET|PUT /api/settings`
- `GET /api/sessions`
- `GET|DELETE /api/sessions/:id`
- `POST /api/memory`

## 文档索引

- `AGENTS.md`：协作规则（包含“每次改动后更新 features/prd”）
- `prd.md`：产品范围、优先级、验收标准
- `features.md`：已实现能力和更新日志
- `architecture.md`：架构说明

## 已知事项

- `prd.md` 早期部分仍保留过往 SQLite 表述；当前实现已切换为 JSON 持久化（以 `features.md` 与代码为准）。
- 若在本机遇到 npm 网络不可达（`ENOTFOUND`），会影响首次依赖安装与构建。
