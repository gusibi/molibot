# Mini App Composer 桥（App → 输入框）技术方案

> 状态：✅ 已实施（2026-08-06 v1 / 2026-08-07 v2，最低 Molibot 2.9.8；v2 动作需 2.9.9）
> 前置：`miniapp-message-actions-plan.md`（不构成硬依赖，可独立实施，但共享"贡献点"心智模型）
> 前置阅读：`AGENTS.md`、`CLAUDE.md`（尤其 pitfalls #2/#7/#13/#26a）
> 交付纪律：完成后更新 `features.md` 与 `CHANGELOG.md`；验证遵循 pitfall #9/#10。

## 1. 背景与目标

Mini App 的 UI 在桌面端以 sandboxed iframe 承载（`MiniAppPanel.svelte`，固定 origin `molibot-miniapp://<app-id>/`）。当前**刻意没有** postMessage 桥——面板代码注释明确记录了这一点。本方案引入这座桥的第一个版本，动机场景：提示词收集类 App 在自己面板里点一条提示词 →"填入输入框"→ 主程序 composer 出现该文本，用户修改后自行发送。

这是 App → 宿主 UI 方向的第一条缝。核心立场：**桥只搬运 UI 意图，绝不代替用户发送**——填充后回车仍在用户手里，因此这条通道永远不需要审批链。

### 目标

- 定义版本化、白名单式的宿主桥协议（postMessage）。
- 首期动作集只有一个：`composer.insert`。
- 面板侧严格校验消息来源；未知动作带标签记日志后丢弃（pitfall #26a：带日志的 default 分支）。

### 非目标

- 自动发送、自动触发 Agent 轮次（永久非目标，写进协议文档）。
- App 读取 composer 现有内容（桥是单向的：App → 宿主）。
- 桥上传附件（`composer.attach` 预留为未来动作，本期不实现）。
- Web 部署形态的桥（本期仅桌面 WebView）。

## 2. 协议设计

### 2.1 消息形状

App UI 侧发送（协议常量与 TS 类型放共享处，见 §3.3）：

```ts
window.parent.postMessage({
  protocol: "molibot-miniapp",  // 固定判别字段
  version: 1,
  type: "composer.insert",
  payload: {
    text: string,               // 必填，非空
    mode?: "append" | "replace" // 默认 "append"
  }
}, "*");
// 注：iframe 内无法得知宿主 WebView 的具体 origin（tauri:// 或 http://127.0.0.1:1420，
// 见 pitfall #25），targetOrigin 用 "*" 是可接受的——消息里不含任何秘密，
// 真正的安全边界在宿主侧的来源校验（§2.2）。
```

### 2.2 宿主侧校验（全部在 `MiniAppPanel.svelte` 的 message 监听里）

按序执行，任一失败即丢弃并 `console.warn` 带 `[miniapp-bridge]` 前缀的结构化日志：

1. `event.source === iframeEl.contentWindow`——**这是主校验**：消息必须来自本面板持有的那个 iframe 实例，天然绑定 appId，伪造不了。
2. `data.protocol === "molibot-miniapp"` 且 `data.version === 1`；不匹配的 version 记日志丢弃（前向兼容：老宿主对新版本消息不崩、不半执行）。
3. `data.type` 在动作白名单内（首期仅 `composer.insert`）。
4. payload 形状校验：`text` 为 string 且非空；长度上限 32 KiB（超限拒绝并记日志，不静默截断——填充截断过的提示词比不填更糟）。
5. `mode` 只接受 `"append" | "replace"`，其余按 `"append"` 处理。

### 2.3 行为语义

- `append`：composer 现有文本非空时以 `\n` 拼接到末尾；`replace`：整体替换。
- 填充后：composer 获得焦点、光标移到末尾；若当前视图不在 Chat（例如 App 面板全屏态），切换到 Chat 视图。
- **不触碰**每会话的模型/思考档选择等任何其他 composer 状态（pitfall #2 corollary 的教训：刷新类操作绝不重置 per-session 状态）。
- composer 正处于流式回合中也允许填充（文本只是草稿）；但若 composer 处于"编辑历史消息"模式，先退出编辑再填充会破坏用户正在做的事——此时拒绝并 toast 提示"请先完成正在编辑的消息"。

## 3. 实现落点

### 3.1 面板侧

`apps/desktop/src/lib/miniapps/MiniAppPanel.svelte`：挂载时 `window.addEventListener("message", ...)`，销毁时移除。校验通过后不直接操作 composer——面板通过 prop 注入的回调（或专门的 bridge store）上抛，由 Chat 容器落地。**面板组件不 import composer/conversation 模块**（pitfall #7：注入差异，共享组件保持干净；`MiniAppPanel` 未来可能出现在非 Chat 宿主里）。

### 3.2 Composer 侧

Chat 容器把 `insertText(text, mode)` 能力接到 `ChatInputArea` 既有的受控状态上。注意 pitfall #2：新代码用 runes；若容器是 legacy `$:` 面，通过 store/回调传递，不裸读跨模块 runes state。

### 3.3 协议常量共享

协议 type/version/上限常量放 `src/lib/shared/miniappBridge.ts`（App 开发者文档引用同一份定义），desktop 与 `skills/miniapp-creator/reference.md` 都指向它。**不要**在面板里手写字符串字面量。

### 3.4 App 侧模板

`skills/miniapp-creator/template/` 的 UI 里加一个演示按钮 + 一个 `molibotBridge.insertToComposer(text, mode)` 辅助函数（内部就是 §2.1 的 postMessage），`reference.md` 补协议章节：形状、上限、"宿主可能不支持（老版本/Web 形态）时静默无效果，App 不应依赖桥完成关键功能"。

## 4. 测试要求

| 位置 | 断言 |
|---|---|
| `apps/desktop/src/chat-ui.test.mjs`（结构守卫） | 面板存在 message 监听且首个校验是 `event.source` 比对；面板不 import composer 模块；动作分发存在带日志的 default 分支 |
| bridge 处理单测（面板逻辑抽成纯函数后测） | 非本 iframe 来源丢弃；错误 protocol/version 丢弃；超 32 KiB 拒绝；append/replace 语义；编辑模式下拒绝 |
| `src/lib/shared/miniappBridge.test.ts` | 协议常量形状；version=1 冻结（改动作集必须升 version 的注释性断言） |

## 5. 验收标准

1. 用 template 演示按钮：点击后 Chat composer 出现文本、获得焦点、视图切到 Chat；再点一次 append 语义正确。
2. 冷启动走查（pitfall #10）：重启服务后首次打开面板、首次点击即生效。
3. 在浏览器 devtools 里从宿主主 frame 伪造同形状消息：被丢弃且有 `[miniapp-bridge]` warn 日志。
4. 正在编辑历史消息时点击：出现提示 toast，composer 内容未被破坏。
5. `svelte-check` 0/0、`vite build`、桌面 UI 测试全绿。

## 6. 预留（v1 当期不做）

桥动作集的自然延伸，实施任何一条都必须升 `version` 或走能力协商：`composer.attach`（附件填充）、`panel.requestClose`、`chat.openSession`（配合深链）。见 `miniapp-platform-extension-roadmap.md`。

## 7. v2（2026-08-07 已实施）

### 7.1 动作集

| action | version | payload | 语义 |
| --- | --- | --- | --- |
| `composer.insert` | 1+ | `{ text, mode? }` | 不变 |
| `composer.attach` | 2 | `{ path, name? }` | `path` 是 App dataDir 内的相对路径；宿主读出字节后作为 composer 附件 |
| `chat.openSession` | 2 | `{ sessionId }` | 切到已有会话；找不到会话时提示，不静默 |

`panel.requestClose` 仍未实施：目前没有它能解决而面板关闭按钮不能解决的场景。

### 7.2 版本兼容立场

**两个版本同时受支持，动作集按 version 冻结。** v1 消息只能用 `composer.insert`；用 v2 动作会得到 `unsupported_action`。

理由是两条对立的失败都要避免：直接把 `MINIAPP_BRIDGE_VERSION` 从 1 改成 2 会让所有既有 App 的 `composer.insert` 一夜失效（模板在 1.4.0 之前都发 `version: 1`）；而"版本号只是个标签、什么版本都能用全部动作"则让版本号失去意义——那样 §6 里"实施任何一条都必须升 version"这条纪律就无法被机器验证。因此**向已发布的版本追加动作永远不允许**：同一个数字不能对应两套能力集。

### 7.3 `composer.attach` 的路径纪律

`path` 由 App UI 提供，是关于「App 自己拥有的目录」的不可信输入（pitfall #6）。三道关卡：

1. 协议层形状校验（`isSafeRelativePath`）——绝对路径、`..`、盘符、UNC、NUL 一律在到达文件系统之前拒绝；
2. `MiniAppHost.readDataFile()` 用 `resolveContainedPath` 跟随符号链接后证明落在该 App 的 dataDir 内；
3. 32 MiB 上限由**路由**持有，客户端传 `maxBytes` 无效。

响应只含 basename 与字节，WebView 永远拿不到宿主路径。

### 7.4 补充测试

| 位置 | 断言 |
| --- | --- |
| `src/lib/shared/miniappBridge.test.ts` | v1 仍可用；v1 消息取不到 v2 动作；`composer.attach` 拒绝绝对路径/`..`/盘符/UNC/非字符串；`chat.openSession` 边界；「桥里没有任何发送或写入动作」的结构断言 |
| `src/lib/server/miniapps/host.test.ts` | `readDataFile` 正常读取、拒绝越界、拒绝指向外部的符号链接、超限拒绝 |
| `src/routes/api/desktop/miniapps/attach/server.test.ts` | 副作用前校验；错误码到状态码映射；异常不泄漏宿主路径；上限不可被客户端覆盖 |
| `apps/desktop/src/chat-ui.test.mjs` | 面板先比对 `event.source` 再解析；三个动作都经注入回调；带日志的 default 分支；面板不 import composer 模块；attach 在 await 之前认领 request id |
