# Molibot

Molibot 是一个基于 pi-mono 的极简多端 AI 助手，V1 支持 Telegram + CLI + Web。

## 当前保留文档与作用
| 文件 | 作用 | 什么时候看 |
|---|---|---|
| `AGENTS.md` | 项目协作规则与文档更新约束 | 每次开始改动前先看 |
| `prd.md` | V1 功能范围（Must/Later）、优先级、验收标准 | 确认要做什么时看 |
| `architecture.md` | V1 技术架构、组件边界、两周冲刺计划 | 设计实现和拆任务时看 |
| `features.md` | 已实现/计划中/待办功能状态 + 变更日志 | 每次改完后更新 |
| `readme.md` | 项目入口与文档导航 | 不确定从哪里开始时看 |

## 当前架构（单进程 SvelteKit）
- `npm run dev` 只启动一个进程：SvelteKit
- SvelteKit 同时承载：
  - Web UI
  - API：`/api/chat`、`/api/stream`、`/api/settings`、`/health`
  - Telegram bot 启动
- CLI 仍独立命令：`npm run cli`

## Web 设置页
- 地址：`/settings`
- 可以配置：
  - AI provider（`pi` / `custom`、模型、key、host）
  - Telegram token 和允许的 chat id 列表
- 设置保存到 JSON（`data/settings.json`），AI 配置立即生效，Telegram 会自动尝试重载。

## 安装
```bash
npm install
```

## 启动
```bash
npm run dev
```

## 构建与运行
```bash
npm run build
npm run start
```

## 目录结构
- `src/lib/server/runtime.ts`: 共享 runtime（router + settings + telegram bootstrap）
- `src/lib/server/services/settingsStore.ts`: 设置持久化（JSON `data/settings.json`）
- `src/lib/server/services/assistant.ts`: 模型调用（读取运行时设置）
- `src/routes/+page.svelte`: 聊天页
- `src/routes/settings/+page.svelte`: 设置页
- `src/routes/api/settings/+server.ts`: 设置 API
