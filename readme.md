# Molibot

<p align="center">
  <img src="./Voldemomo_compressed.jpg" alt="Molibot logo" width="160" />
</p>

<p align="center">
  A simpler OpenClaw-style personal AI assistant.
</p>

Molibot 是一个可本地长期使用的多入口 AI 助手，当前支持：

- Telegram Bot
- Feishu Bot
- Web Chat（SvelteKit）
- CLI

## 1. 你能用它做什么

- 多通道统一对话：同一套 runtime、同一套会话和记忆能力
- 多模型路由：`text / vision / stt / tts`
- 图片和语音：Web 支持图片上传与实时录音发送；Telegram/Feishu 支持多媒体消息
- 会话管理：新建、切换、重命名、删除
- Agent/Profile 分层：
  - Agent（身份层）
  - Channel 实例（Telegram/Feishu/Web Profiles）
  - Prompt 文件覆盖（global -> agent -> bot/profile）
- 设置中心：AI、Agents、Telegram、Feishu、Web Profiles、Memory、Skills、Tasks、Plugins

## 2. 快速安装

### 环境要求

- Node.js >= 22
- npm

### 安装

```bash
npm install
npm link
```

### 初始化

```bash
cp .env.example .env
molibot init
```

`molibot init` 会在 `${DATA_DIR:-~/.molibot}` 初始化 profile 文件与基础目录。

## 3. 启动方式

### 开发模式

```bash
molibot
# 等价于 molibot dev
```

### 生产模式

```bash
molibot build
molibot start
```

### CLI 对话

```bash
molibot cli
```

### 服务脚本（可选）

```bash
./bin/molibot-service.sh start
./bin/molibot-service.sh stop
./bin/molibot-service.sh status
./bin/molibot-service.sh restart
```

## 4. 首次配置（推荐顺序）

1. 打开 `http://localhost:3000/settings/ai` 配置模型和 Provider。  
2. 打开 `http://localhost:3000/settings/agents` 新建你的 Agent。  
3. 打开 `http://localhost:3000/settings/web` 配置 Web Profiles 并绑定 Agent。  
4. 如果要接入 Telegram/Feishu：
   - `http://localhost:3000/settings/telegram`
   - `http://localhost:3000/settings/feishu`
5. 回到 `http://localhost:3000/` 开始聊天。

## 5. Web Chat 使用说明

- 左侧 `+ New chat`：创建新会话（现在只选择 `Web Profile`，不再使用 User ID）
- 会话标题：可双击重命名
- 输入区：
  - 文本消息
  - `+ Image` 上传图片
  - `Record Voice` 实时录音，停止后自动发送
- `Preview System Prompt`：查看当前 profile/agent/bot 文件组合后的实际 system prompt

## 6. Telegram 常用命令

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

## 7. 设置页面索引

- `/settings`：设置首页
- `/settings/ai`：Provider、模型、路由、用量
- `/settings/agents`：Agent 管理与 Markdown 文件
- `/settings/web`：Web Profiles
- `/settings/telegram`：Telegram Bots
- `/settings/feishu`：Feishu Bots
- `/settings/memory`：记忆管理
- `/settings/skills`：技能清单
- `/settings/tasks`：任务管理
- `/settings/plugins`：插件与后端开关

## 8. 数据目录

默认：`~/.molibot`

典型结构：

```text
~/.molibot/
  settings.json
  settings.sqlite
  sessions/
  memory/
  skills/
  moli-t/
  moli-f/
  moli-w/
```

说明：

- `settings.json`：稳定静态配置（bootstrap 类）
- `settings.sqlite`：动态配置（agents/channels/providers 等）
- `sessions/`：会话持久化
- `memory/`：记忆数据
- `moli-t` / `moli-f` / `moli-w`：各通道运行区

## 9. 常用环境变量

- `PORT`：默认 `3000`
- `DATA_DIR`：默认 `~/.molibot`
- `SETTINGS_FILE`：默认 `${DATA_DIR}/settings.json`
- `SETTINGS_DB_FILE`：默认 `${DATA_DIR}/settings.sqlite`
- `AI_PROVIDER_MODE=pi|custom`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`

完整变量见 `.env.example`。

## 10. 文档

- `prd.md`：产品范围和优先级
- `features.md`：已实现能力和更新日志
- `architecture.md`：架构说明
- `docs/plugin-development.md`：插件开发说明
- `AGENTS.md`：协作约束

## 11. 现状说明

- Telegram 是当前最完整、最稳定的通道
- Feishu/Web/CLI 已可用，持续迭代中
- 如文档与行为冲突，优先以 `features.md` 与当前代码为准
