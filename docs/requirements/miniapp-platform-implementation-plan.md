# Mini App Platform 实施方案

> 状态：待实施
>
> 依据：[Mini App Platform PRD](./miniapp-platform-prd.md) v2
>
> 范围：共享 Server + Desktop（macOS）+ Todo 参考 Mini App
>
> 复杂度：复杂。必须按纵向 Slice 逐步交付，不得一次性大改。

---

## 0. 已锁定的产品决策

下列决定已经确认，实施时不再重新讨论：

1. **Owner Workspace 就是 ~/.molibot**。代码中以现有 **config.dataDir / storagePaths.dataDir** 为唯一来源；不新增第二个 Workspace 配置，不从 Channel、Bot、Session 或 Project 的 **workspaceDir** 推导。
2. **Mini App UI 直接调用 App 自己的 HTTP Handler**。UI 不调用 Agent Tool，不经过 MCP Bridge，不实现 MCP Apps postMessage / JSON-RPC。
3. **Tool Handler 与 HTTP Handler 共用同一个 App Runtime 实例和领域模块**，数据与业务规则只有一份。
4. **V1 是 Owner 全局单实例**。任何渠道写入的 Todo，Desktop 面板都读取同一份数据。
5. **App 服务端代码是 Owner 自装的完全可信代码**，在 Molibot Server 进程内运行。V1 不做服务端代码沙箱。
6. **UI 是强隔离面**。每个 App 在独立 Origin 的 sandboxed iframe 中运行，不能访问 Desktop 顶层 DOM、Tauri IPC 或其他 App Origin。

### 0.1 固定目录

~~~text
Owner Workspace       ~/.molibot
Mini App 根            ~/.molibot/miniapps
App 代码               ~/.molibot/miniapps/apps/<app-id>
App 数据               ~/.molibot/miniapps/data/<app-id>
~~~

不变式：

- **apps/** 可替换；**data/** 不得因安装、重载或普通升级被删除。
- Mini App 运行时不接收 Channel **workspaceDir** 作为安装根或数据根。
- App 数据不写入 memory、session 文件或某个 Channel 目录。
- disabled 必须在 Tool 真正执行时、UI 静态资源请求时和 HTTP Handler 请求时同时生效。
- 不提供宿主级通用 App 文件读写 HTTP 接口。

### 0.2 V1 明确不做

- MCP Bridge、MCP Apps Host 协议、UI 调 Agent Tool。
- 远程市场、zip/git 安装、签名、权限申请、子进程沙箱。
- per-agent / per-project / per-channel App 实例。
- App 间调用。
- WebSocket / SSE；V1 使用 revision 轮询。
- TypeScript 现场编译、安装脚本或宿主代执行 npm install。
- 数据 schema 自动迁移。schema 不匹配时停用并报错，不冒险修改用户数据。
- App 代码热更新。新增或替换 App 代码后需重启 Molibot Server；数据不受影响。

---

## 1. 已核实的代码接入点

| 领域 | 代码锚点 | 实施含义 |
| --- | --- | --- |
| Owner Workspace | **src/lib/server/app/env.ts**；**src/lib/server/infra/db/storage.ts** | 现有 dataDir 已是唯一全局根。Mini App 只增加派生路径。 |
| Plugin catalog | **src/lib/server/plugins/types.ts**、**discovery.ts**、**loader.ts** | Mini App 投影到共享 catalog；加载和运行细节留在 MiniAppHost。 |
| Plugin Settings | **src/routes/api/desktop/plugins/+server.ts**、**src/lib/server/app/desktopPlugins.ts**、**apps/desktop/src/lib/settings/PluginsSection.svelte** | Mini App 在 Plugins 页面展示，但启停/卸载走独立细粒度路由。 |
| Agent Tool | **src/lib/server/agent/tools/index.ts**、**toolRuntime.ts**、**toolClassification.ts** | Mini App Tool 通过 Adapter 进入现有 ToolRuntime 和审批链。 |
| Deferred Tool | **src/lib/server/agent/tools/toolSearch.ts**、**src/lib/server/agent/prompts/prompt.ts** | 动态 Mini App Tool 进入 toolSearch，不把所有 schema 放入静态提示词。 |
| Desktop HTTP | **apps/desktop/src/lib/api.ts** | 顶层 Desktop 使用 Tauri plugin-http；iframe 不能获得该能力。 |
| 动态端口 | **apps/desktop/src-tauri/src/supervisor.rs** 的 preferred_port / choose_port | Server 端口运行时才确定，不能写死进构建期 CSP。 |
| Desktop CSP | **apps/desktop/src-tauri/tauri.conf.json** | 当前没有 frame-src；不得粗暴开放整个 localhost。 |
| 右侧面板 | **apps/desktop/src/ChatView.svelte**、**apps/desktop/src/styles.css** | 已有 File Panel。新增第二种面板时应建立真正的 Inspector seam。 |

行号漂移时以符号名为准。若这些结构发生根本变化，先更新本方案再实施。

---

## 2. 总体架构

~~~text
Agent / Channel / Desktop Chat
        |
        | toolSearch -> miniapp__todo__add/list/complete/delete
        v
+--------------------------------------------------------+
| MiniAppHost                                            |
| discovery | validation | catalog | lifecycle | revision|
|                                                        |
| invokeTool(toolId, input)    handleHttp(appId, request)|
|               \                 /                     |
|                one App Runtime instance                |
|        Tool Handlers + HTTP Handler + Domain            |
+-----------------------+--------------------------------+
                        |
                        v
             ~/.molibot/miniapps/data/todo

Desktop Mini App Inspector
        |
        | sandboxed iframe: molibot-miniapp://todo/
        v
Tauri custom-protocol transport adapter
        |
        v
http://127.0.0.1:<runtime-port>/miniapps/todo/*
~~~

### 2.1 MiniAppHost 是深模块

调用方只需要知道 catalog、Tool 描述、Tool 执行、HTTP 请求和生命周期操作。扫描、manifest 校验、路径安全、ESM 加载、单例缓存、revision、并发和卸载顺序都留在实现内部。

删除这个模块时，复杂度会重新散落到 Agent Tool、SvelteKit Route、Settings 和 Desktop，因此它不是转发层。

---

## 3. 目录与存储契约

### 3.1 storagePaths

**src/lib/server/infra/db/storage.ts** 增加：

~~~ts
miniAppsDir: path.resolve(config.dataDir, "miniapps"),
miniAppCodeDir: path.resolve(config.dataDir, "miniapps", "apps"),
miniAppDataDir: path.resolve(config.dataDir, "miniapps", "data")
~~~

**initDb()** 创建这三个目录。其他模块不得重复拼接 Mini App 根路径。

### 3.2 App 安装包

~~~text
~/.molibot/miniapps/apps/todo/
├─ manifest.json
├─ server/
│  └─ index.mjs
└─ ui/
   ├─ index.html
   ├─ app.js
   └─ styles.css
~~~

V1 规则：

- **runtime.entry** 必须是 App 目录内的 .mjs 文件。
- 宿主不编译 .ts/.tsx，不执行 App install/build 脚本。
- App 作者提交可直接运行的 ESM。第三方依赖需自行 bundle 到 App 代码中。
- **ui.entry** 必须位于 App 的 **ui/** 内，所有子资源也必须位于 **ui/** 内。
- 扫描器使用 lstat + realpath；App 目录、entry 和静态资源均不得通过 symlink 跳出对应根目录。
- App 目录名必须等于 manifest id。

### 3.3 App 数据

~~~text
~/.molibot/miniapps/data/todo/
├─ _host.json
└─ todo.sqlite
~~~

- **_host.json** 由宿主管理，V1 记录 schemaVersion。
- App 可在自己的 data 目录使用 SQLite 或 JSON。
- 首次成功创建 Runtime 后，宿主原子写入 _host.json。
- 已记录 schemaVersion 与新 manifest 不一致时，App 进入 error；宿主不自动迁移。
- 普通代码升级保持 schemaVersion 不变，因此可以替换 **apps/<id>** 而不触碰数据。

---

## 4. Manifest V1

### 4.1 示例

~~~json
{
  "manifestVersion": 1,
  "id": "todo",
  "name": "Todo",
  "version": "1.0.0",
  "description": "Manage one shared todo list from chat and Desktop.",
  "engines": {
    "molibot": ">=2.8.0 <3"
  },
  "runtime": {
    "entry": "server/index.mjs"
  },
  "ui": {
    "entry": "ui/index.html"
  },
  "data": {
    "schemaVersion": 1
  },
  "tools": [
    {
      "name": "add",
      "title": "Add Todo",
      "description": "Add one item to the owner's shared todo list.",
      "keywords": ["todo", "task", "待办", "任务"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "minLength": 1, "maxLength": 300 }
        },
        "required": ["title"],
        "additionalProperties": false
      },
      "readOnlyHint": false,
      "destructiveHint": false
    }
  ]
}
~~~

### 4.2 校验

- manifestVersion V1 只接受 1。
- id：**^[a-z][a-z0-9-]{1,62}$**。
- Tool name：**^[a-z][a-z0-9_-]{0,63}$**，App 内唯一。
- App version 为合法 SemVer；engines.molibot 必须包含当前版本。使用正式 SemVer 库，不自造解析器。
- entry 是无父级跳转、无空字节的相对路径，并通过 realpath containment。
- inputSchema 必须为 object JSON Schema；发现时预编译，调用前验证。使用 Ajv 作为唯一 JSON Schema Adapter。
- readOnlyHint 与 destructiveHint 不可同时为 true。
- 未识别顶层字段 V1 拒绝，避免拼写错误被静默忽略。

### 4.3 Tool 风险

| Manifest hints | Runtime risk | 结果 |
| --- | --- | --- |
| readOnly=true、destructive=false | low | 读操作，仍经过 policy pipeline |
| destructive=true | high | 经过现有 approval pipeline |
| 其他或缺失 | medium | source 明确为 plugin，不落入 builtin/low 兜底 |

~~~text
内部 Tool id      miniapp__todo__add
展示名            todo.add
Tool source       plugin
~~~

Manifest 不直接声明 risk 数值；风险只能由语义 hints 推导。

---

## 5. App Runtime 契约

### 5.1 runtime.entry

~~~ts
export interface MiniAppServerModule {
  default: (
    context: MiniAppRuntimeContext
  ) => MiniAppRuntime | Promise<MiniAppRuntime>;
}

export interface MiniAppRuntimeContext {
  appId: string;
  dataDir: string;
  logger: {
    info(event: string, detail?: Record<string, unknown>): void;
    warn(event: string, detail?: Record<string, unknown>): void;
    error(event: string, detail?: Record<string, unknown>): void;
  };
}

export interface MiniAppRuntime {
  tools: Record<string, MiniAppToolHandler>;
  handleHttp(request: MiniAppHttpRequest): Promise<MiniAppHttpResult>;
  dispose?(): void | Promise<void>;
}
~~~

宿主对每个 App 只调用一次 default export。之后 Tool 和 HTTP 都进入这个实例。Runtime 创建后，宿主验证 handler 名称与 manifest Tool 精确对应；缺失或多出 handler 都是加载错误。

### 5.2 Tool Handler

~~~ts
export type MiniAppToolHandler = (
  input: unknown,
  context: {
    toolCallId: string;
    signal?: AbortSignal;
  }
) => Promise<MiniAppToolResult>;

export interface MiniAppToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  changed?: boolean;
}
~~~

- changed=true 表示成功修改数据；宿主在成功返回后递增该 App 的内存 revision。
- AbortSignal 从现有 Tool 调用向下传递。
- Handler 错误转为稳定的结构化 Tool 错误；stack 只写服务日志。

### 5.3 HTTP Handler

V1 只提供 JSON 领域请求，不暴露原始 SvelteKit RequestEvent：

~~~ts
export interface MiniAppHttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query: Record<string, string[]>;
  body: unknown;
  signal?: AbortSignal;
}

export interface MiniAppHttpResult {
  status?: number;
  body?: unknown;
  changed?: boolean;
}
~~~

宿主统一负责：

- 只接收 JSON body，上限 1 MiB。
- 规范化 method/path，拒绝空字节、双重编码、父级跳转和超长 URL。
- 不允许 App 设置 Cookie、CSP、CORS 或任意响应头。
- 统一生成 JSON Response 和 **Cache-Control: no-store**。
- changed=true 时递增 revision。
- 保留 **/_host/state**，直接返回 appId、enabled、revision，不交给 App Handler。

App 服务端是可信代码，宿主不能从技术上阻止它自行读取主机文件；宿主承诺的是不向 UI 暴露 dataDir、绝对路径或凭据。官方 App 的响应只使用不透明 ID。

---

## 6. MiniAppHost 模块

### 6.1 外部接口

~~~ts
export interface MiniAppHost {
  listCatalog(): MiniAppCatalogEntry[];
  listTools(): MiniAppToolDescriptor[];
  invokeTool(
    toolId: string,
    input: unknown,
    context: MiniAppToolCallContext
  ): Promise<MiniAppToolResult>;
  handleHttp(appId: string, request: Request): Promise<Response>;
  setEnabled(appId: string, enabled: boolean): MiniAppCatalogEntry;
  uninstall(
    appId: string,
    options: { deleteData: boolean }
  ): Promise<void>;
}
~~~

这是 catalog、Agent Tool Adapter、SvelteKit Route 和 Settings 唯一允许跨越的 seam。loadModule、resolvePath、revision 和 runtime cache 都是内部实现。

**listTools()** 只返回 enabled、manifest 合法且尚未处于 error/uninstalling 的 Tool；invokeTool 仍需再次检查运行时状态，不能把列表过滤当成安全控制。

### 6.2 构造依赖

~~~ts
createMiniAppHost({
  codeRoot: storagePaths.miniAppCodeDir,
  dataRoot: storagePaths.miniAppDataDir,
  molibotVersion,
  getSettings,
  updateSettings,
  logger,
  importModule
});
~~~

测试直接使用临时文件系统，不新造一套公开 Filesystem Adapter。importModule 只是内部测试 seam。

### 6.3 内部状态与加载

每个 App 保存 descriptor、runtime/loading Promise、revision、inFlight、state 和 error。

- discovery 不立即 import 全部 App；首次 Tool/HTTP 调用时懒加载。
- 同一 App 的并发首次调用共享一个 loading Promise。
- manifest 合法且 enabled 的 App 可显示 active；懒加载失败后立即转 error。
- 每次调用入口先重读 enablement，再递增 inFlight；finally 中递减。
- disable 不主动中断已开始的调用，但阻止全部后续调用。

### 6.4 卸载顺序

1. 校验 app id，并用 realpath containment 精确锁定代码/数据目录。
2. 状态转为 uninstalling，立即阻止新 Tool/HTTP 调用。
3. 最长等待 5 秒让 inFlight 清零；超时返回 409，不删文件。
4. 调用 runtime.dispose；失败则停止卸载。
5. 删除 **apps/<app-id>**。
6. deleteData=true 时删除 **data/<app-id>**；Desktop 必须明确提示不可恢复。
7. 外部 App 删除 enablement 记录；内置 App 改写为 removedBuiltin tombstone。随后刷新 catalog。

---

## 7. Settings 与 Plugin Catalog

### 7.1 Settings

~~~ts
export interface MiniAppPluginSettings {
  entries: Record<string, { enabled: boolean; removedBuiltin?: boolean }>;
}
~~~

- 新发现且无记录的 App 默认 enabled。
- **removedBuiltin** 是内置 App 的卸载 tombstone，防止 Todo 在下次启动自动重装。
- sanitizer 接受合法 App id，但不因当前目录不存在而静默丢弃已支持的设置。
- 必须有 save -> new SettingsStore -> load 的临时数据库整对象 round-trip。

### 7.2 Catalog

- InstalledPluginKind、DesktopPluginKind 和 PluginCatalog 增加 miniapp。
- generic catalog 只保存身份、版本、描述、source、status、enabled、error。
- manifest path、entry path、data path 和 Runtime 实例不进入 Desktop contract。
- invalid JSON、manifest 缺失、id 不匹配、entry 越界、版本不兼容均生成 error 条目。
- **data/** 中孤立目录不生成 catalog 条目。
- Mini App catalog 在读取时从 MiniAppHost 投影，不复制成另一份长期快照；懒加载错误和即时启停必须在下一次 GET 立即可见。
- MiniAppHost 的创建、Todo bootstrap 与 discovery 位于 runtime 基础初始化中，不放进 liveServicesDisabled 分支。测试可以得到完整 Host，但不会启动 Channel、scheduler 或其他长连接。

### 7.3 细粒度 Desktop 路由

~~~text
GET    /api/desktop/miniapps
PATCH  /api/desktop/miniapps     { appId, enabled }
DELETE /api/desktop/miniapps     { appId, deleteData }
~~~

PATCH 只更新一个动态 key，不复用当前提交整个 Plugins Editor 的 PUT。DELETE 不接受任意路径。

---

## 8. Agent Tool 接入

### 8.1 Tool Adapter

新增 **src/lib/server/miniapps/toolAdapter.ts**：

- name = miniapp__<appId>__<toolName>
- label = <appId>.<toolName>
- description/inputSchema 来自已校验 manifest
- execute 只调用 host.invokeTool
- Adapter 不读文件、不打开 SQLite、不自行判断 enablement

### 8.2 Deferred Tool

Mini App Tool 加入现有 DeferredToolEntry。搜索文本包含 App id/name/description、Tool title/description/keywords。

不把动态 App 列表和 schema 放入系统提示词稳定前缀。只增加一条稳定规则：当请求可能由已安装 Mini App 处理时，用领域关键词调用 toolSearch。**toolSearch("todo")** 返回并加载完整 Tool schema。

### 8.3 ToolRuntime

- getRuntimeToolClassification 增加 Mini App 分支，风险来自 descriptor 映射，source 固定 plugin。
- 不根据 Tool id 字符串猜测 read-only/destructive。
- Mini App Tool 经过现有 wrapWithToolRuntime、tool whitelist、policy、approval 和 trace。
- 即使 Tool 已出现在当前 run 的列表，host.invokeTool 也必须在执行前再次检查 enabled。
- Tool details 只记录 appId、toolName、revision，不记录绝对 data path。

---

## 9. UI 托管、Origin 与 CSP

### 9.1 固定 Origin 方案

Desktop Server 端口运行时才确定，而 Tauri CSP 构建时已固定。因此不直接把 loopback URL 放进 iframe，也不把 frame-src 放宽到所有 localhost 端口。

采用固定 custom protocol：

~~~text
iframe:
molibot-miniapp://todo/index.html

Tauri 内部转发:
http://127.0.0.1:<current-endpoint>/miniapps/todo/index.html
~~~

这只是 HTTP 传输 Adapter，不是 MCP Bridge，也不是 UI 调 Tool。App 仍用标准相对 URL直接调用自己的 HTTP Handler。

这是对 PRD 中“frame-src 精确到动态本地端口”实现文字的技术细化：安全目标仍然是不开放整个 localhost，但通过固定、隔离的 custom Origin 达成。只有 Slice 0 Spike 通过后，才把 PRD 中对应的结构测试口径同步改为 custom Origin；Spike 失败则重新评审，不能先改验收来迁就实现。

### 9.2 Slice 0 必做 Spike

正式业务实现前，在真实 WKWebView 验证：

1. Tauri 2 custom protocol 可响应 iframe 主文档、JS/CSS 子资源和 GET/POST fetch。
2. Mini App Origin 与 Desktop 顶层隔离，不同 app host 之间也隔离。
3. sandbox 设为 **allow-scripts allow-forms allow-same-origin** 后，App 不能访问 parent DOM 或 Tauri IPC。
4. CSP 可精确使用 **frame-src molibot-miniapp:**，无需开放 loopback 范围。
5. 响应保留 status、content-type 和 request body。

Spike 必须在开发模式和打包 App 各跑一次。失败时停止并更新 PRD/方案，不得未经评审回退为全 loopback CSP。

### 9.3 Tauri Transport Adapter

新增 **apps/desktop/src-tauri/src/miniapp_protocol.rs**：

- 只接受 molibot-miniapp scheme。
- host 必须通过 app id 正则；path 必须规范化。
- upstream 只能来自现有 Supervisor state，不能由 iframe 指定。
- upstream path 只能是 /miniapps/<app-id>/...
- 覆盖写入 **X-Molibot-Miniapp-Proxy: v1**；Server Mini App 路由要求该 header。
- 不转发 cookie、authorization、Tauri IPC 或 hop-by-hop headers。
- 请求上限 1 MiB、响应上限 10 MiB、超时 30 秒、不跟随跨 Origin 重定向。
- 只回传 content-type、cache-control、CSP 等必要响应头。

外部网页若想伪造 custom header，浏览器必须先完成 CORS preflight；Mini App Server 路由不返回 CORS 许可。该设计防浏览器页面直接调用 loopback，不承诺隔离本机其他进程。

### 9.4 Server 路由

~~~text
GET  /miniapps/<app-id>/                  -> ui.entry
GET  /miniapps/<app-id>/<asset-path>      -> ui/ 静态资源
*    /miniapps/<app-id>/api/<api-path>    -> MiniAppHost.handleHttp
GET  /miniapps/<app-id>/api/_host/state   -> revision/enabled
~~~

- 依次验证 proxy header、app id、enabled。
- 静态资源拒绝目录列表、点文件、symlink、双重编码和未知 MIME。
- HTML 默认 CSP 仅允许 self 资源与 self API，并禁止 object、外部 form action 和 base URL 改写；frame-ancestors 只列出打包 Tauri Origin 与固定 Desktop dev Origin。精确字符串以 Slice 0 在 WKWebView 中验证通过的结果为准。
- disabled 返回 403；未知 App 404；runtime error 503；路径越界 400。
- 响应不包含绝对路径、stack 或 entry source。

---

## 10. Desktop 产品面

### 10.1 先落 DESIGN 规则

Mini App 是第二种 Chat 右侧 Inspector。实现 UI 前，先在 **DESIGN.md** 的 Application templates 增加以下长期规则：

- Chat 同时只打开一个右侧 Inspector。
- File Inspector 与 Mini App Inspector 共用宽度、resize、最小宽度和窄屏规则，不产生第四列。
- Mini Apps 是 Conversation / Project 之后的同级 sidebar section，不新增 primary destination，也不把日常入口藏在 Settings。
- 窄屏沿用现有 in-flow Inspector 规则，不使用 fixed overlay 覆盖 Chat 或 Composer。

规范与 Inspector seam 的代码改造必须在同一 Slice 完成，不为 Mini App 堆一套临时 panel gating。

### 10.2 Inspector seam

**ChatView.svelte** 将 filePanelOpen 升级为显式响应式状态：

~~~ts
type ChatInspector =
  | { kind: "files" }
  | { kind: "miniapp"; appId: string }
  | null;
~~~

这个 seam 有两个真实 Adapter：现有 File Inspector 和 Mini App Inspector。宽度预算、拖动、窄屏切换和关闭逻辑只保留一份。

### 10.3 Mini App 列表与面板

- Sidebar 只显示 enabled + active 的 App；错误和禁用 App 在 Settings 处理。
- 点击 App 打开右侧 Inspector；重复点击当前 App 不重复创建 iframe。
- **MiniAppPanel.svelte** 只负责 panel chrome、loading/error/disabled 和 iframe，不了解 Todo 业务。
- iframe sandbox 固定为 **allow-scripts allow-forms allow-same-origin**；不增加 popup、modal、top-navigation、clipboard 或 downloads。
- iframe URL 携带非敏感展示 hint：locale 与 theme。切换语言/主题时重新加载 iframe，V1 不为此引入 postMessage Bridge。
- App UI 自带中英文字符串和 Light/Dark token；Todo 是参考实现。
- 面板头显示 App name 和关闭按钮；技术 id/version 是次要信息。

### 10.4 Settings 交互

- Plugins Settings 新增 Mini Apps 分组，展示 name、version、description、status 和 error。
- enabled 使用现有 IosSwitch，立即调用细粒度 PATCH，不与页面其他待保存字段混合。
- enabled App 提供“打开 App”。
- 卸载放入 overflow menu，选择“保留数据”或“删除 App 及数据”。后者使用 destructive 确认并明确不可恢复。
- 新 Svelte 文件使用共享语义 CSS 与现有 shadcn-svelte/共享控件，不添加页面内 style。

---

## 11. Todo 参考 App

### 11.1 交付方式

Todo 模板编译进 Server bundle，首次启动由 **ensureBuiltinMiniApps()** 写入 **~/.molibot/miniapps/apps/todo/**：

- 只在目录不存在且 settings 没有 removedBuiltin tombstone 时写入，绝不覆盖 Owner 修改。
- 模板文件使用构建期 raw import 嵌入 Server，开发模式与打包 Runtime 都不依赖开发机源码绝对路径。
- Owner 卸载内置 Todo 后写 removedBuiltin=true，下次启动不自动反悔。
- 后续如要恢复，Settings 提供“恢复内置 App”可作为第二阶段；V1 可通过删除 tombstone 后重启完成，不额外实现市场式安装。

### 11.2 SQLite

~~~sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
~~~

- id 使用 UUID，Tool/UI 只传不透明 id。
- SQLite 启用 WAL 和 busy_timeout，每个 mutation 使用事务。
- delete 为硬删除，manifest destructiveHint=true。
- complete 为状态修改，destructiveHint=false，默认 medium。

### 11.3 Tool 与 HTTP

| 能力 | Agent Tool | HTTP |
| --- | --- | --- |
| 新增 | todo.add | POST /api/todos |
| 列表 | todo.list | GET /api/todos?status=all/open/completed |
| 完成 | todo.complete | PATCH /api/todos/<id> |
| 删除 | todo.delete | DELETE /api/todos/<id> |
| revision | Tool result details | GET /api/_host/state |

Tool Handler 与 HTTP Handler 调用同一组 **add/list/complete/remove** 领域函数，不各自写 SQL。

### 11.4 UI

- 单列待办页：输入框 + Add、Open/Completed 分组、完成和删除操作。
- 每 2 秒轮询 **/_host/state**；revision 改变才重新请求列表。首次加载始终读一次列表。
- 面板不可见时暂停轮询；重新可见时立即检查。
- 403 显示“App 已禁用，可在 Settings 重新开启”；503 显示加载错误，不无限重试。
- 中英文和 Light/Dark 由 iframe URL hint 初始化；状态不只依赖颜色。

---

## 12. 实施 Slices

### Slice 0：WebView Transport Spike

**目标**：先消除 custom protocol、sandbox 与 CSP 的最大不确定性。

**文件**：

- Create: **apps/desktop/src-tauri/src/miniapp_protocol.rs**
- Modify: **apps/desktop/src-tauri/src/lib.rs**
- Modify: **apps/desktop/src-tauri/Cargo.toml**
- Modify: **apps/desktop/src-tauri/tauri.conf.json**
- Temporary: 只供 Spike 使用的静态 fixture，Slice 3 用真实 Server route 替换

**验收**：完成第 9.2 节五条真实 WKWebView 检查；cargo test、Desktop dev 和打包 App 都通过。

### Slice 1：Host 发现、Manifest 与 Settings

**目标**：不接 Agent/UI，先建立可独立验证的 Host 核心。

**Create**：

- **src/lib/server/miniapps/types.ts**
- **src/lib/server/miniapps/paths.ts**
- **src/lib/server/miniapps/manifest.ts**
- **src/lib/server/miniapps/host.ts**
- **src/lib/server/miniapps/host.test.ts**

**Modify**：

- **src/lib/server/infra/db/storage.ts**
- **src/lib/server/settings/schema.ts**
- **src/lib/server/settings/defaults.ts**
- **src/lib/server/settings/sanitize.ts**
- **src/lib/server/settings/store.ts**
- **src/lib/server/settings/sanitize.test.ts**
- **src/lib/server/settings/store.test.ts**
- **src/lib/server/plugins/types.ts**
- **src/lib/server/plugins/discovery.ts**
- **src/lib/server/plugins/loader.ts**
- **src/lib/server/app/runtime.ts**
- **package.json / lockfile**，添加 Ajv 与 SemVer 生产依赖

Slice 1 的初始化顺序为：initDb -> load settings -> create/discover MiniAppHost -> project Mini App catalog -> 启动其他可选 live subsystems。Slice 5 加入内置 Todo 后，在 load settings 与 discovery 之间插入 ensureBuiltinMiniApps。

**验收**：

- 临时 dataDir 下路径精确为 **<temp>/miniapps/apps|data**。
- 合法 App 入 catalog；非法 JSON、id/目录不匹配、entry 缺失/越界/symlink、engine 不兼容均为 error。
- 只有 data/ghost 时 catalog 为空。
- 细粒度启停与 fresh-store round-trip 通过。
- 测试不读写真实 **~/.molibot**。

### Slice 2：Runtime 加载与 Agent Tool

**目标**：完成“任意 Channel 的 Agent Tool 写入 Owner 全局 App 数据”。

**Create**：

- **src/lib/server/miniapps/toolAdapter.ts**
- **src/lib/server/miniapps/toolAdapter.test.ts**
- 临时目录 Mini App runtime fixtures

**Modify**：

- **src/lib/server/miniapps/host.ts**
- **src/lib/server/agent/tools/index.ts**
- **src/lib/server/agent/tools/toolClassification.ts**
- **src/lib/server/agent/tools/toolClassification.test.ts**
- **src/lib/server/agent/tools/toolSearch.ts**
- **src/lib/server/agent/tools/toolSearch.test.ts**
- **src/lib/server/agent/prompts/prompt.ts**
- **src/lib/server/agent/prompts/prompt.test.ts**

**验收**：

- toolSearch("todo") 返回完整 Mini App Tool schema。
- Tool id 无冲突，label 为可读名。
- 输入不符合 JSON Schema 时 handler 不执行。
- risk/source 与 manifest hints 一致，destructive 进入现有审批链。
- Tool 创建后再禁用 App，真正 invoke 时仍被拒绝。
- 不同 Channel 调用始终使用同一个 storagePaths.miniAppDataDir。
- 并发首次调用只创建一个 Runtime。

### Slice 3：Server 静态资源与 HTTP Handler

**目标**：完成 App UI 直调 App HTTP Handler 的 Server 通路。

**Create**：

- **src/routes/miniapps/[appId]/+server.ts**
- **src/routes/miniapps/[appId]/[...path]/+server.ts**
- 对应 server tests

**Modify**：

- **src/lib/server/miniapps/host.ts**
- Desktop custom-protocol Adapter，用真实 Server route 替换 Spike fixture

**验收**：

- HTML/JS/CSS 与 JSON GET/POST/PATCH/DELETE 通过。
- 父级跳转、绝对路径、双重编码、symlink、跨 App、超大 body 全部拒绝。
- 无 proxy header 的 loopback App API 被拒绝，且没有宽松 CORS。
- disabled 返回 403。
- Tool 写入 -> HTTP 读到；HTTP 写入 -> Tool 读到。
- 响应不包含临时目录绝对路径或 stack。

### Slice 4：Desktop Catalog、Inspector 与卸载

**目标**：使 Mini App 成为可发现、可打开、可管理的 Desktop 产品面。

**Create**：

- **src/routes/api/desktop/miniapps/+server.ts**
- **src/lib/server/app/desktopMiniApps.ts**
- **apps/desktop/src/lib/stores/miniapps.svelte.ts**
- **apps/desktop/src/lib/miniapps/MiniAppsSidebarSection.svelte**
- **apps/desktop/src/lib/miniapps/MiniAppPanel.svelte**
- **apps/desktop/src/lib/settings/MiniAppsSettingsGroup.svelte**

**Modify**：

- **DESIGN.md**，先落 Inspector 规范
- **src/lib/shared/desktop.ts**
- **apps/desktop/src/lib/api.ts** 与 **api.test.ts**
- **apps/desktop/src/ChatView.svelte**
- **apps/desktop/src/lib/settings/PluginsSection.svelte**
- **apps/desktop/src/lib/i18n.ts**
- **apps/desktop/src/styles.css**
- **apps/desktop/src/chat-ui.test.mjs**

**验收**：

- Sidebar 可打开 enabled App；Settings 可查看 error、启停、打开和卸载。
- 同时只有一个 Inspector，File/Mini App 切换不产生第四列。
- iframe sandbox 精确，CSP 只放行 molibot-miniapp scheme。
- 宽屏、Project Chat、普通 Chat、窄屏均不压碎 Composer 或变成 fixed overlay。
- 中英即时切换、Light/Dark/System、键盘 focus 与 reduced motion 通过。
- 卸载保留数据后重装可恢复；删除数据时明确不可恢复。

### Slice 5：Todo 与开发者契约

**目标**：用真实 App 证明平台闭环。

**Create**：

- **src/lib/server/miniapps/builtin/todo/manifest.json**
- **src/lib/server/miniapps/builtin/todo/server/index.mjs**
- **src/lib/server/miniapps/builtin/todo/ui/index.html**
- **src/lib/server/miniapps/builtin/todo/ui/app.js**
- **src/lib/server/miniapps/builtin/todo/ui/styles.css**
- **src/lib/server/miniapps/bootstrap.ts**
- **src/lib/server/miniapps/bootstrap.test.ts**
- **docs/guides/miniapps/authoring.md**

**Modify**：

- Runtime startup，在 discovery 前 bootstrap

**验收**：

- 空 Owner Workspace 启动后出现 Todo；已存在时绝不覆盖。
- Agent 与 UI 均支持 add/list/complete/delete。
- Agent 新增后 UI 在一个轮询周期内刷新；UI 操作后 Agent 下一次 list 立即可见。
- 20 个并发 add 不丢数据，revision 单调递增。
- 替换 Todo 代码并重启后 SQLite 数据完整。
- authoring 文档能指导第二个 JSON/SQLite Mini App，无需修改 Molibot 主应用。

### Slice 6：收尾与交付

- 删除 Spike fixture 和所有临时旁路。
- 更新 **docs/designs/plugins/plugin-manifest.md**，链接 Mini App authoring guide。
- 按项目规则更新 **features.md、prd.md、CHANGELOG.md、readme.md**。
- 完成下一节机器验证与冷启动 smoke walk。

---

## 13. 测试与验证

### 13.1 机器守卫

| 测试 seam | 必须证明的外部行为 |
| --- | --- |
| MiniAppHost interface | 发现、error catalog、懒加载单例、enablement、schema gate、in-flight 卸载 |
| Tool interface | 动态搜索、schema 验证、risk/source、approval、调用时禁用、持久化结果 |
| HTTP interface | 静态资源、JSON method/body、proxy header、路径逃逸、跨 App、状态码、信息泄漏 |
| Settings interface | PATCH 单 key、fresh-store round-trip、未知已支持字段保留、卸载数据选择 |
| Desktop interface | contract mapper、API、sidebar、单 Inspector、iframe sandbox、精确 CSP、响应式状态 |
| Todo 端到端 | Tool <-> 同一 SQLite <-> HTTP/UI、并发写、revision、升级保数据 |

### 13.2 命令

具体文件实现后按现有脚本执行，至少包括：

~~~bash
node --import ./scripts/register-loader.js --import tsx --test <miniapp-server-tests>
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/settings/store.test.ts
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/tools/toolClassification.test.ts
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/tools/toolSearch.test.ts
pnpm run tsc
pnpm --dir apps/desktop run test
pnpm run desktop:check
pnpm --dir apps/desktop run build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
~~~

若脚本名已变化，以当时 package scripts 为准；不得减少 Server typecheck、Desktop svelte-check/build/test 和 Rust test 四类验证。

### 13.3 冷启动 smoke walk

1. 使用临时 DATA_DIR 启动 Desktop，确认创建 Mini App 目录并 bootstrap Todo。
2. 首次启动后直接打开 Todo，确认 iframe 不空白、JS/CSS/API 成功。
3. Desktop Chat 说“帮我加一个待办：买牛奶”，确认 Agent 经 toolSearch 找到 Todo Tool 并写入。
4. Todo 面板在 2 秒内显示“买牛奶”。
5. UI 完成待办，再让 Agent list，状态立即可见。
6. 从 Telegram 或 Feishu 添加另一条，Desktop 可见。
7. 面板打开时在 Settings 禁用，下一次轮询显示 disabled；Agent Tool 也被拒绝。
8. 重新启用，数据恢复。
9. 切换 Session、Project Chat、普通 Chat，始终是同一个 Owner 全局 App。
10. 中断 Server 后面板显示可恢复错误；恢复后重新打开正常。
11. 分别走“卸载保留数据 -> 重新放入代码并重启 -> 数据恢复”和“卸载删除数据”。
12. 打包 App 重复 2 至 11，确认不依赖开发机源码路径。

---

## 14. 对抗式审查：最可能翻车的 5 个点

### 14.1 动态端口与静态 CSP

**风险**：开发环境可用，打包或端口冲突后 iframe 空白。

**守卫**：Slice 0 先验证 custom protocol；结构测试禁止 frame-src 出现整个 127.0.0.1 或 localhost 端口范围。

### 14.2 Tool 与 HTTP 加载两份 Runtime

**风险**：SQLite connection、revision 或 cache 分裂，UI 与 Agent 偶发不一致。

**守卫**：所有调用只经 MiniAppHost；并发首次调用测试断言 factory 只执行一次；Tool/HTTP round-trip 使用同一 data dir。

### 14.3 disable/uninstall 竞态

**风险**：代码目录或 SQLite 在 handler 使用时被删除，产生部分写入或崩溃。

**守卫**：Host 单点管理 state + inFlight；卸载先拒绝新调用，再等待清空；超时不删任何文件。

### 14.4 外部网页调用 loopback API

**风险**：攻击网页扫描本机端口并修改 App 数据。

**守卫**：App API 只接收 JSON + custom proxy header，无 CORS；Tauri Adapter 覆盖 header 且只转发到 Supervisor 的当前 endpoint。HTTP 测试覆盖无 header、假 Origin 和 simple content-type POST。

### 14.5 未定义 migration 破坏数据

**风险**：过早引入迁移框架，失败后留下半迁移数据。

**守卫**：V1 只允许同 schemaVersion 代码升级；不匹配就停用报错，宿主不修改数据。等出现两个真实迁移需求时再建立 migration seam。

---

## 15. 完成定义

Mini App Platform V1 只有在以下条件全部成立时才算交付：

1. App 代码和数据只位于 **~/.molibot/miniapps/apps|data**，不依赖任何 Channel Workspace。
2. Agent 通过 Mini App Tool 读写，UI 通过 App HTTP Handler 读写，两者使用同一 Runtime 和数据。
3. UI 路径中没有 MCP Bridge、Tool-call Bridge 或通用文件数据接口。
4. Todo 在 Desktop、Telegram/Feishu 和 Agent Tool 之间形成双向一致闭环。
5. disabled、uninstall、schema mismatch、路径逃逸、CSP、Origin 有机器守卫。
6. enablement 经过 fresh-store round-trip，重启不重置。
7. 开发模式、真实冷启动和打包 Desktop App 都通过 smoke walk。
8. Todo 是可运行作者示例；开发者无需修改 Molibot 主应用即可安装第二个 Mini App。
