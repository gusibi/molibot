# Mini App 开发规范与 API 契约 (Mini App Developer Guide & API Reference)

本文件定义了 Molibot Agent 为内置及第三方 Mini App 开放的各种系统能力、接口协议与运行约束。

---

## 一、 目录结构与生命周期

每个 Mini App 均由 **Agent 工具**、**宿主托管的 UI** 以及 **私有数据区** 组成，共用同一个领域命名空间。

```
~/.molibot/miniapps/
  apps/<app-id>/          # 代码区：升级时整目录替换
    manifest.json         # 属性与工具声明文件
    server/index.mjs      # 后端逻辑入口 (ESM 模块)
    ui/index.html         # UI 界面入口
    ui/app.js             # UI 逻辑
    ui/styles.css         # UI 样式
    ui/icon.svg           # 侧栏及管理器图标 (可选)
  data/<app-id>/          # 私有数据区：安装/升级/卸载时生命周期独立，可保留数据
```

* **目录名一致性**：`apps/` 下的子目录名必须与 `manifest.json` 中的 `id` 严格相等。
* **文件路径约束**：`runtime.entry` 必须是 App 内的相对路径 `.mjs` 模块；UI 入口引用的一切静态资源必须在 `ui/` 目录下。指向 App 外部的软链接 (symlink) 会被宿主拦截拒绝。
* **热更新**：V1 阶段无热更新，安装或替换代码后，必须重启 Molibot 服务方可生效。

---

## 二、 属性配置文件 (`manifest.json`)

小程序的属性配置文件声明了自身的基础元信息、需要的 AI 权限、原生捕获能力、在消息栏的快捷动作以及导出的 Agent 工具列表。

### 1. 配置示例
```json
{
  "manifestVersion": 1,
  "id": "expenses",
  "name": "Expenses",
  "version": "1.0.0",
  "description": "从对话或桌面面板记录并分析账单支出。",
  "engines": { "molibot": ">=2.8.0 <4" },
  "runtime": { "entry": "server/index.mjs" },
  "ui": { "entry": "ui/index.html", "icon": "ui/icon.svg" },
  "data": { "schemaVersion": 1 },
  "tools": [
    {
      "name": "add",
      "title": "Add Expense",
      "description": "记录一笔支出。当用户提到花了多少钱时调用。",
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
  ],
  "contributions": {
    "messageActions": [
      {
        "tool": "add",
        "label": { "zh": "记账", "en": "Add Expense" },
        "icon": "coins",
        "accepts": ["text"]
      }
    ]
  },
  "ai": {
    "capabilities": ["text", "transcription"],
    "uploadLimits": [
      { "path": "/api/upload", "maxBytes": 10485760 }
    ]
  },
  "host": {
    "capabilities": ["audioCapture"]
  }
}
```

### 2. 字段校验规则
* `manifestVersion`：必须为 `1`。
* `id`：符合正则 `^[a-z][a-z0-9-]{1,62}$`。
* `engines.molibot`：合法的 SemVer 版本区间。如果使用了 `contributions` 或 `ai`，版本区间必须声明为 `>=2.9.8`。
* `ui.icon`：可选；必须为 `ui/` 下的 SVG 或 PNG，大小不超过 64 KB。
* `data.schemaVersion`：必须为正整数。
* `tools[].name`：符合正则 `^[a-z][a-z0-9_-]{0,63}$`，在当前 App 内唯一。
* `tools[].inputSchema`：符合 JSON Schema 规范的对象。宿主启动时会使用 Ajv 预编译，编译失败会导致小程序整体加载出错。
* **未知字段**：任何未知的顶层字段都会导致 manifest 被宿主拒绝（避免拼写错误导致静默失效）。

### 3. 工具命名、风险与可发现性
* **自动映射**：工具的系统注册名会被映射为 `miniapp__<appId>__<toolName>`，Agent 对话中显示的友好名称为 `<appId>.<toolName>`。
* **风险控制**：
  * `readOnlyHint: true`（只读，低风险）。
  * `destructiveHint: true`（高风险破坏性操作，如删除数据）。**宿主在 Agent 自动执行此工具时会强制弹窗等待 Owner 审批**。
  * 都不写（中风险，走既有策略管线）。两者不可同时为 `true`。
* **延迟加载**：小程序工具默认不注入模型的系统提示词。Agent 通过 `toolSearch` 使用 `keywords` 命中对应的工具。因此 `keywords` 应覆盖所有可能的中英文触发动词。
* **文件入参（`fileParams`，Requires `engines.molibot >= 2.9.26`）**：需要 Agent 传「文件」而不是「文件内容」的工具，在工具上声明 `fileParams`，Agent 侧的入参就是一条路径（和 `read` 等 Agent 文件工具同一套路径语义与 allowed-roots）。宿主在校验后、handler 执行前把文件拷贝进本 App 的 `dataDir/incoming/`，并把参数**原位改写**为 dataDir 相对路径（如 `incoming/3f2a….md`）；原文件名等元数据在 `context.stagedFiles[参数名]` 里：
  ```json
  "fileParams": [
    { "param": "docPath", "accepts": ["file"], "maxBytes": 5242880 },
    { "param": "imagePaths", "accepts": ["image"], "multiple": true }
  ]
  ```
  * `param` 必须在 `inputSchema.properties` 声明：`multiple: true` 为 string 数组，否则为 string。
  * `accepts` 只能取 `["file"]`、`["image"]` 或两者；`maxBytes` 1..64 MiB（缺省 25 MiB）；每个工具至多 4 个文件参数，每次调用至多 20 个文件。
  * handler 里用 `path.join(context.dataDir, input.docPath)` 读取即可。**不要**把收到的值当宿主路径或回显给用户；staging 目录有容量淘汰，重要数据要落自己的 SQLite。
  * Agent 没传该参数（可选参数）时不做 staging；消息动作（`capture`）路径不支持文件参数，若带值调用会明确报错而不是把宿主路径传进 handler。

---

## 三、 后端运行时契约 (`server/index.mjs`)

小程序后端必须默认导出一个工厂函数，宿主仅在加载时调用一次，以返回一个单例的运行时实例。工具调用和 HTTP 网关请求将路由进入同一实例，保证它们共享同一套业务数据和连接状态。

```js
export default function create(context) {
  // context 见下文「后端 Context API」
  return {
    tools: {
      async add(input, { toolCallId, signal }) {
        // 1. 业务逻辑与 SQLite 操作
        // 2. 返回工具执行结果
        return {
          content: [{ type: "text", text: "已记录一笔消费" }],
          structuredContent: { ok: true },
          changed: true // 如果修改了数据，必须返回 true 以推动 UI 面板刷新
        };
      }
    },
    async handleHttp(request) {
      // 处理来自 UI 的 API 请求，例如 request.path === "/list"
      return { status: 200, body: { items: [] }, changed: false };
    },
    dispose() {
      // 宿主停用或重载时触发，用于关闭数据库句柄及清理定时器
    }
  };
}
```

### 1. 工具 Handler
* `input` 已经被宿主在入口按 `inputSchema` 校验过，格式可信。声明了 `fileParams` 的参数在这里已是 **dataDir 相对路径**（宿主已完成 staging，见前文）。
* `context.stagedFiles`：当本次调用发生了文件 staging 时存在，按参数名分组提供 `{ path, name, kind, mime, bytes }`（`name` 是原文件名）。
* 变更标记：执行了写操作时必须显式返回 `changed: true`。这会使宿主自增该小程序的全局状态 Revision 版本号，用以驱动 UI 自动同步。
* 返回结构化卡片 (`card`)：
  ```js
  return {
    content: [{ type: "text", text: "已收藏：架构设计说明" }],
    changed: true,
    card: {
      title: "已存入笔记",
      subtitle: "来自今日会话",
      fields: [{ label: "分类", value: "开发规范" }], // 最多展示 6 条
      icon: "note",                                  // Phosphor 图标名，省略 ph- 前缀
      link: `molibot://miniapp/<appId>/notes/12`      // 必须指向自己的深层链接
    }
  };
  ```

### 2. 后端 Context API 列表
`create(context)` 工厂函数获得的 `context` 包含以下方法和属性：

#### A. 核心 AI 能力 Facade (`context.ai`)
* **`generateText(options)`**：
  ```js
  const result = await context.ai.generateText({
    prompt: "总结以下文字：...",
    system: "你是一个翻译官。",  // 可选系统提示词
    maxTokens: 1024,            // 可选，最高 8192
    signal: abortSignal
  });
  // result = { text: "...", usage: { inputTokens, outputTokens, totalTokens } }
  ```
* **`chat(options)`**：
  ```js
  const result = await context.ai.chat({
    messages: [{ role: "user", content: "你好" }],
    system: "系统提示词...",
    maxTokens: 1024,
    signal: abortSignal
  });
  ```
  * *限制*：输入 Prompt/Messages 累计不能超过 64 KiB；System 提示词不能超过 32 KiB。消息最大轮数限制为 100 轮，角色必须用户/模型交替。最大输出 Token 被硬限制为 8192。单个小程序受速率保护：最大并发 2 次，每分钟最多调用 30 次。
* **`transcribe(options)`**：
  ```js
  const result = await context.ai.transcribe({
    path: "recordings/meet-1.wav", // 必须是小程序 dataDir 内的相对路径
    language: "zh-CN",            // 可选 BCP-47 标签
    signal: abortSignal
  });
  // result = { text: "转写文本...", durationSeconds: 65.2 }
  ```
  * *限制*：音频大小 $\le 25 \text{ MiB}$，时长必须在 0 到 10 分钟之间。支持格式：`.webm`, `.ogg`, `.mp3`, `.m4a`, `.mp4`, `.wav`, `.flac`。

#### B. 侧栏徽标提示 (`context.badge`)
* `context.badge.set({ kind: "count", count: 3 })`：在侧栏小程序图标上渲染带数字气泡（上限 99，小于等于 0 相当于清除）。
* `context.badge.set({ kind: "dot" })`：在侧栏小程序图标上渲染纯红点。
* `context.badge.get()`：获取当前的徽标对象。
* `context.badge.clear()`：清除当前徽标。

#### C. 数据目录与系统服务
* `context.appId` (string)：小程序 ID。
* `context.dataDir` (string)：分配给小程序的专用隔离物理路径（对应 `~/.molibot/miniapps/data/<appId>/`）。SQLite 数据库及临时捕获音频文件应只读写该路径下子文件。
* `context.logger` (object)：提供 `info(event, detail)`、`warn(event, detail)`、`error(event, detail)`，将结构化日志写入 Molibot 守护进程日志文件。

---

## 四、 前端 UI 与 Bridge 通信协议

小程序的 UI 跑在独立 Origin 的 `sandboxed iframe` 里，无法接触宿主 DOM、Tauri IPC 接口，亦无法进行跨 Origin 调用。

### 1. 宿主状态轮询 API
前端可向其相对路径发送 HTTP 请求，其中有宿主内置的专有状态接口：
* **`./api/_host/state`** (GET)：返回格式：
  ```json
  {
    "appId": "expenses",
    "enabled": true,
    "revision": 12,       // 每次后端修改数据触发 changed: true 后该 revision 会递增
    "schemaVersion": 1
  }
  ```
  **最佳实践：** 前端启动时完整加载一次数据；随后进行低频心跳（如 1~2 秒一次）请求 `./api/_host/state`，仅当 `revision` 变化时才重新调用小程序的业务查询 API，以节省性能。
  
* **HTTP 异常状态码处理**：
  * **`403`**：代表该小程序在系统设置中被禁用。UI 应当提示“去设置里重新开启”并停止所有轮询。
  * **`503`**：小程序后端崩溃或加载失败。UI 应当显示“去设置查看加载错误原因”并停止轮询。

### 2. 宿主草稿插入桥梁 (`protocol: "molibot-miniapp"`)
UI 可以通过向父窗口（`window.parent`）发送 `postMessage` 请求来与宿主的输入框交互。这类交互**绝不会自动触发发送或生成，只填充草稿，最终发送动作仍在用户手中**。

* **插入文本 (`composer.insert`)**：
  ```js
  window.parent.postMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: {
      text: "要追加的格式化文字...",
      mode: "append" // 可选，"append" (追加，默认) 或 "replace" (覆盖输入框)
    }
  }, "*");
  ```
* **附加数据文件 (`composer.attach`)**：
  *支持版本：v2 (Requires `engines.molibot >= 2.9.9`)*
  ```js
  window.parent.postMessage({
    protocol: "molibot-miniapp",
    version: 2,
    action: "composer.attach",
    payload: {
      path: "temp/report.pdf", // 只能是当前小程序 dataDir 文件夹下的相对路径，最大 32 MiB
      name: "分析报告.pdf"     // 可选，指定显示的附件名称
    }
  }, "*");
  ```
* **会话导航切换 (`chat.openSession`)**：
  *支持版本：v2 (Requires `engines.molibot >= 2.9.9`)*
  ```js
  window.parent.postMessage({
    protocol: "molibot-miniapp",
    version: 2,
    action: "chat.openSession",
    payload: { sessionId: "session-abc-123" }
  }, "*");
  ```

### 3. 原生音频流捕获桥梁 (`protocol: "molibot-miniapp-host-capability"`)
*小程序的 `manifest.json` 必须声明具有 `"audioCapture"` 宿主权限。*
UI 界面无法直接调用系统录音，但可以通过向父窗口投递命令来间接控制主线程麦克风硬件采集：

#### 控制信令交互
```js
window.parent.postMessage({
  protocol: "molibot-miniapp-host-capability",
  version: 1,
  requestId: "custom-req-id-1", // 页面自定义的请求标识符
  action: "audio.start" | "audio.pause" | "audio.resume" | "audio.stop" | "audio.status",
  // 仅在 action: "audio.start" 时必填：
  meetingId: "meet-0",
  trackId: "track-0"
}, "*");
```

#### 宿主执行状态回调
宿主处理完毕后，会在 `window` 接收处将结果发送回 `iframe` 的 `contentWindow`：
```js
// 页面 window.addEventListener("message", ...) 收到 event.data:
{
  protocol: "molibot-miniapp-host-capability",
  version: 1,
  requestId: "custom-req-id-1",
  type: "result",
  ok: true, // 信令是否执行成功
  payload: { // 成功时返回当前的原生录制状态信息
    captureId: "...",
    appId: "expenses",
    meetingId: "meet-0",
    trackId: "track-0",
    state: "recording" | "paused" | "stopped",
    pendingChunks: 0,
    durationMs: 15400,
    error: null
  },
  error: "错误原因" // 失败时携带
}
```
* **录制输出推送**：在录制生命周期中，宿主以 10 秒为周期对原生 WAV 音频切片，随后直接向小程序的后端 `handleHttp` 发送 `POST` 请求（路径为 `/api/chunks/<meetingId>`）。在 `audio.stop` 时，宿主还会向后端发送 `/api/meetings/<meetingId>/finish` 的完成包。小程序后端需要自行监听并接收这些路由数据。

---

## 五、 深度链接、语言与主题适配

* **唤醒格式**：`molibot://miniapp/<appId>/<path>`（`<path>` 不能包含 `..`）。
* **UI 参数获取**：宿主加载 iframe 时，会自动在 URL 的查询参数中注入用户当前的系统设置。小程序前端应在启动时从 `location.search` 读取并自适应初始化：
  * `locale`：当前的系统语言（如 `zh-CN`, `en-US`）。
  * `theme`：当前的主题偏好（如 `light`, `dark`, `midnight`）。
  * `path`：当被深度链接唤醒时，宿主将链接中的 `<path>` 进行百分号编码后传入该参数（如 `?path=entries%2F15`），由小程序前端自行解析并完成视图内部导航。
