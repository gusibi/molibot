# macOS App 与 Web 设置功能差异报告

日期：2026-06-29  
方法：只读分析当前工作树源码，不运行、不截图 macOS App。

## 结论摘要

当前差距不是简单的“macOS App 页面少”，而是三类问题叠加：

1. **关键流程断层**：供应商编辑能力已经较完整，但新建和首次引导仍使用单模型简表，导致用户第一步就无法完成合理配置。
2. **桌面页只有只读摘要**：搜索、图片、视频、TTS 在 App 中只能看状态，不能保存、测试或管理任务；对应桌面 API 也只有 GET。
3. **高级设置被大幅压缩**：模型路由、系统设置、Sandbox、Host Bash、Usage、Trace 在 App 中只保留了最基础部分。

当前源码中的 App 设置共有 **22 个分区**，Web 设置共有 **27 个页面入口**。数量差距不是重点：桌面把多个 Web 页面合并了，真正的问题是合并后省掉了写入、测试、明细和高级字段。

> 注意：`apps/desktop` 和多组 desktop API 在当前工作树中仍是未跟踪文件。本报告反映的是 **2026-06-29 当前工作树源码**，不保证与已安装的 `.app` 二进制完全一致。若安装包更旧，实际差距只会更大。

## 一、AI 供应商与模型

### 1. 新建供应商：严重不一致（P0）

| 能力 | Web | macOS App | 判断 |
|---|---|---|---|
| 新建时编辑完整 Provider | 支持 | 不支持 | App 新建只有简表 |
| 协议 | OpenAI-compatible / Anthropic | OpenAI-compatible / Anthropic | 一致 |
| Base URL / Path | 同一流程可配置 | 新建只有 Base URL；保存后编辑才有 Path | 流程断层 |
| API Key | 支持，包含内置服务商 OAuth/环境变量说明 | 新建强制要求 API Key；没有完整认证引导 | App 较弱 |
| 一次添加多个模型 | 支持 | 不支持 | App 必须先保存，再编辑 |
| 模型能力类型 | text / vision / audio_input / stt / tts / tool | 新建固定为 text | 严重缺失 |
| 上下文窗口 | 新建模型时可填 | 保存后编辑才可填 | 流程断层 |
| 启停模型 | 支持 | 保存后编辑支持 | 流程断层 |
| 拉取服务商模型 | 同一 Provider 编辑流程支持 | 保存后编辑支持 | 能力有，入口晚 |
| 单模型测试 | 支持 | 保存后支持 | 能力有，入口晚 |

根因已定位到桌面契约：`DesktopProviderSubmitRequest` 只接受单个 `model`；服务端创建时强制生成一个 `text` 模型，并要求 name、baseUrl、model、apiKey 全部存在。完整的 `models[]`、能力标签、context window、thinking 等字段只在桌面 `PATCH` 编辑契约中存在。

这意味着后续不需要重写供应商后端。最小正确方向是：**取消独立的简化新建模型，让新建直接进入现有完整编辑器，并复用完整保存契约。**

### 2. 编辑已有供应商：基本接近（P1 体验整理）

App 编辑态已经支持：

- Provider 启停、默认 Provider、默认模型；
- Base URL、Path、API Key 替换和清除；
- thinking 支持模式、thinking format、reasoning effort 映射；
- 多模型、能力标签、上下文窗口、模型启停；
- 拉取模型、逐模型测试、删除模型。

剩余差异主要是 Web 的内置/自定义 Provider 分组、OAuth/平台认证说明、搜索和更清晰的同页编辑流程。

### 3. 模型路由：App 只覆盖基础切换（P0）

App 目前只有五个下拉框：text、vision、STT、TTS、subagent。Web 还支持：

- haiku / sonnet / opus / thinking 四级 Subagent 模型映射；
- 模型 fallback 策略和首 token 超时；
- 默认 thinking 等级；
- 自动上下文压缩开关；
- 压缩专用模型；
- 默认 context window、压缩阈值、reserve tokens、keep recent tokens；
- 压缩触发预览；
- 运行时 timezone。

## 二、逐模块差异矩阵

状态说明：

- **接近一致**：核心增删改查和关键字段均在。
- **部分支持**：可用，但明显缺字段、明细或管理动作。
- **只读**：App 只能查看摘要，不能配置。
- **App 缺失**：没有对应操作入口。
- **App 更强/独有**：桌面提供了 Web 没有的结构化或宿主能力。

| 模块 | Web 能力 | macOS App 能力 | 状态 | 优先级 |
|---|---|---|---|---|
| 总览 / 外观 | 设置导航、语言、主题 | 语言、Light/Dark/System、强调色、登录启动、服务状态、readiness | App 独有宿主能力 | — |
| AI Provider | 完整内置/自定义管理 | 编辑完整，新建/引导严重简化 | 部分支持 | P0 |
| 模型路由 | 路由、Subagent 分级、fallback、thinking、compaction、timezone | 仅五个路由切换 | 部分支持 | P0 |
| 模型报错记录 | 200 条记录、类型/Provider/模型筛选和统计 | 无页面 | App 缺失 | P1 |
| Usage | 明细分页、筛选、时间窗口、趋势、模型/Bot 排名、cache 指标 | 总计和四个时间窗口摘要 | 部分支持 | P1 |
| Trace | facts 分页筛选，工具/技能/模型/Bot/会话/Run 等维度 | 时间范围和总量摘要 | 部分支持 | P1 |
| MCP | 原始 JSON 编辑、解析、启停 | 结构化 CRUD；stdio/http、args/env/cwd/headers、secret 清除、tool prefix | App 更强 | — |
| 搜索工具 | 路由、引擎策略、超时、重试、各引擎凭据/URL、未保存配置测试 | 只读状态和引擎摘要 | 只读 | P0 |
| 图片工具 | 6 类引擎配置、模型/URL/Key、测试、任务查看/预览/下载/删除 | 只读状态和引擎摘要 | 只读 | P0 |
| 视频工具 | 2 类引擎配置、模型/URL/Key、测试、进度/播放/下载/删除 | 只读状态和引擎摘要 | 只读 | P0 |
| TTS | macOS/Xiaomi 配置、音色列表、模型/格式、测试和播放 | 只读 Provider/voice/format 摘要 | 只读 | P0 |
| Web Profiles | CRUD、启停、Agent、sandbox、4 个 Markdown 文件 | 同等 CRUD、字段和文件编辑 | 接近一致 | — |
| Telegram | 多 Bot、token、流式、allowed chats、Agent、sandbox、Bot 文件 | 合并在 Channels，字段基本覆盖 | 接近一致 | P2 体验 |
| Feishu | 多 Bot、App 凭据、流式、allowed chats、连接测试、Bot 文件 | 基本覆盖并有连接测试 | 接近一致 | P2 体验 |
| QQ | 多 Bot、App ID/secret、allowed chats、Agent、sandbox、Bot 文件 | 基本覆盖 | 接近一致 | P2 体验 |
| Weixin | 多 Bot、Base URL、二维码工具、Agent、sandbox、Bot 文件 | 基本覆盖并有二维码工具 | 接近一致 | P2 体验 |
| Agents | CRUD、模型覆盖、提示词文件、内置 Subagent 生效模型查看 | CRUD、模型覆盖、sandbox、提示词文件；缺内置 Subagent 说明页 | 部分支持 | P2 |
| Memory | 查询、sync/flush/compact、编辑/删除 | 同等维护和记录编辑，并合并拒绝记录 | 接近一致 | — |
| Memory Rejections | 独立统计和筛选页 | 合并到 Memory，支持筛选 | 接近一致 | — |
| Skills | scope 展示、启停、Skill Search 配置 | 基本覆盖 | 接近一致 | — |
| Skill Drafts | 规则、列表、编辑、保存、promote、删除 | 无入口 | App 缺失 | P1 |
| Run History | 成功/部分/失败记录和详情摘要 | 基本覆盖 | 接近一致 | P2 |
| Tasks | 分类、筛选、批量选择、触发、编辑、删除 | 基本覆盖 | 接近一致 | — |
| Host Bash | pending、白名单、历史、过滤、启停和删除 | 数量摘要、白名单列表和启停 | 部分支持 | P1 |
| System | timezone、运行预算、浏览器超时、reasoning/tool progress 显示策略、通知间隔、版本状态 | 语言/主题/登录启动/服务状态；其余缺失 | 部分支持 | P1 |
| Sandbox | 预设、失败策略、环境继承、网络/文件策略、诊断 | 总开关和只读诊断摘要 | 部分支持 | P1 |
| Plugins | catalog 状态、memory backend、schema 字段和 secret | 基本覆盖 | 接近一致 | — |
| Diagnostics | Web 无独立宿主页 | 服务版本、ownership、endpoint、state、复制诊断 | App 独有 | — |
| Runtime Environment | Web 无桌面依赖安装页 | 只读依赖状态/版本/来源/体积/命令 | App 独有但未完成 | P1 |

## 三、首次启动引导差异

App 已有 new / usable / broken 分流和五步 UI，但完成度不等于需求：

1. **Provider**：仍是单模型简表；不能选内置 Provider、不能添加多模型、不能设置模型类型。
2. **Agent/Profile**：可以确认已有 Profile 与 Agent 的关联，但没有时只能跳转 Settings。
3. **Channels**：只显示已有实例数量，不能在引导里连接渠道。
4. **Launch at login**：可直接设置，已完成。
5. **Diagnostics**：只显示服务和依赖计数，不能安装或修复。

因此首次引导目前更像“检查与跳转器”，还不是完整的首次配置闭环。

## 四、不是 Web 对比，但需求文档明确要求而 App 尚未完成

- 运行环境逐项授权安装；
- 安装实时日志、取消、失败重试、安装后复检；
- 导出数据；
- 重置应用；
- 删除全部本地数据及二次确认；
- 检查更新、Release Notes 和下载入口；
- 统一审批中心；
- 渠道断线和任务失败通知策略。

这些来自现有 macOS App 需求文档，不应混入 Web parity 的首轮开发，但需要单独保留在后续阶段。

## 五、建议的开发顺序

### P0：先让 App 设置真正可用

1. 统一 Provider 新建与编辑流程，支持一次添加多个模型和能力标签。
2. 补齐模型路由高级字段。
3. 将 Search / Image / Video / TTS 从只读改为可保存、可测试；图片/视频补任务管理，TTS 补音色和试听。

### P1：补齐管理和排障能力

4. 补模型报错记录、Skill Drafts。
5. 补 Usage / Trace 明细与筛选。
6. 补完整 Sandbox、Host Bash、System 设置。
7. 完成 Runtime Environment 安装闭环。

### P2：统一体验和信息架构

8. 优化四个渠道的分组、说明和验证反馈。
9. 补内置 Subagent 生效模型视图。
10. 再处理数据生命周期、更新和通知等桌面产品化能力。

## 六、主要源码证据

- Web 设置导航：`src/routes/settings/+layout.svelte`
- Web Provider：`src/routes/settings/ai/providers/+page.svelte`
- Web 模型路由：`src/routes/settings/ai/routing/+page.svelte`
- Web 搜索/图片/视频/TTS：`src/routes/settings/search/+page.svelte`、`image/+page.svelte`、`video/+page.svelte`、`tts/+page.svelte`
- Web 系统/Sandbox/Host Bash：`src/routes/settings/system/+page.svelte`、`sandbox/+page.svelte`、`host-bash/+page.svelte`
- Desktop 设置 UI：`apps/desktop/src/App.svelte`
- Desktop 首次引导：`apps/desktop/src/ChatView.svelte`
- Desktop API 客户端：`apps/desktop/src/lib/api.ts`
- Desktop Contract：`src/lib/shared/desktop.ts`
- Desktop Provider 创建/编辑：`src/lib/server/app/desktopProviderSubmit.ts`、`desktopProviderManage.ts`
- Desktop API routes：`src/routes/api/desktop/`
- macOS App 既定需求：`docs/requirements/molibot-macos-app-plan.md`

## 七、审计步骤与健康度

1. Web 设置导航和页面入口盘点 — **完整**。
2. Desktop 设置导航、UI 和固定底栏动作盘点 — **完整**。
3. Provider/模型字段与保存契约对照 — **完整，已定位核心断层**。
4. 其余模块保存、测试和任务能力对照 — **完整**。
5. Desktop API 是否具备写能力的交叉核对 — **完整**。
6. 与 macOS App 需求文档验收口径核对 — **完整**。

## 八、分析边界

- 未运行已安装 App，因此没有验证源码与安装包版本是否一致。
- 未连接真实 Provider、渠道或外部服务，因此没有验证运行时凭据、网络错误和服务商兼容性。
- 本报告比较功能和代码路径，不评价视觉还原、响应式、键盘操作或辅助功能。
