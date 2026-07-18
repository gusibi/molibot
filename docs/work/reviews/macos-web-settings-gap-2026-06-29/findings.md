# Findings

## 初始观察

- Web 设置页位于 `src/routes/settings/`，桌面界面主要集中在 `apps/desktop/src/App.svelte`。
- 服务端已有一组 `src/routes/api/desktop/` API，必须区分“后端能力已存在但桌面 UI 未接入”与“能力完全不存在”。
- 当前工作树已有大量用户改动和未跟踪桌面代码；本次只新增独立审计目录，不触碰现有文件。

## 桌面设置入口

- `App.svelte` 定义了 22 个设置分区：general、models、providers、agents、mcp、skills、memory、channels、plugins、webSearch、imageGenerate、videoGenerate、ttsGenerate、profiles、usage、runHistory、trace、sandbox、hostBash、tasks、diagnostics、runtimeEnv。
- 桌面“模型路由”只有 `text / vision / stt / tts / subagent`；没有独立 image/video 路由，图片与视频生成被设计为单独服务配置。
- 桌面供应商代码并非完全没有模型能力：编辑已有供应商时可增删模型、设置 `text / vision / audio_input / stt / tts / tool` 标签、启停模型、发现模型和测试单模型。
- 关键可用性断层已经确认：`providerDraft`（新建供应商）只有名称、协议、Base URL、单个 model 字符串和 API Key；完整的模型数组和类型标签只存在于 `providerEdit`（保存供应商之后的编辑态）。因此“添加时直接录入多个模型并分类”的 Web 流程在 App 新建流程中确实缺失。

## Web 导航与供应商能力

- Web 设置导航共有 27 个页面入口，按总览、AI 引擎、渠道、助手数据、系统五组组织。
- Web 服务商页区分内置与自定义服务商，支持启停、默认服务商、OpenAI-compatible / Anthropic 协议、Base URL、接口 Path、API Key/OAuth/环境变量说明。
- Web 新建自定义服务商会立即进入完整详情编辑；无需先提交简化表单。用户可在同一保存周期内添加多个模型。
- Web 添加模型支持能力标签 `text / vision / audio_input / stt / tts / tool`、上下文窗口、启停；还支持从服务商拉取模型后逐个选择并补标签。
- Web 还有桌面模型编辑目前需要继续核对的高级字段：thinking 支持模式、thinking 格式、reasoning effort 映射、context window，以及内置服务商认证引导。

## 初步跨模块差异

- Web“路由与提示词”不仅切换 text/vision/STT/TTS/subagent 路由，还包含 subagent 分级模型、默认 thinking、fallback 策略、上下文压缩阈值/预览和时区。桌面“模型”页目前只显示五个路由下拉框。
- Web 搜索、图片、视频、TTS 页面都有细粒度保存和测试；图片/视频还管理生成任务。桌面 API 客户端对这四类模块当前只有 `load` 方法，未暴露 save/test/task-delete，因此桌面对应页面大概率只是只读摘要。
- Web 独有的独立页面已确认包括：模型报错记录、记忆拒绝记录、技能草稿、系统配置。桌面虽然把部分能力合并进其他页或 diagnostics/runtimeEnv，但需要逐项核对是否等价。
- 桌面 API 已覆盖供应商、Agent、MCP、技能、记忆、渠道、插件、任务等写操作，不能把这些模块简单判定为“缺失”；重点要检查字段覆盖面和交互深度。

## 桌面页面深度

- Providers：编辑态已经覆盖协议、Base URL、Path、API Key 替换/清除、默认模型、thinking、reasoning effort、模型 context window、能力标签、启停、发现与测试。与 Web 最大差异集中在新建流程、内置服务商认证引导和整体交互组织，不是底层数据结构缺失。
- Agents：桌面支持增删改、启停、说明、sandbox 继承、text/vision/STT 模型覆盖及 Agent 文件编辑；Web 还需核对 subagent 内建项和字段数量。
- MCP：桌面支持结构化增删改，覆盖 stdio/http、command/args/cwd/env、URL/headers、tool prefix，且对敏感/已有字段采用保留或清除语义；这一块可能比 Web 的原始 JSON 编辑更强。
- Skills：桌面支持按 scope 展示和启停，并可配置本地/API skill search、Provider/Model、token、temperature、timeout、confidence；但没有技能草稿页面。
- Search/Image/Video/TTS：桌面界面已确认是纯只读状态与引擎摘要，没有保存、测试、任务管理、语音试听/voice 拉取。
- Profiles：桌面支持增删改、启停、关联 Agent、sandbox 和 Profile 文件编辑，接近 Web Profile 能力。
- Usage/Trace：桌面仅展示聚合总数和时间窗口；Web 有明细分页、筛选、趋势、按模型/Bot/会话/工具/技能等维度分析。
- Sandbox：桌面只有总开关与诊断摘要；Web 可配置预设、失败策略、环境继承、网络域名和文件系统读写策略，并运行诊断。
- Host Bash：桌面只显示数量并允许启停白名单；Web 还提供 pending、白名单、历史、筛选和删除等完整管理。
- Tasks：桌面具备筛选、批量选择、触发、删除、编辑任务内容/交付/会话/调度/时区，整体接近 Web。
- Desktop 独有实用页：运行环境依赖状态、桌面服务诊断、开机启动、主题强调色；这些不是 Web 缺口，而是桌面环境特有能力。

## 供应商后端与渠道核对

- 桌面新建供应商 API 的限制是契约级而非纯 UI：`DesktopProviderSubmitRequest` 只接受一个 `model`，服务端强制创建单个 `text` 模型，并要求 name/baseUrl/model/apiKey 全部非空。Web 则允许先建立完整 provider draft、添加多模型/标签后统一保存。
- 桌面完整 `PATCH` 契约已经支持 Web 的核心自定义供应商字段，所以修复方向可以保持为“小改”：统一新建与编辑的数据结构/界面，直接复用完整编辑保存逻辑，而不是新增第二套能力。
- 桌面渠道页把 Telegram/Feishu/QQ/Weixin 合并管理，支持多实例、启停、Agent、sandbox、allowed chat、渠道字段、secret 保留/清除、Bot Markdown 文件；微信二维码工具也已存在，Feishu 提供连接测试。
- 与 Web 渠道页相比，桌面渠道能力整体接近，主要差异更可能是字段展示/验证和逐渠道引导，而不是缺少 CRUD。Web Profile 在桌面独立为 Profiles 页，也基本等价。
- 桌面记忆页把运行状态、能力、记录搜索/编辑/删除、sync/flush/compact 和拒绝记录合并在一起；功能上不弱于 Web 两个独立页面，只是信息组织不同。
- 桌面插件页支持 memory backend 和 schema 驱动的 feature plugin 字段保存，接近 Web；两端都更偏配置/状态，不是插件安装市场。

## 需求文档与实现偏差

- macOS 需求文档明确要求 Desktop Settings 覆盖现有全部设置能力，且“所有现有设置能力均可操作”。当前 Search/Image/Video/TTS 只读、Sandbox/Host Bash/Usage/Trace 大幅简化，属于未满足既定验收，不是新需求扩张。
- 需求文档还要求运行环境页支持逐项授权安装、准确命令、实时日志、取消、重试和复检；当前桌面页只展示依赖状态、版本、来源、体积和命令，并明确写着安装功能 deferred。
- 文档要求 Settings 提供导出数据、重置应用、删除全部本地数据，以及检查更新/Release Notes；当前 Settings 导航和代码中未发现这些操作。
- 桌面已有首次启动分流和五步引导的状态/辅助逻辑，但需要继续核对实际 Provider 步骤是否仍沿用单模型简表，以及渠道/诊断步骤是否只是跳转/只读。

## 最后核对

- 首次启动 Provider 步骤确认与 Settings 新建页使用同一个单模型简表：name/protocol/baseUrl/model/apiKey，保存后才能测试；无法在引导中选择内置 Provider、添加多个模型或设置能力类型。
- 首次启动 Channels 步骤只是显示已配置数量并提示去 Settings 管理；Diagnostics 只显示服务和依赖数量；与需求中的“可选连接渠道”和“安装/修复环境”仍有明显距离。
- Web 搜索可配置默认路由/引擎/策略/max results/timeout/retry，各引擎启停、key、base URL，并用未保存配置测试；桌面完全只读。
- Web 图片支持 Agnes/OpenAI/OpenAI Chat/ModelScope/Google/Volcengine，保存引擎/key/base URL/model，测试提示词/尺寸，查看、预览、下载和删除任务；桌面完全只读摘要。
- Web 视频支持 Agnes/Volcengine，保存、测试、查看进度/详情、播放/下载/删除任务；桌面完全只读摘要。
- Web TTS 支持 macOS/Xiaomi，保存 voice/model/format/key/base URL、拉取系统音色、合成测试与音频播放；桌面完全只读摘要。
- 桌面 Search/Image/Video/TTS 对应 API 路由均只有 GET，确认不是“UI 按钮漏放”，而是桌面专用 contract 与写 API 尚未实现。
- Web 系统配置包含时区、run budget（tool calls/failures/model attempts）、浏览器超时、reasoning/tool progress/gateway 通知显示策略、sandbox 总开关和版本/更新状态；桌面 General 只覆盖语言、主题、开机启动、服务与 readiness。
