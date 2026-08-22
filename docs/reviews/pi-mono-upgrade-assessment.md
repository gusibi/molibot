# pi-mono 0.73.1 → 0.81.0 升级与 Molibot 集成评估

> 实施状态（2026-07-21）：本报告的 P0/P1 与 P1.5 已完成，包括新 scope/0.81、Node 下限、共享 PiRuntime/CredentialStore、两个 Agent 的 `streamFunction`、compaction、subagent `ModelRuntime`、`addedToolNames` 和无用 Web UI 依赖移除。P2/P3 项继续按本文分开推进。

日期：2026-07-21  
范围：只做分析，不修改产品代码或依赖锁文件。

## 一句话结论

建议升级，而且优先级应为 P1。

但这不是一次普通的依赖版本更新：Molibot 当前使用的 `@mariozechner/*` 包已经停止在 0.73.1 并被 npm 标记为 deprecated；上游后续版本发布在 `@earendil-works/*` 下。0.80 又重构了模型、Provider 和认证运行时，0.81 收紧了 Agent 与 Session 接口。

正确方案是先把 Molibot 现有的模型目录、认证、流式调用和子 Agent 接入收口到一个共享 `PiRuntime`，再升级到 0.81.0。不要长期依赖上游的 `/compat` 入口，也不要在主 Agent、`AssistantService` 和子 Agent 三处分别打补丁。

## 1. 当前基线

| 项目 | Molibot 当前状态 | 上游当前状态 | 结论 |
| --- | --- | --- | --- |
| `pi-ai` | `@mariozechner/pi-ai@0.73.1` | `@earendil-works/pi-ai@0.81.0` | 必须迁移 scope 和 API |
| `pi-agent-core` | `@mariozechner/pi-agent-core@0.73.1` | `@earendil-works/pi-agent-core@0.81.0` | 必须迁移 `streamFn` |
| `pi-coding-agent` | `@mariozechner/pi-coding-agent@0.73.1` | `@earendil-works/pi-coding-agent@0.81.0` | 子 Agent 需迁移到 `ModelRuntime` |
| `pi-web-ui` | `@mariozechner/pi-web-ui@0.73.1` | 新 scope 最新仅 0.75.3 | Molibot 活跃源码未使用，优先移除 |
| Node.js | 项目声明 `>=22.5.0`，本机为 22.15.1 | pi 0.81 要求 `>=22.19.0` | 升级前先抬高并固定 Node 下限 |

证据来源：根目录 `package.json`、`pnpm-lock.yaml`、`example/pi-mono` 各 package manifest/changelog，以及 npm 当前发布信息。旧 scope 的四个包都停在 0.73.1，并明确提示迁移到新 scope。

## 2. 0.74–0.81 最值得关注的变化

### 2.1 不是“新功能”，而是依赖线已经迁移

0.74 将仓库和 npm scope 迁移到 `earendil-works`。继续留在旧 scope 不会再收到 Provider、模型、认证和流式协议修复。

收益：恢复到受维护的发布线，后续模型/API 变化可以正常跟进。

### 2.2 Provider、模型和认证统一到 `Models`

0.80 将旧的全局 `getModels()`、`streamSimple()`、`completeSimple()`、`getEnvApiKey()` 移到临时 `/compat` 入口，并引入正式的 `Models`：

- Provider 自己拥有模型目录、认证和流式实现；
- `Models` 负责模型查询、可用性、认证解析、登录、登出、刷新和请求；
- 支持动态 Provider 模型目录和凭证感知的模型过滤；
- `CredentialStore.modify()` 串行化 OAuth 刷新，避免并发请求重复刷新或覆盖 token。

对 Molibot 的价值很高。当前模型列表、API key/OAuth、主 Agent、`AssistantService` 和子 Agent 的认证链路是分开的；统一后可形成一个共享真相源。

### 2.3 Agent 流式接口收紧

0.81 将 Agent 的可选 `streamFn` 改成必填 `streamFunction`。Molibot 主 Runner 已经有重要的自定义流式包装：角色兼容、孤儿 tool result 清理、纯文本模型图片过滤、首 token 超时、日志和回退信号。这些不能丢失，只需迁移到新的共享 Models 调用上。

`AssistantService` 还有第二个未提供 `streamFn` 的 Agent 构造点，也必须接入同一个 runtime。

### 2.4 子 Agent 改用 `ModelRuntime`

0.80.8 删除了 coding-agent SDK 的 `AuthStorage` 输入，并把 `authStorage + modelRegistry` 改为异步 `modelRuntime`。Molibot 的 `subagent.ts` 正在直接使用这些旧对象，因此这是明确的编译和行为迁移点。

收益：主 Agent 与子 Agent 可共享同一种 Provider、凭证、模型可用性和请求行为，减少“主 Agent 能调用、子 Agent 无认证”或模型目录不一致的问题。

### 2.5 大量流式、重试、上下文和 replay 修复

0.74–0.81 累积了很多直接适用于 Molibot 的可靠性修复：

- 不完整或提前结束的流不再被误判为成功，而是进入可重试错误；
- Codex WebSocket/SSE 等待、连接轮换和响应头超时更可靠；
- 429、配额错误、Cloudflare 524、socket drop、gRPC 资源耗尽等分类更准确；
- 长上下文输出上限、context overflow 文案识别和模型 context metadata 更准确；
- 跨 Provider replay 保留 reasoning 状态和唯一 tool call ID；
- `null` content、空 tool result、缺失 usage 等边界更稳健；
- 截断的 tool call 不再无限等待不存在的 tool result；
- split-turn compaction 避免对单并发 Provider 发出重叠总结请求；
- abort 后的兄弟工具准备、晚到的工具进度事件得到正确抑制。

这些修复会直接提升 Molibot 的模型回退、长会话、工具并行、跨 Provider 切换、压缩和自定义 Provider 稳定性。

### 2.6 缓存友好的动态工具加载

0.80.7 新增 `AgentToolResult.addedToolNames` 和 `ToolResultMessage.addedToolNames`。Anthropic 与 OpenAI Responses 可以知道工具从哪一个 transcript 点开始可用，不必把所有延迟工具定义塞进稳定 prompt 前缀。

Molibot 已经有 `toolSearch` 和 deferred tools，因此这是最匹配现状的新能力：保留现有搜索和权限体系，只需让加载结果带上 `addedToolNames`。

预期收益：长会话的 prompt cache 命中更稳定、重复输入和 cache write 成本更低、动态工具增加时不必破坏前缀缓存。

### 2.7 新 Provider、模型与思考档位

新版本增加或更新了 Together AI、Ant Ling、NVIDIA NIM、Qwen Token Plan/China、Radius、Z.AI Coding China、Kimi K3、MiniMax M3、Claude 5、GPT-5.6 等目录与兼容行为。

Molibot 当前硬编码的 `KNOWN_PROVIDER_LIST` 已经落后于运行时目录。迁移后应由 Models registry 提供候选列表，再叠加 Molibot 的产品可见性策略。

0.81 还支持 `xhigh` 与按模型能力开放的 `max`。Molibot 当前只有 `off/low/medium/high`，可在核心升级稳定后补齐，但应显示成本/延迟提示，且不向不支持的模型展示。

### 2.8 更完整的 usage

新版本可记录 reasoning token，以及工具执行、压缩、分支总结的 usage。Molibot 已有 Usage、Trace 和 run summary，应把这些字段扩展到现有数据模型，而不是再引入一套上游 usage 存储。

收益：可以解释“为什么某次任务贵”、区分回答 token 与 reasoning token，并纳入子 Agent、压缩和工具侧成本。

## 3. 建议优先级

| 优先级 | 建议 | 方式 | 主要收益 |
| --- | --- | --- | --- |
| P0 前置 | Node 下限改为 `>=22.19.0`，开发机升级；构建/sidecar 使用明确版本 | 基础设施 | 避免安装或运行时失败 |
| P1 | 迁移到 `@earendil-works` 0.81.0 | 正式迁移 | 回到维护线，获得全部兼容/可靠性修复 |
| P1 | 建立一个共享 `PiRuntime` / `Models` | 架构集成 | 模型、Provider、认证、请求、主/子 Agent 一致 |
| P1 | 把 OAuth/API key 存储实现为 `CredentialStore` | 根修 | 并发刷新安全，认证流程统一，可测试 |
| P1 | 主 Runner 和 `AssistantService` 改用 `streamFunction` + Models | API 迁移 | 保留本地超时/回退，同时获得新版 provider stream |
| P1 | 子 Agent 从 `AuthStorage/ModelRegistry` 迁到共享 `ModelRuntime` | API 迁移 | 子 Agent 认证与模型一致，减少重复代码 |
| P1 | 移除未使用的 `pi-web-ui` 和 `mini-lit` | 删除无效依赖 | 减少包体、构建风险和错误版本联动 |
| P1.5 | deferred tool result 写入 `addedToolNames` | 特性集成 | 提高 prompt cache 稳定性和成本效率 |
| P2 | Provider/模型 UI 改由 Models registry 驱动 | 产品集成 | 新模型更快可用，减少静态列表漂移 |
| P2 | usage 增加 reasoning/tool/compaction/subagent 字段 | 产品集成 | 成本和性能诊断更准确 |
| P2 | 支持 `xhigh/max`，按模型能力展示 | 产品集成 | 高难任务可获得更高推理质量 |
| P3 | 评估动态 Provider 刷新、Radius、完整 Provider extension | 可选能力 | 适合网关/企业自定义 Provider |
| 暂缓 | `pi-storage-sqlite-node` 替换 Molibot Session 存储 | 独立项目 | 有规模化价值，但当前迁移成本和回归面太大 |
| 不集成 | coding-agent CLI/TUI 的 llama 下载、主题、快捷键、包更新 UI | 不适用 | Molibot 有自己的 Desktop/Web/Channel 产品层 |

## 4. 推荐实施顺序

### Slice A：先建立迁移边界，不升级依赖

1. 新建共享 pi runtime 模块，先代理当前 `getModels/streamSimple/completeSimple/auth`；
2. 让主 Runner、`AssistantService`、compaction、model routing 和 subagent 只通过该模块取模型与认证；
3. 增加认证并发、Provider/model 选择、主/子 Agent 一致性和客户端 bundle 边界测试；
4. 删除确认未使用的 `pi-web-ui`/`mini-lit`。

这不是临时兼容层，而是 Molibot 长期应该拥有的深模块：上层只表达“选哪个模型并发起请求”，Provider 细节集中在模块内部。

该 runtime 不能是永远不更新的进程级静态快照。设置保存后应原子重建或更新 Provider registry，同时让正在执行的 turn 继续使用启动时的稳定快照，下一轮再看到新配置。

### Slice B：一次性升级到 0.81.0

1. 将 npm scope 改为 `@earendil-works/*`；
2. 用正式 `Models`/Provider factories 替换旧全局 API，不把 `/compat` 留进最终代码；
3. 实现 Molibot 文件型 `CredentialStore`，认证测试必须使用临时目录；
4. `streamFn` 改为 `streamFunction`，保留所有 Molibot 流式包装；
5. 子 Agent 改为 `ModelRuntime`；
6. 修复类型变化并完整跑构建、测试与冷启动路径。

### Slice C：兑现新版能力

1. deferred tools 接入 `addedToolNames`；
2. Provider/model route options 从共享 registry 生成；
3. usage 扩展 reasoning/tool/compaction/subagent；
4. 最后再增加 `xhigh/max` 设置与中英文 Desktop/Web UI。

## 5. 升级后的具体好处

### 对用户

- 新模型和中国区 Provider 更快可用；
- 长会话、工具调用和跨 Provider 回退更少出现卡住、空回复或错误成功；
- OAuth、设备码登录、Bedrock/Vertex 等复杂认证更一致；
- 高难任务可选择更高思考档位；
- Usage/Trace 更能解释成本与性能。

### 对产品稳定性

- Provider 早结束、网络抖动、429、超时和 context overflow 的判断更准确；
- reasoning/tool replay 更少破坏多轮上下文；
- 工具 abort、并行和 compaction 竞态减少；
- prompt cache 更稳定，降低长任务成本。

### 对维护成本

- 主 Agent、简化回复路径和子 Agent 不再各自维护模型/认证逻辑；
- Provider 列表不再依赖手工同步；
- custom Provider header/baseUrl/auth 可在一个共享边界处理；
- 删除无用 Web UI 依赖，降低前端打包污染风险；
- 后续 pi 升级的改动集中在一个模块，而不是散落到几十个 import 点。

## 6. 最可能翻车的地方与守卫

1. **OAuth 凭证迁移或并发刷新覆盖**  
   守卫：使用原子替换和 provider 级跨进程锁；临时 `auth.json` 做读写 round-trip、过期 token 并发刷新、登录/登出、失败后保留旧 credential 测试；禁止测试读取真实用户数据。

2. **自定义 Provider 丢失 baseUrl、headers、思考映射或模型能力**  
   守卫：为 OpenAI-compatible、Anthropic-compatible、Azure/Cloudflare 风格 env/header、文本/视觉模型各建契约测试；对比升级前后最终 payload。

3. **双重重试导致请求放大**  
   守卫：明确 Provider 内部 retry 与 Molibot model fallback 的职责；记录每层 attempt；验证配额 429 不会被隐藏重试，瞬时错误仍能回退。

4. **Node-only Provider SDK 泄漏进浏览器包**  
   守卫：pi runtime 只允许从 server 模块导入；Web 和 Desktop production build 都必须通过；保留/加强 client-boundary 静态测试。

5. **本地 Runner 行为被上游默认值覆盖**  
   守卫：回归首 token 超时、CJK compaction、跨 Provider checkpoint rollback、工具 call ID/progress、steer/follow-up、stop/approval/resume、subagent budget。

6. **动态模型刷新拖慢冷启动或覆盖新内置目录**  
   守卫：启动先使用 bundled snapshot；网络刷新在运行态显式触发并有超时/取消；冷启动无网也必须可用。

## 7. 验收口径

- `pnpm install --frozen-lockfile`、Web build、Desktop check/test/build 全通过；
- 主 Agent、`AssistantService`、compaction、subagent 都使用同一 runtime/credential source；
- 不再存在 `@mariozechner/pi-*` import，也不在最终代码中依赖 `pi-ai/compat`；
- 本地 Node、CI、Docker、Desktop sidecar 都满足并明确记录 >=22.19.0；
- API key、OAuth、设备码登录、登出和刷新均用临时 credential store 测试；
- built-in/custom Provider 各至少一次真实或可控假 Provider 流式 smoke；
- 冷启动 → 首次聊天 → 切 session → steer/follow-up → stop → 服务重启恢复 → subagent → compaction 路径通过；
- deferred tool 加载前后 payload 与 cache usage 有可重复对比；
- 旧 session、旧 auth 文件和旧 usage JSONL 可继续读取，不静默丢字段。

## 8. 复杂度判断

整体复杂度：**复杂**。

原因不是改动行数，而是认证、模型路由、主/子 Agent、流式回退和两个前端构建边界同时受影响。建议按上面的三个 slice 做，每个 slice 都可独立回归和回退。

如果只做“改 scope + 临时 `/compat` + 修到能编译”，复杂度看似中等，但会留下第二次迁移和分散认证逻辑，不符合 Molibot 当前共享上层的架构方向。

## 参考

- 本地上游 changelog：`example/pi-mono/packages/{ai,agent,coding-agent}/CHANGELOG.md`
- 本地上游 SDK 文档：`example/pi-mono/packages/{ai,agent,coding-agent}/README.md`
- [上游 GitHub Releases](https://github.com/earendil-works/pi/releases)
- [新 pi-ai npm 包](https://www.npmjs.com/package/@earendil-works/pi-ai)
- [新 pi-agent-core npm 包](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
- [新 pi-coding-agent npm 包](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
