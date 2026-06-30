# Findings

## 已知基线

- 功能差异报告：`docs/reviews/macos-web-settings-gap-2026-06-29/report.md`。
- 视觉来源：`Momo for Mac (standalone).html`。
- 设计规范：`DESIGN.md`。
- Desktop Settings 主 UI：`apps/desktop/src/App.svelte` 与 `apps/desktop/src/styles.css`。
- 当前 P0 首要断层：Provider 简化新建契约与完整编辑契约分离。

## 设计审计

- `DESIGN.md` 要求 Settings 模仿 macOS System Settings：228px 左侧分类栏、内容区分组 inset card、46px 行高、12px 卡片圆角、固定底栏、Phosphor 图标、4px 间距体系。
- 现有 desktop CSS 已具备 Liquid Glass token、Light/Dark/System、accent、reduce transparency、reduced motion 和窄窗口断点，可在现有体系内增量修正，不需要另建样式系统。
- 当前 Settings 的主要规范偏差：大量表单直接堆在单个 `App.svelte`；`settings-row` 实际最小高度为 66px（设计规范为 46px）；多处原生 checkbox/裸 input 组合缺少统一的语义组件层；高级编辑器的信息层级不足。
- 设计稿的关键视觉语言是克制的 macOS 分组列表，而不是 Web dashboard。新增能力应使用分组标题、inset card、行内 popup/select、彩色分类图标和单一主操作，不能照搬 Web 页面布局。
- 当前固定底栏、主题 token 和响应式基础可复用；P0 实现应先改善 Provider 编辑器结构，并避免大范围重写所有 Settings。

## Provider 实施基线

- `DesktopProviderSubmitRequest` 与 `buildNewCustomProvider()` 仅支持单模型 onboarding payload；`DesktopProviderUpdateRequest` 已覆盖完整 Provider 字段。
- `App.svelte` 当前同时维护 `providerFormOpen/providerDraft` 简化新建态和 `providerEdit` 完整编辑态，形成重复状态和功能断层。
- 最小改造路径：增加完整 create contract；Settings 的“添加”直接创建完整 editor draft；保存时按 `isNew` 走 POST 或 PATCH；onboarding 的简表通过客户端映射到完整 create contract，保持现有引导可用。
- 现有测试基线 `npm run test:desktop-chat`：146/146 通过。

## Provider 已实现

- Settings 的“新增服务商”已直接进入完整编辑器，可在首次保存前配置 Provider ID、协议、Base URL、Path、API Key、thinking/reasoning，以及任意数量的模型、能力标签、上下文窗口、默认模型和启停状态。
- 新增完整 `DesktopProviderCreateRequest`，POST route 进行 ID 冲突检查并复用现有 provider sanitizer；不再由服务端强制创建单个 text 模型。
- 首次启动 Provider 步骤已支持多模型、能力标签和上下文窗口，并通过同一完整 create contract 保存。
- 远端模型拉取/验证仍要求先保存，UI 已显式禁用并说明；这避免在未持久化前复制一套携带 secret 的临时测试协议。
- 验证：`npm run test:desktop-chat` 146/146；`npm run desktop:check` 0 errors；desktop Vite build 通过。

## 模型路由设计

- 共享 schema 已完整保存 Web 所需字段：五类基础路由、compaction model、四级 Subagent 映射、fallback、first-token timeout、default thinking、compaction 数值和 timezone。
- 现有 desktop `/api/desktop/models` 只处理五类基础路由切换，不能承载高级设置；应新增细粒度 `/api/desktop/model-routing`，避免桌面提交整个 settings 对象。
- 高级路由 API 只需暴露凭据安全的文本模型 options 和上述路由字段；保存交给共享 `runtime.updateSettings()` sanitizer，desktop 层负责字段白名单与结构化 contract。
- UI 继续放在现有“模型”分区：基础能力路由保持 macOS 行式卡片，高级设置拆成 Subagent、Fallback/Thinking、Compaction、Timezone 四个 inset groups，并由同一固定底栏保存。
- 现有 `loadModels()` 已统一加载五类基础 route；高级设置可以并行加载，不改变已有即时 route 切换行为。高级字段采用显式“保存”提交，避免每个数字输入都触发运行时更新。
- App 已有 route 切换的独立 loading/error 状态；高级设置新增自己的 dirty/saving/message 状态，避免与即时 route 下拉框互相锁死。

## 模型路由已实现

- 新增细粒度 `/api/desktop/model-routing` GET/PATCH 和凭据安全 contract。
- App 模型分区已补 Subagent 四级映射、fallback/first-token timeout、default thinking、compaction model/数值和 timezone，保持基础路由即时切换，高级设置固定底栏显式保存。
- 模型 key 在服务端按当前可用 text options 校验；未知 key 清空为继承/fallback，不会持久化无效 selector。
- 验证：模型/API 定向测试 57/57；Svelte check 0 errors。

## Search / Media / TTS 设计

- 共享 sanitizer 已支持 Web Search、Image、Video、TTS 的完整字段，并以当前设置为 fallback；desktop 更新 request 可以省略未修改的 secret，仅传替换值或显式清除标记。
- Web 已有测试 endpoint，均会把请求中的未保存配置与服务端当前配置合并后调用真实工具。因此 desktop 不需要复制搜索/生成/TTS 工具逻辑，只需构造凭据安全的 draft request。
- 图片/视频任务查询、媒体读取和 TTS 音频/voice endpoint 也已存在；desktop UI 可复用 HTTP 能力，但保存仍应增加 desktop 专用细粒度 PATCH contract，以保证 secret 保留/清除语义明确。
- App 当前四个模块已有独立 lazy-load 生命周期；可在各自加载完成时建立 detached editor draft，不需要引入跨页面全局 settings state。
- 四个只读 section 在 `App.svelte` 中是连续独立块，可原位升级为 macOS 分组表单，不影响 Profiles 及后续设置页面。
- 原 i18n 明确写着“只读展示”，升级 UI 后必须同步改成可配置/可测试说明，避免功能完成但文案仍误导用户。
## 实施发现

- Search/Image/Video/TTS 的 Web 测试端点已经支持提交未保存设置，Desktop 复用该执行链即可避免复制 Agent 工具逻辑；保存仍使用独立 Desktop PATCH 路由。
- 媒体任务原始记录包含 session、provider 请求参数和本地路径，Desktop 需要单独的安全投影，不能直接把 Web 任务接口响应送入 WebView。
- 工具页未保存状态必须按 section 独立记录；单一 dirty 字符串会在跨页编辑时覆盖前一页状态。
- TTS 试听可以复用受路径保护的 `/api/settings/tts-generate/audio`，客户端只从 `test-audio` 受控目录提取相对文件名。
