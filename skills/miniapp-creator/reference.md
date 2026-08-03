# Mini App 契约速查

宿主强制执行的规则（不是建议）。违反的结果通常是设置里出现一条 error，而不是静默降级。

## 目录

```
~/.molibot/miniapps/
  apps/<app-id>/          # 代码：升级 = 整目录替换
    manifest.json
    server/index.mjs
    ui/index.html
    ui/app.js
    ui/styles.css
    ui/icon.svg
  data/<app-id>/          # 数据：安装、升级、卸载都可保留，生命周期独立
```

- 目录名必须等于 manifest `id`。
- `runtime.entry` 必须是 App 目录内的 `.mjs`。宿主不编译 TypeScript、不跑 `npm install`。
- `ui.entry` 引用的一切都要在 `ui/` 下。
- 指向 App 目录外的 symlink 一律拒绝。
- 安装 / 替换代码后必须重启服务（V1 无热更新）。

## manifest.json

```json
{
  "manifestVersion": 1,
  "id": "expenses",
  "name": "Expenses",
  "version": "1.0.0",
  "description": "Track spending from chat and from the desktop panel.",
  "engines": { "molibot": ">=2.8.0 <4" },
  "runtime": { "entry": "server/index.mjs" },
  "ui": { "entry": "ui/index.html", "icon": "ui/icon.svg" },
  "data": { "schemaVersion": 1 },
  "tools": [
    {
      "name": "add",
      "title": "Add Expense",
      "description": "Record one expense. Use when the user mentions spending money.",
      "keywords": ["expense", "spend", "记账", "花了"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "amount": { "type": "number", "exclusiveMinimum": 0 },
          "note": { "type": "string", "maxLength": 200 }
        },
        "required": ["amount"],
        "additionalProperties": false
      },
      "readOnlyHint": false,
      "destructiveHint": false
    }
  ]
}
```

| 字段 | 规则 |
| --- | --- |
| `manifestVersion` | 必须是 `1` |
| `id` | `^[a-z][a-z0-9-]{1,62}$`，等于目录名 |
| `version` | 合法 SemVer |
| `engines.molibot` | 合法 SemVer range，且当前 Molibot 必须满足 |
| `ui.icon` | 可选；`ui/` 下的 SVG 或 PNG，≤ 64 KB。声明了但读不到 = 错误，不是静默回退 |
| `data.schemaVersion` | 整数 ≥ 1 |
| `tools[].name` | `^[a-z][a-z0-9_-]{0,63}$`，App 内唯一 |
| `tools[].inputSchema` | object 型 JSON Schema，发现阶段用 Ajv 预编译；编译不过 = 整个 App 失败 |
| 未知顶层字段 | **拒绝**——拼错的键不能被静默忽略 |

### 工具命名与风险

内部注册名 `miniapp__<appId>__<toolName>`，展示名 `<appId>.<toolName>`，都由宿主生成，作者不需要也不应该自己写。

| 提示 | 风险 | 效果 |
| --- | --- | --- |
| `readOnlyHint: true` | low | 走既有工具策略管线 |
| `destructiveHint: true` | high | 每次调用需要 owner 审批 |
| 都不写 | medium | 走既有工具策略管线 |

两个 hint 不能同时为 true。风险只来自语义提示，永远不来自工具名。

### 可发现性

Mini App 工具是**延迟加载**的，默认不在模型提示词里。Agent 通过 `toolSearch` 用领域关键词命中，所以 `keywords` 决定了 App 是否可达。写用户真正说的词，覆盖所有他们会用的语言。

用户也可以在对话里用 `/miniapps` 查看已装应用，或用 `@<app-id> ...` 把当次请求定向到某个 App（只对该轮生效，且该轮只预载这个 App 的工具）。

## server/index.mjs 运行时契约

默认导出一个工厂函数，宿主**每个 App 只调用一次**，工具调用和 HTTP 请求都路由进同一个实例——这正是「一份数据库连接 + 一套业务规则服务两个入口」的实现方式。

```js
export default function create(context) {
  // context.appId   — App id
  // context.dataDir — 私有数据目录，已创建
  // context.logger  — info/warn/error 写入服务日志
  return {
    tools: { /* 与 manifest 严格一一对应 */ },
    async handleHttp(request) { /* UI 的 API */ },
    dispose() { /* 关闭文件、连接、数据库句柄 */ }
  };
}
```

### 工具 handler

```js
async function add(input, { toolCallId, signal }) {
  return {
    content: [{ type: "text", text: "Added: milk" }],
    structuredContent: { id: "…", title: "milk" },
    changed: true
  };
}
```

- `input` 已按 `inputSchema` 校验过，形状可信；但业务规则（金额必须为正、标题不能空白）仍要自己校验。
- 改了数据就返回 `changed: true`，它推进 UI 轮询的 revision 计数器。
- 抛普通 `Error` 表示失败：message 会去掉宿主路径后交给 Agent，堆栈只进服务日志。

### HTTP handler

```js
async handleHttp(request) {
  // request.method — "GET" | "POST" | "PATCH" | "DELETE"
  // request.path   — App 相对路径，如 "/todos/abc123"
  // request.query  — Record<string, string[]>
  // request.body   — 解析后的 JSON；GET 为 undefined
  // request.signal — AbortSignal
  return { status: 200, body: { … }, changed: true };
}
```

宿主负责响应封装，所以 header、cookie、CORS、CSP 既不需要也无法设置。宿主保留 `/_host/state`，返回 `{ appId, enabled, revision, schemaVersion }`，不会进入 App 代码。请求体上限由宿主强制，超限返回 413。

## UI 契约

宿主在 `/miniapps/<app-id>/` 托管 `ui/`，桌面端用自定义协议在 sandboxed iframe 中加载：

```
molibot-miniapp://todo/index.html?locale=zh-CN&theme=dark
```

- 拿不到父页面 DOM、Tauri IPC、其他 App 的 origin。
- 只能用相对 URL `./api/*` 访问自己的 API。
- CSP：仅同源脚本与样式，无 `<object>`、无外部 form action、无 `<base>` 重写；**内联 `<script>` 不执行**。
- 自带自己的文案与明暗色 token，无法继承 Molibot 的设计系统。
- iframe 跑在哪个 WebView 取决于系统（macOS=WKWebView、Linux=WebKitGTK、Windows=WebView2），焦点与定时器行为有差异；写 UI 时照 SKILL.md 的「UI 铁律」与「跨平台 WebView 差异」做防御，别只在自己的机器上验证。

### 保持数据新鲜

V1 无推送。轮询 `./api/_host/state`，revision 变了才重新拉数据；**启动时无论 revision 都要拉一次**（后开的面板没有基线可比）。

| 状态 | 含义 | UI 应当 |
| --- | --- | --- |
| 403 | App 被禁用 | 提示「去设置里重新开启」，停止轮询 |
| 503 | App 加载失败 | 提示「去设置查看错误」，停止轮询 |
| 网络错误 | 服务正在重启 | 可恢复提示，保留列表，继续轮询 |

## 信任模型

App 服务端代码是 owner 自装的**完全可信代码**，在 Molibot 进程内运行，V1 **没有服务端沙箱**。「App 只碰自己的 `data/`」是目录约定，只在 HTTP 路由边界强制（app-id 作用域、路径校验），不是对服务端代码的安全承诺。真正的强隔离面是 UI 的 sandboxed iframe。

由此产生两条作者义务：

1. HTTP 响应里绝不返回宿主绝对路径、凭据或 API key，只返回不透明 ID。
2. 来自渠道的一切输入都按不可信处理。

**所有来源一视同仁**：从 GitHub 或 ZIP 安装不会带来任何沙箱，那是在用你的权限运行别人的代码。安装器保证的只是更窄的事：压缩包写不出暂存目录（穿越条目、symlink、超大与 zip bomb 会被拒绝），manifest 必须先校验通过才会进入安装根，来源会被记录并在管理器里显示。签名、权限粒度、子进程沙箱尚未实现——在此之前只装自己写的或读过的 App。

## 数据与升级

数据在 `~/.molibot/miniapps/data/<app-id>/`，可用 `node:sqlite` 或 JSON。宿主会在该目录写一个自己的 `_host.json` 记录 `data.schemaVersion`。

- **普通升级**：`schemaVersion` 不变，替换 `apps/<id>`，重启。数据原样保留。
- **schema 变更**：bump `schemaVersion`。宿主**不会**替你迁移，它会停掉 App 并报错，而不是猜。发新代码前自己先迁完数据。

卸载时会询问是否删除 `data/<id>`；保留的话，重装代码即可恢复历史。
