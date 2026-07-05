# Projects（项目）功能实施方案

> 状态：待实施
> 范围：Desktop（macOS App）+ 共享 Server；渠道（Telegram/飞书）接入为明确的后续阶段，本方案不实现
> 读者：执行本方案的工程模型。本文档自包含，所有文件路径、代码锚点、验收标准均已在当前代码库（分支 `desktop-app`）核实。

---

## 0. 背景与目标

Molipibot 目前的 Agent 会话都运行在自己的 Workspace 数据目录里（每个 chat 一个 scratch 临时目录）。用户希望注册若干个**外部真实目录**作为"项目"（例如一个用 Claude Code 维护的 wiki 仓库），在 Desktop App 里针对项目开多个会话，让 Agent 直接在项目目录下工作（读写项目文件、执行命令），并遵守项目目录里自带的 `AGENTS.md`/`CLAUDE.md` 工作规范。

### 0.1 核心概念模型（已与用户确认，不得偏离）

| 概念 | 定义 | 数量 | 本功能是否改动 |
|------|------|------|----------------|
| **Workspace** | Molipibot 自己的数据目录（`storagePaths.dataDir` 一族），存 session、memory、scratch、附件 | 1 个，固定 | **绝对不动**。位置、结构、现有内容零变化 |
| **Project** | 注册表里的一条"名字 + 外部目录路径 + 配置"记录 | 0~N 个 | 新增概念 |
| **Session** | 一次对话 | 每个 Project 下 0~N 条；Project 之外照旧 | 新增"归属 Project"的可选维度 |

### 0.2 不变式（红线，任何一条被打破即算实现失败）

1. **Workspace 零变化**：现有 Workspace 目录不移动、不重命名、不改结构。不属于任何 Project 的 session 行为与今天完全一致（回归测试必须覆盖）。
2. **项目目录零侵入**：Molipibot 永远不往项目的真实目录（rootPath）里写任何元数据（session 文件、索引、日志、隐藏目录都不行）。Agent 在项目 session 中写入 rootPath 的只能是"工作内容本身"。
3. **删除 Project 不碰 rootPath**：删除项目 = 删注册表行（+ 可选地删 Workspace 里该项目的 session 目录）。rootPath 指向的目录一个字节都不动。
4. **session 归属看上下文不看入口**：项目 session 一律存在 Workspace 的 `projects/<projectId>/` 下，无论将来从哪个渠道发起。
5. **现有 `WorkspaceStore` 不复用、不改名、不扩展**（`src/lib/server/workspaces/store.ts`）。它是另一个概念（trace/审批作用域标记，默认 `"personal"`），与 Project 无关。新建独立的 `ProjectStore`。
6. **身份与安全指令不可被项目文件覆盖**：项目 `AGENTS.md` 只主导"干活规范"；运行时安全层（审批、注入防护）与 bot 身份不受项目文件影响。

### 0.3 非目标（本期明确不做）

- 渠道（Telegram/飞书/微信/QQ）里的 `/project` 绑定命令 —— 仅在设计上保持兼容（见 §9）。
- 包装 Claude Code CLI 作为项目执行器。
- git worktree / 并发写保护（同项目多 session 并发写文件的冲突，v1 不解决，与 Claude Code 行为一致）。
- 项目级 skills/sandbox profile 的完整配置 UI（数据库字段预留，UI 后续版本）。
- Tauri 原生目录选择对话框（当前 `apps/desktop/src-tauri/Cargo.toml` 没有 `tauri-plugin-dialog`；v1 用文本输入 + 服务端校验，原生选择器列为可选增强，见 §7.4）。

---

## 1. 已核实的代码锚点（实施前请逐一确认仍然成立）

| 锚点 | 位置 | 当前事实 |
|------|------|----------|
| 存储路径注册 | `src/lib/server/infra/db/storage.ts` | `storagePaths` 含 `dataDir`、`dbDir`、`settingsDbFile`、`webWorkspaceDir`、`sessionsDir` 等；`ensureBaseDirs()`（约 72 行起）负责 mkdir |
| 会话存储 | `src/lib/server/sessions/store.ts` | `SessionStore` 类（168 行起）；web 渠道模式：`webWorkspaceDir/sessions-index.json` + `users/<externalUserId>/sessions/<conversationId>.json`；核心方法 `getOrCreateConversation(channel, externalUserId, conversationId?)`（302 行）、`listConversations`（460 行）。文件内已有 legacy 与 web 两套索引并存的先例 —— 新增 projects 第三套遵循同样的结构 |
| web 身份格式 | `src/lib/server/web/identity.ts:12` | `toWebExternalUserId(userId, profileId)` → `web:<profileId>:<userId>` |
| Chat 入口 | `src/routes/api/chat/+server.ts` | POST handler 解析 `ChatBody`（43 行起，字段 `userId/message/conversationId/profileId/thinkingLevel`），调 `runtime.sessions.getOrCreateConversation("web", externalUserId, conversationId)`，然后 `runner.run({ channel: "web", workspaceDir: store.getWorkspaceDir(), chatDir: store.getChatDir(scopeId), message: {...} })`（约 280 行） |
| 流式入口 | `src/routes/api/stream/+server.ts` | 约 138 行同样调用 `runner.run(...)`，改动方式与 chat 相同 |
| Agent 工具 cwd | `src/lib/server/agent/core/runner.ts` | **三处** `cwd: this.store.getScratchDir(this.chatId)`：约 293、868（`createMomTools({...})` 内）、2041 行。这是项目 session 需要改写为 rootPath 的位置 |
| 工具上下文类型 | `src/lib/server/agent/core/types.ts` | `MomContext` / message 类型已有可选 `workspaceId?`（24、62 行），新增 `project?` 字段照同样方式 |
| 工具集创建 | `src/lib/server/agent/tools/index.ts` | `createMomTools(options)`，options 含 `cwd`（122 行）与 `workspaceDir`（123 行）；`createPathGuard(options.cwd, options.workspaceDir)`（233 行）—— 守卫放行 cwd 与 workspaceDir 两棵子树。**推论：cwd 换成项目 rootPath 后，守卫自动放行 rootPath + Workspace，无需改守卫本身**（需用测试证实，见 Slice 2 验证） |
| 路径守卫 | `src/lib/server/agent/tools/path.ts` | `createPathGuard(cwd, workspaceDir)`（80 行起）；`resolveToolPath` 里有若干针对 scratch 布局的路径纠偏正则（33-77 行），项目模式下 cwd 不再是 scratch，需确认这些纠偏不会误伤（见 Slice 2 步骤 4） |
| Prompt 组装 | `src/lib/server/agent/prompts/prompt.ts` | `OPERATOR_DIRECTIVE_FILES`（29 行，AGENTS/BOT/IDENTITY/SOUL/SONG/USER，位于默认系统提示词**之上**）；`SUPPORTING_INSTRUCTION_FILES`（39 行，TOOLS/BOOTSTRAP，位于**之下**）；`PROJECT_CONTEXT_PRIORITY = ["AGENTS.md"]`（41 行）；`discoverProjectContext(workspaceDir)`（662 行起，含 `scanContextForInjection` 注入扫描与 `truncateContextContent` 截断，上限 `CONTEXT_FILE_MAX_CHARS = 20_000`）；目录约定文案在 428 行附近（"TOOLS.md is guidance about conventions and paths…"） |
| 现有 WorkspaceStore（勿动） | `src/lib/server/workspaces/store.ts` | SQLite 表 `workspaces`，`resolveWorkspaceId()` 返回默认 `"personal"`。保持原样 |
| Settings API 模式 | `src/routes/api/settings/<domain>/+server.ts` | 每个域一个目录；返回 `json({ ok: true, ... })`；参考 `src/routes/api/settings/tasks/+server.ts` 的读写结构 |
| Desktop API 客户端 | `apps/desktop/src/lib/api.ts` | 模式：`export async function loadDesktopXxx(endpoint: string, ...)`，内部 fetch `${endpoint}/api/...`；测试在 `api.test.ts` |
| Desktop 状态层 | `apps/desktop/src/lib/stores/*.svelte.ts` | 每个域一个 runes store；**禁止把域逻辑写回 `App.svelte`**（项目协作规则） |
| Desktop 导航 | `apps/desktop/src/App.svelte` | `SETTINGS_GROUPS`（110-115 行）定义 settings 分组；主界面为 Chat（`ChatView.svelte`，2236 行，正在按 slice 拆分，**不要往里加项目逻辑**） |
| 测试运行方式 | 根 `package.json` | server 侧测试用 `node --import ./scripts/register-loader.js --import tsx --test <files>`；desktop 侧 `pnpm --dir apps/desktop run test`；类型检查 `pnpm run desktop:check` 与根 `svelte-check`（经 `pnpm run build` 间接验证） |

> 执行时若发现锚点行号漂移，以符号名（函数/常量名）为准重新定位；若发现结构性差异（比如 createPathGuard 签名变了），停下来重新评估该 Slice 的方案再动手。

---

## 2. 总体架构

```
┌─ Desktop App (Tauri/Svelte) ─────────────────────────────┐
│  Projects 视图: 项目列表 / 添加 / 项目详情(会话列表+聊天)      │
│  lib/stores/projects.svelte.ts + lib/projects/*.svelte    │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (现有 endpoint 机制)
┌─ 共享 Server (SvelteKit) ─────────────────────────────────┐
│  /api/settings/projects[...]     ← ProjectStore CRUD      │
│  /api/chat, /api/stream          ← ChatBody 增加 projectId │
│                                                           │
│  ProjectStore (SQLite, settings.sqlite 新表 projects)      │
│  SessionStore 增加 projects 分支                            │
│  runner: 项目 session 的工具 cwd = rootPath                 │
│  prompt: 项目模式分层（项目 AGENTS.md 高优先注入）             │
└──────────────────────┬───────────────────────────────────┘
                       │
   Workspace(dataDir)  │            项目真实目录(rootPath)
   ├─ projects/        │            └─ 只被读写"工作内容"，
   │   └─ <id>/        │               永无 molipibot 元数据
   │       ├─ sessions-index.json
   │       └─ sessions/<conversationId>.json
   ├─ web/ …(现状不动)
   └─ db/settings.sqlite (新表 projects)
```

数据流（项目 session 一条消息的生命周期）：

1. Desktop 在项目详情页发消息 → `POST /api/chat`（或 `/api/stream`），body 多带 `projectId`。
2. Server 用 `ProjectStore.get(projectId)` 解析出 rootPath；不存在则 4xx 拒绝。
3. `SessionStore.getOrCreateConversation("web", externalUserId, conversationId, { projectId })` —— 存储走 projects 分支，落盘到 `dataDir/projects/<projectId>/sessions/`。
4. `runner.run(ctx)` 的 ctx 带上 `project: { id, rootPath }`。
5. runner 三处 cwd 取值改为 `ctx.project?.rootPath ?? this.store.getScratchDir(this.chatId)`；scratch/runlogs/memory 照旧留在 Workspace。
6. prompt 组装进入"项目模式"：注入项目 `AGENTS.md`（高优先干活规范）+ 项目视角目录说明，抑制 bot 的 Workspace 目录说明。

---

## 3. Slice 1 — ProjectStore 与 CRUD API（纯后端，零行为影响）

### 3.1 为什么先做这个

它是纯增量（新表、新路由），不触碰任何现有路径，可以独立合入并验证，为后面所有 Slice 提供数据底座。

### 3.2 步骤

**步骤 1：新建 `src/lib/server/projects/store.ts`**

仿照 `src/lib/server/workspaces/store.ts` 的实现风格（`node:sqlite` 的 `DatabaseSync`、`ensureSqliteParentDir`、`CREATE TABLE IF NOT EXISTS`、row→record 映射、id sanitize），但完全独立成文件/表。表结构：

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,            -- slug，由 name 生成：小写、[a-z0-9-]、去首尾横线；冲突时追加 -2/-3…
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,        -- 绝对路径，存 resolve 后的规范形式
  instructions TEXT,              -- 可选的项目级附加指令（不想写进项目仓库文件的要求放这里）
  sandbox_profile_id TEXT,        -- 预留，本期不消费
  approval_profile_id TEXT,       -- 预留，本期不消费
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects(root_path);
```

导出 `ProjectRecord` 接口与 `ProjectStore` 类：`list()`、`get(id)`、`create(input)`、`update(id, patch)`、`remove(id)`。数据库文件用 `storagePaths.settingsDbFile`（与 workspaces 表同库不同表，避免多一个 db 文件）。

**步骤 2：rootPath 校验函数（同文件导出，供 store 与 API 共用）**

`validateProjectRootPath(rootPath: string): { ok: true; resolved: string } | { ok: false; reason: string }`，规则与理由：

| 规则 | 理由 |
|------|------|
| 必须是绝对路径 | 相对路径会随 server 工作目录漂移，产生不可预测的读写位置 |
| `fs.existsSync` 且 `statSync().isDirectory()` | 拒绝把文件或不存在的路径注册成项目 |
| resolve 后不得等于/包含/被包含于 `storagePaths.dataDir` | 防止把 Workspace 自己注册成项目造成递归读写与"Workspace 被项目化"（违反不变式 1） |
| 不得为文件系统根 `/` 或用户 home 目录本身 | 把整个磁盘/家目录交给 Agent 写权限的风险不可接受；home 的子目录可以 |
| 比较一律用 `pathCompareKey`（`src/lib/server/agent/tools/path.ts:17`，处理 macOS 大小写不敏感） | 避免 `/Users/x/Wiki` 与 `/users/x/wiki` 被当成两个项目 |

`update` 允许改 `name`、`instructions`、`rootPath`（改 rootPath 需重新过全部校验）；改 `name` **不改 id**（id 是存储目录名，改了会孤儿化已有 session 目录）。

**步骤 3：新建 API 路由**

- `src/routes/api/settings/projects/+server.ts`：
  - `GET` → `{ ok: true, projects: ProjectRecord[] }`
  - `POST` body `{ name, rootPath, instructions? }` → 校验失败返回 `400 { ok: false, error: <人类可读原因> }`；成功 `{ ok: true, project }`
- `src/routes/api/settings/projects/[id]/+server.ts`：
  - `GET` → 单个项目 + 会话统计（`sessionCount`，Slice 3 之前先返回 0）
  - `PATCH` body `{ name?, rootPath?, instructions? }`
  - `DELETE` query `?removeSessions=true|false`（默认 false）→ 删注册表行；`removeSessions=true` 时额外递归删除 `dataDir/projects/<id>/`（**只删这一个目录，实现里必须 resolve 后断言该路径以 `dataDir/projects/` 开头再删**，防御 id 注入 `../`）。永不触碰 root_path。

参照 `src/routes/api/settings/tasks/+server.ts` 的错误处理与 `json({ ok })` 风格。

**步骤 4：存储目录注册**

`src/lib/server/infra/db/storage.ts` 的 `storagePaths` 增加 `projectsDir: path.resolve(config.dataDir, "projects")`，并在 `ensureBaseDirs()` 中 mkdir。理由：所有磁盘布局必须经由 storagePaths 单点定义（现有约定），后续 Slice 的 SessionStore 分支直接引用。

### 3.3 验证

1. **单测** 新建 `src/lib/server/projects/store.test.ts`（仿 `workspaces/store.test.ts` 的临时 db 模式）覆盖：
   - create → list/get 往返一致；slug 生成与冲突追加序号；同 rootPath 二次注册被拒（大小写变体也被拒）。
   - 校验规则逐条：相对路径、不存在、是文件、dataDir 本身、dataDir 子目录、dataDir 的父目录、`/`、home —— 全部 `ok: false`；正常目录 `ok: true`。
   - update 改 rootPath 重新校验；remove 后 get 为 null。
   - 运行：`node --import ./scripts/register-loader.js --import tsx --test src/lib/server/projects/store.test.ts`
2. **手动**：`pnpm run dev` 起 server，用 curl 走一遍 POST（一个真实临时目录）→ GET → PATCH → DELETE，确认 400 场景返回可读错误。
3. **回归**：跑 `pnpm run test:desktop-chat`（其中含 `sessions/store.test.ts`），必须全绿 —— 证明本 Slice 未影响现有会话逻辑。

---

## 4. Slice 2 — Runner 支持项目 cwd（核心，含安全验证）

### 4.1 为什么

这是"Agent 在项目目录里干活"的本体。单独成 Slice 是因为它触碰现有 runner 路径，必须用回归测试隔离风险。

### 4.2 步骤

**步骤 1：类型扩展**

`src/lib/server/agent/core/types.ts`：在含 `workspaceId?` 的 `MomContext`（24 行处的那一个类型）与消息类型（62 行处）增加：

```ts
project?: { id: string; rootPath: string };
```

可选字段，理由：所有现有调用方不传即完全不受影响（不变式 1 的类型层保证）。

**步骤 2：runner 三处 cwd 改写**

`src/lib/server/agent/core/runner.ts` 约 293、868、2041 行，把

```ts
cwd: this.store.getScratchDir(this.chatId),
```

改为（三处一致）：

```ts
cwd: ctx.project?.rootPath ?? this.store.getScratchDir(this.chatId),
```

注意：三处所在函数作用域里 `ctx`（`MomContext`）是否可达需逐处确认；若某处拿不到 ctx（比如 293 行若在构造流程里），把 project 信息在 `run()` 入口存到实例字段（如 `this.activeProject`）并在该处读取，run 结束后清空。**不要**把 rootPath 长期挂在 runner 实例上跨 run 残留 —— 一次 run 一次生效。

`workspaceDir: this.store.getWorkspaceDir()` **保持不变** —— path guard 与 memory/skills 解析依赖它指向 Workspace。

**步骤 3：chat / stream 路由传入 project**

`src/routes/api/chat/+server.ts` 与 `src/routes/api/stream/+server.ts`：

1. `ChatBody`（chat 43 行起；stream 侧找到对应的 body 接口）增加 `projectId?: string`。
2. handler 里若有 `projectId`：`new ProjectStore().get(projectId)`，不存在 → `404 { ok:false, error: "Unknown project" }`；rootPath 落盘后再次 `existsSync` 校验（目录可能在注册后被用户移走），失败 → `409 { ok:false, error: "Project directory missing: <path>" }`。
3. 会话创建改用项目分支（见 Slice 3；在 Slice 3 合入前，本步骤可先把 project 传给 runner 而 session 仍走 web 存储 —— 但**推荐 Slice 2、3 同一批次合入**，避免中间态里"项目会话混在 web 列表"被用户看到）。
4. `runner.run({ ..., message: { ..., project: { id, rootPath } } })`（按 MomContext 实际形状放置字段）。

**步骤 4：`resolveToolPath` 纠偏正则复核**

`src/lib/server/agent/tools/path.ts` 33-77 行有多条针对 "cwd 是 scratch 目录" 布局的路径纠偏（如 `data/moli-*/.../scratch/`、`memory/` 前缀重写）。项目模式下 cwd 是任意外部目录，这些正则依赖的 `normalizedBase.match(/^(.*)\/[^/]+\/scratch(...)/)` 匹配不上时会自然跳过 —— **写测试证实**：cwd 为一个不含 `scratch` 的任意路径时，`resolveToolPath(cwd, "docs/a.md")` 恰好等于 `resolve(cwd, "docs/a.md")`，且 `memory/...` 输入不会被错误重写到项目目录外。若发现会误伤，在纠偏分支前加 "cwd 必须位于 Workspace 下" 的前置判断。

**步骤 5：path guard 行为确认（只加测试，预期不改代码）**

`createPathGuard(cwd, workspaceDir)` 语义是放行两棵子树。cwd=rootPath 时应得到：rootPath ✅、Workspace ✅、其他任意路径 ❌。写测试固化这个结论；如实际实现与预期不符（比如只放行 cwd），再最小化修改 guard 并保持原有测试全绿。

### 4.3 验证

1. **单测** `src/lib/server/agent/tools/path.test.ts`（若已存在则追加 case）：步骤 4、5 描述的全部断言。
2. **单测** runner 层（放在 `src/lib/server/agent/core/` 现有测试旁）：构造带 `project` 的 ctx，断言 `createMomTools` 收到的 `cwd` 是 rootPath；不带 `project` 时是 scratch 目录（回归锚）。若现有代码难以注入观测点，允许把 "解析 cwd" 提炼成一个可单测的纯函数 `resolveSessionCwd(ctx, store, chatId)`，三处调用它。
3. **手动端到端**（这是本 Slice 的验收核心）：
   - 准备一个临时目录 `/tmp/proj-demo`，放一个 `hello.md`。
   - 注册为项目，向 `/api/chat` 发带 `projectId` 的消息："读取 hello.md 的内容并原样返回"。Agent 应直接读到（证明 cwd 生效）。
   - 发"创建 notes/today.md 写入一行文字"，确认文件出现在 `/tmp/proj-demo/notes/`，而**不是** Workspace scratch。
   - 发"读取 ../../etc/hosts"之类越界请求，确认被 path guard 拒绝。
   - 检查 `/tmp/proj-demo` 里**没有**出现任何 molipibot 元数据文件（不变式 2）。
   - 不带 projectId 再发一条普通消息，确认行为与改动前一致（对照 Workspace scratch 里的产物位置）。
4. **回归**：`pnpm run test:desktop-chat` 全绿。

---

## 5. Slice 3 — SessionStore 的 projects 分支

### 5.1 为什么

项目会话必须与 web/渠道会话物理隔离、按项目分组落盘（§0.2 不变式 4），并让"desktop 发起"与将来"渠道发起"的会话共享同一份存储。

### 5.2 存储布局（最终形态）

```
<dataDir>/projects/
  <projectId>/
    sessions-index.json          # { byConversationId: { <convId>: { origin: "web:<profile>:<user>" } }, order: [<convId>...] }
    sessions/
      <conversationId>.json      # 与现有 SessionFile 同构: { conversation, messages }
```

### 5.3 步骤

**步骤 1：`src/lib/server/sessions/store.ts` 增加 projects 路径族**

仿照文件顶部 web 那组函数（`webIndexFilePath`/`webUserSessionsDir`/`webSessionFilePath`，58-68 行附近）新增：

```ts
function projectIndexFilePath(projectId: string): string;      // <projectsDir>/<id>/sessions-index.json
function projectSessionFilePath(projectId: string, conversationId: string): string;
```

`projectId` 一律过 `sanitizeUserDirPart` 同款清洗（防路径注入）。

**步骤 2：`Conversation` 类型加 `projectId?: string`**

位置：`src/lib/shared/types/message.ts` 的 `Conversation`。可选字段，旧数据反序列化天然兼容。

**步骤 3：读写分支**

- `getOrCreateConversation` 增加可选参数 `opts?: { projectId?: string }`：带 projectId 时，索引/文件读写走 projects 路径族，conversation 记录写入 `projectId` 与 `origin`（即 externalUserId，用于区分将来不同入口）。
- 新增 `listProjectConversations(projectId): Conversation[]`（按 `updatedAt` 倒序，与现有列表习惯一致——见 prd 2.25）。
- 关键隔离断言：`listConversations("web", ...)` **不得**返回项目会话（项目会话根本不在 web 索引里，天然满足；用测试钉死）。

**步骤 4：项目会话 API**

- `GET /api/settings/projects/[id]/sessions` → `{ ok, sessions: [{ conversationId, title, updatedAt, origin }] }`
- `POST /api/settings/projects/[id]/sessions` → 新建空会话，返回 conversationId（desktop"新会话"按钮用）。
- 读取单个会话消息：复用现有 `src/routes/api/sessions/[id]` 的机制 —— 阅读该路由现状，若它按 conversationId 全局寻址则扩展其查找路径把 projects 目录纳入；若按渠道索引寻址则新增 `GET /api/settings/projects/[id]/sessions/[conversationId]`。以现状代码为准，选择改动小的那条路。
- Slice 1 里 `GET /api/settings/projects/[id]` 的 `sessionCount` 此时接真数据。

**步骤 5：chat/stream 路由接上**（完成 Slice 2 步骤 3 留的口子）

带 `projectId` 的请求：`getOrCreateConversation("web", externalUserId, conversationId, { projectId })`。channel 仍为 `"web"`（不新增 Channel 枚举值 —— 新增枚举会波及渠道层大量 switch，违背"项目逻辑不进渠道层"的分层原则；入口渠道信息已由 `origin` 承载）。

### 5.4 验证

1. **单测** 扩展 `src/lib/server/sessions/store.test.ts`：
   - 项目会话创建后文件落在 `projects/<id>/sessions/`；index 正确；`listProjectConversations` 排序正确。
   - web 列表与项目列表互不可见（双向断言）。
   - projectId 含 `../evil` 之类脏值时被清洗、不逃出 projectsDir。
   - 运行：`node --import ./scripts/register-loader.js --import tsx --test src/lib/server/sessions/store.test.ts`
2. **手动**：注册项目 → POST 建会话 → 发两条消息 → GET sessions 列表看到 1 条且 title 取自首条消息（沿用 `summarizeTitle` 现状）→ 重启 server 后再 GET，数据仍在（落盘验证）→ DELETE 项目带 `removeSessions=true`，确认 `projects/<id>/` 目录消失而 rootPath 无恙。
3. **回归**：`pnpm run test:desktop-chat` 全绿（该命令显式包含 sessions/store.test.ts）。

---

## 6. Slice 4 — Prompt 项目模式

### 6.1 设计（已与用户确认）

项目 session 的系统提示词分层（自上而下 = 优先级从高到低）：

```
① 运行时安全层（审批、注入防护）            —— 不变，不可被覆盖
② bot 身份（BOT.md/IDENTITY.md/SOUL.md 等） —— 保留"我是谁"；
   bot 自己 AGENTS.md 中与"干活方式/文件组织"相关的约定在项目模式下不注入
③ 项目指令块：项目根目录发现的 AGENTS.md
   （显式声明：工作规范与 bot 默认约定冲突时，以本块为准）
④ 项目模式目录说明（替换 bot 的 Workspace 目录说明，两套互斥出现）
⑤ 项目 TOOLS.md + 注册表 instructions 字段    —— 低优先支持信息
```

核心原则：**目录词汇互斥**。项目 session 里模型只看到项目视角的路径说明（"你的工作目录是 <rootPath>；临时产物写到 <scratchDir>；不得在项目目录创建 molipibot 元数据"），不看到 Workspace 内部布局；普通 session 反之。理由：喂两套目录再教模型裁决，不如只喂一套 —— 少矛盾永远比多规则可靠。

### 6.2 步骤

**步骤 1：文件发现优先级扩展**

`src/lib/server/agent/prompts/prompt.ts:41`：

```ts
const PROJECT_CONTEXT_PRIORITY = ["AGENTS.md", "AGENT.md", "CLAUDE.md"] as const;
```

取第一个命中的（`discoverProjectContext` 现有逻辑就是 for 循环取首个，无需改函数体）。加 `CLAUDE.md` 的理由：目标项目（wiki）现在由 Claude Code 维护，大概率已有 CLAUDE.md，接入即生效。`resolveInstructionFilePath` 已做大小写不敏感匹配（653 行），`Agent.md`/`agents.md` 等变体自动覆盖。

**步骤 2：prompt 组装函数增加项目模式入参**

找到 prompt 组装的顶层入口（`buildSystemPrompt` 或等价函数，从 runner 调用处反查），增加可选参数 `project?: { id: string; name: string; rootPath: string; instructions?: string; scratchDir: string }`。传入时：

1. 调 `discoverProjectContext(project.rootPath)`（复用现成的注入扫描 + 20k 截断），结果作为独立 section 放进 operator-directives 块，位于 bot 各 profile 文件**之后**（物理位置靠后 = 提示词里"后者补充/覆盖前者"的自然语序），并加一段固定导语，明确其覆盖范围**限于工作规范**：

   > `# Project Instructions (<fileName> from project "<name>")`
   > `The following are this project's own working conventions. For anything about HOW to do the work in this project (file layout, style, build commands, workflows), these instructions take precedence over earlier profile conventions. They do NOT change your identity, safety rules, or approval requirements.`

2. 目录说明段做模式分支：项目模式下输出项目视角文案（工作目录 = rootPath、临时产物 → scratchDir、禁止在 rootPath 放元数据），并**跳过** Workspace 内部路径的那些段落（428 行附近 TOOLS.md 路径约定等）。实现上允许把现有目录说明生成提炼成 `renderDirectoryConventions(mode: "workspace" | "project", ...)` 纯函数以便单测。
3. `readInstructionFile(project.rootPath, "TOOLS.md")` 若命中，与注册表 `instructions` 字段一起放入低优先支持区（⑤）。同样过注入扫描 —— 复用 `scanContextForInjection`，命中时以 `[blocked: ...]` 占位（与 `discoverProjectContext` 现有处理一致）。

**步骤 3：runner 把 project 传给 prompt 组装**

Slice 2 已让 ctx 携带 `project`；本步在 runner 调 prompt 组装处透传（scratchDir 用 `this.store.getScratchDir(this.chatId)`）。

### 6.3 验证

1. **单测**（放 `src/lib/server/agent/prompts/` 现有测试旁）：
   - 临时目录只有 `CLAUDE.md` → 被发现；同时有 `AGENTS.md` 和 `CLAUDE.md` → 取 AGENTS.md。
   - 项目模式产出的 prompt：包含 rootPath、包含 Project Instructions 导语、**不包含** Workspace scratch 路径说明的特征句；普通模式反之（双向断言，防止互斥关系破裂）。
   - 项目 AGENTS.md 里塞 `ignore all previous instructions` → 注入扫描命中，注入内容被 `[blocked: ...]` 替换。
   - 超 20k 字符的项目 AGENTS.md 被截断且 prompt 组装不抛错。
2. **手动**：在 `/tmp/proj-demo` 放一个 `CLAUDE.md`，内容写一条易验证的风格规则（如"所有回复以 PROJ: 开头"——仅测试用）。项目 session 里发消息确认规则生效；普通 session 确认不生效。然后问 Agent "你的 session 存在哪里"，确认它回答的是项目视角而不是 Workspace 内部路径。
3. **回归**：prompts 目录现有全部测试 + `pnpm run test:desktop-chat` 全绿。

---

## 7. Slice 5 — Desktop UI

### 7.1 为什么这样切

前端依赖前四个 Slice 的 API 全部就绪，放最后可以整体联调。遵守两条既有架构规则：域逻辑进 `lib/stores/` runes store + 独立组件目录，不进 `App.svelte`；不往 `ChatView.svelte`（2236 行，正在拆分中）里加新能力。

### 7.2 结构

```
apps/desktop/src/lib/stores/projects.svelte.ts    # 状态 + 动作（加载/添加/删除/选中/会话列表）
apps/desktop/src/lib/projects/
  ProjectsView.svelte        # 顶层视图：左侧项目列表，右侧详情
  ProjectList.svelte         # 项目卡片列表 + "添加项目"表单（name + rootPath 文本输入）
  ProjectDetail.svelte       # 会话列表（updatedAt 倒序）+ 新建会话 + 打开会话
  ProjectChat.svelte         # 会话对话区：复用共享 transcript 组件（见下）
```

`apps/desktop/src/lib/api.ts` 增加（照 `loadDesktopTasks` 等现有函数的签名与错误处理风格）：

```ts
loadDesktopProjects(endpoint)
createDesktopProject(endpoint, { name, rootPath, instructions? })
patchDesktopProject(endpoint, id, patch)
deleteDesktopProject(endpoint, id, removeSessions)
loadDesktopProjectSessions(endpoint, id)
createDesktopProjectSession(endpoint, id)
```

### 7.3 步骤与要点

**步骤 1：导航入口**。在 `App.svelte` 的主视图切换处（Chat / Settings 并列的那一层）加 "Projects" 入口，进入 `ProjectsView`。只加路由切换代码，视图内部逻辑全部在新模块里。中英文案都要（现有 `text` 本地化机制）。

**步骤 2：添加项目表单**。v1 是 name + rootPath 两个文本框。**校验完全交给服务端**（POST 返回的 400 error 原样展示），前端不自己猜路径合法性 —— 理由：合法性规则（dataDir 嵌套、大小写等）只有服务端知道，前端复刻一份必然漂移。

**步骤 3：会话对话区复用共享渲染**。项目会话的消息展示必须复用共享 completed-message renderer（`apps/desktop/src/lib/chat/ConversationTranscript.svelte` 一族 —— prd 2.28 的硬性规则："本地 Chat、历史、外部只读会话与自动任务详情共用同一个完成消息 renderer"）。发送用现有 chat/stream API 加 `projectId` 字段。streaming、composer 状态管理可参考 ChatView 现有调用方式，但代码放 `ProjectChat.svelte`，不共享 ChatView 的内部状态。

**步骤 4：删除项目交互**。确认弹窗必须写清两件事："项目目录本身不会被删除或修改"；提供 checkbox"同时删除该项目的会话记录"（对应 `removeSessions`）。默认不勾选。开关类控件一律用 `IosSwitch`（`$lib/components/ui/ios-switch`，CLAUDE.md 硬规则）。

**步骤 5：样式**。遵循 `DESIGN.vercel.md`（Geist —— desktop 端已确认取代 Liquid Glass）；模板里禁止裸 Tailwind 视觉工具类，一律语义类名（DESIGN.md §CSS Class Naming Convention）。Svelte 5 注意：模板里不要用无参函数调用取派生状态（不追踪依赖），用 `$derived`/显式依赖。

### 7.4 可选增强（单独小提交，可跳过）

原生目录选择器：`apps/desktop/src-tauri/Cargo.toml` 加 `tauri-plugin-dialog = "2"`，前端加 `@tauri-apps/plugin-dialog`，rootPath 输入框旁加"浏览…"按钮调 `open({ directory: true })`。跳过不影响验收。

### 7.5 验证

1. `pnpm run desktop:check`（svelte-check）零新增错误；`pnpm run desktop:test`。
2. api.ts 新函数在 `apps/desktop/src/lib/api.test.ts` 补 case（该文件在 `test:desktop-chat` 命令里）。
3. **手动走查**（`pnpm run desktop:dev`）：
   - 添加项目（真实目录）→ 列表出现；添加非法路径（相对路径、不存在、dataDir 内）→ 表单展示服务端错误文案。
   - 项目详情新建会话 → 发消息"列出本目录的文件" → 回复正确 → 会话出现在列表且标题取自首条消息。
   - 开第二个会话，两个会话上下文互不串扰；重启 App 后会话与项目都在。
   - 普通 Chat 页面的 session 列表**看不到**项目会话（隔离验收）。
   - 删除项目（不勾删会话）→ 项目消失；重新添加同目录 → 因 id 不同旧会话不自动回来（可接受，写入交互文案）；勾选删会话的路径也走一遍，确认 rootPath 目录无恙。
   - 中英双语、明暗主题、窄窗口三个维度各过一遍（项目既有验收习惯，见 prd 2.29/2.30）。

---

## 8. 安全要求汇总（实现时对照自查）

1. **rootPath 校验白名单式规则**见 §3.2 步骤 2，任何新入口（PATCH、未来渠道绑定）都必须走同一个校验函数，不得旁路。
2. **删除操作的路径断言**：任何 `rm -rf` 等价操作前，resolve 目标并断言前缀为 `dataDir/projects/`（§3.2 步骤 3）。
3. **项目文件是半可信内容**：项目 AGENTS.md/TOOLS.md 全部经过 `scanContextForInjection`；截断上限沿用 20k。项目目录里任何人能写文件 ≠ 任何人能改写 Agent 行为。
4. **审批与 hostBash 逻辑不因项目模式放宽**：bash 工具的 sandbox/审批流（`src/lib/server/agent/tools/bash.ts`）不做任何项目特例。
5. **projectId 作为目录名前必须 sanitize**（§5.3 步骤 1）。

## 9. 为后续渠道接入预留的兼容点（本期只需"不做错"，无需实现）

- 会话索引里的 `origin` 字段（§5.2）已能区分入口来源；渠道接入时新增"绑定表 channel+chatId → projectId + activeConversationId"与 `/project` 命令（挂 `channelCommands.ts` 现有命令体系），存储与 runner 无需再改。
- channel 枚举不为项目扩值（§5.3 步骤 5 的决定），渠道层保持对项目零感知 —— 符合 AGENTS.md 分层规则。
- 渠道发起的项目 session 默认安全策略（只读或强审批）留到那一期决策。

## 10. 文档与流程要求（仓库协作规则，必须执行）

1. **实施开始前**：`prd.md` 增加新节（编号顺延，如 `## 2.31 Desktop Projects (日期)`），把 §0.2 不变式与各 Slice 验收标准写成 `[Planned]` 条目；实施中逐条翻 `[Done]`。
2. **每个 Slice 交付时**：同一批次更新 `features.md`（实现记录）与 `CHANGELOG.md`（面向用户的一句话），desktop 相关 Slice 尤其不得漏（用户明确要求过）。
3. 提交信息风格参考近期历史（如 `feat(desktop): ...` / `feat(projects): ...`）。
4. 任何文档、代码、提示词中**不得出现绝对路径**（`/Users/...`）—— 示例一律用 `/tmp/...` 或占位符。

## 11. 实施顺序与依赖

```
Slice 1 (ProjectStore + API)        ← 独立，先行合入
Slice 2 (runner cwd) ─┐
Slice 3 (SessionStore) ┴─ 建议同批合入（避免中间态），内部先 3 后 2 联调
Slice 4 (Prompt 项目模式)            ← 依赖 2
Slice 5 (Desktop UI)                ← 依赖 1/2/3/4 全部
```

每个 Slice 合入前的统一门禁：`pnpm run test:desktop-chat` 全绿 + 该 Slice 自己的新增测试全绿 + 手动验证清单走完。
