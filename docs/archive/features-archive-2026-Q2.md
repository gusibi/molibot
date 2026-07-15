# Molibot Features Archive - 2026 Q2

## 2026-06-30

### macOS 聊天侧栏重构为「渠道 → Bot → 会话」导航
- Chat 页左栏重做成两列布局的统一导航：顶部一排横向圆形渠道切换器（Web / telegram / feishu / qq / weixin，紧凑头像 + 与上方菜单间用分割线隔开），选中渠道后下方列出该渠道已配置的全部 Bot 实例（含 0 会话的），点开某个 Bot 展开它的会话列表，点会话进入右侧对话区。Web 渠道的「Bot」即各 Web Profile（会话可新建/重命名/删除），外部渠道的 Bot 会话只读。
- 修复「全部显示为未指定 Bot 实例」：外部会话以前只读 `external.botInstanceName`（实际数据未写）。真实数据里 Bot 身份编码在 legacy 索引的 `externalUserId`（`bot:<instanceId>:chat:...`，如 `bot:moli_news_bot:chat:...`），而会话 `id` 只是 UUID。现在后端从 `externalUserId` 解析出 `botInstanceId`，前端再与渠道设置（实例 id=slug、name=显示名）join 出 Bot 名称与完整 Bot 列表 —— 实测 272 条外部会话里 269 条能正确归位（telegram 拆到约 10 个 bot、feishu 8 个、qq 2 个、weixin 1 个），仅 3 条旧式 `chat:<chatId>:...` 无 Bot 前缀的归入「未指定 Bot 实例」兜底。
- 后端新增纯函数 `parseBotInstanceId`（解析 `externalUserId`）与契约字段 `DesktopExternalSession.botInstanceId`，投影改为透传 `externalUserId`；前端新增纯函数 `buildExternalChannelNav` / `externalSessionsForBot` 与 `.channel-switch` / `.channel-chip` 语义类。
- 验证：`api.test.ts` 60/60、`desktopExternalSessions.test.ts` 9/9、Desktop `svelte-check` 0/0、production build 通过；并用真实 `~/.molibot/sessions/index.json` 验证分组分布。

### macOS 设置导航分组与实体编辑弹窗
- macOS Settings 左栏按 Web `/settings` 的五组结构整理为「总览 / AI 引擎 / 渠道 / 助手数据 / 系统」，保留全部 22 个桌面设置入口、双语标签和搜索过滤。
- Agent、MCP、外部渠道、Web Profile、任务的新增/编辑表单不再追加到长页面底部，统一显示为居中的可滚动编辑窗口；保存仍走原有细粒度 API 和固定底栏。
- 编辑窗口现在自带固定标题、关闭、取消和保存区，避免操作按钮被浮层遮挡；Memory 记录也从列表内直接改写调整为摘要列表 + 独立编辑窗口。
- 设置行、38×22 开关、紧凑下拉框、卡片间距继续复用 `DESIGN.md` / standalone 设计稿 token；Provider、Agent、MCP、渠道和 Web Profile 编辑态的启用控件统一为 Switch，并补充减少动态效果适配。
- 完成 22 个设置入口的逐页布局检查：独立卡片增加 12px 组间距，TTS 默认只展开当前 Provider，图片测试尺寸改为受控下拉，模型/任务时区下拉保留 `UTC` 和旧配置值，运行历史增加双语即时筛选，渠道名称按中英文显示；运行环境长命令在窄窗口安全换行。
- 在 860×650 实页逐项切换全部 22 页，标题均正确且无横向溢出；620×480 最小窗口确认切换为 170px/449px 双栏布局。服务依赖内容的完整数据态继续由源码契约与 production build 覆盖。
- 修复 Desktop 设置即时切换语言时的响应式失效：此前正文和分组标题会变英文，但左侧页面名、当前页标题、主题选项以及部分动态状态标签仍停留在中文；现在所有 helper 显式接收当前 `text`/`locale`，避免 Svelte 5 隐藏依赖。已在 620×480 深色英文状态逐项切换 22 页，标题全部即时翻译且无横向溢出，随后恢复中文与跟随系统。

### 定时任务：会话隔离改为下拉 + 修复默认值漂移
- **交互改为下拉**：`/settings/tasks` 编辑态的「会话隔离」由 `IosSwitch` 开关改为 `fresh` / `chat` 下拉（`NativeSelect`），两种模式一目了然，不再用开/关隐含表达。
- **修复 chat 跑一次变 fresh 的 Bug**：开关此前把「未显式设置 `sessionMode`」当作 `chat`（开关 off），而展示用的 Badge 和运行时（`resolveEventSessionMode`）对「未设置 + periodic」解析为 `fresh`，导致不动开关直接保存会写入空值、运行后显示成 `fresh`。现在编辑态用共享的 `effectiveSessionMode(item)` 以「实际生效模式」初始化下拉（Badge 也复用该 helper），保存时始终写入明确的 `fresh`/`chat`，选择不再漂移。

- Completed macOS Sandbox policy parity with Web: Observe/Build/Strict presets, enable/failure/env modes, relative env-file replacement, env allow/deny keys, network allow/deny domains, filesystem read/write rules, reset, fixed save footer, and diagnostics refresh are fully editable. Presets remain local drafts until save. Existing absolute env-file paths and all env values stay server-side. Verified with 61 focused server/client tests, 6/6 UI structural tests, `svelte-check` 0/0, Desktop/Web production builds, and an isolated standard/640px save-and-reload smoke.
- Improved macOS AI Provider management: built-in providers, self-hosted providers, and custom models now have distinct bilingual labels and grouped sections. The complete create/edit form opens in a 920px scrollable liquid-glass modal with a persistent action footer instead of being appended below the provider list; Escape, backdrop close, dark theme tokens, and narrow-window single-column layout are supported. Verified against an isolated temporary service at normal and 640px widths, plus frontend tests (5/5), `svelte-check` (0/0), Desktop production build, and Web production build.
- Refined the standalone macOS Settings shell against `Momo for Mac (standalone).html` / `DESIGN.md`: the sidebar now uses a real bilingual settings filter, compact 34px category rows, native titlebar spacing, and a status footer; the right pane now has fixed title chrome, an independent scrolling body, 46px grouped rows, horizontal appearance controls, layered liquid-glass materials, and translucent sticky save footbars. Existing fine-grained settings actions, light/dark themes, and responsive behavior are preserved. Verified with Desktop `svelte-check` (0/0), frontend tests (4/4), Rust tests (8/8), and production build; visual acceptance remains with the user on macOS as requested.
- Standardized macOS Desktop Settings i18n and DESIGN.md compliance: replaced hardcoded English (tool `Base URL`, Provider protocol options, Search route/strategy enums, Search/Image/Video engine names, TTS format/provider labels) with bilingual `text.*` keys; added a reusable show/hide API-key reveal control across Web Search, Image, Video, and TTS credential fields.
- Brought Desktop tool/provider panels to web parity polish: Search per-engine test-target selector; TTS test-provider selector plus Xiaomi MiMo voice dropdown; Provider per-row "Set as default", per-model verification badges, and an editable supported-roles chip row.
- Added Image/Video generation task-detail modal (preview + download + status/progress/error/timestamps) with 5s auto-polling for in-progress tasks; localized engine names in the task list and default-engine selector.
- Added a live model-routing compaction-trigger preview callout and a native timezone `<select>` (from `Intl.supportedValuesOf`) replacing the free-text field.
- Completed the whole-settings i18n sweep: localized header language label, Memory placeholders, Runtime Environment total count, Diagnostics connection state, Weixin QR-login placeholder, and the onboarding sidebar-resize label. Preserved the Desktop privacy boundary (no local paths/session ids/secret-bearing request params in the media-task projection).

### macOS Settings 功能对齐——Provider、模型路由与生成工具
- **完整 Provider 新建**：Settings 与首次引导统一使用完整 Provider 契约；新建时即可配置 Provider ID、协议、Base URL/path、默认模型、Thinking/Reasoning、多模型、模型能力标签、上下文窗口与启停状态，不再先创建单一 text 模型再二次编辑。
- **高级模型路由**：补齐 Subagent haiku/sonnet/opus/thinking 路由、fallback 策略、首 Token 超时、默认 Thinking、自动上下文压缩参数、压缩模型和运行时 timezone，并使用细粒度 `/api/desktop/model-routing` 保存。
- **搜索/图像/视频/TTS 可操作化**：四个原只读区域支持启停、默认路由/引擎、超时、模型、Base URL、凭据替换/显式清空、未保存值测试；图片/视频支持安全的最近任务查看与删除，TTS 支持系统音色和测试音频播放。
- **安全与交互**：保存使用各动态 key 的 Desktop API，保留未提交密钥；媒体任务契约过滤 session、请求参数和本地绝对路径。多个工具页的未保存状态独立保留，保存按钮固定在 `.settings-footbar`。界面沿用 `Momo for Mac (standalone).html` / `DESIGN.md` 的 macOS 分组卡片、主题 token、中英和窄窗口布局。
- **验证**：Desktop 回归测试 155/155、`svelte-check` 0 错误/0 警告、Desktop production build 与 Web production build 通过；常规和 680px 窄窗口真实渲染检查通过。真实第三方 Provider 请求仍需在有凭据环境做 smoke。

### macOS Settings 可操作迁移——外部渠道
- **统一实例管理**：Telegram、Feishu、QQ、Weixin 支持新增、编辑、删除、启停、关联 Agent、沙箱继承/强开/强关、允许会话列表，以及 `BOT.md`、`SOUL.md`、`IDENTITY.md`、`SONG.md` 编辑。
- **凭据安全**：Desktop 只读取“已配置”的凭据字段名，不回传 Token/Secret；留空保留原值，显式勾选才清空，编辑不会丢弃渠道实例的其它已支持字段。
- **渠道工具**：飞书支持使用已保存或尚未保存的 App ID/App Secret 测试连接；微信提供与 Web 页一致的本地登录链接二维码生成、清空和原链接打开能力。
- **验证**：渠道聚焦测试 56/56、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——MCP
- **服务管理**：stdio 与 HTTP MCP 服务支持新增、编辑、删除、启停，并可配置名称、命令或 URL、工具名前缀。
- **敏感配置边界**：已保存的 args、env 值、HTTP headers 与 cwd 不回传 Desktop，只展示计数、键名或已配置状态；用户可提交替换值或逐项显式清空，留空保留原配置。
- **验证**：设置回归测试 79/79、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Skills
- **Skill 启停**：已发现的全局、Bot、会话 Skill 可在 Desktop 逐项启用或禁用；WebView 只持有不可逆短 ID，服务端再解析真实路径。
- **搜索配置**：支持本地/API 技能搜索启停、Provider、模型、最大 Tokens、Temperature、超时和最低置信度，并使用固定保存底栏。
- **安全边界与验证**：Skill 磁盘路径、搜索 API Key/Base URL/path 不回传且更新时保留。设置回归测试 84/84、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Plugins
- **插件配置**：支持启用/禁用记忆能力、选择记忆后端，以及按插件目录声明动态渲染功能插件的布尔、文本、选择和密码字段。
- **凭据安全**：密码字段只返回已配置状态，支持替换和显式清空；未提交字段、hooks、插件 manifest/entry 路径均不会被覆盖或泄露。
- **验证**：设置回归测试 90/90、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Memory
- **完整操作**：支持全部/指定作用域的记忆列表和搜索、外部文件同步、写入、去重，以及记忆内容、标签、过期时间编辑和删除。
- **治理记录**：同一页面展示记忆写入拒绝记录，并可按原因、内容、渠道、用户和标签筛选；治理日志磁盘路径不回传。
- **验证**：设置回归测试 93/93、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### macOS Settings 可操作迁移——Tasks
- **任务管理**：显示并筛选完整任务文本，支持单项/批量选择、触发和删除，以及文本、交付方式、会话模式、单次时间或周期 Cron/时区编辑。
- **运行时边界**：任务绝对 JSON 路径替换为不可逆 ID，服务端解析后复用 watched-event API 的路径白名单、格式校验和渠道 `triggerTask`。
- **验证**：设置回归测试 98/98、Desktop `svelte-check` 0/0、Desktop 与 Web production build 通过。

### Molibot macOS App 原生麦克风录音与音频回放
- **根因**：Tauri 在 macOS 用 WKWebView，`navigator.mediaDevices` 不暴露，前端 `getUserMedia` 永远走不到，统一报「当前环境不支持麦克风录音」。与 dev/生产无关，正式包同样如此。
- **原生采集**：新增 Rust 模块 `apps/desktop/src-tauri/src/audio.rs`，用 `cpal` 打开默认输入设备，在独立线程持有 `!Send` 的 `cpal::Stream` 并缓冲样本；`stop` 时用 `hound` 编码为内存 WAV（16-bit PCM）并以 base64 返回。新增 `start_recording`/`stop_recording`/`cancel_recording` 三个命令与 `AudioState`。
- **麦克风授权修复**：原先只开流不申请权限，macOS 静默拒绝、只给静音（表现为「没监听麦克风」）。新增 `ensure_microphone_access()`，用 `objc2-av-foundation` 显式查询 `AVCaptureDevice` 授权状态并在未决时调 `requestAccessForMediaType` 弹窗、阻塞等待结果；拒绝/受限/超时分别返回明确错误。
- **前端接线**：`ChatView.svelte` 录音改为优先调用 Tauri 命令（`__TAURI_INTERNALS__` 探测），把返回的 base64 WAV 还原成 `File` 加入待发送附件；保留纯浏览器 `npm run dev` 的 `MediaRecorder` 回退路径。录音中禁用重复触发。
- **音频回放**：待发送录音 chip 内嵌 `<audio controls>` 即时试听（object URL 随 `pendingFiles` 增删创建/回收，用独立 tracking map 避免响应式自写循环）；已发送消息的音频附件新增「播放」按钮，按需经 `fetchDesktopFileBlob` 拉取并内联播放，URL 在切换会话/销毁时回收。新增 i18n `play`。
- **附件发送 CSRF 修复**：打包后带附件（如录音）发送报 `Cross-site POST form submissions are forbidden`——multipart `/api/chat` 请求来自 WebView 的 `tauri://localhost` origin，与 loopback 服务端 origin 不符被 SvelteKit CSRF 拦截。在服务端 `svelte.config.js` 的 `kit.csrf.trustedOrigins` 加入 `tauri://localhost`：保留 Web 部署的完整 CSRF 防护，只放行这一个固定的桌面 origin。运行时随 `prepare:runtime`（root `npm run build`）打包生效。
- **验证**：`cargo check` 通过、Desktop `svelte-check` 0/0。原生录音、回放、附件发送已在打包版实测通过。

### macOS Settings 可操作迁移——Provider、Web Profile、Agent
- **AI Provider 管理**：自定义 Provider 支持编辑、删除、启停、默认项、Key 替换/清空、模型注册表增删与启停、能力标签、上下文窗口、默认模型、远端模型发现、逐模型验证、Thinking 格式和推理力度映射；全局 Provider mode、Pi Provider/模型与默认自定义 Provider 可保存。已保存 Key 不回传 Desktop。
- **Web Profile 管理**：支持新增、编辑、删除、启停、关联 Agent、沙箱继承/强开/强关，以及 `BOT.md`、`SOUL.md`、`IDENTITY.md`、`SONG.md` 编辑。编辑时保留 Desktop 不可见的 credentials/allowedChatIds。
- **Agent 管理**：支持新增、编辑、删除、启停、沙箱覆盖、文本/视觉/STT 专有模型路由，以及 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`SONG.md` 编辑；仍被渠道引用的 Agent 拒绝删除。
- **验证**：目标测试 70/70、Web production build、Desktop production build、Desktop Svelte check 0/0。设置功能迁移继续推进到渠道、MCP、Skills、Memory、Tasks 与媒体能力。

## 2026-06-28

### Molibot macOS App 设置——Web 功能迁移启动与重连修复
- **重连操作修复**：移除所有 Desktop Settings 页面底部无条件出现的「重新检查」。本地服务健康时不再渲染该底栏；仅断开时显示语义明确的「重新连接服务」。
- **AI 服务商首条功能迁移**：Desktop Settings → AI 服务商在新 macOS UI 中支持新增自定义服务商、一次性提交 API Key、保存后刷新列表，以及验证已保存服务商的真实连接。密钥只在保存请求中传入，服务端测试按 provider id 读取，不向 WebView 回显。
- **设计与验证**：新增表单采用共享语义 CSS、中英即时切换、明暗主题 token、窄窗口单列布局和固定保存底栏。目标测试 55/55、Desktop `svelte-check` 0/0、Desktop 与 Web production build 均通过；其余 Web 设置动作按 `prd.md` 分批迁移。

### Molibot macOS App Chat 输入、录音与 Markdown 可读性修复
- Chat 输入框现在直接用“Enter 发送 · Shift+Enter 换行”（英文同步）作为 placeholder，不再把提示挤在发送按钮左侧。
- 原先错误跳转到 TTS 设置页的麦克风按钮已接回现有 `MediaRecorder` 录音流程；录音时显示双语计时条、脉冲状态、取消与完成操作，完成后作为待发送音频附件加入当前消息。macOS bundle 增加麦克风用途声明。
- AI 消息的 fenced code block 改为保留换行并在容器宽度内自动折行，禁用横向滚动条；新增 3 个 Chat UI 回归检查。Desktop Svelte check 0/0、生产构建和 Info.plist 校验通过。

### Molibot macOS App Phase 4 设置——语音（TTS）只读区
- **语音区**：Settings 新增「语音」区，只读展示 TTS 配置（启用、默认提供方）与两个提供方：macOS 系统语音（音色/格式，无密钥）与小米 MiMo（是否配置密钥、模型、Base URL、音色、格式），状态徽标文本+颜色（§8 "语音"）。这是 §8 最后一个待补设置区。
- **凭据安全映射**：新增 `desktopTtsGenerate.ts`（`buildDesktopTtsSummary` + 两个 per-provider 构造器）逐字段投影；小米 `apiKey`→`hasApiKey`，macOS 无密钥。新增 `/api/desktop/tts-generate` GET、`DesktopTtsSummary`/`DesktopTtsProvider` 契约、`loadDesktopTts` loader、能力 scope。
- **验证边界**：`desktopTtsGenerate.test.ts` 4/4（macOS 无密钥；小米 `apiKey`→bool 且不泄露；空密钥；summary 保序不泄露）——desktop-chat 128/128、Desktop check 0/0、Desktop+Web build 通过。真实配置实机 smoke 待补。**至此 §8「保留现有全部设置能力」全部 22 个区均已在桌面端落地。**

### Molibot macOS App Phase 4 设置——视频生成只读区
- **视频区**：Settings 新增「视频」区，复用图像/视频共享的媒体映射器只读展示视频生成配置和各引擎状态（是否配置密钥、模型、Base URL），布局与图像区一致（§8 "视频"）。
- **复用实现**：`/api/desktop/video-generate` GET 复用 `buildDesktopMediaGenerateSummary`（每引擎 `apiKey`→`hasApiKey`）；新增 `DesktopVideoGenerateResponse` 契约别名、`loadDesktopVideoGenerate` loader、能力 scope。无新增映射器/测试（共享映射器已被 `desktopMediaGenerate.test.ts` 覆盖）。
- **验证边界**：desktop-chat 124/124、Desktop check 0/0、Desktop+Web build 通过。真实配置实机 smoke 待补。

### Molibot macOS App Phase 4 设置——图像生成只读区
- **图像区**：Settings 新增「图像」区，只读展示图像生成配置（启用、默认引擎）与每引擎状态（是否配置密钥、模型、Base URL）+ 计数（总/启用/已配置）（§8 "图像"）。
- **可复用媒体映射器**：因图像与视频设置结构完全一致，新增共享 `desktopMediaGenerate.ts`（`buildDesktopMediaEngine` + `buildDesktopMediaGenerateSummary`）与共享 `DesktopMediaGenerateSummary`/`DesktopMediaEngine` 契约，每引擎 `apiKey`→`hasApiKey`，保留 baseUrl/model；新增 `/api/desktop/image-generate` GET、`loadDesktopImageGenerate` loader、能力 scope。
- **验证边界**：`desktopMediaGenerate.test.ts` 4/4（密钥→bool 且不泄露；未配置引擎；summary 计数；缺 engines map）——desktop-chat 124/124、Desktop check 0/0、Desktop+Web build 通过。

### Molibot macOS App Phase 4 设置——联网搜索只读区
- **搜索区**：Settings 新增「搜索」区，只读展示联网搜索配置（启用、默认路由/引擎、选择策略、最大结果数）与每个引擎状态（是否配置密钥、Base URL）+ 计数（总/启用/已配置密钥）（§8 "搜索"）。
- **凭据安全映射**：新增 `desktopWebSearch.ts`（`buildDesktopWebSearchSummary` + per-engine 构造器），每引擎 `apiKey`→`hasApiKey`，保留 baseUrl（端点非密钥）；新增 `/api/desktop/web-search` GET、`DesktopWebSearchSummary` 契约、`loadDesktopWebSearch` loader、能力 scope。
- **验证边界**：`desktopWebSearch.test.ts` 4/4（密钥→bool 且不泄露；未配置引擎；summary 计数+不泄露；缺 engines map）——desktop-chat 120/120、Desktop check 0/0、Desktop+Web build 通过。

### Molibot macOS App Phase 4 设置——插件只读区
- **插件区**：Settings 新增「插件」区，只读展示已加载插件（渠道/服务商/功能/记忆后端）：名称、版本、种类、来源（内置/外部）、状态徽标（活跃/错误/已发现）+ 计数（总/活跃/外部）（§8 "插件"）。
- **完成孤立映射器**：此前 `desktopPlugins.ts` 仅有映射器无路由/测试/UI。本切片端到端接入：新增 `/api/desktop/plugins` GET（映射 `runtime.pluginCatalog`，丢弃 `manifestPath`/`entryPath`/`settingsFields`）、`desktopPlugins.test.ts`、`loadDesktopPlugins` loader、能力 scope。种类/状态标签用显式三元表达式直接引用 `text`（保持 locale 切换响应式，避免 Svelte-5 响应式陷阱）。
- **验证边界**：`desktopPlugins.test.ts` 4/4（丢弃路径/secret；未知种类/状态 coerce；已知种类顺序+计数；空目录）——desktop-chat 116/116、Desktop check 0/0、Desktop+Web build 通过。

### Molibot macOS App Phase 3 外部会话——Bot 实例层级
- **多实例自动分层**：外部渠道只读侧栏现按计划 §7.2「单实例时直接显示会话。多实例时自动增加 渠道 → Bot 实例 → 会话 层级」分层。某渠道有多个不同 `botInstanceName` 时渲染每个实例的子标题与其会话；单实例或旧无元数据渠道保持扁平（渠道徽标内联）。旧无元数据会话归入 null 实例桶，仅在渠道被拆分时显示「未指定 Bot 实例」标题。
- **可测试纯函数**：新增 `groupExternalSessionsByInstance`（返回有序 `ExternalChannelSection[]`，含 `showInstances` + per-instance 段，保持服务端渠道顺序与组内最新优先）。复用现有 `/api/desktop/external-sessions` 契约（已投影 `botInstanceName`），渠道适配器填充后层级自动出现。
- **验证边界**：新增 api 单测 3 例（单实例扁平；多实例拆分并保序；旧无元数据→null 桶）——desktop-chat 112/112、Desktop check 0/0、Desktop build 通过。改动仅限桌面端，无 Web/server 源码变更。

### Molibot macOS App Phase 4 首次启动——诊断步骤
- **可工作的第五步**：§9.2 onboarding 的「诊断」步骤不再是延期占位。只读展示运行环境诊断概览：本地服务就绪状态 + 依赖已安装/总数 + 缺失可选依赖名称，并提示前往 设置 → 运行环境（计划 §9.2 step 5「展示运行环境诊断」）。仅信息展示，缺失可选依赖不阻止「完成」。
- **复用端点**：新增纯函数 `summarizeOnboardingDiagnostics(runtimeEnv, serviceReady)`，复用 `/api/desktop/runtime-env`；加载折入 `connect()` 的 `Promise.all` 并 `.catch(()=>null)`（信息性、非关键），断连重置。**至此 §9.2 五步引导全部实现（provider/agent/channels/launch/diagnostics），无剩余延期占位。**
- **验证边界**：新增 api 单测 2 例（服务+依赖状态+缺失名；null runtime→空）——desktop-chat 109/109、Desktop check 0/0、Desktop build 通过。

### Molibot macOS App Phase 4 首次启动——渠道步骤
- **可工作的第三步**：§9.2 onboarding 的「渠道」步骤不再是延期占位。只读展示已配置外部渠道（每渠道 已启用/总数 + 已启用实例计数），并提示前往 设置 → 渠道 连接/编辑（计划 §9.2 step 3「可选连接渠道」）。引导内无输入/连接控件，该步可选、不门控「下一步」。
- **复用端点**：新增纯函数 `summarizeOnboardingChannels(summary)`，复用 credential-safe `/api/desktop/channels`；加载折入 `connect()` 的 `Promise.all` 并 `.catch(()=>null)`，断连重置。
- **验证边界**：新增 api 单测 2 例（有序投影+计数；null summary→空）——desktop-chat 107/107、Desktop check 0/0、Desktop build 通过。改动仅限桌面端，复用既有端点。

### Molibot macOS App Phase 4 首次启动——Provider 提交/验证
- **外部渠道会话右侧展示**：修复了点击左侧“外部渠道”会话时内容依然挤在窄侧边栏展示的问题。现将外部渠道的 transcript 统一呈现在右侧主对话视口 `.messages` 中，复用了 Markdown 渲染与附件芯片样式；并在底部展示只读提示横幅，保证外观和操作逻辑与本地对话完全一致。同时移除了侧栏的临时 `.external-transcript-panel`。
- **输入框区域置底固定与消息滚动**：修复了 ChatView 消息较多时或搜索栏开启时，底部输入框区域 `.composer-wrap` 会随页面内容向上滚走的问题。将 `.chat-content` 主容器升级为 `display: flex; flex-direction: column; height: 100%; min-height: 0;`（`min-height: 0` 强行约束高度），并将 `.messages` 设置为 `flex: 1; min-height: 0;`。这确保无论是在普通对话、搜索栏开启还是特殊状态提示下，消息区域都可以在高度内自动滚动，而头部和输入框永远稳固钉在界面两端。
- **列表滑动翻页修复**：修复了 macOS App 内所有长列表在小屏幕或内容溢出时无法使用鼠标滑轮滚动的体验问题。对 `.settings-content` 配置了 `overflow-y: auto` 并设置了 padding-bottom 留空；将 `.settings-footbar` 保存栏改为 `position: sticky; bottom: 0` 粘性置底；使 `.chat-sidebar` 与 `.settings-sidebar` 支持 `overflow-y: auto` 滚动；限制外部会话列表 `.external-list` 与文件列表 `.file-list` 容器高度并启用垂直滚动；对首启引导卡片 `.onboarding-card` 限制最大高度并支持滚动。
- **可工作的首个步骤**：§9.2 onboarding 的 Provider 配置步骤不再是占位说明。新增了 Provider 提交和真实连接测试的完整功能闭环。
- **安全设计与 API**：
  - 新增服务端 `/api/desktop/providers` [POST] 及纯函数 `buildNewCustomProvider`：接收 Provider 配置，创建带有 `desktop-` 唯一时间戳 ID 的 CustomProvider，自动配置 text model 并将 `providerMode` 切为 `"custom"`。API Key 仅本地安全保存，不在任何接口响应中泄露。
  - 新增服务端 `/api/desktop/provider-test` [POST]：接收 `providerId`，从服务端读取 API 密钥后，调用已有的真实 `testCustomProvider` 执行远程连接验证。密钥绝不传回 WebView。
  - 新增客户端 API `submitDesktopProvider` 与 `testDesktopProvider`。
- **UI 与交互**：ChatView 首启引导中移除 deferred 延期占位，增加了「保存 Provider」与「验证连接」的操作流程与 loading/success/error 响应式状态。Next 按钮现被 `providerSubmitted` 状态门控，要求成功保存后才能继续，但不强制连接成功（允许进入主界面/设置排障）。
- **能力授权**：在 Tauri `default.json` 权限配置中，将 `/api/desktop/provider-test` 的 loopback 访问权限注册到 scopes，保证请求的安全发起。
- **验证**：新增 `desktopProviderSubmit.test.ts` (5个服务端用例，验证构造合法性与 credentials 隔离不泄露)；`api.test.ts` 新增 2 例 mock-fetch 用例。全部 105 个桌面测试通过，`svelte-check` 0 错误/0 警告。

### Molibot macOS App Phase 4 首次启动——登录启动步骤
- **可工作的第四步**：§9.2 onboarding 的「登录启动」不再是占位说明。它复用现有 Tauri `tauri-plugin-autostart` / macOS LaunchAgent 与 `set_login_start(enabled)` 命令，通过 App→Chat 显式异步回调展示默认关闭的双语 Switch、保存中状态、实际返回状态和错误；浏览器预览只更新内存，不写 OS scheduler。
- **精简修复流程**：新增 `resolveOnboardingStartStep` 与 `resolveOnboardingRepairTarget`。已有模型但缺 Web Profile 的损坏配置直接从 Agent 步骤开始；引导锁定初始 `new/usable/broken` 模式和缺失目标，Agent 保存使 readiness 变为可用后仍继续 Channels→Launch→Diagnostics，且顶部提示不会错误翻转。
- **验证**：desktop-chat 回归 98/98、Rust 8/8、Desktop Svelte check、Desktop production build、现有 Web production build通过。隔离临时数据页面验证到第 4 步：默认关闭、可访问 `role=switch`、中英状态文案和完整修复路径均真实渲染。

### Molibot macOS App Phase 4 首次启动——Agent / Web Profile 确认
- **可工作的第二步**：§9.2 onboarding 的 Agent 步骤不再显示占位说明。Desktop 从既有 credential-safe `/api/desktop/agents` 与 `/api/desktop/profiles` 读取已启用 Agent 和 Web Profile，提供双语选择器、保存中/成功/错误状态；只有确认保存成功后才可进入下一步。若确认时 Chat 尚无活动 Profile，成功启用后会立即走既有 `loadProfile` 会话路径，避免完成引导后输入区仍未连接。
- **细粒度安全保存**：`DesktopWebProfilePatch` 与 `/api/desktop/profiles` PATCH 新增可选 `agentId`，服务端校验目标 Agent 存在，只更新指定 Web Profile 的 `agentId`/`enabled`，保留 credentials、allowedChatIds、sandbox override、显示配置、其他 Profile 和其他渠道。未知 Agent 会拒绝且不修改设置。
- **响应式与验证**：onboarding 标题、提示、步骤名和步骤计数改为显式 `$:` 派生状态，移除模板中的无参数 helper。完整 desktop-chat 回归 96/96、Desktop Svelte check、Desktop production build、现有 Web production build 通过；隔离临时数据页面 smoke 已验证中文修复分支与五步布局。Profile 创建仍由 Settings 完成；Launch 已在后续切片交付，Provider 提交/验证及 Channels/Diagnostics 继续后续实现。

### Molibot macOS App Phase 4 引导健康检查摘要
- **既有配置健康检查**：首次启动引导的 `usable` 分支（已存在可用配置）现展示「迁移和健康检查摘要」卡片（计划 §9.1「已存在可用 Provider/模型：显示一次迁移和健康检查摘要」）：两行分别列出检测到的文本模型（标签或「未配置」）与 Web Profile 数量（或「未启用」），加一行就绪/未就绪状态。由新增纯函数 `buildOnboardingHealthCheck(readiness, labels)` 构建（locale 无关、标签可注入），卡片边框/状态颜色反映就绪状态，文本标签承载含义（§14 状态不仅靠颜色）。
- **验证边界**：新增 api 单测 1 例（ready + 缺模型 + 缺 Profile 三分支）——desktop-chat 套件 93/93、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。复用已加载的 readiness 数据，无需新端点。

### Molibot macOS App Phase 4 引导式首次启动——Provider 步骤
- **多步引导流**：首次启动引导覆盖层在 `new`/`broken` 配置下升级为 §9.2 五步引导：provider → agent → channels → launch → diagnostics。含步骤指示（`Step n/total`）、有序步骤列表（active/done 状态）、上一步/下一步/完成导航，末步显示「完成」。`usable` 配置仍保留简单摘要 + 继续。
- **凭据盲的 Provider 草稿表单**：provider 步渲染表单（名称、协议、Base URL、模型、API Key），由新增纯函数 `validateProviderDraft` 实时校验（仅结构：名称/模型非空、已知协议、http(s) Base URL、apiKeyPresent）。API Key **绝不存入草稿**——仅 `apiKeyPresent: boolean`；密钥只活在输入框，提交/验证明确标注将在后续版本接入（需桌面端令牌 §11.1）。下一步在草稿未通过校验时禁用。
- **纯函数可测**：新增 `ONBOARDING_STEPS`（有序）、`OnboardingStep`、`ProviderDraft`/`ProviderDraftValidation`、`validateProviderDraft`（不联网、不处理密钥）、`advanceOnboardingStep`。双语 i18n（步骤标签、字段标签、已输入/未输入、上一步/下一步/完成、步骤模板、提交延期说明）与语义化 CSS（`.onboarding-steps`/`.onboarding-field`/`.onboarding-error`）。
- **验证边界**：新增 api 单测 3 例（`validateProviderDraft` 接受完整草稿 + 拒绝各缺失字段 + 错误 URL；`ONBOARDING_STEPS` 顺序；`advanceOnboardingStep` 前进与末步返回 null）——desktop-chat 套件 92/92、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。Provider 提交/验证、agent/channels/launch/diagnostics 步骤表单与真机 smoke 留作后续切片（需桌面端令牌 + 服务端创建/验证路由或运行服务）。

### Molibot macOS App Phase 4 运行环境设置区
- **只读依赖检测展示**：Settings 新增「运行环境」区（位于「诊断」之后），提供计数卡片（已安装 / 未安装 / 总数）与每行一条可选依赖：名称、状态徽标（已安装/未安装/未知）、用途、版本、来源、预计体积，以及 `<code>` 块中的准确安装命令。底部说明「安装功能将在后续版本提供逐项授权安装」——本区仅检测/展示，不执行安装（计划 §10「用户逐项明确授权，禁止静默安装」）。Node 因已由内置 sidecar 满足而故意省略。
- **服务端检测**：新增 `desktopRuntimeEnv.ts`，含 `DESKTOP_RUNTIME_DEPENDENCIES` 声明表（ffmpeg/git/python3）、可注入的 `detectRuntimeDependency`（经 `command -v` 解析、按解析路径判别 homebrew vs system 来源、探测版本、永不抛错）、纯 `buildDesktopRuntimeEnvSummary`/`buildDesktopRuntimeDependency` 映射器，以及 `formatRuntimeInstallCommand`（homebrew → `brew install <formula>`；tooling → `pip install --target ~/.molibot/tooling`；禁 `sudo`、禁 `npm -g`、禁改系统 Python）。映射器丢弃解析出的二进制路径，仅保留来源类别（§11 不变式，逐字段构建）。新增 `/api/desktop/runtime-env` GET 与契约类型。
- **验证边界**：新增服务端 `desktopRuntimeEnv.test.ts` 7/7（安装命令格式化 homebrew/tooling/system；缺失检测；homebrew vs system 来源判别；映射器投影展示字段并丢弃解析路径；空来源回退；summary 计数与声明顺序；声明依赖无 sudo/npm -g），api 单测新增 1（`missingRuntimeDependencies` 仅返回未安装项）——desktop-chat 套件 89/89、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/runtime-env` 已加入 Tauri HTTP capability scope（127.0.0.1 + localhost）。真机检测 smoke 与逐项授权安装执行（PATH 恢复、实时日志、取消/重试）留作后续 §10 切片。

### Molibot macOS App Phase 4 首次启动引导覆盖层
- **三分流引导**：ChatView 在服务就绪后展示一次性、由 localStorage 门控的引导覆盖层（`molibot-desktop-first-launch-seen`）。通过新增纯函数 `classifyFirstLaunch` 将就绪摘要分为计划 §9.1 三分支：`new`（无模型且无 Profile → 完整配置引导）、`usable`（两者皆有 → 可直接对话的摘要）、`broken`（仅有一项 → 指明缺失项的精简修复引导，不覆盖既有配置）。每个分支含「打开设置」按钮；`usable` 另含「继续」，`new`/`broken` 另含「不再提示」。任一操作写入 seen 标志，覆盖层不再出现。
- **纯客户端可测**：`classifyFirstLaunch` 为纯函数，双语 i18n（`onboardingTitleNew/Usable/Broken`、`onboardingHintNew/Usable/BrokenModel/BrokenProfile`、`onboardingContinue`、`onboardingDontShowAgain`）与语义化 CSS（`.onboarding-overlay`/`.onboarding-card`/`.primary-button`，遵循 DESIGN.md，无裸 Tailwind）。`new` 分支不显示「继续对话」主操作，符合 §9.1「全新安装不得假装配置完成」。
- **验证边界**：新增 api 单测 1 例（覆盖 usable / new（空 + null 模型）/ broken-model / broken-profile 四分支）——desktop-chat 套件 81/81、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。覆盖层的真机行为（真实就绪数据、真实设置导航）需运行服务 smoke。完整 §9.2 引导式 provider/agent/渠道配置与 §9 既有配置迁移摘要留作后续切片。

### Molibot macOS App Phase 3 外部渠道只读 transcript 面板
- **只读 transcript 查看**：在「外部渠道」分页中点击某条外部会话，通过新增的 `/api/desktop/external-sessions/[id]` GET 加载只读 transcript，在侧栏内嵌面板渲染：标题 · 会话类型 · 渠道 的头部（含关闭按钮），随后逐条展示消息（角色标签、Markdown 渲染内容、附件名）。无输入框、无重命名、无删除、无归档，外部 transcript 保持只读（计划 §7.2「支持查看…当前 transcript」）。重复点击当前行无操作；切回「本地」清空面板。
- **服务端契约**：新增 `SessionStore.getExternalSession(id)`（按 id 解析单条非 web 会话，web/未知/陈旧返回 null）与凭据/路径安全的 `/api/desktop/external-sessions/[id]` GET，经 `buildDesktopExternalTranscript` + `buildDesktopExternalTranscriptMessage` 投影。映射器复用列表的会话投影，并逐字段显式投影消息——**丢弃** 附件的磁盘 `local` 路径（外部附件无法经 Web 文件端点预览，仅保留 original/mediaType/mimeType/size），**过滤掉 `system` 角色消息**（控制指令不得作为普通 transcript 呈现，计划 §12）。新增 `DesktopExternalTranscript`/`DesktopExternalTranscriptMessage`/`DesktopExternalTranscriptResponse` 到共享契约。
- **验证边界**：服务端 `desktopExternalSessions.test.ts` 增至 9/9（新增：transcript 消息丢弃 local 路径并过滤 system；transcript 投影元数据与有序非 system 消息），api 单测新增 1（`groupExternalTranscriptByRole` 计数）——desktop-chat 套件 80/80、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/external-sessions/*` 已加入 Tauri HTTP capability scope（127.0.0.1 + localhost）。真实渠道数据实机 transcript smoke 留作后续。§7.3 实时事件流与统一审批中心留作后续 Phase 3 切片。

### Molibot macOS App Phase 3 外部渠道只读视图
- **本地/外部分页**：ChatView 侧栏新增「本地 / 外部渠道」分页切换。选择「外部渠道」时通过新增的 `loadDesktopExternalSessions` 客户端 loader 加载 `/api/desktop/external-sessions`，按渠道分组只读展示外部会话——每行含渠道徽标、会话类型（私聊/群聊/频道）、可选 Bot 实例/发送者、更新时间。无输入框、无重命名、无删除、无归档，外部 transcript 保持只读（计划 §7.2）。连接后加载一次，切页时懒加载；空/加载中/错误状态内联处理。
- **可测试的纯函数**：新增 `groupExternalSessionsForView`（将分组 summary 展平为有序视图列表，保持服务端分组与最新优先顺序）与 `formatExternalSessionPreview`（生成 `Bot 实例 · 线程 · 发送者` 紧凑预览）。新增双语 i18n（`externalChannels`、`externalChannelsHint`、`noExternalSessions`、`chatTypePrivate/Group/Channel`）与语义化 CSS（`.view-tabs`/`.view-tab`/`.external-*`，遵循 DESIGN.md，无裸 Tailwind 工具类）。
- **验证边界**：新增 api 单测 3 例（分组展平保序并携带展示字段；空 summary；预览拼接 Bot 实例/线程/发送者并降级为空）——desktop-chat 套件 77/77、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 复确认、桌面机器路径扫描干净。改动仅限桌面端，无 Web/server 源码变更。真实外部会话列表实机 smoke 与只读 transcript 面板 / 实时事件流（§7.3）留作后续 Phase 3 切片。

### Molibot macOS App Phase 3 外部渠道会话聚合（列表/契约起步）
- **共享 session 元数据扩展**：在共享 `Conversation` 类型上新增向后兼容的可选 `external?: ExternalSessionMetadata`（Bot 实例 id/名称、发送者 id/名称/头像、会话类型 private·group·channel、线程 id/标题、来源平台），供渠道适配器后续填充；旧记录缺失时省略该字段，符合计划 §7.2「现有 session schema 需要向后兼容地增加可选元数据」。元数据定义置于共享 session 层而非渠道代码。
- **外部会话枚举**：`SessionStore` 新增 `listExternalSessions()`，遍历 legacy session 索引，跳过 `web`，按 `updatedAt` 倒序加载每个非 web 会话文件，并跳过索引中文件已缺失的陈旧条目。
- **凭据安全的只读聚合端点**：新增 `/api/desktop/external-sessions` GET，经 `buildDesktopExternalSessionsSummary` + `buildDesktopExternalSession`（`desktopExternalSessions.ts`）按 telegram/feishu/qq/weixin 已知顺序分组（排除 `web` 与 `cli`），每个会话仅投影展示字段——id、标题、updatedAt、会话类型、发送者名、可选头像/线程标题/Bot 实例名、平台。原始 `externalUserId` 经 `maskExternalUserId` 截断为 8 字符预览（完整平台 id 不抵达 WebView），列表从不加载消息内容，旧记录无元数据时回退为 `chatType=private` / `senderName=掩码 id` / `platform=渠道`（计划 §7.2「旧记录缺失元数据时使用稳定 fallback，不回头批量请求平台补全」）。
- **验证边界**：新增服务端 `desktopExternalSessions.test.ts` 7/7（掩码截断+直通；缺失元数据回退为掩码 id+私聊且原始 id 不泄露；元数据投影；空标题+空发送者回退；分组按已知渠道排序且排除 web/cli；空 summary；渠道内顺序保持），`store.test.ts` 新增 `listExternalSessions` 用例（2 个 telegram 会话按最新优先排序、排除 web、暴露 externalUserId/channel）——desktop-chat 套件 74/74、Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/external-sessions` 已加入 Tauri HTTP capability scope（127.0.0.1 + localhost）。真实渠道数据实机 smoke 留作后续。只读 transcript 视图、实时事件流（§7.3）、统一审批中心与通知留作后续 Phase 3 切片。

### Molibot macOS App Phase 5 GitHub Actions unsigned-DMG 发布流水线
- **可复现的 unsigned-beta 构建流水线**：新增 `.github/workflows/desktop-release.yml`（仓库首个 CI 流水线），按计划 §16.1 / Phase 5 在 `macos-14`（Apple Silicon）runner 上产出 unsigned DMG。触发方式：推送 `molibot-v*` tag（发布 prerelease GitHub Release）与 `workflow_dispatch`（仅构建冒烟，不发布）。
- **构建步骤**：Setup Node 22 + stable Rust，缓存 Cargo，安装根目录与 `apps/desktop` 依赖，执行 `npm run desktop:build`（= 准备内嵌 Node 22.23.1 sidecar runtime → `tauri build --ci`（`tauri.bundle.conf.json`）→ `finalize-desktop-release.mjs` 写 `.sha256`）。随后生成 BUILD-INFO 清单（版本、git commit/ref、构建时间、runner OS/arch、Node/Rust 版本、macOS 13.0 部署目标、内嵌 sidecar Node 版本、明确的 unsigned/未公证说明），上传 `molibot-desktop-dmg` workflow artifact，并在 tag 推送时通过 `softprops/action-gh-release@v2` 发布含 DMG + `.sha256` + 清单的 prerelease（自动生成 release notes）。`MACOSX_DEPLOYMENT_TARGET=13.0` 与 bundle `minimumSystemVersion` 一致。
- **验证边界**：仅配置改动，未触及 Web/server 运行时代码，故无 Web 回归；YAML 已校验（11 步、`runs-on: macos-14`）。真实 DMG 生产仍需真实 macOS runner（受限沙箱无法运行 `hdiutil`/`tauri build`），端到端验证留待真实 `molibot-v*` tag 构建或 `workflow_dispatch` 运行。`molibot-v*` tag 与现有服务端/Web 产品的 `v*` tag 分离，保持发布语义不混淆。

### Molibot macOS App Phase 4 渠道设置区
- **只读渠道展示**：Settings 新增「渠道」区（位于「内存」之后），提供计数卡片（实例总数 + 已启用）与按外部渠道分组：每组一个子标题（`渠道 · 已启用/总数`）外加每个 Bot 实例一行，显示名称、关联 Agent、放行会话数、沙箱覆盖（继承/是/否）、启用/禁用状态徽标（文本+颜色，符合 §14）。Web 渠道排除在外（已有独立的 Web Profiles 区）（计划 §8 Telegram/Feishu/QQ/Weixin）。
- **凭据安全**：新增 `/api/desktop/channels` GET，经 `buildDesktopChannelsSummary` + `buildDesktopChannelInstance` 投影 runtime 设置。映射器过滤掉 `web` 渠道，已知渠道（telegram/feishu/qq/weixin）优先排序，每个实例保留 id/name/enabled/agentId、三态沙箱覆盖、`allowedChatCount`，**整体丢弃** 实例 `credentials`（Bot Token / App 密钥）并将 `allowedChatIds` 降为计数——渠道密钥不抵达 WebView。
- **验证边界**：新增服务端 `desktopChannels.test.ts` 3/3（实例丢弃 credentials 并将 allowedChatIds 降为计数——断言 `SECRET-BOT-TOKEN`/`sk-secret-app`/`credentials` 不泄露；summary 排除 web、已知渠道优先排序、统计实例；缺失沙箱覆盖→继承），desktop-chat 套件 65/65（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含夹具 Bot Token/App 密钥以证明映射器会剥离。`/api/desktop/channels` 已加入 Tauri HTTP capability scope。真实 Bot 实例实机 smoke 留作后续。编辑渠道实例/凭据与实时连接状态留作后续（后者属 Phase 3 外部渠道聚合）。

### Molibot macOS App Phase 4 内存设置区
- **只读内存状态展示**：Settings 新增「内存」区（位于「Skills」之后），提供状态卡片（运行时启用、配置启用、后端名称）与能力卡片（混合检索、向量检索、增量刷新、分层记忆），每项为 yes/no 徽标（文本+颜色，符合 §14）。仅读取后端状态，绝不读取任何记忆内容（计划 §8「内存」）。
- **隐私安全**：新增 `/api/desktop/memory` GET，经 `buildDesktopMemorySummary` 将 `settings.plugins.memory`（enabled/backend）与运行时 `runtime.memory.isEnabled()`、`runtime.memory.capabilities()` 组合。记忆记录含用户内容，故映射器刻意从不 list/search 记录——只暴露后端名称、配置/运行时启用标志与四个能力标志。
- **验证边界**：新增服务端 `desktopMemory.test.ts` 2/2（映射 config + 运行时状态 + 能力标志；内存配置缺失时回退为禁用/空后端），desktop-chat 套件 62/62（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/memory` 已加入 Tauri HTTP capability scope。真实后端实机 smoke 留作后续。查看/编辑/删除记忆记录不在范围内（记录内容属用户数据）。

### Molibot macOS App Phase 4 Skills 设置区
- **只读 Skill 展示**：Settings 新增「Skills」区（位于「MCP」之后），提供计数卡片（总数 / 已启用 / 按作用域 global·bot·chat）与技能搜索状态（本地启用徽标、API 服务商/模型），以及每行一条 Skill 记录：名称、描述、作用域、归属 bot/chat、MCP 服务器数、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「Skills」）。
- **路径与凭据安全**：新增 `/api/desktop/skills` GET，复用共享 skills 路由的 GET（其忽略 RequestEvent，故传 `undefined`），再经 `buildDesktopSkillsSummary` + `buildDesktopSkillItem` 投影。映射器保留 name/description/scope/enabled/botId/chatId 并将 `mcpServers` 降为计数，**丢弃** 每个 skill 的 `filePath` 与 `baseDir`（绝对磁盘路径），以及路由的 `dataRoot`/`globalSkillsDir`/`diagnostics`/原始 `searchProviders`；`skillSearch` 仅保留 local/api 启用标志与 api provider/model，**丢弃** 技能搜索的 `api.apiKey`——磁盘路径与搜索密钥均不抵达 WebView。
- **验证边界**：新增服务端 `desktopSkills.test.ts` 3/3（item 丢弃 filePath/baseDir 并将 mcpServers 降为计数——断言 `/Users/secret`/`filePath`/`baseDir` 不泄露；未知 scope 归 global；summary 按作用域计数并丢弃技能搜索 api key——断言 `sk-secret-search-key` 不泄露），desktop-chat 套件 60/60（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `/Users/secret/...` 夹具路径与搜索 api key 以证明映射器会剥离。`/api/desktop/skills` 已加入 Tauri HTTP capability scope。真实技能文件实机 smoke 留作后续。启用/禁用 Skill、查看 SKILL.md 内容与技能草稿管理留作后续切片。

### Molibot macOS App Phase 4 MCP 设置区
- **只读 MCP 展示**：Settings 新增「MCP」区（位于「Agent」之后），提供计数卡片（总数 / 已启用 / stdio / http）与每行一条服务器记录：传输方式、命令（stdio）或 URL（http）、参数/env/请求头数量、可选工具名前缀、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「MCP」）。
- **凭据安全**：新增 `/api/desktop/mcp` GET，经 `buildDesktopMcpSummary` + `buildDesktopMcpItem` 投影 runtime 设置。映射器保留 id/name/enabled/transport/toolNamePrefix 与可识别的 `command`（stdio）/`url`（http），并将携带密钥的字段一律降为计数——stdio 的 `env` 值、`cwd`（绝对路径）、`args` 值（可能含内联 token），以及 http 的 `headers` 值（鉴权 token）——WebView 永远拿不到 MCP 凭据。
- **验证边界**：新增服务端 `desktopMcp.test.ts` 3/3（stdio 保留 command 但 env/cwd/args 降为计数——断言 `sk-secret-env-value`/`SECRET-ARG`/`/Users/secret` 不泄露；http 保留 url 但 headers 降为计数——断言 `sk-secret-header-token` 不泄露；summary 计 total/enabled/stdio/http 且无密钥泄露），desktop-chat 套件 57/57（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含夹具密钥/路径以证明映射器会剥离。`/api/desktop/mcp` 已加入 Tauri HTTP capability scope。真实服务器实机 smoke 留作后续。新增/编辑/删除 MCP 服务器与查看逐服务器工具列表留作后续切片。

### Molibot macOS App Phase 4 Agent 设置区
- **只读 Agent 展示**：Settings 新增「Agent」区（位于「AI 服务商」与「Web Profiles」之间），提供计数卡片（总数 + 已启用）与每行一条 Agent 记录：名称、描述、沙箱覆盖（继承/是/否）、逐 Agent 模型路由覆盖数、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「Agent」）。
- **窄契约投影**：新增 `/api/desktop/agents` GET，经 `buildDesktopAgentsSummary` + `buildDesktopAgentItem` 投影 runtime 设置。Agent 不含服务商密钥，故映射器并非"丢弃敏感字段"而是投影一个窄的展示形状——id/name/description/enabled、三态 `sandboxEnabled`（继承时为 null）、以及由 agent `modelRouting`（text/vision/stt key）推导的 `modelOverrides` 计数——而非把完整 settings 对象交给 WebView。
- **验证边界**：新增服务端 `desktopAgents.test.ts` 3/3（投影展示字段并计 1 个模型覆盖；缺失 routing/sandbox 时计 0 覆盖/继承；summary 计 total + enabled），desktop-chat 套件 54/54（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/agents` 已加入 Tauri HTTP capability scope。真实配置实机 smoke 留作后续。创建/编辑/删除 Agent 与逐 Agent 模型路由编辑留作后续切片。

### Molibot macOS App Phase 4 语言选择持久化与跨窗口同步
- **语言偏好持久化**：Settings 语言下拉的选择现经 `normalizeLocale` 校验后写入 `localStorage`，重启后保留；此前仅在内存生效、重启重置（计划 §8「支持中文和英文即时切换」）。
- **跨窗口实时同步**：Chat 与 Settings 两个 WebView 同源共享存储，通过 `storage` 事件实时同步语言切换，两窗保持一致；与既有主题处理一致。
- **验证边界**：新增 `normalizeLocale` 纯函数及单测（已知 locale + zh 变体映射 + fallback）；desktop-chat 套件 51/51、Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端、纯客户端，无服务端变更。

### Molibot macOS App Phase 4 Desktop Settings 起步：模型路由
- **多区设置导航**：Settings 窗口从单一「通用」扩展为可切换的左侧导航，新增「模型」区，沿用现有固定底栏、中英即时切换、Light/Dark/System 和紧凑布局；不嵌入现有 `/settings` 页面。
- **凭据安全的模型配置**：「模型」区按 text/vision/stt/tts/subagent 五条能力路由各提供一个下拉，复用现有 `/api/desktop/models`（现扩展为接受 `route` 参数，向后兼容默认 `text`）即时切换并与 Web 共享；返回项仅含 key/label/contextWindow，绝不向 WebView 暴露 Provider API key 或 Base URL，符合计划 §8/§11 的细粒度复用与凭据掩码要求。
- **验证边界**：服务端新增 `sanitizeDesktopModelRoute` 与路由化 `buildDesktopModelState` 单测（含五路由不泄漏凭据断言，desktop-chat 套件 20/20）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、**现有 Web production build 回归通过**、机器路径扫描干净。`/api/desktop/models` 改动为附加且向后兼容（ChatView 不传 route 仍走 text）。真机内 Settings 实操 smoke 待运行服务环境补充。

### Molibot macOS App Phase 4 环境就绪摘要
- **就绪健康卡片**：Settings「通用」区在服务就绪后展示「环境就绪」卡片，按文本模型与 Web Profile 两项给出「就绪/未配置」状态徽标与修复提示；为计划 §9 首启分流（全新/已有可用/损坏配置）提供凭据安全的判定信号。
- **纯客户端派生**：就绪状态由 `summarizeDesktopReadiness` 从现有 `/api/desktop/bootstrap`（Profile 列表）与 `/api/desktop/models`（文本路由 currentKey/options）派生，无新增服务端接口，不向 WebView 暴露任何 Provider 凭据；状态徽标同时用文字表达，不只靠颜色（§14）。
- **验证边界**：新增 `summarizeDesktopReadiness` 纯函数及单测（api 套件覆盖有/无模型与 Profile，desktop-chat 套件 22/22）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端，无服务端变更，故无需 Web 回归；真机内 Settings 实操 smoke 待运行服务环境补充。

### Molibot macOS App Phase 4 Chat 首启分流（无可用模型引导）
- **不阻断的修复引导**：当本地服务就绪、已有 Web Profile，但未配置可用文本模型时，Chat composer 上方显示橙色引导横幅（标题 + 提示 + 「打开设置」按钮），并禁用附件、输入框与发送，避免「假装配置完成」；保留已有 transcript 历史可见，符合计划 §9「配置存在但不可用：精简修复引导」与「没有可用模型时...允许进入 Settings 排障」。
- **复用就绪判定**：`modelReady` 由上轮的 `summarizeDesktopReadiness` 从 ChatView 已加载的文本模型 `currentKey/options` 派生；`sendMessage` 增加 `!modelReady` 守卫，双重防止无模型时发送。无新增接口、无凭据暴露。
- **验证边界**：复用已测的 `summarizeDesktopReadiness`，本切片新增逻辑为模板绑定（派生态 + 横幅 + 禁用条件），由 Svelte check 与 production build 覆盖（desktop-chat 套件 22/22，0 错误/警告，build 通过，机器路径干净）。改动仅限桌面端，无服务端变更。

### Molibot macOS App Phase 4 诊断设置区
- **本地诊断视图**：Settings 新增「诊断」区，只读展示服务版本、服务所有权（由 Molibot 管理 / 外部服务）、本地 loopback 地址与连接状态；数据全部来自现有 `desktop_status`，不含任何 Provider 凭据或 token，符合计划 §11.3 与 §16.1。
- **脱敏复制**：提供「复制诊断信息」按钮，经 `buildDiagnosticsSummary` 生成仅含非敏感运行事实的多行文本写入剪贴板，复制后短暂显示「已复制」。
- **验证边界**：新增 `buildDiagnosticsSummary` 纯函数及单测（含缺失值 fallback 断言，desktop-chat 套件 23/23）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端，无服务端变更。完整轮转日志与诊断包导出（§11.3）需原生文件写入，留作后续切片。

### Molibot macOS App Phase 4 显式主题切换（System/Light/Dark）
- **主题选择落地**：Settings「通用」区新增「外观」下拉（跟随系统 / 浅色 / 深色），默认跟随系统，补齐计划 §8「支持 Light、Dark、System，默认跟随系统」此前缺失的显式选择能力；此前仅靠 `@media (prefers-color-scheme)` 跟随系统。
- **持久化与跨窗口同步**：选择经 `normalizeTheme` 校验后写入 `localStorage` 并设置 `document.documentElement[data-theme]`；Chat 与 Settings 两个 WebView 同源共享存储，通过 `storage` 事件实时同步，重启后保留。CSS 重构为：显式 `:root[data-theme="dark"]` 始终深色、显式浅色保持浅色、未显式选择时 `:not([data-theme])` 仍跟随系统暗色媒体查询。
- **验证边界**：新增 `normalizeTheme` 纯函数及单测（已知值 + 非法值 fallback，desktop-chat 套件 24/24）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、机器路径扫描干净。改动仅限桌面端，无服务端变更。


### Molibot macOS App Phase 4 任务设置区
- **只读任务展示**：Settings 新增「任务」区，提供计数卡片（总数、按类型/状态/范围）与每行一条任务记录：channel/bot/chat、类型、调度文本+时区、状态、运行次数、上次触发时间、最近错误（计划 §8「任务」）。
- **凭据与路径安全**：新增 `/api/desktop/tasks` GET，复用共享 tasks 路由的 GET（其忽略 RequestEvent，故传 `undefined`），再经 `buildDesktopTaskSummary` 投影。映射器保留 channel/botId/chatId/scope/type/delivery/scheduleText/timezone/status/statusReason/lastError/runCount/时间戳/sessionMode，**丢弃** `text`（任务 prompt，可能含用户密钥）与 `filePath`（绝对磁盘路径），也丢弃 web 端的 `dataRoot`/`diagnostics`。未知 type/status 归为 `one-shot`/`pending`。
- **验证边界**：新增服务端 `desktopTasks.test.ts` 3/3（item 丢弃 text/filePath 但保留调度元数据——断言 `API key`/`/Users/secret`/`filePath`/`text` 不泄露；未知 type/status 归默认；summary 按 type/status/scope/channel 计数且无 text 泄露），desktop-chat 套件 47/47（本切片无新客户端纯函数——`taskTypeLabel`/`taskStatusLabel` 为类型化 i18n 取值）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `/Users/secret/.../task-123.json` 夹具 `filePath` 与敏感 `text` 以证明映射器会剥离。`/api/desktop/tasks` 已加入 Tauri HTTP capability scope。真实任务的实机 smoke 留作后续。创建/编辑/触发/删除任务留作后续切片。


### Molibot macOS App Phase 4 AI 服务商设置区
- **只读服务商展示**：Settings 新增「AI 服务商」区，提供模式卡片（服务商模式 + 内置 Pi 服务商/模型）与每行一条自定义服务商记录：名称（含默认标记）、协议 + baseUrl、模型数 + 默认模型、API Key 是否已配置、启用/禁用状态徽标（文本+颜色，符合 §14）（计划 §8「AI Provider/模型路由」）。
- **凭据安全**：新增 `/api/desktop/providers` GET，经 `buildDesktopProvidersSummary` + `buildDesktopProviderItem` 投影 runtime 设置。映射器保留 providerMode/piModelProvider/piModelName/defaultCustomProviderId，以及每个自定义服务商的 id/name/enabled/isDefault/protocol/baseUrl/modelCount/defaultModel，**丢弃** `apiKey`（服务商密钥，改为 `hasApiKey` 布尔值）、各模型 verification 细节与 reasoning-effort 映射——WebView 永远拿不到服务商密钥。
- **验证边界**：新增服务端 `desktopProviders.test.ts` 3/3（item 丢弃 apiKey 但保留身份/端点/模型数——断言 `sk-super-secret-key`/`apiKey` 不泄露；报告缺失 key + 非默认 + anthropic 协议；summary 映射模式/pi 模型且不泄露 key），desktop-chat 套件 51/51（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/providers` 已加入 Tauri HTTP capability scope。真实配置的实机 smoke 留作后续。创建/编辑/测试/删除服务商与逐模型路由编辑留作后续切片。

### Molibot macOS App Phase 4 Host Bash 设置区
- **审批状态与白名单**：Settings 新增「Host Bash」区，提供计数卡片（待审批、白名单已启用/总数、历史记录）与白名单列表。每行展示工具 id、显示名、原因、审批模式与权限摘要（文件系统/网络/env 数量）及启用/禁用开关（计划 §8「Host Bash」）。
- **凭据安全**：新增 `/api/desktop/host-bash` GET + POST（`toggle_whitelist` 复用 `hostBashStore.setWhitelistEnabled`），由 `buildDesktopHostBashSummary` + `buildDesktopHostBashWhitelistItem` 映射，保留 id/toolId/displayName/reason/approvalMode/enabled/approvedAt 与权限摘要（envAllowlist 归约为计数），**丢弃** `command`（shell 命令）、原始 env-allowlist key 名、channel/chatId/scopeId、approvedFromRecordId——桌面白名单列表永远看不到实际命令或 env 变量名。pending/history 归约为计数。
- **验证边界**：新增服务端 `desktopHostBash.test.ts` 2/2（白项丢弃 command/env key 名但保留身份/原因/模式/权限摘要——断言 `ls -la`/`/Users/secret`/`PATH`/`command` 不泄露；summary 计数 pending/whitelist/enabled/history 且无命令泄露），desktop-chat 套件 44/44（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `ls -la /Users/secret` 夹具命令以证明映射器会剥离。`/api/desktop/host-bash` 已加入 Tauri HTTP capability scope。真实 Host Bash 的实机 smoke 留作后续。删除白名单/历史条目与审批 pending 项留作后续切片。

### Molibot macOS App Phase 4 沙箱设置区
- **沙箱状态与诊断**：Settings 新增「沙箱」区，提供启用/禁用开关、初始化失败策略与环境变量继承模式；一张诊断卡片（平台支持、依赖可用、沙箱已初始化+错误、env 文件存在性+已注入/可用 key 计数）与一张网络/文件系统规则卡片（允许/拒绝计数）（计划 §8「沙箱」）。
- **凭据与路径安全**：新增 `/api/desktop/sandbox` GET + PATCH，由 `buildDesktopSandboxSummary` 复用 `getToolSandboxDiagnostics`，保留 enabled/initFailureMode/envInheritMode、network/filesystem 域规则与聚合诊断计数，**丢弃** `envFilePath`（绝对磁盘路径）、原始 env allow/deny key 列表以及逐 key 诊断数组（envKeys* 归约为计数）——env 变量名永不进入 WebView。PATCH 仅切换 `toolSandbox.enabled`，经 `{ ...current, enabled }` 保留其余字段。
- **验证边界**：新增服务端 `desktopSandbox.test.ts` 2/2（保留模式 + network/filesystem 规则 + 诊断计数但丢弃 envFilePath/env key 名——断言 `/Users/` 与 `SECRET_KEY` 不泄露；展示沙箱错误与缺失 env 计数），desktop-chat 套件 42/42（本切片无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试刻意含 `/Users/example/.../.env` 夹具 `envFilePath` 以证明映射器会剥离。`/api/desktop/sandbox` 已加入 Tauri HTTP capability scope。真实沙箱诊断的实机 smoke 留作后续。编辑 network/filesystem 允许/拒绝列表留作后续切片。

### Molibot macOS App Phase 4 Trace 设置区
- **只读 trace 聚合**：Settings 新增「Trace」区，按可选时间窗口（今天 / 昨天 / 近 7 天 / 近 30 天）展示运行 trace 聚合计数：一张范围卡片（窗口日期 + 时区）+ 一张总计卡片（事实数、运行数、工具调用含失败/拦截、模型调用含 token、技能使用含不同数、平均工具/模型耗时、覆盖 bots/channels/chats/sessions）（计划 §8「Trace」）。
- **凭据与内容安全**：新增 `/api/desktop/trace` GET，由 `computeDesktopTraceTotals` 从 `SqliteTraceStore.listRecentFacts` 只派生聚合计数与平均，**丢弃**原始 fact 记录——fact 携带 `payload`/`argsPreview`/`resultPreview`/`errorPreview`，可能含用户或命令内容，永不进入 WebView。web 端 `/api/settings/trace` 的 per-tool/skill/model/bot/session/run/chat 明细分组也一并省略，桌面卡片只需聚合。映射器自包含，未改动 web 代码。
- **验证边界**：新增服务端 `desktopTrace.test.ts` 3/3（`sanitizeDesktopTraceRange` 已知值+fallback；`resolveDesktopTraceWindow` last7Days 跨度=6 天；`computeDesktopTraceTotals` 计数 tools/models/skills/tokens/distinct/coverage 且断言 `errorPreview`/`argsPreview`/`private-model`/`payload` 不泄露），desktop-chat 套件 40/40（本切片复用已测的 `formatTokenCount`/`formatDurationMs`，无新客户端纯函数）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。`/api/desktop/trace` 已加入 Tauri HTTP capability scope。真实 fact 的实机 trace smoke 留作后续。

### Molibot macOS App Phase 4 运行历史设置区
- **只读运行历史**：Settings 新增「运行历史」区，列出近期运行——统计卡片（成功/部分/失败计数）加每行一条运行记录：结果徽标、bot/chat、创建时间+耗时+停止原因+是否回退模型、反思摘要、工具/失败工具列表（计划 §8「运行历史」）。
- **凭据与路径安全**：新增 `/api/desktop/run-history` GET，由 `buildDesktopRunHistoryItem` 映射，保留 runId/createdAt/botId/chatId/stopReason/durationMs/toolNames/failedToolNames/reflectionOutcome/reflectionSummary/nextAction/memorySelectedCount/usedFallbackModel，**丢弃** `workspaceDir`/`filePath`/`skillDraftPath`（绝对磁盘路径）、`finalText`（原始模型输出）、`modelFailureSummaries`、`explicitSkillNames`；路由也不再返回 web 端的 `dataRoot`/`diagnostics`。桌面列表永远看不到磁盘位置或 transcript 内容。
- **验证边界**：新增服务端 `desktopRunHistory.test.ts` 3/3（丢弃绝对路径与 finalText 但保留 timing/tools/reflection；未知 outcome 归为 failed；按 outcome 分组计数），desktop-chat 套件 37/37（新增 `formatDurationMs` 用例：亚秒/秒/分秒/NaN/负数兜底）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、桌面机器路径扫描干净。服务端测试文件刻意含 `/Users/example/...` 夹具路径以证明映射器会剥离（断言输出 `includes("/Users/")` 为 false）。`/api/desktop/run-history` 已加入 Tauri HTTP capability scope。真实运行记录的实机 smoke 留作后续。

### Molibot macOS App Phase 4 用量设置区
- **只读用量展示**：Settings 新增「用量」区，展示本地 AI 聚合用量——累计卡片（请求数 + 输入/输出/缓存读/缓存写/合计 tokens，附生成时间与时区）与四个时间窗口行（今天 / 昨天 / 近 7 天 / 近 30 天），每行显示请求数、合计 tokens 与日期区间（计划 §8「用量」）。
- **凭据安全与窄契约**：新增 `/api/desktop/usage` GET，由 `buildDesktopUsageSummary` 将 `UsageStatsResponse` 映射为稳定的 `DesktopUsageSummary`（timezone/generatedAt/totals/四个带 label 的窗口）。映射器刻意丢弃 `records`、`breakdowns` 与各窗口的 `models`/`bots` 数组——provider/model 名称与 bot id 不进入桌面端，用量卡只需聚合 token/请求数。
- **验证边界**：新增服务端 `desktopUsage.test.ts` 2/2（映射 totals + 四窗口有序；断言 `private-model`/`botId`/`records`/`breakdowns` 不泄露），desktop-chat 套件 33/33（新增 `formatTokenCount` 用例：千分位、四舍五入、NaN/负数兜底）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、机器路径扫描干净。`/api/desktop/usage` 已加入 Tauri HTTP capability scope。真实记录的实机用量 smoke 留作后续。

### Molibot macOS App Phase 4 Web Profile 设置区
- **Profile 列表与管理**：Settings 新增「Web Profile」区，列出全部已配置的 Web Profile（含已禁用），显示关联 Agent 名称，提供内联重命名（Enter 保存 / Esc 取消）与启用/禁用开关；当没有已启用的 Profile 时显示明确错误卡片，补齐 Chat「请先启用一个 Web Profile」空状态背后的可操作入口（计划 §8）。
- **凭据安全与窄契约**：新增只读 `/api/desktop/profiles` GET，仅返回 id/name/enabled/agentId/agentName/sandboxEnabled，绝不回显凭据或 allowed-chat 列表；PATCH 仅接受指定 id 的 `name` 和/或 `enabled`，由 `patchDesktopWebProfile` 仅覆盖这两个字段，原样保留 agentId、credentials、allowedChatIds、sandboxEnabled、display，避免凭据盲的桌面端开关抹除服务端配置。写入经 `runtime.updateSettings({ channels: { web: { instances } } })`，`sanitizeChannels` 按渠道深合并，其他渠道不动。
- **验证边界**：新增服务端 `desktopProfiles.test.ts` 4/4（含禁用 Profile + agentName 解析且凭据不泄露；patch 仅改 name/enabled 保留 agentId/credentials；拒绝未知 id；空名回退 id），desktop-chat 套件 30/30（新增 `hasEnabledWebProfile`、`sanitizeWebProfileName` 用例）；Desktop Svelte check 0 错误/警告、Desktop production build 通过、Web production build 通过（本切片触及服务端，已复跑 Web 回归）、机器路径扫描干净。`/api/desktop/profiles` 已加入 Tauri HTTP capability scope。创建/删除与关联 Agent 留作后续切片。

### Molibot macOS App Phase 1 服务运行时切片
- **共享单实例租约**：生产启动器、`molibot start` 与开发服务器统一使用 `DATA_DIR/runtime/service.lock`；活跃实例冲突会安全退出，失效租约可回收，状态文件只由持有者清理。测试全部使用临时数据目录。
- **真实发现与握手**：新增只读、版本化的 Desktop handshake，返回服务版本、实例 ID、所有权和 capability；Tauri 只探测 loopback 地址，兼容的既有 Molibot 服务按 external 接入，绝不由 App 停止。
- **内置 Node 与服务监管**：构建流程固定校验并打包 Apple Silicon Node 22.23.1 和 production release；Rust supervisor 支持发现、随机端口回退、临时 desktop token 注入、日志、有限退避重启、菜单重启，以及仅对 App-managed 子进程执行 SIGTERM 后超时强制退出。
- **打包边界**：生成的 App 明确要求 macOS 13+；裁剪 build-only/optional 依赖后，当前 runtime resource 为 249 MB、测试 `.app` 为 363 MB。发布命令使用非交互 CI 打包并在 DMG 成功后自动生成同名 `.sha256`，checksum 逻辑由临时文件测试覆盖。打包 runtime 已通过独立启动/握手/清理 smoke，但完整 App 生命周期 smoke 和受限环境外的压缩 DMG 实产尚未完成，因此仍不构成可发布 beta。

### Molibot macOS App Phase 2 本地 Chat 垂直切片
- **真实 Web Profile/session 共享**：Desktop 通过窄化的 `/api/desktop/bootstrap` 只读取已启用 Web Profile 摘要，并继续使用现有 `channel=web` session API；支持 Profile 切换、按 Profile 恢复最后会话、新建、选择、内联重命名和两步删除，不新增 `desktop` channel。
- **共享 transcript 与流式传输**：独立 Desktop UI 可读取持久 transcript，展示 user/assistant 气泡，选择 thinking level，并消费现有 SSE 的 token、replace、thinking、工具状态、done/error 事件；发送和停止均复用共享 Agent runner API，不在桌面端复制执行逻辑。
- **安全 Markdown 与模型切换**：消息气泡使用 GFM 渲染并通过 DOMPurify 清洗后显示；Desktop 使用只返回模型 key/label/context window 的窄接口读取和切换文本模型，不把完整 settings、Provider API key 或 Base URL送入 WebView。
- **受限 loopback transport**：新增官方 Tauri HTTP client，能力范围仅允许 `127.0.0.1`/`localhost` 的 Molibot Chat API 路径，支持动态服务端口和流式 body，不开放任意远程 URL。
- **验证边界**：5 项临时数据/纯流/模型脱敏测试、8 项 Rust 生命周期测试、Desktop Svelte/production build 与现有 Web production build 均通过；标准宽度浏览器 smoke 已验证临时会话切换、新建、重命名和删除。真实模型流、附件、语音、队列/steer/follow-up、审批和文件面板仍属于 Phase 2 后续工作。

### Molibot macOS App Phase 2 当前会话文件面板
- **只读文件面板**：Chat 头部新增可切换的「文件」面板，复用现有只读 `/api/web/files` 接口，仅索引当前本地 session 的持久附件，并按「全部/图片/视频/音频/文档」媒体类型筛选；切换会话和每轮运行结束后自动刷新，符合「右侧文件面板只索引当前本地 session」的范围约束。
- **预览与导出**：图片/视频/音频通过 Tauri HTTP loopback 客户端拉取字节并以 object URL 在应用内预览，所有文件均可经浏览器 `download` 锚点导出原文件名；HTTP 能力范围新增 `/api/web/files*`，仍仅限 `127.0.0.1`/`localhost` 的 Molibot 路径，不开放任意远程 URL，也不向 WebView 暴露磁盘绝对路径。
- **验证边界**：新增 `filterDesktopFiles` 与 `desktopFileContentUrl` 纯函数单测（api 套件 4/4，desktop-chat 套件 8/8），Desktop Svelte check 0 错误/警告、production frontend build 通过；面板改动仅限桌面端，未触及 Web/服务端代码。原平台「Finder 定位」与本地缓存 Quick Look 需要 fs/dialog/opener 原生插件，留作后续切片。

### Molibot macOS App Phase 2 运行进度时间线
- **实时工具时间线**：运行中的回复气泡内新增可折叠的「运行进度」卡片，按顺序展示工具开始/结束（含成功/失败状态点）、subagent 进度和 thread note，复用现有 SSE 的 `runner_event`/`thread_note` 事件，不新增任何服务端或原生能力；事件解析由纯函数 `parseDesktopActivity` 完成并落入 api 单测。
- **范围与重置**：时间线随每轮发送和会话切换清空，仅在运行期间展示当前轮的步骤；不把诊断字符串写入持久 transcript，符合「运行进度展示」而非持久消息。
- **验证边界**：新增 `parseDesktopActivity` 单测覆盖工具开始/结束/错误、thread note 与无关 token 忽略（api 套件 6/6，desktop-chat 套件 10/10），Desktop Svelte check 0 错误/警告、production frontend build 通过；改动仅限桌面端。

### Molibot macOS App Phase 2 消息内联附件
- **附件随消息展示**：transcript 中每条消息底部新增附件条，按媒体类型显示图标和原文件名；附件数据来自现有 `/api/sessions/[id]` 已返回的 `attachments`，无需服务端改动。
- **复用预览/下载**：内联附件按 `local` 与已加载的 `/api/web/files` 列表匹配，复用同一套 loopback 预览 overlay 和应用内 `download` 导出（图片/音频/视频可预览，全部可下载）；文件尚未在面板列表就绪时优雅降级为只读文件名条。Agent 生成的回复附件在本轮结束、会话重载后持久出现。
- **验证边界**：契约新增 `DesktopMessageAttachment` 并为 `DesktopSessionFile` 补充 `local`（均为响应中已有字段）；api 套件 6/6、desktop-chat 套件 10/10、Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。改动为纯增量且仅限桌面端，未触及 Web/服务端代码。

### Molibot macOS App Phase 2 文件上传
- **附件随消息发送**：composer 新增附件按钮（隐藏 `<input type=file multiple>`，无需原生插件），选中文件以可移除 chip 形式预览；含附件的消息通过现有 `/api/chat` multipart 接口发送，复用共享 Agent runner 完成整轮处理，不在桌面端复制上传或执行逻辑。
- **传输与回显**：Tauri HTTP 客户端转发 multipart body 及其自动生成的 boundary（不手动设置 Content-Type），绕过 WebView 跨源限制；HTTP 能力范围新增 `/api/chat*`，仍仅限 loopback。发送时乐观展示用户气泡和待上传文件名，整轮结束后重载会话，持久化的用户附件与 Agent 回复一并出现。含附件的轮次走非流式 `/api/chat`（纯文本消息仍走 `/api/stream` 流式）。
- **验证边界**：新增 `sendDesktopChatWithFiles` 单测，mock fetch 断言 multipart 字段（profileId/conversationId/message/thinkingLevel/files）与 `/api/chat` 目标 URL（api 套件 7/7，desktop-chat 套件 11/11）；并通过阅读 `@tauri-apps/plugin-http` 源码确认其用标准 `Request` 序列化 FormData 并转发 boundary 头。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。受限沙箱无运行服务，真实 multipart 上传实机 smoke 仍待补。改动仅限桌面端（含一处 loopback 能力范围），未触及 Web/服务端代码。

### Molibot macOS App Phase 2 Host Bash 审批
- **本地审批卡片**：流式回复消费现有 `host_bash_approval` SSE 事件，在 transcript 内渲染审批卡片，结构化展示待执行命令和原因，并按 prompt 选项提供「仅此一次/本会话允许/永久允许此工具/拒绝」按钮（选项标签由桌面端按 id 本地化中英）。
- **复用共享 runtime 恢复**：审批结果通过 `/api/chat` 的 `/hosttools approve-once|approve-session|approve|reject <id>` 命令解决，命令不持久化为普通 session 消息；服务端执行决策并在后台恢复原任务，桌面端按有限次数（最多 15×1s）轮询 transcript，待恢复出的 assistant 回复落库后停止并刷新，符合「通过共享 runtime 恢复、不持久化临时控制指令」的要求，不在桌面端复制审批或执行逻辑。
- **验证边界**：契约新增 `DesktopApprovalPrompt`/`DesktopApprovalDecision`；新增 `parseDesktopApproval`（从 SSE 载荷构建卡片）、`hostBashApprovalSubcommand`（决策→`/hosttools` 子命令）纯函数及单测（api 套件 10/10，desktop-chat 套件 14/14）。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。受限沙箱无运行服务，真实审批触发与后台恢复实机 smoke 仍待补。改动仅限桌面端，未触及 Web/服务端代码。

### Molibot macOS App Phase 2 会话筛选与 transcript 搜索
- **侧栏标题筛选**：会话列表上方新增筛选输入，按会话标题大小写不敏感地过滤当前 Profile 的本地会话（计划 §7.4「侧栏按会话标题筛选」），纯前端、即时生效。
- **当前对话内搜索**：Chat 头部新增「搜索对话」开关，打开后浮出查找条，在当前 transcript 内按消息内容大小写不敏感匹配，显示「第 i / 共 n」计数并支持上一个/下一个匹配跳转——命中消息气泡高亮、活动匹配滚动居中（计划 §7.4「当前 transcript 内搜索，支持上一个/下一个匹配」）。切换会话自动清空查询。首版只做当前会话内搜索，不做跨全部会话全文索引。
- **验证边界**：新增 `filterSessionsByTitle`/`findTranscriptMatches` 纯函数及单测（api 套件 12/12，desktop-chat 套件 16/16）。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。功能完全在客户端，无需运行服务即可验证；改动仅限桌面端，未触及 Web/服务端代码。

### Molibot macOS App Phase 2 跟进队列与媒体预览 CSP 修复
- **跟进消息队列**：运行期间输入框保持可用，按 Enter 把消息排入本地跟进队列（而非被 409 拒绝）；队列以可移除 chip + 「已排队 · n」徽标展示，当前轮结束后自动按序发送下一条，满足计划 §7.1「follow-up 和队列状态」。主动「停止」会清空队列；切换会话清空队列，但同一会话流式回复重载不清空。Web 渠道服务端无并发队列，本地顺序队列是该 UX 的正确落点。
- **媒体预览 CSP 修复**：此前 `tauri.conf.json` 的 CSP `img-src` 缺少 `blob:` 且无 `media-src`，会在真机上拦截文件面板、内联附件等用 `URL.createObjectURL` 生成的 `blob:` 预览。现补充 `img-src ... blob:` 与 `media-src 'self' blob:`，使已交付的图片/音频/视频预览在真机生效。
- **验证边界**：新增 `addToFollowUpQueue`/`nextFollowUp` 纯函数及单测（api 套件 14/14，desktop-chat 套件 18/18）。Desktop Svelte check 0 错误/警告、production frontend build 通过、机器路径扫描干净。队列完全客户端可验证；CSP 为配置修正、真机媒体预览仍待实机确认。改动仅限桌面端，未触及 Web/服务端代码。语音录制与发送（§7.1）因 Tauri WKWebView 的 `getUserMedia` 需额外原生麦克风授权接线、当前沙箱无法验证，留作独立切片。

## 2026-06-27

### Molibot macOS App Phase 1 基础切片
- **独立桌面工程**：新增 `apps/desktop`，使用独立 Svelte 5 + Vite 前端和 Tauri 2 Rust host，不导入现有 Web 页面或页面 CSS；根 package scripts 提供 `desktop:dev`、`desktop:build`、`desktop:check`、`desktop:test` 入口。
- **原生宿主基础**：配置 Chat / Settings 两个真实窗口、单实例聚焦、关闭窗口后隐藏保活、Dock reopen、菜单栏打开 Chat/Settings/Web 与明确退出；登录启动使用 Tauri autostart LaunchAgent 能力，默认关闭。
- **服务边界模型**：新增 App-managed / external 服务所有权、兼容握手决策、端口顺延选择和退出停止策略的 Rust 纯逻辑；4 条单测覆盖兼容外部服务连接、非兼容拒绝、端口占用回退，以及退出时绝不停止外部服务。
- **桌面视觉基础**：按 `DESIGN.md` 建立独立语义 token、Light/Dark/System、减少透明度/动效降级、固定 Settings 底栏和 620px 紧凑布局；中英即时切换和登录启动开关通过浏览器交互验证。新增巴哥犬 Molibot macOS 图标 master 与 `.icns` 资源。
- **当前边界**：该基础切片当时尚未打包 Node sidecar、启动真实本地服务或产出 DMG；后续进展见 2026-06-28 记录。
## 2026-06-23

### Agent 专有模型（text / vision / stt）
- **分层覆盖**：不同 agent 现在可以配置专有模型，默认与全局模型路由（`/settings/ai/routing`）一致，可单独覆盖文本 / 视觉 / 语音转写三条路由；其它路由（TTS、压缩、subagent 各级别）始终走全局。`AgentSettings.modelRouting` 新增可选字段，三个 key 都留空即透明跟随全局。
- **单一注入点**：runner 构造时把绑定 agent 的覆盖叠加到 `getSettings()` 返回值上（`applyAgentModelRoutingOverride`，按 workspace 的 botId → channel 实例 `agentId` 解析 agent），下游 turn 编排、压缩、媒体兜底等所有 `resolveModelSelection` 自动用 agent 模型，无需逐处改调用点。覆盖只替换非空的 text/vision/stt key，不改其它路由，也不修改全局 settings 对象。
- **配置贯通**：`/settings/agents` 页面新增「专有模型」卡片，三个下拉复用 `/api/settings/model-switch` 的 route 选项（首项「跟随全局（默认）」= 空），随 agent 一起保存；`/api/settings/agent` PUT、sanitize、store（新增 `settings_agents.model_routing_json` 列 + 幂等 ALTER 迁移）全链路持久化，空值自动丢弃回退全局。
- **`/status` 与 `/models` 命令适配**：`/status` 模型区现在显示「实际生效模型」（叠加 agent 覆盖后），并在 text/vision/stt 行标注来源 `（agent：<id>）` 或 `（全局）`；思考能力判定也按生效文本模型。`/models` 切换在「bot 绑定了 agent + 路由是 text/vision/stt」时写入该 agent 的专有模型（影响所有共用该 agent 的 bot），其余（tts/subagent、或未绑定 agent）仍写全局；新增 `/models <route> global`（亦接受 `reset`/`default`）清除 agent 覆盖、恢复跟随全局；`/models` 列表顶部显示本次切换的写入目标（agent/global）。命令处理器经 `this.options.channel` + `instanceId` 解析绑定 agent，全部走共享上层、不下沉 Channel。
- **测试**：新增 `applyAgentModelRoutingOverride` 单测 4/4；channelCommands 新增 `/models` agent 维度写入 + `global` 重置、tts/subagent 仍走全局 2 例，套件 25/25；store/settings 套件全绿；`npm run build` 通过，改动源文件无新增 tsc 错误。

### 压缩专用模型
- **压缩与对话解耦**：会话上下文压缩（摘要）此前固定复用主文本模型，现在可以单独指定。新增 `modelRouting.compactionModelKey` 路由：可把摘要任务交给更便宜/更快的模型，主对话仍跑在更强的文本模型上；留空则复用主文本模型（默认行为不变）。
- **触发判定仍按主文本模型**：是否触发压缩仍以「主文本模型的上下文窗口」为准（对话实际跑在该模型上），只有摘要那一次调用换用压缩专用模型——`turnOrchestrator.compactSessionContext` 中分别用 `resolveModelSelection(settings, "text")` 取窗口、用新增的 `resolveCompactionSelection(settings)` 取摘要模型与 API key；压缩 key 失效时自动回退到文本兜底链。
- **配置贯通**：`/settings/ai/routing` 页面压缩设置区新增「压缩专用模型」下拉（复用文本能力模型选项，含「复用主文本模型」空选项），并贯通 schema/defaults/sanitize 持久化；选中的模型若不再存在，保存时自动清空回退到主文本模型。
- **测试**：compaction、modelRouting、sanitize 套件全绿，改动源文件无新增 tsc 错误。

### 流式首字超时 + 模型兜底
- **解决卡死**：当上游模型接受了请求却迟迟不返回任何内容时，流式模式下 `for await` 会一直阻塞导致整轮任务卡住。现在在 `runner.ts` 的 `streamFn` 里包了一层首字超时（`withFirstTokenTimeout`，见 `agent/core/firstTokenStreamTimeout.ts`）：计时器对「第一个真正的内容 token」生效，pi-ai 的 `start`（HTTP 流已打开）和裸 `*_start`（声明了内容块但还没产出字节）等事件不会清除计时器——`text_start` 到首个 `text_delta` 之间正是要兜底的「首字响应时间」；只有 `*_delta`/`*_end`/`done`/`error` 到达才清除计时器，慢但还在输出的模型不会被打断。
- **超时即兜底**：超时后通过独立的 `AbortController` 终止当前请求并抛出带 “timed out” 的可重试错误，命中既有 `isRetryableModelError` 判定，进而走原有的模型候选兜底循环切到下一个模型；所有候选都不可用时返回错误而不是卡住。
- **可配置**：默认 60 秒（环境变量 `MOLIBOT_MODEL_FIRST_TOKEN_TIMEOUT_MS`），新增 `modelFallback.firstTokenTimeoutMs` 设置项并贯通 schema/defaults/sanitize/store 持久化；`/settings/ai/routing` 页面「首字响应超时」数字输入框可调，填 `0` 关闭。正值会被夹到 1s–10min 区间。
- **测试**：`firstTokenStreamTimeout.test.ts` 5/5（无事件时超时触发 onTimeout+可重试错误、`start`+`text_start` 后仍因 stall 超时、首个 `text_delta` 到达后不再超时、`result()` 透传、超时为 0 时原样返回）；runner 22/22、modelRouting 2/2 仍全绿，改动文件无新增 tsc 错误。

## 2026-06-21

### Bot Profile 与 Agent AGENTS 叠加
- **`BOT.md` 不再覆盖 `AGENTS.md`**：系统提示词构造时，已绑定 agent/global 的 `AGENTS.md` 与 bot 维度 `BOT.md` 一起放在上方 operator directives 区块；`AGENTS.md` 先作为可复用底座，`BOT.md` 再叠加 bot 专属规则，避免 Feishu/Web/Telegram 等 bot 的专属规则把 agent 维度长期规则整体挤掉。
- **同名身份文件仍按 bot 优先**：`SOUL.md`、`IDENTITY.md`、`SONG.md` 继续使用 bot > agent > global 取一个的覆盖语义，适合 bot 维度定制人格、身份和表达风格。
- **回归验证**：新增 prompt render 测试覆盖 bot `BOT.md` 与 global `AGENTS.md` 叠加且位于默认 `<system-prompt>` 前，以及 Feishu bot 绑定 agent 时 agent `AGENTS.md` 先于 bot `BOT.md` 生效、bot `SOUL.md` 覆盖 agent `SOUL.md`。

### Feishu 卡片去标题 + emoji 状态 + 回复引用
- **去掉卡片标题栏**：`buildFeishuStreamingCard` / `buildFeishuFinalCard` 不再渲染 `header`（原来显示 Thinking/Processing/Completed 等），删除随之失效的 `title` 入参、`FeishuStreamingSession.resolveStreamingTitle()` 与 `workingPhase` 字段。卡片仍保留 `config.summary`，通知列表里照常显示进度文案。
- **状态改用用户消息上的 emoji reaction**：`FeishuStreamingSession.startStatusIndicator()` 在任务一开始就给「用户的触发消息」加 `OnIt`（处理中）表情；`finalize()` 按 `stopReason` 换成 `DONE`（成功）/`CrossMark`（失败）/`No`（中止）。emoji 用飞书固定 `emoji_type` 枚举（非任意 emoji），新增 `addFeishuReaction` / `removeFeishuReaction` 封装（`client.im.messageReaction.*`），全程 try/catch + `momWarn`，缺权限或错 key 只告警不打断运行。
- **回复明确引用用户消息**：`replyOptionsForEvent` 放开原先「仅 thread 才 reply」的限制——只要有 `platformMessageId` 就带 `replyToMessageId`，`replyInThread` 仅在源自 topic 时为真。普通群聊/单聊里每条回复都带引用块，连发多条也能快速定位。
- **测试**：cardkit 6/6、streamingSession 4/4 通过；剔除测试中已删除的 `title` 入参。改动源文件无新增 tsc 错误（messaging 既有 `buildFeishuReplyCards` 类型告警为基线既存）。

### 审批收敛 Phase 2 (b)：审批落库合并为单表
- **两表合一**：新增 `approval/approvalSchema.ts`，把 `approval_requests` + `approval_grants` 合并为单表 `approvals`（两套旧表列并集）+ `type` 判别列（`request`/`grant`），并提供幂等迁移 `migrateLegacyApprovalTables`（启动时把旧表数据 `INSERT OR IGNORE` 拷入，旧表保留可回滚）。
- **两个访问类共用单表**：`SqliteApprovalStore`(broker, 8 语句) 与 `HostBashStore`(bash 工作流, ~24 语句) 全部 SQL 切到 `approvals` 并带显式 `type` 过滤；bash 域行仍以 `capability LIKE 'bash:%'` 标记。生产代码不再创建或引用旧表。
- **测试**：`approvalSchema.test.ts`(3) + 既有 broker/hostBash 守卫；hostBash 两处直插旧表用例改为 `approvals`；approval + hostBash + channelCommands + toolRuntime + turnOrchestrator 合计 61/61 通过，改动源文件无新增 tsc 错误。
- **取舍**：瞬时 request 与持久 grant 同表带来可空列/混生命周期（按用户决定执行）；旧表暂留以便回滚。

### 审批收敛 Phase 2 (a)：删除 dead broker 桥接
- **证实再删除**: 新增 lock 测试证明默认策略下唯一的 high-risk 内置分类是 `bash`，而 `bash` 在 `decideBashToolPolicy` 中 opt-out broker（永远 `allow`）——因此没有任何内置工具会创建 broker request，hostBash 审批永远不存在同 scope 的待对账 broker request。据此删除 `channelCommands.ts` 的 `resolvePendingBrokerRequests` 方法、5 处调用、以及无 hostBash 记录时回退 resolve broker 的 NL 审批分支，并清理 `getApprovalBroker` import。
- **只删死桥接、不动 broker**: `ApprovalBroker` 的 grant 模型仍在 ToolRuntime / TurnOrchestrator / feishu 中存活。
- **回归保护**: lock 测试在未来新增「非-bash 高危工具」时会失败，提示去显式接线审批。验证：channelCommands + classification + toolRuntime + approvalService 共 43/43 通过，tsc 干净。

### Image Generation Provider Diagnostics
- **图像工具 HTTP 诊断日志**: `imageGenerate` 现在会在服务端日志打印供应商请求 URL、脱敏请求头、请求体、响应状态和响应体预览，覆盖设置页测试与 Agent 调用，便于排查 Google Imagen 返回空 `{}` 等 provider 侧问题。
- **敏感信息脱敏**: 图像工具日志会脱敏 `Authorization`、API key header、Google `?key=` 查询参数以及已配置的供应商密钥，避免调试时把真实 key 打到日志里。

### OpenAI Images Provider
- **OpenAI 图像生成接入**: `imageGenerate` 新增 `openai` 引擎，默认使用 `OPENAI_API_KEY`、`https://api.openai.com` 和 `gpt-image-2`，通过 OpenAI Images API 保存返回的 `b64_json` 图像结果。
- **设置页 OpenAI 选项**: `/settings/image` 新增 OpenAI Images 配置卡片，支持 API Key、模型 ID、Base URL、默认引擎选择和即时测试；读取旧设置时会补齐新增的 `openai` 引擎配置，避免老数据缺字段导致页面崩溃。
- **OpenAI Chat Completions 兼容协议**: `imageGenerate` 新增 `openai-chat` 引擎，提交到 `/v1/chat/completions`，用于兼容通过 chat/completions 返回图片 URL、data URL 或 Base64/JSON 的服务；设置页新增 `OpenAI Chat Format` 配置项，同样支持 API Key、模型 ID、Base URL 和即时测试。
- **图像引擎显式启用开关**: `/settings/image` 的每个 provider 现在和 `/settings/video` 一样有独立启用/禁用开关；运行时只会选择同时启用且配置了 API Key 的引擎。旧配置缺少 `enabled` 字段时会按已有 API Key 自动补齐启用状态，避免升级后不可用。
- **图像工具返回 provider 启用状态**: `imageGenerate` 执行结果的 `details` 现在包含 `engineEnabled` / `providerEnabled`，任务 `requestParams` 也会记录同样状态，便于调用方和历史记录判断本次 provider 是否启用。

## 2026-06-20

### Session 命名日期随机化
- **`/new` 会话命名**: IM 共享命令创建的新 session 改为日期 + 4 位随机小写字母格式，例如 `s-YYYYMMDD-yush`，避免不同 bot 同一天创建 session 时都出现相同的序号尾缀。
- **定时任务 session 命名**: `sessionMode=fresh` 的 scheduled task session 使用同样规则，前缀为 `task`，例如 `task-YYYYMMDD-yush`，仍保留原有 task session 自动清理策略。
- **回归验证**: 增加 `MomRuntimeStore` 单元测试覆盖普通 session 与 task session 的日期随机命名格式。

### Web 工具附件类型修复
- **Web `attach` 附件持久化**: Web Chat 的 `/api/chat` 与 `/api/stream` 现在会把 Agent 工具通过 `uploadFile` 产生的文件保存为会话附件，并随 assistant 消息写入 `attachments` 元数据，避免工具显示已发送但文件面板没有结构化附件。
- **无扩展名标题保留文件类型**: 当 `attach` 传入类似 `Example.com 网页截图` 这类不带扩展名的标题时，Web 保存文件名会保留源文件扩展名（如 `.png`），并写入 `mediaType: image` / `mimeType: image/png`，确保图片可以直接预览和打开。
- **回归验证**: 新增 Web 附件单元测试覆盖 PNG 文件路径 + 无扩展名标题的保存行为。

### MCP 设置保存兼容性修复
- **URL-only HTTP 配置保留**: `/settings/mcp` 现在会把包含 `url` 但未显式声明 `type` / `transport` 的 MCP 服务自动识别为 HTTP transport，避免这类配置在保存 sanitizer 中被当作缺少 `command` 的 stdio 服务过滤掉。
- **顶层 headers 兼容**: MCP 配置支持常见的顶层 `headers` 写法，并在保存时归一到最终 HTTP headers，适配 `{ "mcpServers": { "id": { "url": "...", "headers": {...} } } }` 格式。
- **回归验证**: 新增 `sanitizeMcpServers` 单元测试覆盖 TDX 风格 payload；验证原始复现 payload 已从空数组变为保留 `tdx` HTTP 配置。
- **MCP 调用入口修复**: 新增稳定的 `mcpInvoke` 工具，只在显式 MCP 场景随 `loadMcp` 暴露。`loadMcp` 仍负责加载服务器；`mcpInvoke(listTools)` 负责列出已加载 MCP 工具；`mcpInvoke(call)` 负责调用具体 MCP 工具，避免同一轮 `agent.prompt()` 中动态追加工具 schema 不会进入当前 context snapshot 导致模型只能误用 `toolSearch` / `bash`。
- **MCP 工具包装透传**: `wrapWithToolRuntime` 现在向原始工具透传 `AbortSignal` 和 `details`，保留 MCP 结果中的 `serverId` / `remoteToolName` 等可观测信息，并保持停止/中止链路一致。

### 运行预算降级修复（预算耗尽不再 spiral 成报错 / 不再吞掉半截回复）
- **预算 block 不再误记为工具失败**: 撞「工具调用预算」被 block 的调用会返回 error 结果，原先在 `tool_execution_end` 里被 `recordToolResult(isError)` 当成「工具失败」计数。当模型一轮并行发出多个工具调用时，这些被 block 的调用会让「失败预算」迅速冲顶并触发硬中止，绕过本该执行的「无工具优雅续写」，最终给用户一句 `Sorry, something went wrong`。现在在 `beforeToolCall` 用 tool-call id 记下被预算 block 的调用（`budgetBlockedToolCallIds`），`tool_execution_end` 通过纯函数 `shouldCountToolResultAsFailure` 跳过这些调用的失败计数，并且不再把重复的「budget exceeded」刷屏到会话线程。
- **错误时保留半截回复**: 流式输出了一半再报错时，原先会把整条消息 `replaceMessage("Sorry, something went wrong.")`，把用户已经看到的部分全部覆盖。新增纯函数 `resolveFinalErrorAction`：有最终答案 → 不动；有可见的流式 partial → 保留 partial、只追加一句中断说明；确实什么都没产出 → 才用兜底通用错误文案。
- **测试**: `runnerRetryState.test.ts` 新增 2 组用例（失败计数口径、最终错误动作）；回归 `runner.test.ts` 22/22，全部受影响套件 69/69 通过；改动源文件 tsc 干净。

### 审批收敛 Phase 2 第一刀（ApprovalService façade，零行为变更）
- **统一接口**: 新增 `src/lib/server/approval/approvalService.ts`，定义 `ApprovalService` 接口（`checkGrant / createRequest / getRequest / waitForDecision / resolve`）+ broker 适配器 `BrokerApprovalService`（`waitForDecision` 复用 Phase 1a 的 `pollUntilResolved`）。
- **ToolRuntime 改为依赖接口**: 不再直接戳 `ApprovalBroker`；构造时把既有 `approvalBroker` 选项包成 `BrokerApprovalService`（所有现有调用点不变），`pollApprovalRequest` 的内联轮询移入服务。底层 store 未动。
- **测试**: 新增 `approvalService.test.ts` 5 条（delegate/已终态/abort/timeout 落库/resolve 建 grant）；既有 `toolRuntime.test.ts` 6 条行为测试全过，合计 28/28；改动源文件 tsc 干净。
- **后续**: HostBash 适配器实现同一接口、通过接口消解 `resolvePendingBrokerRequests` 桥接（会改行为，单独谨慎推进）。

### 审批收敛 Phase 1（共享 poll 等待器，零行为变更）
- **背景**: 仓库存在两套独立审批阻塞循环 —— ApprovalBroker 通道（`ToolRuntime.pollApprovalRequest`，非 bash 高危工具）与 Host Bash 通道（`waitForHostBashApprovalAndExecute`，bash host 命令），各自手写 timeout/abort/sleep 轮询（摸底见 `docs/designs/agent-runtime/approval-convergence-plan-2026-06-20.md`）。
- **改动**: 新增 `src/lib/server/approval/approvalWaiter.ts` 的 `pollUntilResolved<T>` 通用轮询骨架（注入 `now`/`sleep`，可纯单测），把"等到终态或超时/中止"的循环机制抽出。System A 与 System B 都改调它；各自的 store 访问、终态判定、approval 后内联执行逻辑保留在各自的 `poll()` 回调中。**零行为变更**（超时、轮询间隔、中止语义、内联执行均不变）。
- **测试**: `approvalWaiter.test.ts` 4 条（done/持续轮询/中止/超时，均注入假时钟）；回归 System A `toolRuntime.test.ts` 6/6、System B `bash-output.test.ts` 19/19（含「approval 后阻塞内联执行」用例）。改动源文件 tsc 无新增错误。
- **Prompt 构造收敛（同样零行为变更）**: 把 `ToolRuntime` 内部两处「假 host-bash prompt」构造（pending 卡片 + rejected/expired 结果）合并为单一 `buildBrokerApprovalRecord` helper —— 两处仅传各自的 toolId/displayName/command/status/pendingAction，公共信封（channel ""、ephemeral、scratch-only 权限、从 request 派生的 id/reason/scopeId/sessionId/requestedAt）收敛到一处。新增纯单测 2 条，回归 toolRuntime 8/8、approval 套件 26/26。
- **范围**: 以上是审批收敛 Phase 1 的两步（共享等待器 + broker prompt 构造收敛），均零行为变更。跨渠道的卡片形状统一（非纯零行为变更）、单一 store of record、subagent resume 收敛为后续 Phase（见上述设计文档）。

### SubagentRuntime 硬化（第一刀）
- **执行预算与时间上限**: 新增 `src/lib/server/agent/tools/subagentRuntime.ts`，提供 `SubagentExecutionGuard`。它复用父 runner 的 `RunBudget`（不另造预算），叠加 wall-clock deadline（默认 `DEFAULT_SUBAGENT_DEADLINE_MS = 10min`），在子 agent 超过工具调用 / 工具失败 / 模型调用预算或超时时返回**结构化停止原因**（`{ kind: "budget_exceeded" | "timeout", reason }`）。
- **会话事件驱动中断**: `evaluateSubagentEvent(guard, event)` 把 pi-coding-agent 的 session 事件映射为预算判定；`runSingleSubagent` 在 `session.subscribe` 中据此 `session.abort()`，子 agent 因此获得与父 runner 一致的预算中断能力。
- **独立 deadline 计时器（修复 idle hang）**: 仅靠事件驱动检查无法在 `session.prompt` 卡住（provider stall、无后续事件）时触发超时。新增 `armSubagentDeadline(guard, onExpire, scheduler?)`（注入式调度器，纯逻辑可测）+ `guard.remainingMs()`，在每次 attempt 外层挂一个真实计时器，到点记录 timeout stop 并 `session.abort()`，并在 `finally` 中清除，确保空闲挂起也能被中止。
- **结果携带可观测信息**: `SubagentRunResult` 新增 `budget`（RunBudget 快照）、`runtimeStopKind`、`durationMs`；预算/超时触发时 `stopReason` 归一为 `error` 并附结构化 `errorMessage`。
- **模型 fallback**: 新增 `buildSubagentModelCandidates(settings, modelHint)`（有序去重候选路由，首项与既有 `resolveSubagentModelRoute` 等价、末项追加主 text 路由兜底）+ `resolveSubagentModelCandidates` / `buildModelFromRoute` / `buildSubagentFallbackModel`。`runSingleSubagent` 重构为「解析候选 → 共享 guard → 逐候选 `runSubagentOnce`」循环，按 `shouldFallbackToNextModel` 决定是否换下一个模型；预算/超时/审批/中止不触发 fallback（避免浪费模型或丢状态）。
- **Run summary 透传**: 新增纯函数 `buildSubagentTaskRecord`，把子 agent 的 `budget`/`model`/`durationMs` 从 `subagent_execution` task_end 事件落到 `RunSummary.subagent.tasks`，使 trace/分析能看到每个子任务的预算、耗时、模型与 stopReason。
- **测试**: `subagentRuntime.test.ts`（10）覆盖预算耗尽、deadline 超时、事件映射、limits 解析、fallback 判定；`subagent.test.ts` 新增候选构建/去重；`runSummary.test.ts`（2）覆盖任务记录映射。改动源文件 tsc 干净，全量 agent 回归仅既有 `events.test.ts`（与本次无关）失败。
- **Per-mode 预算测试**: `createSubagentTool` 新增可注入的 `runSubagent` 依赖（默认 `runSingleSubagent`），无需活模型即可端到端验证三种模式下预算中断的流转：single 透出 `runtimeStopKind="budget_exceeded"` 并发出 `error` 终态事件；parallel 即使某个任务被预算中断仍跑完全部；chain 在被预算中断的步骤后停止、不再执行后续步骤。
- **对照验收**: 标准 1（预算/超时结构化停止）✅、2（模型 fallback）✅、4（single/parallel/chain 预算中断用例）✅、5（run summary 可见）✅；仅剩 3（审批接口收敛，风险最高，建议与 ToolRuntime 双栈合并规划）作为后续 slice（见 `docs/reviews/agent-runtime/agent-optimization-review-2026-06-20.md`）。

## 2026-06-19

### Settings Data Visibility Reliability
- **Agents 生产启动可见性修复**: `/settings/agents` 页面依赖 `/api/settings/subagents` 同时加载内置 Subagent 清单。生产 `node build` 若缺少打包进 `build/server/chunks/subagent-agents` 的 Markdown 资源，现在会回退读取本地源码目录中的 `subagent-agents` 定义，避免接口 500 导致已保存 agents 看起来无法加载。
- **Host Bash 旧白名单兼容**: `/settings/host-bash` 现在兼容旧的 persistent approval grant 记录，即使 `action_fingerprint` 为 `NULL` 也能用 capability tool id 渲染白名单项，不再因为 `metadata.displayName` 为空对象访问而整页 500。
- **回归验证**: 覆盖 Host Bash legacy grant 单元测试，并验证生产 `node build` 下 `/api/settings/subagents` 与 `/api/settings/host-bash` 均返回 200。

## 2026-06-18

### Stop Command Busy-State Release
- **Stop 后立即释放会话忙碌态**: `/stop` 成功中止当前运行或清理 stale running turn 时，会同步释放 channel 层 busy 标记、标记当前 run 为 aborted，并重置对应 runner。这样用户收到“已停止”后，下一条普通消息会直接进入新任务，而不会继续被误判为当前任务 follow-up 并提示 `Queued as #...`。

## 2026-06-17

### Telegram Rich Message Output
- **grammY 1.44.0**: Telegram SDK dependency upgraded to `grammy@^1.44.0`, resolving `@grammyjs/types@3.28.0` with Bot API 10.1 rich message types and methods.
- **富文本优先发送**: Telegram outbound text now prefers Bot API 10.1 rich messages via grammY `sendRichMessage` and rich `editMessageText` payloads, using the original text as the rich Markdown source.
- **grammY-only Telegram rendering**: Telegram formatting no longer performs local Markdown-to-HTML conversion. If rich message delivery fails, the fallback is grammY `sendMessage` / plain `editMessageText` with the original text.
- **命令 Markdown 统一输出**: Shared commands now produce one canonical Markdown shape across channels instead of branching by Telegram/Feishu/QQ/Weixin: `/status` uses grouped Markdown lists, while `/help` and queue listings use standard Markdown table blocks. Channel senders remain responsible for platform-specific rendering or fallback.
- **Runlog 状态块标准化**: `/runlog status` and runlog toggle confirmations now render the status block as Markdown headings plus bullet lists, avoiding Telegram rich Markdown folding single newlines inside plain paragraphs.
- **命令输出结构化打磨**: Host Bash 审批、queue/session/model/login/compact/thinking/sandbox/toolprogress/showreasoning/runlog 等共享命令的多行结果统一改为 Markdown heading、bullet list、command list 或 table，避免 Telegram rich Markdown 把普通段落单换行折叠成一行，同时保持飞书等渠道复用同一套命令文本。
- **无本地渲染判断**: Telegram no longer uses local regular expressions to decide whether text is Markdown; grammY/Telegram receives the original text and owns rich rendering.

### Independent Control Daemon (Telegram 运维控制进程)
- **独立控制守护进程**: 新增 `bin/molibot-control.js`，一个不依赖主程序 agent/runtime/settings 的极小独立进程，用一个专用 Telegram bot 接收运维命令。它与主服务生死无关，因此主服务完全停止时仍能收命令并把服务重新拉起（这是“启动已停服务”唯一可行的路径）。
- **运维命令**: `/status`、`/start`、`/start dev`、`/stop`、`/restart`、`/restart dev`、`/logs [n]`。每条命令通过 `spawn` 调用相应脚本并把输出回贴到聊天。
- **两套服务源**: `/start` 走 release 流程(调用 `molibot-update.sh`：拉取并构建最新 git ref → 部署到 `current` → 启动);`/start dev`、`/restart dev` 对齐本地 dev 工作树。stop/status 基于 PID 文件,与启动来源无关。
- **dev 自动构建**: `/start dev`、`/restart dev` 会先 `npm run build`(通过 login shell 解析 node/npm PATH)再启动,确保拿到最新本地代码;构建失败则中止、不启动。另提供 `/build` 单独构建。
- **发现模式**: admin 白名单为空时不再退出,而是进入发现模式(不授权任何命令,只把收到消息的 chat_id 记日志),避免「没 id 不让启动、不启动又拿不到 id」的死锁;非白名单消息一律只记日志、不回复。
- **白名单鉴权**: 仅响应 `MOLIBOT_CONTROL_ADMIN_IDS` 中的 chatId/userId，非白名单消息静默忽略；进程缺少 token 或空白名单时拒绝启动。控制进程不接入任何 agent 能力，只能执行固定命令集。
- **自身守护**: 新增 `bin/molibot-control-service.sh`，沿用 `molibot-service.sh` 的 nohup 监督循环模式（start/stop/status/restart、崩溃自动重启），让控制进程开机后常驻并在崩溃时自拉起。
- **配置与发布接线**: `molibot manage` 的 `deploy.env` 新增 `MOLIBOT_CONTROL_TG_TOKEN` / `MOLIBOT_CONTROL_ADMIN_IDS` 两项（交互式可配置），`molibot-release.sh` 把两个新脚本打包进 release。
- **设计文档**: 方案归档到 `docs/designs/operations/control-daemon.md`，README 部署章节给出快速使用步骤并链接到该文档。

### Telegram Command Menu Cleanup（命令菜单精简）
- **精简「/」菜单**: 新增 `TELEGRAM_MENU_COMMANDS` 并在启动时调用 `setMyCommands`，Telegram 的命令选择器只暴露 8 个常用命令（`/new`、`/clear`、`/stop`、`/sessions`、`/status`、`/models`、`/skills`、`/help`），按运行时 locale 显示中/英描述。菜单注册失败只告警、不影响启动。
- **/help 分组**: `/help` 输出拆成「常用命令 / 高级命令」两组,高级命令(steer/followup/queue/compact/thinking/sandbox/runlog/toolprogress/showreasoning/delete_sessions/skills 详情等)合并为更紧凑的带可选参数行。
- **非破坏式**: 所有命令处理器保持不变(`TELEGRAM_SHARED_COMMANDS` 未删减),高级命令照常可用,仅调整 UI 暴露与帮助呈现。

## 2026-06-16

### Runlog Notice Controls
- **自动归档通知默认关闭**: run detail 仍然持续归档，但“本次执行成功，详细记录已归档。查看：/runlog ...”自动提示默认关闭，减少聊天噪音。
- **分层开关**: 新增 `/runlog status`、`/runlog on|off|reset`、`/runlog bot on|off|reset`、`/runlog global on|off|reset`，按 session > bot > global 生效；`/runlog` 和 `/runlog latest` 保持查看最新记录语义。
- **历史列表与状态面板**: 新增 `/runlog list` 列出最近归档记录；`/status` 现在同时展示 runlog notice、sandbox、toolprogress、showreasoning 的当前有效状态和来源。
- **跨渠道接线**: Telegram、Feishu、QQ、Weixin 的自动归档通知统一遵守共享开关；手动 `/runlog` 查询不受影响。

### Feishu Topic Runlog Notice Threading
- **Topic 内归档通知对齐**: Feishu 流式输出在 topic 中触发 runlog 归档提示时，现在会沿用原始消息的 `reply_in_thread` 回复参数，不再把“本次执行成功，详细记录已归档。查看：/runlog ...”发送到群聊主消息流。
- **回归测试**: Feishu runtime 测试覆盖流式 topic 场景，断言归档通知通过 Feishu reply API 回到原 topic。

### AGENTS 重复问题规则提炼
- **Changelog 复盘提炼**: 分析 `CHANGELOG.md` 中反复出现的修正主题，将稳定的避免规则补充到 `AGENTS.md`，覆盖 prompt/profile 真实生效与去重、设置页响应式与设计系统、细粒度设置保存、测试数据库隔离、跨渠道队列幂等等长期约束。
- **文档同步**: 按文档职责分层，仅在 `features.md` / `prd.md` / `CHANGELOG.md` / `README.md` 记录本次规则治理摘要，不把 changelog 历史流水账搬入长期规则。

### Docs Taxonomy Cleanup
- **分类入口**: 新增 `docs/README.md`，按文档职责定义 `requirements`、`designs`、`reviews`、`research`、`guides`、`reference` 等目录用途，并明确 `docs/agent-dev-series` 与 `docs/superpowers` 维持独立结构。
- **过程数据清理**: 删除 `docs` 下临时执行计划、迁移 checklist、进度记录和完成日志类过程材料；长期需求、架构方案、研究、评审、指南和参考资料保留。
- **导航同步**: 更新根 `README.md` 的 Docs 和 Documentation Workflow，指向新的文档路径和归档规则。

## 2026-06-14

### Feishu Card Markdown 渲染优化 (Feishu Card Markdown Rendering)
- **最终回答结构化渲染**: Feishu CardKit final card 不再把完整回答塞进单个 markdown 元素；标题会拆成独立 markdown 元素，markdown 表格会转换成飞书原生 table 元素，降低大段 H1/结构化回答在 card 中排版错乱的概率。
- **代码块保护**: `markdownToFeishuMarkdown()` 在应用标题、列表、引用等兼容转换前会先保护 fenced code block，避免代码示例里的 `#`、`-`、`>` 被误改成标题、项目符号或引用样式。
- **回归测试**: Feishu 测试覆盖代码块 markdown 保护、final card 标题拆分和 markdown table 原生 table 渲染。

### Bot Profile 身份锁定 (Bot Profile Identity Lock)
- **默认身份不再覆盖 Bot 身份**: 当有效 prompt 中存在 `BOT.md` / `IDENTITY.md` / `SOUL.md` / `SONG.md` / `USER.md` 这类 operator profile 时，默认 `<system-prompt>` 不再硬声明 `You are Momo Agent...`，而是要求模型以 profile 中定义的名称、身份、使命、工作流、语气和禁令作为自我描述与行为准则。
- **尾部提醒防止后置默认规则稀释**: 新增 `<operator-directives-reminder>` 段，明确回答“你是谁 / 工作流 / 核心原则 / 禁止行为”时必须从 active profile 文件回答；如果 profile 要求缺少必要 skill 时停止，也必须按 profile 原因停止。
- **回归测试**: `prompt.test.ts` 覆盖有 bot 身份时不再渲染默认 Momo 身份，并保留 profile 内容与尾部提醒。

### System Prompt 易变段落后置以利缓存 (Volatile Sections Last for Cache-Friendliness)
- **易变内容移到 system 块末尾**: `<available-skills>`（技能名列表）和 `<current-memory>`（记忆内容）这两段会随轮次变化,现在统一放到 `<system-prompt>` 块的**最末尾**,排在静态的 `system-configuration-log` / `log-queries` 之后。此前 `available-skills` 紧跟在 skills protocol 后、靠近顶部,导致技能列表或记忆一变就作废几乎整个前缀。讲用法的 skills **protocol**(静态)仍留在顶部与 pipeline 一起,只挪了易变的技能名列表。
- **目的**: 让上方那一大段静态前缀跨轮保持字节一致,便于做前缀缓存的 provider/模型复用更多内容。(注:Anthropic 经 pi-ai 把 system 当**单块**缓存,所以在 Anthropic 上是无收益的 no-op;收益面向更细粒度缓存或自定义协议路径。)改动在 `agent/prompts/prompt.ts` 的 `buildBaseSystemPromptWithOptions`。

### Operator Profile 优先级高于默认系统提示词（但有安全底线） (Operator Profile Files Outrank System Prompt, Under a Safety Floor)
- **代表 operator 意图的 profile 文件上提到最前**: `BOT.md` / `IDENTITY.md` / `SOUL.md` / `SONG.md` / `USER.md` 现在被拼到默认 `<system-prompt>` 之**前**，并由一段 `<operator-directives>` 前言声明它们为高优先级、与默认系统提示词冲突时以这些为准。此前它们被追加在 base prompt 之后、且是无任何框定的纯文本，容易被 base prompt 里的工具/bash 指引稀释——例如 Skill-Only 的 `BOT.md`（禁用 curl/cat 等）规则被忽略。
- **不可逾越的安全底线压在最上层**: 新增 `<inviolable-safety>` 段，位于 operator directives **之上**，声明 profile 文件（以及用户、外部内容）只能**收紧**而不能放松/绕过核心安全——不得关闭安全规则、不得外泄密钥、不得在未确认下执行破坏性/不可逆操作、不得攻击系统、必须抵御 prompt injection、不得谎报执行成功——**即使 profile 文件明确要求破坏也不行**。
- **支撑类文件仍为低优先级**: `TOOLS.md` / `BOOTSTRAP.md` 保留在 base prompt 之后作为低优先级配置；`AGENTS.md` 仍仅在没有 `BOT.md` 覆盖时注入；project-context 块保持不变。改动集中在 `agent/prompts/prompt.ts`（新增 `OPERATOR_DIRECTIVE_FILES`、`SUPPORTING_INSTRUCTION_FILES`、`buildSafetyFloorSection`、`buildOperatorDirectivesPreamble`），现有 `prompt.test.ts` 的 BOT.md 覆盖断言仍通过。

### Stop Command Terminal Confirmation Copy
- **终止确认改为最终态**: `/stop` 成功中止当前运行时，共享命令回复从“正在停止……”改为“已停止。”；同时清理排队任务时继续显示已清除数量，避免飞书等渠道在运行卡片已显示 stopped 后，底部确认消息仍停留在进行态。

## 2026-06-13

### Host Bash Fallback 继承沙箱环境变量 (Host Bash Fallback Inherits Sandbox Env)
- **修复 fallback 丢失 token**: 沙箱命令被拒后会自动 fallback 到 Host Bash，但此前 `buildHostEnv` 只读父进程 env，导致只存在于 `.env.sandbox.local` 的密钥（如 `BOT_API_TOKEN`）在 fallback 路径上凭空消失，报出误导性的“缺少 token”。现在 Host Bash 也会注入这些仅存在于沙箱 env 文件中的密钥。
- **沿用沙箱 env 策略**: 注入受同一套 `inheritMode`/`allow`/`deny` 策略约束，并跳过父进程 env 里已有的 key，因此 fallback 拿到的权限不会超过沙箱本身会授予的范围；沙箱关闭时不注入任何文件密钥（不污染长期存活的主进程 env）。
- **新增 `buildSandboxEnvFileInjection`** 辅助函数（`agent/tools/sandbox.ts`），由 `sandbox.test.ts` 覆盖。

### 多渠道 System Prompt Preview 热刷新 (Cross-Channel Prompt Preview Refresh)
- **No-op apply 也刷新预览**: Feishu / QQ / Weixin 在保存 bot 配置或 profile Markdown 后，即使渠道凭据和白名单没有变化、无需重启适配器，也会重写对应 bot workspace 的 `SYSTEM_PROMPT.preview.md`。行为与 Telegram 对齐，避免只有 Telegram 预览更新、其他渠道仍显示旧 prompt 的观测偏差。
- **日志对齐**: Feishu / QQ 的 apply、no-op apply 日志补充 `botId`，刷新时会输出与 Telegram 同类的 `system_prompt_preview_written` 日志，便于按 bot 核对 prompt 是否已经更新。

### 树洞发帖 Bot Profile 模板 (Treehole Poster Bot Profile Template)
- **Bot 维度模板**: 新增 `src/lib/server/agent/prompts/templates/treehole-poster/`，提供可复用的 `BOT.md` / `IDENTITY.md` / `SOUL.md` 模板，用于专门负责轻度整理随想并按明确触发发布帖子的 bot。
- **配置分层去重**: `BOT.md` 只承载工作流、发布触发和风险确认规则；`IDENTITY.md` 只定义身份边界；`SOUL.md` 只定义表达气质，避免三份配置互相重复。

### AI 用量与 Trace 页面分页支持 (AI Usage and Trace Pagination)
- **分页控制与每页条数自选**: 为 `/settings/ai/usage` 的“请求事件明细”和 `/settings/ai/trace` 的“最近 Trace Facts”表格添加了分页组件。每页支持可选条数（10/20/30/50/100，默认 20 条）。
- **多语言（i18n）支持**: 分页文本信息（例如 `第 1 / 5 页 (共 98 条记录)` / `Page 1 of 5 (98 records)`）和“上一页”/“下一页”导航控件完美匹配 `$locale` 多语言，在中英文下均可自动适应切换。
- **状态联动重置**: 在切换时间范围、模型、Bot、渠道或 Fact 调用类型等过滤条件时，分页状态会自动重置归零（`currentPage = 1`），保证过滤结果显示正确。

### Trace Skill 调用统计 (Trace Skill Usage Statistics)
- **Skill 调用指标卡**: `/settings/ai/trace` 在工具调用、模型请求卡片之外新增 "Skill 调用" 指标卡，展示当前筛选范围内 `skill_usage` fact 总数、实际执行（executed）次数与技能种类（distinct）。
- **技能使用排行表**: 新增 "技能使用排行" 表格，按技能 name 聚合命中（triggered）、加载（loaded）、执行（executed）次数、关联 run 数与平均耗时，与工具调用排行对齐。
- **API 汇总扩展**: `/api/settings/trace` 的 `buildStats` 现在产出 per-skill 汇总（`skills[]`）与 totals 字段（`skillUsages` / `executedSkills` / `distinctSkills`），level 取自 `payload.level`、scope 取自 `payload.scope`，复用既有 fact 读取链路，不新增存储。

### CLI Readline 退出防护 (CLI Readline Shutdown Guard)
- **TTY EIO 防护补齐**: 为 CLI adapter 增加统一的 readline shutdown guard。Ctrl+C、TTY 断开或 stdin `read EIO` 时会安静关闭 readline 并暂停 stdin，不再因为未处理的 `Interface` error 打出 Node.js 崩溃栈。
- **异步 prompt 防重入**: CLI line handler 在异步回复完成后会先检查 readline 是否已关闭，避免 Ctrl+C 后继续调用 `rl.prompt()` 重新读取已关闭的终端输入。

### Skill 使用追踪 Phase 1 (Implicit Skill Load Tracking)
- **隐式读取追踪**: 当模型通过 `read` 工具成功读取当前 run 已加载 skill manifest 中的 `SKILL.md` 时，runner 会记录 `skill.loaded`，并标记 `reason: "read_skill_file"`。这补齐了非显式 `/skill` / `$skill` 调用场景下，模型按 skill routing 自行读取技能文件但 trace 中没有 skill fact 的缺口。
- **路径与阻塞安全**: read 路径归因复用工具层 `resolveToolPath` 与导出的 `pathCompareKey`，支持 `data/moli-*/skills/...` 等既有路径纠偏；缓存只在 hook gate、preflight、budget 全部放行后写入，read 成功、失败、blocked 与 run cleanup 都不会残留 pending path。
- **单调 skill fact 合并**: `TraceRecorderHook` 现在为 `skill_usage` 维护 run 内合并态，使用 `payload.level` (`triggered` / `loaded`) 与 `payload.evidenceCsv` 累积证据，保证后到的低置信度信号不会把已 loaded 的 fact 降级。triggered-only skill facts 使用 `status: "info"`，避免被误显示为进行中。
- **实施说明**: Skill 使用追踪的长期行为记录在本文件与 Trace 设计文档中，不再保留单独的过程进度 checklist。

### Skill 使用追踪 Phase 2 (SkillSearch Candidate Tracking)
- **候选触发追踪**: 当 `skillSearch` 成功返回 `details.matches` 时，runner 会对每个结构完整的匹配项发出 `skill.selected`，并标记 `reason: "search_match"`，让 trace 能记录“被检索命中的候选 skill”，即使模型后续没有读取对应 `SKILL.md`。
- **防御式结果解析**: Phase 2 只读取 `context.result.details.matches`，并逐项校验 `name`、`scope`、`filePath` 为字符串；失败的 `skillSearch`、缺失 details、非数组 matches 或畸形 match 都会被忽略，不影响工具原始执行结果。
- **语义边界**: `search_match` 只会形成 `payload.level: "triggered"` / `status: "info"` 的 `skill_usage` fact；如果同一 skill 后续已由 Phase 1/3 标记为 loaded 或 executed，合并逻辑保持高置信度层级不降级。

### Skill 使用追踪 Phase 3 (Heuristic Executed Evidence)
- **可选 signals 元数据**: `SKILL.md` frontmatter 现在可声明 `signals`，支持 `cli`、`mcp`、`tools` 三类特征信号；实现同时兼容嵌套 `signals:` 写法和扁平 `signals_cli` / `signals_mcp` / `signals_tools` 字段。
- **加载后执行证据归因**: Runner 只对同一 run 内已经 loaded 的 skill 做执行证据归因。成功的 bash/tool/MCP 调用命中声明信号时，会追加 `cli_signal` / `tool_signal` / `mcp_signal` evidence，并把 `skill_usage.payload.level` 单调升级到 `executed`。
- **保守重叠处理**: 多个已 loaded skill 命中同一 signal 时，只归因给最近 loaded 的匹配 skill，避免一个工具调用同时污染多个 skill fact。executed 仍是启发式证据，不作为确定性执行证明。

### 导航栏图标优化与菜单名称展示切换 (Sidebar Emojis & Label Toggle)
- **语义化 Emoji 图标**: 优化了设置中心左侧一级导航的 5 个图标，使用更直观、高频表达的 Emojis (`🏠`, `🤖`, `💬`, `💾`, `⚙️`) 替换了原来的抽象几何符号。
- **名称展示切换开关**: 在一级导航底部添加了一个 `🏷️` (显示名称) 按钮，控制左侧边栏是否展开并显示各菜单组的文本名称（如 “总览”、“AI 引擎”、“渠道”等）。侧边栏展开宽度与底部固定保存栏的左侧定位均完美适配并自带过渡动画。状态保存在 `localStorage` 中，刷新页面亦可自动还原 operator 的选择。

### 设置页面全面响应式多语言支持 (Complete Reactive i18n Overhaul for Settings)
- **i18n 多语言架构升级**: 全面重构了 `/settings/` 目录下全部 24 个设置子页面，彻底移除了原本基于 MutationObserver 暴力 DOM 替换的 `localizeSettings` 机制。
- **响应式 `COPY` 与 `$locale` 绑定**: 统一在 Svelte 组件的 script 块中定义中英双语 (`zh-CN` / `en-US`) 的 `COPY` 本地数据源，并通过导入 `$lib/ui/i18n` 的 `$locale` 存储实现完全响应式的模板绑定 (`{copy.title}`)。用户切换语言时，所有动态文本（包括 placeholders、KPI 描述、表格头部、下拉选项和弹窗详情）瞬间即时更新，且绝不产生闪烁或文案漏译。
- **控件与底栏规范化**: 结合此前重构，对残留的开关控件统一升级为 `IosSwitch`，并规范使用固定的 `.settings-footbar` 底栏，确保在所有设置页面中均实现统一、专业、高水准的交互。

### 设置页面设计系统风格与 iOS Switch 适配 (Settings Pages Design System & iOS Switch Overhaul)
- **多页面统一风格重构**: 针对 `/settings/agents`, `/settings/memory`, `/settings/memory-rejections`, `/settings/skills`, `/settings/skill-drafts`, `/settings/run-history`, `/settings/tasks`, `/settings/host-bash`, `/settings/system`, `/settings/sandbox`, 和 `/settings/plugins` 11 个设置页面进行了全方位的风格重构，使用统一的 Warm Shadcn 布局和配色，弃用零散的 Tailwind 工具类，引入自定义 CSS 类名（`channel-page` 等），与已重构的 `/settings/web` 保持高度一致。
- **iOS Switch 开关组件升级**: 在所有重构页面的开关配置处统一使用 `IosSwitch` 源码组件，替换原本的原生 checkbox 或非 iOS Switch 开关。
- **粘性保存底栏适配**: 将所有带有配置保存/重置动作的页面（包括 Agents, Skills, Skill Drafts 等）的提交按钮和状态反馈信息，均迁移至固定于窗口底部的粘性底栏（`.settings-footbar`）中，确保无论表单多长用户都能随时一键保存。

### 定时任务 Fresh Session 与任务会话自动清理 (Scheduled Task Fresh Sessions & Auto Cleanup)
- **事件级 `sessionMode`**: `MomEvent` 新增 `sessionMode: "fresh" | "chat"`。`fresh` 表示每次触发在全新 session 中运行（不携带聊天历史），`chat` 表示沿用聊天 active session（旧行为）。默认值：periodic → fresh，one-shot/immediate → chat（`resolveEventSessionMode`）。解决日报类周期任务的历史报告逐日累积、每次运行重复支付全部历史 input token 的问题。
- **Fresh session 即 active session**: `MomRuntimeStore.beginTaskSession` 创建 `task-` 前缀的新 session 并切换为 active，任务报告发出后用户直接在聊天中回复即可微调——反馈自然落入该任务 session，生成上下文完整保留。下次任务触发时再开新 session，上一个自动归档。
- **任务会话自动清理**: `pruneTaskSessions` 在每次创建 fresh session 时按保留期删除过期的 `task-*` session（按 entries 文件 mtime 判定最近活跃时间）；active session 与非 task 前缀的用户 session 永不删除。保留期由 `settings.events.taskSessionRetentionDays` 控制（默认 7 天，0 = 不清理，env `MOLIBOT_EVENT_TASK_SESSION_RETENTION_DAYS`）。
- **四渠道统一接线**: telegram / feishu（流式与非流式）/ weixin / qq 的 triggerTask 在 synthetic 消息上标记 `sessionMode`，session 解析统一收敛到 `BaseChannelRuntime.resolveInboundSessionId`。
- **createEvent 工具支持 sessionMode**: agent 创建定时任务时可显式指定 `sessionMode`，工具描述中说明了 fresh/chat 语义与默认值。
- 测试: 新增 `taskSessions.test.ts`（5 个用例：创建、过期清理、保留期关闭、默认模式解析、天数换算），全部通过。

## 2026-06-12

### Subagent 触发可观测性与触发场景扩展 (Subagent Trigger Observability & Scenario Widening)
- **run-summaries 持久化 Subagent 遥测**: `RunSummary` 新增 `subagent` 字段（`delegationNoticeSent` / `invoked` / `taskCount` / 每个任务的 agent、mode、stopReason、耗时、错误、任务预览），runner 在 `subagent_execution` 事件流中采集并写入成功/失败两条 run summary 路径。此前 subagent 是否触发只能在终端 momLog 中看到，无法事后查证；现在可直接 `grep '"subagent"' run-summaries.jsonl` 审计。
- **run closing note 展示 Subagent 使用情况**: 调用过 subagent 时显示任务数与角色；收到委派建议（12 次工具调用阈值）但未使用时显示 "delegation recommended but not used"，便于发现模型忽略建议的 run。
- **触发场景从 codebase-heavy 扩展为 file/shell-heavy**: 系统提示词（tools 段 + subagents 段）与 `SUBAGENT_DELEGATION_RUNTIME_NOTICE` 统一改写——日志/数据文件分析、长文档处理、多文件 artifact 构建等 bash 密集任务现在也被明确引导委派；同时新增反向约束：subagent 仅有 read/bash(/edit/write)，需要 webSearch/imageGenerate/attach 等父级工具的步骤不得委派。旧版 notice 文案保留在 transient 剥离集合中，历史会话中的旧 notice 仍会被正确清理。

### 文件工具加固 (File Tool Hardening: read/write/edit/bash)
- **edit `$` 替换模式 bug 修复**: `String.replace` 会把 newText 中的 `$&`/`$'`/`` $` `` 解释为特殊替换模式导致写入内容被悄悄破坏，现改用 replacer 函数按字面值插入。
- **edit 功能增强（参考 Claude Code FileEditTool）**: 新增 `replaceAll` 参数；多匹配时报具体数量并提示扩大片段或用 replaceAll；oldText===newText 提前拒绝；CRLF 文件按 LF 归一匹配、写回时还原原始换行风格。
- **read 重写**: 不再 spawn `wc`/`cat`/`tail`，改为 fs 直读 + JS 切片；修复带末尾换行文件总行数多报一行的 off-by-one；二进制文件（前 8KB 含 NUL）直接拒绝；图片超过 5MB 拒绝读取，避免 base64 撑爆上下文。
- **write 修正**: 返回的字节数改用 `Buffer.byteLength`（此前中文内容按字符数误报）；删除恒真的死代码条件。
- **bash 文件操作硬门禁**: `decideBashToolPolicy` 新增 `findFileToolRedirect` 规则——单独的 `cat`/`head`/`tail`/`less` 读文件、`echo/printf/cat > file`、heredoc、`echo | tee`、`sed -i`/`perl -i`/`awk -i inplace` 一律 deny 并提示改用 read/write/edit 工具；管道组合、多文件合并（`cat a b > c`）、`make | tee log` 等复合用法不受影响。bash 工具描述同步加了 prompt 级引导。
- **清理**: 删除 helpers.ts 中无调用方的重复 `truncateTail`（统一使用 truncate.ts 的 UTF-8 安全版本）。
- 测试: 新增 read.test.ts、bashPolicy.test.ts，扩充 edit.test.ts（`$` 字面值、replaceAll、多匹配、CRLF），tools 目录 80 个测试全部通过。

### 沙箱可写目录扩展与审批幂等回复 (Sandbox Writable Roots & Idempotent Approval Replies)
- **数据目录全量可写**: `buildEffectiveSandboxConfig` 的 allowWrite 现在包含 `config.dataDir`（默认 `~/.molibot`）与 workspaceDir，schedule/服务往数据目录内写入不再被沙箱拦截；bot 维度 scratch 目录仍是默认工作目录（cwd），数据优先落 scratch 的约定不变。denyWrite（`.env*`、`*.pem`、`*.key`、sandbox env 文件）依旧生效。
- **临时目录按真实路径放行**: macOS 上 `/tmp` 是 `/private/tmp` 的符号链接（`os.tmpdir()` 同理指向 `/private/var/folders/...`），沙箱按解析后路径匹配导致 `mkdir /tmp/longbridge-logs` 报 "Operation not permitted"。现在 allowWrite 同时加入 `/tmp`、`os.tmpdir()` 及二者的 `realpathSync` 结果，固定写临时路径的第三方 CLI（如 longbridge 日志目录）可直接工作。
- **重复审批操作幂等化**: 审批已处理后再次点卡片/再次回复，不再返回误导性的「未找到匹配的待处理 Host Bash 审批」，改为按记录实际状态回复（已通过正在执行 / 已批准并执行 / 执行失败原因 / 已拒绝 / 已过期），`describeResolvedApproval` 同时覆盖 approve / approve-session / reject 三条路径。

### Host Bash 审批交互修复：阻塞式审批门 (Host Bash Approval Interaction Fixes)
- **卡片命令截断**: `buildHostBashApprovalPrompt` 中展示的命令最多显示前 100 字符（超出加 `…`），不再把最长 4000 字符的完整命令塞进飞书卡片正文；审批结果卡/处理中卡复用同一 prompt body，一并生效。
- **审批改为 run 内阻塞门**: bash 工具的 `hostApproval` 请求不再以 "waiting_for_approval" 结束本轮、批准后改写上下文再 resume。`waitForHostBashApprovalAndExecute` 在 run 内轮询审批存储（最长 10 分钟，500ms 间隔，尊重 abort signal）：批准 → 原地执行宿主命令并把真实输出作为 toolResult 返回，run 持续流式更新；拒绝/过期 → 立即返回失败；仅等待超时才回退到旧的「批准后补跑 + resume」流程（测试可经 `approvalWaitTimeoutMs` 注入短超时）。审批卡片在等待开始时即通过 runner 事件下发。
- **去掉双重审批门**: `decideBashToolPolicy` 不再对带 `hostApproval` 的 bash 调用走 ApprovalBroker 门控（此前同一条命令要先批 broker 请求、再批 Host Bash 记录，各出一张卡）。
- **执行权原子认领**: 新增 `executing` 状态与 `HostBashStore.claimExecution`（`approved → executing` 的 CAS）。run 内等待者与渠道审批处理器都先 claim 再执行，彻底消除双重执行竞态；输掉 claim 的一方继续轮询直至赢家写入 executed/failed。
- **isRunActive 修复**: run id 实际是 `chatId-sessionId-messageId`，旧实现用 scopeId 查 `runs.id` 永远 false（"活跃 run 自动执行" 分支从未生效）。改为按 `session_id + status='running'` 查询并套用 10 分钟锁超时；run 活跃时审批只落库由阻塞中的 bash 执行，另挂 3 秒延迟兜底（`scheduleHostBashExecutionFallback`）防止等待已超时的批准被丢弃。
- **双审批体系桥接**: 用户文字回复「本会话允许/永久允许/拒绝」及卡片点击现在也会 resolve 同 scope 下 pending 的 ApprovalBroker 请求（`resolvePendingBrokerRequests`），仅有 broker 请求（无 Host Bash 记录）时文字审批同样命中；`ApprovalBroker` 新增 `listPendingRequests()`。修复审批通过后 run 仍报 "User approval timeout" 的问题。
- **回归验证**: 新增「阻塞等待→批准→原地执行」用例（bash-output.test.ts）与 `claimExecution` 竞态用例（store.test.ts）；更新 index.test / channelCommands.test 断言新语义；相关 9 个套件 77 个用例全部通过。

### 沙箱 Host Bash 审批流程优化 (Sandbox Host Bash Approval UX Overhaul)
- **沙箱失败检测收紧**: `isSandboxPermissionFailure` 不再对输出做 `sandbox`/`socket`/`ipc`/`access denied` 等宽泛子串匹配，只匹配 OS 沙箱真实产生的签名（`operation not permitted`、`permission denied`、`sandbox-exec`、`seatbelt`、`EPERM/EACCES`），大幅减少普通失败命令误触发自动 Host 审批。
- **审批卡片改为明确三档授权**: 审批提示统一为「仅此一次 / 本会话允许 / 永久允许此工具 / 拒绝」，按钮语义不再随请求类型（persistent/ephemeral）变化；无法归约为可复用 capability 的一次性脚本不显示「永久允许」。飞书卡片、Telegram inline keyboard、QQ/微信文字回复与 Web `/hosttools` 全部对齐。
- **普通「批准」改为最小授权**: 回复 `批准`/`approve` 或点击旧卡片的 Approve 仅执行一次、不落白名单；落白名单需显式回复 `永久允许` 或点「永久允许此工具」；`/hosttools approve` 保持白名单语义，新增 `/hosttools approve-once`。
- **复合命令一次审批全量授权**: 永久批准时把命令分类出的所有 capability（如 `gh | osascript`）分别写入 `approval_grants` 白名单，后续任一工具单独使用均免审批。
- **pending 审批 TTL + 同工具旧卡失效**: 待审批记录 60 分钟自动过期（新增 `expired` 状态）；同一 scope 下同一 capability 的新审批请求会使旧的 pending 卡片自动失效，重试命令不再堆积多张活动卡片；完全相同的命令仍复用现有 pending。
- **toolRuntime 通用审批路径修复**: 审批请求 ID 加时间戳+随机后缀消除同 run 同工具的 ID 冲突；审批提示卡现在显示真实命令/路径（之前显示的是工具名）。
- **回归验证**: 新增 `src/lib/server/hostBash/store.test.ts`（once 不落白名单、复合命令全量授权、旧卡失效、相同命令去重）；更新 `approval.test.ts`、`channelCommands.test.ts` 断言新语义，相关套件 77 个用例全部通过。

### Profile 三层作用域一致性修复 (Profile Scope Consistency)
- **BOT.md 真覆盖 AGENTS.md**: 系统提示词拼装中，当 bot 目录存在 `BOT.md` 时不再同时注入 agent/global 的 `AGENTS.md`，与 `profileFiles` 工具 bootstrap 的"bot 覆盖 agent 覆盖 global"语义对齐，消除 bootstrap 后同一内容在提示词里出现两遍的问题。
- **USER/TOOLS 回退链对齐**: `profileFiles` 工具的父级回退只在 agent 维度实际包含该文件（`AGENTS/SOUL/IDENTITY/SONG`）时才检查 agent 目录；`USER.md`、`TOOLS.md` 直接回退到 global，与提示词拼装一致，避免 agent 目录残留文件导致"读到的"与"实际生效的"不一致。
- **常量去重**: 工具复用 `BOT_PROFILE_FILES`，提示词拼装的 global 默认文件列表复用 `GLOBAL_PROFILE_FILES`，frontmatter 剥离逻辑统一复用 `profiles.ts` 的 `normalizeEditableBody`，消除三处手抄副本的漂移风险。
- **bot 根路径解析加固**: `profileFiles` 的 `resolveBotRoot` 现在把路径截断到 `/bots/<botId>`，传入更深层路径（如 chat 目录）也能解析出正确的 botId。
- **回归验证**: `prompt.test.ts` 新增用例覆盖"无 BOT.md 时注入 global AGENTS.md / 有 BOT.md 时只注入 BOT.md"两种合并行为。
### Agent Hook 框架加固与可插拔化 (Agent Hook Framework Hardening & Pluggability)
- **Gate 失败默认拒绝 (fail-closed)**: gate 类 hook 抛错或超时时不再静默放行，默认返回 `deny`（`HOOK_GATE_FAILURE`）；hook 可声明 `failMode: "open"` 显式选择失败放行。
- **Observe 队列按 run 隔离**: `DefaultHookManager` 的 observe 事件队列从全局单链改为按 `runId` 分队列，慢 hook 不再拖慢其他并发 run；`flush()` 支持 `runId` 参数做单 run 排空，runner 结束时改用 `flush({ runId, timeoutMs: 2000 })`。
- **Emit payload 快照**: `emit()` 时对 payload 做 `structuredClone` 快照，调用方在 emit 后修改对象不会影响异步 hook 看到的数据。
- **Transform 管线默认启用并接入 runner**: `input.enrich.after` 支持 transform hook 改写富集后的输入文本；`prompt.build.after` 支持 transform hook 改写系统提示词（在 prompt 重建时应用并随 promptRefreshKey 缓存）。
- **TraceRecorderHook 状态防泄漏**: run 状态与 fact 起始状态改为按 runId 的二级 Map，run 结束整体释放；新增 1 小时 TTL + 5 分钟间隔清扫，覆盖 `run.finished` 永不到达的异常路径。
- **插件加载入口**: 新增 `pluginRegistry.ts`（`registerHookPluginFactory` / `applyConfiguredHookPlugins`），由 `settings.plugins.hooks: [{ id, enabled, options }]` 控制启用；单个插件 init 失败不影响其它插件和运行时启动。插件 hook id 自动加 `pluginId/` 命名空间防冲突；`unregisterPlugin` 先 flush 在途事件再 destroy。
- **类型化 Stage Payload**: 新增 `StagePayloadMap`，`emit/transform/gate` 按 stage 类型约束 payload 字段（保留开放索引签名）；未接入的 stage 在 `HookStage` 上标注 `(reserved)`。
- **小优化**: stage→hooks 索引缓存（注册/注销时失效）替代每次 emit 全量排序过滤；runner 的内联空实现替换为共享 `NOOP_HOOK_MANAGER`。
- **回归验证**: `manager.test.ts` 新增 fail-closed / fail-open、transform 链式 replace、per-run flush 隔离、payload 快照、插件命名空间用例；hooks 全部测试与 `runner.test.ts` 通过。

## 2026-06-11

### Adapter-node SQLite 构建告警清理 (Adapter-node SQLite Build Warning Cleanup)
- **显式 external 化 `node:sqlite`**: SvelteKit 生产构建改用项目内 adapter-node 变体，在 adapter 最终 Rollup 打包阶段把 `node:sqlite` 标记为 external，避免 build 末尾出现无法解析 `node:sqlite` 的 adapter 告警。
- **Node 版本前提收紧**: 项目 `engines.node` 从 `>=22.0.0` 调整为 `>=22.5.0`，对齐内置 `node:sqlite` 的真实运行要求。

### DB 目录集中管理 (Centralized DB Directory)
- **统一 SQLite 默认目录**: 默认数据库目录新增为 `${DATA_DIR}/db`，`settings.sqlite`、`inbound-queue.sqlite`、`outbox.sqlite` 和 Mory 的 `mory.sqlite` 都集中到该目录下，不再散落在数据根目录或 `memory/` 子目录。
- **旧路径自动迁移**: 启动初始化会在新路径不存在时把旧的 `${DATA_DIR}/settings.sqlite`、`inbound-queue.sqlite`、`outbox.sqlite`、`memory/mory.sqlite` 迁移到 `${DATA_DIR}/db/`，并同步迁移 SQLite 的 `-wal` / `-shm` sidecar 文件。
- **显式路径仍可覆盖**: 新增 `DB_DIR` 环境变量控制统一 DB 目录；`SETTINGS_DB_FILE` 等显式测试或运维路径保持优先，避免破坏隔离测试和自定义部署。

### Feishu 多机器人群聊 @ 归属过滤 (Feishu Multi-Bot Mention Ownership)
- **严格匹配被 @ 机器人身份**: Feishu 群聊主消息流现在只有在消息 `mentions` 命中当前 Bot 的身份 ID 时才触发运行；@ 群内其他机器人不会再让本实例响应。
- **移除任意 @ 兜底误触发**: 当当前 Bot 身份尚未解析或解析失败时，群聊 direct mention 不再退化为“只要有任意 @ 就响应”，避免多机器人群里同时回复。私聊和已登记 Bot thread 续聊逻辑保持不变。
- **Bot 身份解析对齐 openclaw-lark**: 运行时和 `/api/settings/feishu/test` 现在优先使用 `POST /open-apis/bot/v1/openclaw_bot/ping` 读取 `pingBotInfo.botID/botName`，仅在 ping 未返回身份时回退到 `/open-apis/bot/v3/info`，避免旧接口返回 `code: 0` 但身份字段为空导致群聊 @ 全部被忽略。
- **防止忙碌重试复制队列**: Feishu 入站 worker 遇到 “Another run is currently active” 时不再重新插入一条队首任务，避免启动恢复或锁竞争时把同一条消息复制成大量 completed/pending 记录并放大 SQLite 锁冲突。
- **完成/废弃队列自动清理**: 共享 `PersistentTaskQueue` 改为在成功、失败、手动删除、批量取消以及启动时发现遗留 running 任务时直接删除 SQLite 记录，避免跨渠道入站队列长期保留 completed/failed/cancelled 记录导致数据库膨胀、WAL 变大和首个设置页请求被 runtime 初始化拖慢。
- **SDK 适配判断**: 现有 Feishu runtime 已使用 `@larksuiteoapi/node-sdk` 的 Client / WSClient / EventDispatcher；本次问题属于入站触发过滤和身份探测 endpoint 选择，不需要引入额外 SDK 适配层。
- **回归验证**: 扩展 `src/lib/server/channels/feishu/message-intake.test.ts` 和 `src/routes/api/settings/feishu/test.server.test.ts`，覆盖 @ 当前 Bot 放行、@ 其他 Bot 忽略、Bot 身份未知时忽略群聊 @、已知 Bot thread 继续免 @ 续聊、ping 身份解析和 v3 fallback。

## 2026-06-10

### Global Profile File 防误写保护 (Global Profile File Write Guard)
- **移除路径自动重路由**: 从 `resolveToolPath` 中移除 `resolveGlobalProfilePath`，不再将被判定为 profile 文件名的路径无条件重路由到 `dataRoot/`。此前 `SOUL.md` 等文件名无论路径层级都被解析到全局文件，导致 bot 维度的 write/edit 误改全局配置。
- **门禁阻断全局 profile 直接写入**: `createPathGuard` 对全局 profile 文件 (AGENTS.md, SOUL.md, TOOLS.md, BOOTSTRAP.md, IDENTITY.md, USER.md, SONG.md) 由**显式放行**改为**显式拒绝**，统一提示使用 `profileFiles` 工具管理。读取能力不受影响——`profileFiles` 工具内部直接调用 `profiles.ts` 的读写函数，不经过路径守卫。
- **修复文件**: `src/lib/server/agent/tools/path.ts`

## 2026-06-08

### Feishu Bot 健康检查与 Thread 续聊 (Feishu Bot Health Check & Thread Continuation)
- **Bot 连接测试**: 新增 `/api/settings/feishu/test`，允许 `/settings/feishu` 使用当前表单中的 `appId` / `appSecret` 直接测试飞书 Bot 凭据，成功时返回 Bot 名称和 `open_id`，失败时返回飞书 SDK `code` / `msg` 或本地校验错误。
- **设置页健康面板**: 在 Feishu Bot Configuration 区块加入 `Test Connection` 操作和结果面板，保留现有多 Bot 单实体保存流程与 `.settings-footbar` 固定保存底栏。
- **Thread 免 @ 续聊**: Feishu 入站消息保留原始 `message_id`、`thread_id`、`parent_id`、`root_id`，并为 thread 生成独立 `scopeId`，让同一群里的不同 thread 拥有独立 session、队列、附件和运行日志。
- **保守触发策略**: 群主消息流仍需 @ Bot；只有 Bot 已在某个 Feishu thread 中回复过，或用户回复命中已知 Bot 消息时，该 thread 后续无 @ 消息才会触发同一对话。旧 registry 数据缺失时，用户只需在老 thread 中重新 @ 一次。
- **Thread 内回复渲染**: Feishu 文本、卡片、CardKit streaming、文件/图片 fallback 均支持 `im.message.reply({ reply_in_thread: true })`，关闭 CardKit streaming 后也不会退回群主消息流。
- **回归验证**: 新增 Feishu intake、thread registry、messaging reply 和 settings test endpoint 覆盖；验证普通群无 @ 不触发、带 @ 触发、已登记 thread 无 @ 触发、未知 thread 无 @ 不触发，以及 thread 回复走 `im.message.reply`。

## 2026-06-07

### System Prompt Skill Routing 合并与 Preview 防误导 (System Prompt Skill Routing Merge & Preview Guardrail)
- **Skill routing 去重**: 将独立的 `Skill Routing (Mandatory)` section 合并回 `Message Processing Pipeline` 与 `Skills Protocol`，保留显式 skill 调用、`[explicit skill invocation]` 权威路径、读取 `SKILL.md`、输出媒介不静默降级和失败 fallback 等规则，同时减少系统提示词重复段落。
- **静态 preview 防误导**: 将 `src/lib/server/agent/prompts/templates/SYSTEM_PROMPT.preview.md` 从过期的完整旧样例改成静态占位说明，明确真实预览来自 `buildSystemPromptPreview()` / Web prompt preview endpoint / runtime 生成文件，避免继续传播手写 event JSON 的旧调度做法。
- **Prompt 长度回归检查**: `prompt.test.ts` 新增真实 `buildSystemPromptPreview()` render 测试，使用临时 workspace 校验 broad size budget，并固定 `available-deferred-tools`、`createEvent`、`skillSearch`、`skills-protocol` 等关键路由锚点。
- **验证命令更新**: 系统提示词重构方案文档中的验证命令已从不可用的 `npm test -- --run ...` 更新为当前仓库可执行的 `node --import ./scripts/register-loader.js --import tsx --test ...`。
- **ToolRuntime 测试库隔离**: `ToolRuntime` 支持注入测试专用 `WorkspaceStore`，`toolRuntime.test.ts` 的 workspace whitelist 用例改用临时 SQLite 文件，避免写真实 settings DB 并修复 `attempt to write a readonly database` 失败。

### Trace Facts 模型用量补写与 Usage 关联 (Trace Facts Model Usage Backfill & Usage Alignment)
- **模型调用 token 补写**: Runner 在 assistant 消息结束并拿到 `usage` 后，会额外向 HookManager 发出同一 `modelAttemptId` 的 `model.call.after` 事件，使 `agent_trace_facts` 的 `model_call` 记录也能拿到 input/output/cache/total token。
- **工具后续写模型请求拆分记录**: 同一个 Agent prompt 内如果发生“模型请求 -> 工具调用 -> 工具结果后再次请求模型”的循环，每次真实 AI API 请求都会生成独立的 `modelAttemptId`，避免工具后的模型请求覆盖第一次模型调用 fact。
- **Trace 与 Usage 口径对齐**: `/settings/ai/usage` 继续作为独立用量账本读取 `usage/ai-usage.jsonl`；`/settings/ai/trace` 继续读取 SQLite trace facts，但现在通过同一 run/session/model attempt 维度记录模型用量，便于把用量统计和运行 trace 对上。
- **total token 兜底计算**: 当模型返回 usage 里没有显式 `totalTokens` 时，TraceRecorder 会用 input/output/cache read/cache write 相加补出总数，避免 Recent Trace Facts 里只有分项没有总数。
- **回归验证**: 更新 `traceRecorderHook.test.ts` 和 `runner.test.ts`，覆盖 cache token 透传、total 兜底和 runner 模型调用 hook payload。

## 2026-06-06

### Agent HookManager 运行时扩展 (Agent HookManager Runtime Extension)
- **运行时可插拔 HookManager**: 新增了基于事件总线的 `HookManager` 模块，为 Molibot Agent 的各项关键生命周期事件（包括运行启动/结束、模型调用前/后、工具调用前/后、工具拦截/报错、技能选择/加载）提供可插拔的插件系统。
- **内置调试与 trace telemetry 插件**: 实现了两个内置 observe 插件——`DebugLogHook`（向控制台输出诊断日志）和 `TraceRecorderHook`（将 sanitized 后的结构化运行 trace 日志通过 `SqliteTraceStore` 存储在本地 SQLite 数据库中，并以 `runId` 隔离/在结束后清理状态以防泄漏）。
- **统一 trace facts 分析表**: 在保留原始 `agent_trace_events` 事件流的同时，新增统一 `agent_trace_facts` 表，用 `fact_type` 区分 `tool_call` 与 `model_call`，将工具名、调用状态、耗时、模型 provider/model、token usage 等常用分析字段独立成列，便于按 session/run 统计调用次数和关联工具。
- **Trace 分析设置页**: 新增 `/settings/ai/trace` 与 `/api/settings/trace`，复用用量统计页的时间段筛选体验，按 Usage 页同一 `botId` 口径记录和筛选 Bot，并支持 channel、chat ID、session ID、run ID、fact 类型和读取上限筛选；页面展示工具调用、模型请求 token、Bot、channel/chat、session、run、最近 facts 等汇总与明细，方便核对某个工具是否实际调用及调用次数是否符合预期。
- **拦截控制网关与拦截事件日志**: 实现了 gate net 网关能力，允许注册拦截型 hook 依据自定义的安全或预算策略直接在 tool preflight/budget 前提拦截 tool 执行，并通过 `tool.call.blocked` 上报 `blockedBy: "hook_gate"`。
- **全链路依赖注入与 Runner 桥接**: 在 runtime 引擎（`baseRuntime`、Web context）以及 `RunnerPool` 和 `MomRunner` 中完整注入了 `hookManager` 单例，并将 `pi-agent-core` 的回调和 Molibot 本身的模型选择、技能加载完整桥接至事件通知网关。
- **终态 trace 与插件生命周期修复**: 修复 Runner 早退路径未写入 `run.finished` 的问题，确保设置错误、缺失 API Key 等未进入 `agent_end` 的运行也有终态 trace；同时让 `HookPlugin.init()` 接收真实 `RuntimeSettings`，并修复 critical observe hook 失败后 observe 队列不再处理后续事件的问题。

### SQLite 动态设置迁移与细粒度 API 改造 (SQLite Settings Migration & Fine-grained APIs)
- **设置配置存储数据库迁移**: 将原本存放在 `settings.json` 里的 `webSearch` (搜索配置)、`imageGenerate` (图片生成配置)、`videoGenerate` (视频生成配置) 和 `toolSandbox` (运行沙箱配置) 统一迁移到 SQLite `settings_dynamic` 数据库表中，通过键值对和 JSON 序列化形式结构化存放，减小大 JSON 文本对内存和持久化的压力。
- **动态键值存储与表合并**: 废弃了原方案创建 7 张具体配置子表的做法，改用现有的 `settings_dynamic` 动态表，使用对应的 `settings_web_search`、`settings_image_generate`、`settings_video_generate` 和 `settings_sandbox` 作为键进行存储。
- **启动时配置与旧表自动搬迁**: 在系统加载 `SettingsStore` 时，会自动检测 `settings.json` 中的旧字段以及 SQLite 中若已存在的旧版独立表，将其搬迁、转换并导入 `settings_dynamic` 键值行中，并在落盘时自动把 `settings.json` 中的旧字段以及 SQLite 中的旧表进行清理与删除。
- **推出统一动态更新 API**: 新增了统一配置更新与读取接口 `/api/settings/dynamic/[key]`，支持对具体 Key 配置进行 `GET` (读取)、`PUT`/`POST`/`PATCH` (写与更新)。Web 搜索、图片生成、视频生成和沙箱设置页面在初始化时均通过该 API 独立按需加载，保存时仅对该 Key 进行增量修改并回写，从而完全免去了旧的 `/api/settings` 大查询与原本的独立更新接口，有效规避冲突。

### AI 提供商页面样式切换与模型开关保存修复 (AI Providers Page Switches & Model Enable Save Fix)
- **提供商页面独立 API 解耦**: 扩展了 `/api/settings/custom-providers` 接口，支持 `GET` (读取提供商相关配置) 和 `PUT` (保存提供商模式、默认服务商设置)，重构了 `/settings/ai/providers` 设置页面使其初始化和保存时仅定向请求此接口，彻底取消了对大 `/api/settings` 接口的依赖。
- **Shadcn iOS 开关替换**: 将 AI 提供商设置页面（`/settings/ai/providers`）的提供商启用状态与单模型启用状态两处自定义 HTML checkbox 开关，替换为 `src/lib/components/ui/switch` 统一的 iOS 样式开关组件。
- **自定义模型启用保存修复**: 修复了模型列表单模型启用状态无法被保存的 Bug。更新了 `ProviderModelConfig` 类型定义与 `+page.svelte` 保存函数映射机制，打通了 `enabled` 状态的序列化与存储。并修正了 `ensureProviderDefaults`、`addModel`、`confirmAddModel` 和 `addDiscoveredModel` 中对 `enabled` 字段的正常传递与默认初始化，防止在保存映射和新增模型时丢失 `enabled` 属性值。
- **后台过滤与路由对齐**: 在模型选择与路由层（`modelRouting.ts` 的 `pickCustomModelId`、`getProviderModel` 以及 `modelSwitch.ts` 的 `buildModelOptions` 等）增加了 `enabled !== false` 过滤机制，避免已被禁用的自定义模型参与服务路由或展示在可选列表中。
- **Svelte a11y 构建告警清理**: 修复 Providers、Image、Video 设置页的 modal/backdrop 可访问性告警，移除静态 modal card 上的 click/keydown handler，改用 backdrop 自身目标判断关闭弹窗；为图标关闭按钮添加 `aria-label`，并为视频预览补充有效 captions track，使 `npm run build` 不再输出 Svelte a11y warnings。

### HookManager 运行时扩展设计方案细化与评审 (HookManager Runtime Spec Refinement & Review)
- **挂载式多播设计**: 明确 HookManager 并非替代 pi-agent-core 循环，而是作为其上的多播层挂载在已有回调点（`beforeToolCall`, `afterToolCall`, `subscribe` 等）上。
- **生命周期语义澄清**: 重命名阶段为 `run.started` / `run.finished` 以与 pi-agent-core 内部 LLM turn-level 状态区分；重新规划 `beforeToolCall` 桥接点，使 gate 拦截在 preflight/budget 前置触发。
- **运行性能与内存防护**: 确立 observe hook 默认以异步非阻塞队列运行以不增加 LLM 响应延迟；要求全局 `TraceRecorder` 实例内部的状态（如 span stack）必须以 `runId` 隔离并在结束后清理，避免跨会话污染与内存泄漏。
- **可插拔插件接口**: 新增 `HookPlugin` 接口定义，为未来的 S3 结果导出和 Webhook 通信留好扩展插槽。

### AI 设置页面顶部 Hero 栏尺寸收缩与统一 (AI Settings Pages Hero Header Compact Unification)
- **全局顶部栏缩减**: 为包括 Routing、Providers、Errors、MCP、Search、Image、Video、Usage 以及其他 16 个使用 Tailwind inline classes 布局的普通设置页面在内的所有设置页面，应用了全局统一的 Hero 头部样式规范。
- **排版与间距优化**: 将所有标题的字号从 `1.875rem` / `2rem` 缩小至 `1.375rem`，描述文字字号统一至 `0.8125rem`（13px）并且行高设为更紧凑的 `1.45`。头部内的间距 gap 从 `0.75rem`/`1rem` 缩减至 `0.375rem`，下边距设为 `0.5rem`。
- **多余垂直留白消除**: 将各设置页面最外层容器在 Svelte 结构中渲染的默认 `padding-top` 从 Tailwind 默认的 `py-8` / `sm:py-10` 重载并缩减为统一的 `0.5rem !important`，从而消除由于 Layout 叠加导致的上方过大空白。

### AI 设置页面底部固定栏全宽适配与样式抽离 (AI Settings Pages Footer Full-Width & Style Extraction)
- **底栏全宽适配**: 将路由（`/settings/ai/routing`）、提供商（`/settings/ai/providers`）、报错记录（`/settings/ai/errors`）、MCP（`/settings/mcp`）、搜索（`/settings/search`）和视频（`/settings/video`）等设置页面的底栏从 `div` 元素改为 HTML5 语义化的 `footer` 元素。这成功绕过了 `workbench.css` 中限制 `.settings-viewport > div` 最大宽度的样式污染，使底栏可以像用量统计页面一样，完整打通横跨右侧的整个右半屏幕宽度。
- **自定义样式完全抽离**: 将上述所有 AI 设置子页面（包括路由、提供商、用量统计、报错、MCP、搜索、图片、视频等 8 个页面）中的 Svelte 内部 `<style>` 样式块完全删除，全部转换为普通类名，并将所有对应样式规则整合到全局独立的 `src/styles/settings-custom.css` 中，防止 Svelte 编译器在运行时动态在 `<head>` 中生成大量 scoped 内部样式（即 Header code 样式）。
- **去内联样式与规范化**: 移除了搜索设置页面中测试结果成功提示的内联 style，在 `settings-custom.css` 中新增 `.search-test-result[data-tone="success"]` 类选择器，并通过 `data-tone` 进行样式绑定。

### AI 设置子页面统一重构与布局居中对齐 (AI Settings Pages Styling Unification & Center Alignment)
- **统一居中展示**: 重构了所有 AI 设置相关页面（包括路由、提供商、用量统计、报错记录、MCP、搜索、图片和视频设置页面），为它们的主页面容器（`.routing-page`、`.providers-page`、`.usage-page`、`.errors-page`、`.mcp-page`、`.search-page`、`.image-page` 和 `.video-page`）添加了统一的居中对齐规则（`margin: 0 auto;`），使得中间的内容区域左右留白完全对称，彻底解决了在大屏下左偏的问题。
- **打通全屏的底栏**: 将所有页面的粘性保存/操作底栏（`.settings-footbar`）从页面的 max-width 容器中移到最外层，从而配合全局 `left: calc(72px + 260px); right: 0;` 属性，能够真正打通全屏，横跨整个右侧主显示区。
- **提供商与图像设置页 Hero 头部适配**: 移除了提供商设置（`/settings/ai/providers`）和图像生成设置（`/settings/image`）对 Svelte `SettingsSection` 布局组件的依赖，替换为与路由页面一致的精美 `.providers-hero` / `.image-hero` 衬线标题头部，并进行了 scoped CSS 的精细化编写。
- **视频设置页固定底栏与表单联动**: 重构了视频生成设置页面（`/settings/video`）的表单结构，将其输入控制及引擎列表包裹在 `<form id="video-form" ...>` 中。将原先位于卡片底部的普通保存按钮，移至悬浮在下方的固定粘性底栏（`.settings-footbar`），始终横跨全屏底部，与表单 action 完美绑定，从而实现 AI Settings 下所有页面交互和视觉风格的绝对统一。

### Telegram 视频附件扩展名保留 (Telegram Video Attachment Filename Preservation)
- **保留媒体扩展名**: Telegram `attach` 上传二进制媒体时，如果工具传入的 `title` 没有扩展名，会自动补回源文件路径的扩展名。例如本地文件 `aerobics_practice.mp4` 搭配标题“女健美操运动员练习视频”时，实际上传文件名会变成“女健美操运动员练习视频.mp4”，避免平台因上传文件名缺少 `.mp4` 而出现视频展示异常。
- **视频流式播放提示**: `sendVideo` 现在附带 `supports_streaming: true`，让 Telegram 更明确地按原生视频消息处理可在线播放的 MP4。
- **回归测试补充**: `runtime.test.ts` 新增覆盖“标题无扩展名但源文件是 `.mp4`”的上传文件名解析断言。

### 设置页面样式重构 (Settings Pages Styling Refactor)
- **errors/mcp/search 页面 Warm Shadcn 重构**: 重构了模型报错记录（`/settings/ai/errors`）、MCP 服务（`/settings/mcp`）和搜索工具（`/settings/search`）这三个设置页面的样式与布局，彻底弃用旧的 `.wb-` Workbench 样式，转为与 AI 路由页面一致的 Warm Shadcn 高级衬线排版风格。
- **iOS 粘性保存底栏适配**: 将 MCP 服务与搜索工具设置页面的保存按钮重构为符合 `DESIGN.md` 规范的固定粘性底栏（`.settings-footbar`），始终悬浮在内容区最下方，并联动 `<form>` 提交动作。模型报错记录页面的“刷新记录”操作也被集成到了固定底栏中。
- **iOS-style 状态开关组件**: 将 MCP 服务列表和搜索引擎列表里的原生 HTML 开关/逻辑，重构为统一的 Svelte `<Switch>` 源码组件，配合明暗模式实现平滑过渡。
- **移除 SettingsSection 布局依赖**: 取消这三个页面对 `SettingsSection` 包装组件的依赖，替换为自定义的 Hero 头部区域，并清理了文件中未使用的 Svelte UI 组件导入。

### 图像生成记录入库与历史记录管理 (Image Generation SQLite Logging & History Management)
- **SQLite 增加图像记录表**: 在 SQLite 数据库中新增 `image_tasks` 表，用于存储图像生成任务记录（包含 `id`、`engine`、`session_id`、`status`、`prompt`、`image_path`、`image_url`、`request_params`、`error_message`、`created_at`、`updated_at`）。
- **工具执行同步入库**: 在 `imageGenerate` 工具执行时，生成唯一 Task ID，先向 SQLite 写入一条 `processing` 记录；并在生成完成后，将状态更新为 `completed`（保存本地绝对路径与远程 URL）或 `failed`（保存错误信息）。
- **后台 API 路由配置**: 新增 `/api/settings/image-generate/tasks` 接口，支持读取最近 50 条图像生成记录及根据任务 ID 删除记录；新增 `/api/settings/image-generate/image` 接口，支持根据任务 ID 读取并串流本地图像文件或重定向到远程公网 URL。
- **设置页面历史查询与重构**: 在 `/settings/image` 设置页面下方新增“最近生成记录”表格，展示生成记录的创建时间、任务 ID、引擎、提示词、状态，并支持“查看结果”（弹出浮窗展示生成的图片与详细元数据）、“查看参数”（查看/复制原始请求参数）和“删除”操作。
- **粘性保存底栏适配**: 将图像生成设置页面的提交表单重构为符合 `DESIGN.md` 规范的固定粘性底栏（`.settings-footbar`），以提供更加一致、流畅的保存交互体验。
- **单元测试覆盖**: 在 `imageGenerateTool.test.ts` 单元测试中，新增针对 SQLite 任务入库和记录详情的完整断言。

### 视频远程 URL 存储与 302 重定向播放 (Remote Video URL Storage & Redirect Streaming)
- **取消大型文件本地下载**: 从后台任务轮询器（`/api/settings/video-generate/tasks`）和 `videoGenerate` 工具的查询逻辑中，移除了拉取下载远程 `.mp4` 文件到本地并落盘的步骤。这彻底解决了在网络较差或目标存储服务连接不稳定时（如遇到 Google GCS 的 `ECONNRESET` TLS 连接重置错误）而导致已成功生成完成的任务在本地库被误判/更新为 `failed` 失败状态的问题。
- **SQLite 增加远程 URL 字段**: 更新 [`videoTaskStore.ts`](file:///Users/gusi/Github/molipibot/src/lib/server/agent/videoGenerate/videoTaskStore.ts)，在任务记录表 `video_tasks` 中安全增加 `video_url` 列。在服务启动初始化时，会自动执行表结构变更，从而安全保留已有的任务数据。
- **Agent 查询优先使用 SQLite 缓存**: 当 `videoGenerate` 通过 `taskId` 查询任务时，优先读取 `video_tasks`。已完成任务直接返回 DB 中的 `Remote URL`；处理中任务若 `updated_at` 距今不超过 30 秒，则直接返回缓存进度；超过 30 秒才向供应商查询一次状态并把最新进度或 `video_url` 写回 DB。
- **302 重定向透明流式预览**: 优化了 `/api/settings/video-generate/video` 后端流媒体响应接口。在检测到任务无本地保存文件但有远程 `videoUrl` 时，自动返回 302 重定向至远程地址，使得控制台内置的播放器和下载链接可以免修改、无感地在线播放或下载远程生成的视频。
- **工具返回远程地址给 AI**: `videoGenerate` 工具查询完成后直接将 `Remote URL: https://...` 返回给 AI Agent 的上下文。若 DB 中同时存在本地路径才附带 `Local path`，不再因本地路径为空输出 `unknown` 或触发本地文件查找。
- **请求参数入库与详情/列表展示**: 在 SQLite 的 `video_tasks` 表中安全增加了 `request_params` 字段。在 AI Agent 创建视频任务时，自动捕获并存入提交给云端 API 的所有原始请求参数（例如：prompt、model、images 等）。在 `/settings/video` 页面任务列表的“操作”列中，直接新增了“查看参数”按钮（当存在请求参数时即可点击，支持生成中状态），并在详情弹窗中增加了“请求参数”格式化 JSON 复制区块，便于核对和排查提示词及参考图引用关系。


### 图像绝对路径输出与 images 参数容错标准化 (Image Path Visibility & Robust Parameter Normalization)
- **图像远程 URL 与绝对路径输出**: 更新了 `imageGenerate` 工具返回的成功文本内容。当供应商返回公网图片地址时，工具会输出 `Remote URL: https://...`，同时继续输出本地保存路径 `Saved file to` 与绝对路径 `Absolute path`。这确保了当图片成功生成时，AI Agent 能够优先把公网 URL 传给后续视频生成工具，同时保留本地归档文件用于查看和调试。
- **渠道上传失败不吞掉生成结果**: `imageGenerate` 将图片生成/保存成功与聊天渠道上传成功分离。若 Telegram 等渠道 `sendPhoto`/`sendDocument` 网络失败，工具仍返回成功结果、远程 URL、本地路径和上传错误说明，避免 Agent 误判为图片生成失败。
- **images 参数容错与标准化**: 将 `videoGenerateSchema` 中的 `images` 字段类型修改为支持数组或单个字符串（使用 `Type.Union`）。在工具执行时，对传入的 `params.images` 进行了运行时标准化处理：支持自动解析 JSON 字符串化数组（例如 `'["/path/to/img"]'`) 并映射为常规的字符串数组，而对于普通的单个字符串路径/URL，则自动用数组包裹，规避了由于 AI 混淆输入格式、把 string 传给 array 遍历而导致逐字符迭代寻找路径（如寻找名为 `[` 的文件）报错的问题。
- **视频参考图只接受公网 URL**: `videoGenerate` 不再把本地图片路径读取成 Base64 Data URL 提交给 Agnes 或火山视频接口。工具会在提交前拒绝本地路径和 `data:` URL，并提示使用 `imageGenerate` 返回的 `Remote URL`，避免供应商因无效 Base64 或不可访问本地路径返回 400。
- **回归测试补充**: 在 `videoGenerateTool.test.ts` 中新增了分别使用 JSON 字符串数组和普通单路径字符串作为 `images` 参数的两个测试用例，校验其运行时的标准化和路径解析能力。

### 视频生成参考图公网 URL 校验与轮询容错优化 (Video Generate Public URL Validation & Poller Fault Tolerance)
- **参考图公网 URL 前置校验**: 修复了远端视频生成服务（Agnes AI 和火山引擎）无法读取本机路径或 Base64 Data URL 而导致 400/500 报错的问题。当检测到 `images` 参数传入本地路径或 `data:` URL 时，工具会立刻拒绝并提示使用 `imageGenerate` 返回的 `Remote URL`，避免向云端 API 发送不可用图片引用。
- **本地路径提交拦截**: 如果传入的参考图不是 `http://` 或 `https://` 公网地址，工具会在提交供应商前直接返回明确错误，不再读取本地文件或构造 Base64。
- **后台轮询限制与错误规避**: 修复了由于 Agnes 返回的 `error` 报错以结构化对象形式存在而导致 SQLite 绑定入库崩溃的问题。优化后台轮询管理器和工具查询逻辑，在遭遇 4xx 终端 HTTP 错误或连续拉取失败 3 次时，自动在数据库中将任务标记为 `failed` 失败状态，防止无限重复循环拉取。
- **单元测试补充**: 新增针对远程图片 URL 透传、本地路径拒绝和 Base64/data URL 拒绝机制的独立单元测试，运行且测试完全通过。

### Telegram 流式长消息分片复用 (Telegram Streaming Long-Message Chunk Reuse)
- **复用已有分片消息**: Telegram answer lane 现在保存完整的分片消息 ID 列表；连续流式刷新会按分片位置编辑已有消息，只在分片数量增加时创建新消息，避免第二段在每次刷新时被重复发送。
- **清理多余分片**: 当后续答案内容缩短、所需分片数量减少时，runtime 会删除已经不再需要的尾部分片消息。
- **回归断言补充**: `formatting.test.ts` 覆盖连续分片刷新与分片数量减少，固定“编辑已有分片、不重复创建第二条”的行为。

### 异步视频查询 SQLite 预检优化 (Video Query Bypass Optimization)
- **避免重复调用三方 API**: 当 Agent 使用 `taskId` 重新查询视频生成状态时，`videoGenerate` 工具会优先检查本地 SQLite 数据库中的 `status` 记录。如果任务已由后台轮询服务更新为 `completed` 或 `failed`，工具将直接读取本地视频路径或错误信息并返回，避免因三方任务过期或连接波动产生 `fetch failed` 报错。
- **自动触发消息发送**: 即使任务是在后台被静默轮询下载完成的，一旦 Agent 在会话中触发查询，工具也会自动检测 `options.uploadFile` 存在并将本地已完成的视频文件发送给当前聊天通道，保证用户顺畅拿到生成结果。

### 工具运行进度文案压缩 (Compact Tool Progress Copy)
- **去掉重复状态前缀**: `toolProgress = "new"` 的单行运行态文案不再显示 `正在运行:`，从 `⏳ 正在运行: videoGenerate...` 压缩为 `⏳ videoGenerate...`，为真正有用的工具名留出更多可见空间。
- **回归校验补充**: 新增 `displayFormatter.test.ts`，固定 `new` 模式下的最小运行态输出格式，避免后续又把冗余前缀带回来。

### Telegram 视频消息原生支持与 MIME 识别优化 (Telegram Native Video Message Support & MIME Optimization)
- **修正视频文件被误判为音频的问题**: 修复了 MP4 容器在字节头检测时（包含 `ftyp` 签名）被错误归类为 `audio/mp4` 并通过 `sendAudio` 路径发送，从而在 Telegram 中显示为音频且无法正常播放的问题。
- **添加 detectVideoMime 探测器**: 在 `TelegramManager` 中实现 `detectVideoMime` 辅助方法，专门提取 `.mp4`、`.webm`、`.mov` 视频格式文件的 MIME 类型，并在 `detectAudioMime` 中排除这些后缀的视频文件。
- **原生 sendVideo 接口调用**: 完善 `uploadFile` 逻辑，在检测到视频 MIME 类型时，优先通过 `bot.api.sendVideo` 将视频原生发送给用户，如果失败则优雅降级为发送文档 (`sendDocument`)。
- **完善单元测试覆盖**: 在 `src/lib/server/channels/telegram/runtime.test.ts` 中新增针对音频与视频 MIME 类型（包括 MP4/M4A、WebM、MOV、OGG）的精准识别断言。

### 视频生成设置页新增 Task ID 展示 (Task ID Display on Video Settings Page)
- **展示任务唯一定义标识**: 在 `/settings/video` 设置页面的“最近生成任务”列表中，新增“任务 ID (Task ID)”展示列。
- **便携复制与完整可见**: 将 Task ID 以等宽字体（`font-mono`）展示，并配置 `select-all` 类名与 hover title，让管理员可以直接在界面完整查阅并快速选中/拷贝 Task ID，方便在聊天窗口手动查验生成进度或核实结果。

### 视频生成结果查看与测试隔离优化 (Video Generation Results Viewing & Test Isolation)
- **单元测试数据库隔离**: 重构了 `createVideoGenerateTool` 使其支持在 options 中接收自定义的 `taskStore`。在 `videoGenerateTool.test.ts` 单元测试中，为所有 `SqliteVideoTaskStore` 配置隔离的临时测试 SQLite 数据库文件（在 `mockCwd` 目录中），在测试结束后会自动删除，彻底避免测试执行向宿主正式的 settings 数据库文件添加 mock 测试任务数据。
- **新增视频流服务接口**: 新增后端 API 端点 `/api/settings/video-generate/video`，支持通过 `taskId` 从数据库读取对应任务的本地 `videoPath`，并在文件存在时以 `video/mp4` MIME 格式通过流式响应安全输出。
- **结果详情弹窗与内置播放器**: 在 `/settings/video` 的“最近生成任务”表格操作列中，为已完成（`completed`）和失败（`failed`）的任务新增了“查看结果 (View Result)”操作按钮。点击可弹出一个精美的模态框：
  - 对已完成的任务，弹窗内嵌 HTML5 `<video>` 原生播放器，支持直接在配置页面播放和查验生成的视频文件；
  - 汇总展示任务 ID、生成引擎、完整提示词、本地物理保存路径以及详细错误信息；
  - 弹窗底部提供一键下载生成的 `.mp4` 文件及关闭弹窗的按钮。

### 图像生成设置页优化 (Image Generation Settings Optimization)
- **多引擎 Model ID 自定义**: 优化内置 `imageGenerate` 工具及其控制台 `/settings/image`，为 Agnes, Google Imagen, Volcengine (Seedream) 和 ModelScope 图像引擎独立支持自定义 Model ID 输入，增强不同画风和模型版本的灵活扩展性。
- **极简启用逻辑 (基于 API Key)**: 移除了各个引擎配置中冗余的 `enabled` 显式复选框/开关。遵循“只要配置了非空 API Key 即视为启用”的清晰规则，简化配置负担并避免状态不同步问题。
- **完整中英本地化支持**: 重构了前端配置表单以完整支持双语 `zh-CN` / `en-US` 本地化显示及切换，适配明暗模式和响应式自适应布局。
- **全面单元测试对齐**: 更新了 `imageGenerateTool.test.ts` 以移除对各引擎显式启用参数的依赖，利用 Mock 校验模型自定义和多引擎按优先级自动路由（根据配置 key 的有无自动路由）。

## 2026-06-05

### 设置总览页重新设计 (Settings Overview Redesign)
- **控制中心仪表盘**: 将 `/settings` 总览页从 14 个扁平卡片重构为 4 个分组功能卡片（AI 智能、消息渠道、知识与数据、系统），匹配设计稿的 Dashboard 布局。
- **Lucide 图标集成**: 每个分组卡片使用语义化 Lucide 图标（Cpu、MessageSquare、BookOpen、Settings），引入 `@lucide/svelte` 在设置页面的首次直接使用。
- **衬线标题排版**: 页面标题采用 `var(--font-serif)` 衬线字体，营造设计稿中的编辑感排版风格。
- **子页面快捷导航**: 每张卡片底部列出所有子页面链接，hover 时显示 → 箭头动画，直接导航到对应设置页。
- **分组计数 Badge**: 每张卡片顶部显示 Shadcn Badge 标注模块/渠道/页面数量。
- **双语支持**: 所有文本完整支持 zh-CN 和 en-US，使用 `$locale` 响应式切换。
- **暗色模式适配**: 卡片背景通过 `color-mix()` 在暗色模式下自动调整透明度。

### 设置布局头部重新设计 (Settings Layout Header Redesign)
- **侧边栏品牌头部**: 将侧边栏顶部从"配置工作台 + 设置"大标题重构为品牌圆点 logo + 衬线字体"设置"标题 + 紧凑的"返回聊天"胶囊按钮，匹配设计稿的主侧边栏头部风格。
- **面包屑顶部栏**: 将顶部栏从"工作台标题 + 页面名"改为"设置 › [当前页面]"面包屑导航，右侧保留主题/语言选择器和"打开聊天"链接。
- **语义化 CSS 类**: 所有新增 UI 元素使用语义化 CSS 类名（`.settings-sidebar-header`、`.settings-topbar-breadcrumb` 等），遵循 DESIGN.md 的 CSS 类名规范。
- **移动端导航保留**: 移动端折叠导航（`<details>`）保持不变，样式统一更新。
- **清理未使用 i18n**: 移除 `workspaceTitle` 翻译键，不再使用。

### 设置导航菜单样式重做 (Settings Navigation Menu Restyle)
- **匹配设计稿 nav-item 样式**: 将导航链接从 `rounded-xl border text-xs` 卡片风格改为设计稿的 `rounded-[6px] text-sm` 无边框列表风格，padding 从 `px-3 py-2` 调整为 `px-3.5 py-2.5`。
- **活跃状态对齐**: 活跃链接改为 `accent-soft` 背景 + `accent` 文字色 + 内边框阴影（`inset box-shadow`），匹配设计稿的 `nav-icon.active` 样式。
- **分组标题更新**: 去掉 `uppercase tracking-[0.16em]`，改为正常的 12px 小写标题，带折叠箭头（▾ 替代 ▸），闭合时旋转 -90°。
- **语义化 CSS 类**: 导航样式全部迁移到 `<style>` 块中的语义化类名（`.settings-nav-link`、`.settings-nav-group-title` 等），移除 `navLinkClass()` 中的 Tailwind 内联。
- **移动端同步**: 移动端折叠导航复用同一 `navLinkClass` 函数，样式自动继承。

### 内置视频生成工具 (Built-In Video Generation Tool)
- **原生 Agent 层工具**: 新增内置 `videoGenerate` 工具，视频生成能力从 bash/Python 脚本技能提升为 runtime 原生能力。
- **多渠道 API 支持**: 支持 Agnes-Video-V2.0 和 火山引擎 (Doubao-Seedance-2.0)。
- **模型自定义支持**: 支持在设置里为每个供应商独立配置特定的模型 ID（如 `agnes-video-v2.0`、`doubao-seedance-2.0`），而不再硬编码，充分保证了模型的灵活选型。
- **沙箱与存储规范**: 工具生成的视频会自动存放到对应会话的 dated 归档目录 (`artifactDir`)，并应用严格的安全沙箱路径校验，禁止向受限目录写入。
- **直发通道**: 工具会自动将生成的视频通过 active channel 发送回聊天对话，无需 Agent 额外运行 `attach` 工具。
- **设置管理界面**: 新增 `/settings/video` 专属页面与 `/api/settings/video-generate/test` 接口，支持配置全局开关、默认引擎，按引擎启用状态、API 密钥、自定义模型 ID 与自定义基准 URL 存储，并支持在页面直接运行测试 Prompt 生成并渲染。
- **启动与设置兼容**: 旧版 settings 缺少 `videoGenerate` 字段时会自动回填默认配置；默认引擎会优先参与 auto 路由；设置页测试产物写入 Molibot 数据目录，避免污染项目源码目录。
- **语义路由优先级**: Agent 会对任意语言的视频生成意图做语义判断，并优先通过 `toolSearch select:videoGenerate` 加载内置工具；只有内置工具不可用或失败时才回退到 skill/bash。
- **非阻塞异步任务执行**: `videoGenerate` 视频生成支持完全非阻塞的异步任务执行。Agent 提交任务后即刻将任务记录持久化写入 SQLite，并向 Agent 返回 taskId，直接释放当前对话回合。
- **后台轮询与状态同步**: 前端设置页面 `/settings/video` 以 30 秒间隔运行后台轮询，查询处于 processing 状态的任务，自动更新 SQLite 数据库中的任务状态，完成时自动下载并保存视频文件。
- **详细的请求与响应日志**: 在服务端查询第三方视频生成接口的状态时，会打印带有 `[Video Task Poller]` 标识的详细 HTTP 请求与响应日志，包含请求 URL、请求 Payload 以及完整的响应 Body（限前 500 字节），方便管理员随时核对调用细节与排障。
- **回归测试与编译校验**: `videoGenerateTool.test.ts` 完整覆盖了异步任务的提交、SQLite 读写、状态轮询与下载处理。项目在 TypeScript + SvelteKit 生产构建下完美编译通过。

### 飞书审批卡片终态稳定 (Feishu Approval Card Terminal State)
- **原卡片编辑为终态**: 审批完成后原地把带按钮卡片更新成“审批已处理”结果卡片，不再依赖有时间限制的消息撤回；编辑失败时才发送文本结果。
- **审批动作幂等**: HTTP 与 WebSocket 同时收到同一审批点击、或用户重复点击时，按 `requestId` 只执行一次审批，并复用同一张无按钮终态卡片。
- **明确终态展示**: 结果卡片标题改为“审批已处理”，并移除全部 action 按钮，不再继续显示“需要你的确认”。
- **三秒内快速回调**: 点击后立即返回无按钮的“审批处理中”卡片，后台完成审批执行后再原地编辑为“审批已处理”，避免飞书长连接回调超时重推旧卡片。
- **会话忙时持续恢复**: 共享审批自动恢复最长等待从约 5 秒延长到 1 小时；当前会话仍在运行时继续后台等待，不再很快提示用户发送任意消息继续。
- **工具结果由 Agent 汇总**: 审批后的 Bash stdout/stderr 只回填到原工具调用上下文，不再直接发送到聊天；“命令执行成功，正在恢复”也不再作为独立消息打扰用户。
- **回归测试补充**: `runtime.test.ts` 覆盖并发重复回调只执行一次及后续重复动作复用首次结果；`messaging.test.ts` 固定终态卡片标题与无按钮结构。

### Bash Stop 可靠收尾 (Reliable Bash Stop Finalization)
- **取消即终止本轮**: `/stop` 触发 bash/Agent abort 后，Runner 将 `aborted` 作为不可重试的终止结果，不再误判为空响应并自动重试或切换备用模型。
- **状态及时释放**: abort 后跳过可能阻塞的 UI 更新队列等待并清除待发送进度，确保 bash 已被 kill 后会话状态能从“运行中”回到空闲。
- **部分输出保留**: 停止前已经产生的 assistant 文本仍可保留展示，但不会被改写成普通运行错误。
- **回归测试补充**: `runnerRetryState.test.ts` 固定 aborted 不得进入 empty-response retry 的行为。

### 精简审批确认文案 (Concise Approval Confirmation Copy)
- **只展示决策所需信息**: Host Bash 审批提示统一收敛为“需要确认、操作、完整命令、批准/本轮允许/拒绝”结构，不再向聊天用户展示 request ID、Tool ID、分类器、权限明细和内部原因。
- **完整命令优先**: 审批提示优先展示真正待执行的原始完整命令，避免只显示 executable 后还要用户自行拼接参数。
- **跨渠道共享**: Telegram / 飞书审批卡片与 QQ / 微信纯文本审批复用同一个共享审批 prompt；纯文本渠道使用简短中文回复指引，审批动作与权限边界保持不变。
- **回归测试补充**: 新增 `hostBash/approval.test.ts`，固定长期审批、单次审批和非交互文本的最小信息结构。

### 全局命令响应多语言 (Global Command Response i18n)
- **运行时语言配置**: Settings 语言选择现在会写入全局 `RuntimeSettings.locale`，不再只保存在当前浏览器。
- **共享命令双语响应**: Telegram、飞书、QQ、微信复用的 Agent 命令层会按全局语言返回 `/help`、`/status`、模型、技能、会话、队列、运行控制、沙盒与显示控制等固定响应。
- **Web Chat 对齐**: Web Chat 本地命令读取同一运行时语言配置，避免网页命令与其他渠道语言不一致。
- **Help 命令精简**: `/help` 不再展示 `/login` 与 `/logout` OAuth 管理命令；命令本身继续可用。

## 2026-06-04

### 内置图片生成工具 (Built-In Image Generation Tool)
- **原生 Agent 层工具**: 新增内置 `imageGenerate` 工具，图片生成能力从 shell 脚本技能提升为 runtime 原生能力。
- **多渠道 API 支持**: 支持 Agnes-Image-2.0-Flash、Google Imagen、火山引擎 (Seedream) 和 ModelScope。
- **沙箱与存储规范**: 工具生成的图片会自动存放到对应会话的 dated 归档目录 (`artifactDir`)，并应用严格的安全沙箱路径校验，禁止向受限目录写入。
- **直发通道**: 工具会自动将生成的图片通过 active channel 发送回聊天对话，无需 Agent 额外运行 `attach` 工具。
- **设置管理界面**: 新增 `/settings/image` 专属页面与 `/api/settings/image-generate/test` 接口，支持配置全局开关、默认引擎，按引擎启用状态、API 密钥与自定义基准 URL 存储，并支持在页面直接运行测试 Prompt 生成并渲染。
- **启动与设置兼容**: 旧版 settings 缺少 `imageGenerate` 字段时会自动回填默认配置；默认引擎会优先参与 auto 路由；设置页测试产物写入 Molibot 数据目录，避免污染项目源码目录。
- **默认引擎兼容**: 当默认图片引擎已经配置 API key 时，即使旧配置残留该引擎 `enabled: false` 也会自动视为可用；`/settings/image` 页面明确展示每个引擎的启用开关。
- **语义路由优先级**: Agent 会对任意语言的图片生成/编辑意图做语义判断，并优先通过 `toolSearch select:imageGenerate` 加载内置工具；只有内置工具不可用或失败时才回退到 skill/bash。
- **回归测试补充**: 新增 `imageGenerateTool.test.ts`，利用 fetch mock 覆盖 Agnes 尺寸与 seed 参数校验、Google base64 解码、火山引擎下载和 ModelScope 异步轮询任务执行。

### Host Bash 分类器 URL/Helper 修复 (Host Bash URL and Helper Classification Fix)
- **Quoted URL 不再误判 glob**: Host Bash 分类器现在只把未引用、未转义的 `*` / `?` / `[` 视为 glob 风险，`agent-browser open "https://example.com/search?q=..."` 这类带 query string 的已引用 URL 会正确归约到 `agent-browser` capability。
- **受限 wrapper 归约**: `cd /tmp && agent-browser ... && echo DONE` 这类静态工作目录切换和输出标记会作为 safe helper 处理，避免已批准 `agent-browser` 因安全 shell 包装再次触发 one-time 审批；动态 `cd "$HOME"` 仍退化为 one-time。
- **回归断言补充**: `commandClassifier.test.ts` 增加 quoted URL、未引用 glob、受限 `cd` / `echo` wrapper、动态 `cd` 降级测试，固定审批降噪边界。

### Telegram 超长编辑统一分片能力 (Telegram Unified Overlong Edit Chunking)
- **统一发送/编辑分片 helper**: `src/lib/server/channels/telegram/formatting.ts` 现在把 Telegram 文本分片、grammY rich message 发送、plain text fallback 收口到共享 helper，避免 `sendMessage` 和 `editMessageText` 分别维护近似但漂移的逻辑。
- **超长编辑自动续发**: 当 Telegram 对 `editMessageText` 返回 `400: Bad Request: MESSAGE_TOO_LONG` 时，runtime 不再直接失败中断；现在会保留原消息作为第一段并自动补发后续分片消息。
- **Thread 上下文透传**: Telegram runtime 在状态消息、主答案、思考消息和运行详情消息的编辑路径中，都会把既有的 `message_thread_id` / 发送选项透传给超长续发逻辑，避免 forum topic 场景把后续分片发回主聊天。
- **回归断言补充**: `formatting.test.ts` 新增针对 plain text 和 rich message 路径的超长编辑拆分断言，固定“首条编辑 + 后续补发”的行为。

### System Prompt Boundary Refactor (P0 + Sandbox Slice)
- **P0 去重落地**: `src/lib/server/agent/prompts/prompt.ts` 已压缩 `Events`、`ToolSearch` 和 `Tools` 三个区块，移除重复的 `createEvent` 细节、`<functions>` 返回格式教学，以及冗长的 Tool Priority Table，保留最小但足够的路由规则。
- **P1.2 Core Directives 合并**: 原本分散在 `Execution Discipline`、`Freshness`、`External Content Safety`、`Action Confirmation`、`Runtime Safety & Truthfulness`、`Failure Recovery` 的全局防御性规则，现已合并为单一 `Core Directives` section，并把 `Processed Inputs` 一并收口到同一区块。
- **Sandbox 边界收口**: 系统提示词中的 sandbox 文本已从实现细节改为决策边界，只保留“普通 shell 工作可走 bash”“不要绕过 sandbox”“需要 host-only 能力时走 `bash.hostApproval`”这类模型决策规则，不再在全局提示词里展开实现名、文件系统/网络细节或共享 venv 路径。
- **`bash` 工具描述对齐**: `src/lib/server/agent/tools/bash.ts` 的工具描述与 `hostApproval.reason` 参数说明同步收短，明确其职责是受控 host-only 访问说明，而不是让系统提示词承担具体 runtime 教学。
- **回归断言补充**: `prompt.test.ts` 与 `bash-output.test.ts` 新增断言，固定这轮去重结果，防止后续把 `<functions>` 细节、Tool Priority Table 或 `sandbox-exec` / `bubblewrap` 这类实现描述重新塞回系统提示词。

## 2026-06-03

### Deferred Web Search 去重 (Deferred Web Search Deduplication)
- **`webSearch` 改成 deferred-only 暴露**: `src/lib/server/agent/tools/index.ts` 里保留 `webSearch` 的 deferred registry 条目，但显式设置 `exposeStub: false`，不再把它作为顶层 lightweight stub 放进模型工具列表。
- **修复 provider 400 重名错误**: `toolSearch` 加载 `webSearch` 后，不会再和顶层同名 stub 同时出现在 `tools` 请求参数里，避免 `tools contains duplicate names: webSearch`。
- **回归断言补充**: `index.test.ts` 新增断言，固定 `webSearch` 的 deferred-only 暴露方式。

### Deferred Tool Registry 对齐 (Deferred Tool Registry Alignment)
- **deferredEntries 补齐 webSearch**: `src/lib/server/agent/tools/index.ts` 现在把 `webSearch` 加入 deferred tool registry，与 prompt 里的 `<available-deferred-tools>` 保持一致，避免提示词宣称可延迟加载但 runtime 注册表缺项。
- **提示词回归断言**: `prompt.test.ts` 补充断言，确保 `<available-deferred-tools>` 区块继续显式包含 `webSearch`。

### 共享 Python 工具环境收敛 (Shared Python Tooling Runtime)
- **统一 Python 工具目录**: Agent `bash` 运行时默认使用 `~/.molibot/tooling/python/venv` 作为共享虚拟环境，替代旧的 `~/.molibot/tooling/sandbox-venv`，避免 skill 目录各自生成 `.venv` 后残留机器绝对路径。
- **缓存和临时文件归位**: `wrapCommandWithVenv()` 现在统一导出 `PIP_CACHE_DIR`、`UV_CACHE_DIR`、`TMPDIR`、`TEMP`、`TMP` 到 `~/.molibot/tooling/python/{pip-cache,uv-cache,tmp}`，并设置 `PYTHONNOUSERSITE=1`，让 pip/uv/临时构建文件留在 Molibot tooling 目录。
- **沙箱写入范围对齐**: OS sandbox 的写入 allowlist 同步包含 Python tooling 根目录，避免 pip/uv 在 cache/tmp 目录写入时触发 `Operation not permitted`。
- **onlinestool 使用共享环境**: `~/.molibot/skills/onlinestool/scripts/run_update.sh` 现在自定位到 skill 根目录，并优先使用 runtime 注入的 `VIRTUAL_ENV` 或 `~/.molibot/tooling/python/venv`，不再创建 skill 私有 `.venv`。
- **回归测试补充**: 新增 `helpers.test.ts` 覆盖默认 Python tooling 路径、`MOLIBOT_TOOLING_DIR` / `MOLIBOT_VENV_DIR` 覆盖语义，以及 pip/uv/tmp 环境变量注入。

### Web Search 查询稳健性修复 (Web Search Query Robustness)
- **搜索关键词不再被时间前缀污染**: `runWebSearch()` 现在把用户的简洁 query 直接交给 provider，不再统一拼接 `Current date/time ... User query ...`，避免“最新黄金价格”这类实时查询因为当天日期关键词过窄而搜不到可用结果。
- **弱模型工具参数容错**: `webSearch` 会清理 `route` / `engine` 参数中常见的换行和嵌套引号形态，例如 `\n"auto"\n`，避免连续工具校验失败卡住搜索轮次。
- **中文路线优先网页引用**: `china` 路由优先尝试 `baidu_web`，再降级到 `baidu_fast` / `baidu` 等摘要型搜索，降低 provider AI 摘要无引用或幻觉时被直接放大的风险。
- **提示词边界收紧**: `webSearch` 工具说明保留当前年份提醒，但明确不要机械添加当天完整日期；系统工具表述从 `time-aware queries` 调整为 `date-aware guidance`。
- **回归测试补充**: 更新 `webSearchTool.test.ts` 和 `router.test.ts`，覆盖简洁 provider query、弱参数容错和中文路由顺序。

## 2026-06-02

### Host Bash 复合命令能力分类 (Host Bash Compound Command Classification)
- **复合命令分类器**: 新增 `src/lib/server/hostBash/commandClassifier.ts`，对受限 shell 语法做保守解析，把命令分成 `persistent-capability`、`compound-capabilities` 和 `one-time-script`，并显式记录 safe glue（如 `|`、`2>&1`、`&&`）与 safe helper（如 `head -30`、`sleep 3`）。
- **审批降噪**: `longbridge news FIG.US 2>&1 | head -30`、`agent-browser ... && sleep 3 && agent-browser ...` 这类“同一真实能力 + 安全修饰”的命令，不再一律退化成一次性审批；未批准时会优先请求对应 capability 的长期 Host Bash 审批。
- **运行时命中增强**: 已批准的 Host Bash capability 现在可以命中带 safe helper / safe glue 的复合命令，并直接走 Host Bash 执行，不再因为简单管道或 sleep 链而重新进 sandbox 或重新发审批。
- **审计可解释性**: 新审批记录会在 `action_json` 中持久化 classification 元数据；`/settings/host-bash` 的 Pending / History 表格会展示 capability、safe helper / glue 或 one-time reason，方便运维判断为何是长期审批还是一次性审批。
- **回归测试补充**: 新增 `commandClassifier.test.ts`，并扩展 `bash-output.test.ts` 覆盖 approved pipeline、same-tool chain、safe helper 命中与 compound one-time 退化路径。

## 2026-06-01

### Host Bash 审批自动恢复避免 session 锁 panic (Host Bash Auto-Resume Session-Lock Recovery)
- **共享恢复重试**: `baseRuntime.ts` 的批准后自动恢复流程现在会在旧 turn 尚未完全释放 session 锁时做短暂重试，而不是让 `prepareTurn()` 的并发锁异常直接变成未处理 rejection。
- **服务稳定性修复**: Telegram 点按 `approve-session` / `approve` 后，即便撞到 `Another run is currently active in this session.` 的释放窗口，也不会再触发进程异常退出。
- **可见降级提示**: 若短重试后会话仍持续忙碌，runtime 会给用户发送“命令已执行，但会话仍忙碌”的继续提示，避免自动恢复静默卡住。
- **回归测试补充**: 新增 `approvalAutoResume.test.ts`，覆盖 turn 锁冲突重试与非锁错误直接终止两条路径。

### 内置网页搜索工具 (Built-In Web Search Tool)
- **共享 Agent 层工具**: 新增内置 `webSearch` 工具，搜索能力从 skill 文档/脚本提升为 runtime 原生能力，Web、Telegram、Feishu、QQ、Weixin 等渠道共享同一套工具注册、结果结构和诊断信息。
- **多引擎配置**: `RuntimeSettings.webSearch` 支持 DuckDuckGo、Brave、Tavily、Exa、Serper、Baidu Qianfan、Bocha。DuckDuckGo 默认开箱即用；其他引擎按 API Key 配置后参与路由。
- **与本地 web-search skill 对齐**: 额外补齐 `baidu_fast`、`baidu_web`、`ark`、`grok` 四个原本只存在于 `~/.molibot/skills/web-search/scripts` 的引擎入口，统一纳入 runtime 设置、默认 base URL、路由顺序与 provider 执行链路。
- **路由与降级**: 搜索路由收敛为 `china`、`global`、`official_docs`、`research` 四类目标导向 fallback，不再把“中文 + 最新/新闻”粗暴等同于国内新闻；当前引擎失败、无结果或缺少 Key 时按配置顺序降级到下一个可用引擎。
- **自动引擎选择策略**: `Default engine = auto` 时支持 `priority`、`random`、`round_robin` 三种策略；随机与轮询只会在已启用且已配置 API Key 的付费/账号引擎之间选择（DuckDuckGo 作为无需 Key 的例外），便于分摊额度或绕开单个 Key 余额不足。
- **测试请求诊断**: `/settings/search` 的 Test Query 结果现在展示每次 provider attempt 的脱敏请求诊断，包含 method、实际 URL、脱敏 headers 和请求 body，方便核对 Tavily/Brave/DuckDuckGo 等实际调用路径。
- **设置页管理**: 新增 `/settings/search`，可配置工具总开关、默认 route/engine、最大结果数、超时/重试超时、各引擎启用状态、API Key、自定义 Base URL，并支持使用当前表单值发起测试查询。
- **默认地址可见**: 搜索设置页现在直接展示 Brave、Tavily、Exa、Serper、Baidu、Bocha 在 `baseUrl` 留空时的真实默认地址，并与运行时 provider 共享同一份常量，避免 UI 文案和实际回退目标漂移。
- **工具提示词优化**: `webSearch` 工具描述现在明确要求最终答案附带 `Sources:` 区块，近期/最新查询使用当前年份，并优先交给自动 route/engine 分流，除非用户指定来源或区域。
- **回归测试补充**: 新增搜索路由和 `webSearch` 工具结果归一化测试，并将 `webSearch` 分类为会访问外部网络的中风险内置工具。
- **来源证据包**: `webSearch` 结果现在包含 `citations`、`metadata` 与每条 result 的 `citationId`，Agent 可以稳定把最终回答引用到真实 URL，而不是只依赖临时拼接的结果列表。
- **Provider 元数据归一化**: Brave、Tavily、Baidu Fast/Baidu Web、Bocha 等 provider 会尽量保留 request id、站点名、favicon、发布时间、provider 原始引用 id 和 usage/credits，排障信息继续保持密钥脱敏。
- **百度 Fast answer 保留**: 当百度 `web_summary` 同时返回综合 answer 与 references 时，工具会保留 provider answer 作为摘要，并将 references 标准化为可引用来源。
- **测试面板结果对齐真实响应**: `/settings/search` 的 Test Query 现在支持显式选择搜索引擎，并直接展示 `runWebSearch()` 返回的完整 `WebSearchResponse` JSON，避免页面再拼一层简化结果导致调试视图与模型实际看到的 payload 不一致。
- **Ark 从搜索设置页隐藏**: `ark` provider 仍保留在共享 runtime 类型和 provider 链路中，但设置页不再展示或允许作为默认引擎选择，避免在当前产品面上继续暴露这个实验性入口。
- **搜索请求自动注入当前时间**: `runWebSearch()` 现在会为每次 provider 请求生成带 `Current date/time` 与用户原始问题的内部查询文本，提升“明天天气”“最新价格”“今天新闻”等相对时间查询的时效性；返回的 `WebSearchResponse.query` 仍保留用户原始输入，方便会话展示与诊断对齐。
- **Prompt 工具优先级对齐**: 系统提示词的 Tools Priority Table 现在明确要求当前网页信息查询使用 `webSearch`，而不是通过 `bash curl`、浏览器搜索或旧 skill 脚本绕行；Tool Parameters 中也补充了 `webSearch` 参数签名。

### Feishu 本地审批按钮长连接回调 (Feishu Local Approval Buttons via WebSocket)
- **卡片按钮不再依赖公网 HTTP 回调**: Feishu runtime 现在通过现有 `WSClient` 的 `card.action.trigger` 事件接收审批卡片点击，本地机器启动且端口未暴露时也能处理 Host Bash 审批按钮。
- **审批逻辑复用**: 长连接卡片事件复用原有 Host Bash approve / approve-session / reject 共享命令路径；若按钮对应的是通用工具审批记录，会用同一个 `requestId` 回落到通用审批 Broker 继续处理。HTTP `/api/feishu/card` 回调入口保留，公网部署仍可继续使用。
- **自然中文审批口令**: 共享命令层现在支持 `审批通过`、`通过`、`批准通过`、`审批拒绝` 等常见中文回复，避免用户回复审批结论时被当作普通消息排队。
- **结果卡片更新与降级提示**: WebSocket 卡片事件处理完成后会主动编辑原审批卡片为结果态；如果原消息编辑失败，则发送一条普通文本结果提示。
- **按钮回调可观测性**: 收到飞书按钮点击时记录 `card_action_received`，便于区分飞书控制台未投递回调和运行时解析失败。
- **回归测试补充**: 新增 Feishu card action payload 解析测试，覆盖 `card.action.trigger` 的 chat/message/operator/action 字段归一化。

### Molibot 本机持续后台运行 (Local LaunchAgent Runtime)
- **LaunchAgent 配置**: 新增 `launchd/com.gusi.molibot.dev.plist`，可安装到用户 `LaunchAgents` 后由 macOS 管理本地 Molibot dev 服务。
- **自动拉起**: 配置 `RunAtLoad` 与 `KeepAlive`，避免普通前台 `molibot` 进程因终端/PTY 会话结束而停止。
- **独立日志**: 标准输出和错误分别写入本机 `molibot-launchd` 日志文件，方便排查启动与运行状态。

## 2026-05-31

### 定时任务执行 Lease、超时中止与重试 (Scheduled Event Lease, Timeout Abort, and Retry)
- **共享执行 Lease**: 新增 SQLite-backed `event_execution_leases` 运行态表，将 watched event 的“当前是否正在执行、属于哪个 run、尝试次数、超时与重试状态”从事件 JSON 文件锁提升为共享 runtime 协调状态。
- **10 分钟默认超时与 3 次上限**: `RuntimeSettings.events` 新增 `executionTimeoutMs`、`maxAttempts`、`retryDelayMs`，默认分别为 10 分钟、3 次、5 秒，并支持通过 settings/env 配置。
- **超时先中止再重试**: `EventsWatcher` 现在为事件执行包裹 watchdog；超时后调用共享 channel runtime 的 abort 路径，中止 runner / stale running turn，再按 lease retry budget 触发下一次尝试。
- **超时后成功收尾不再补发重复 attempt**: 如果首个 attempt 虽然超过 nominal timeout，但最终自己成功完成，`EventsWatcher` 现在直接按成功收口，不会再把同一 cron 槽位补发成第二次重复执行。
- **启动恢复**: watcher 启动时会扫描并恢复超时的 `running` lease，将其转换到 retry/final failed 路径，避免进程重启后旧 lease 永久阻塞同一事件槽位。
- **恢复镜像对齐**: watcher 启动恢复后会重新接管 `retry_wait` lease，并把 failed/aborted/completed lease 同步回事件 JSON 镜像，避免文件仍停在 `running` 状态导致跳过或误判。
- **`/stop` 识别事件 Lease**: 共享 `BaseChannelRuntime` 的停止逻辑现在会同步查询并终止当前 chat 的 active event lease，避免只有 runner 内存状态丢失时误报 `Nothing running.`。
- **跨 Bot Lease 隔离**: lease 唯一键新增 channel/bot 作用域，避免不同渠道或不同 bot 中同名事件文件、同 chatId、同 slot 相互阻塞。
- **重试并发防护**: timeout 分支会等待旧 runner 释放后才进入下一次 attempt；若 `/stop` 已经终止 lease，后续 runner 返回不会再把事件覆盖成完成态。
- **跨渠道 runId 对齐**: Telegram、Feishu、QQ、Weixin 的事件触发路径现在使用 lease 分配的 `runId`，使 runs 表、lease 表和事件 JSON 镜像能对齐同一轮事件执行。
- **回归测试补充**: 新增 `eventsLeaseStore.test.ts` 覆盖同槽位单 active lease、timeout 进入 retry、重试次数耗尽、手动 stop 抑制 retry、启动恢复 stale running lease。

### Sandbox 关闭时 Host Bash 免审批 (Host Bash Full Access When Sandbox Is Off)
- **权限语义修正**: 有效 `/sandbox off` 现在表示当前作用域进入 Host Bash full access。普通 `bash` 以及模型附带的 `hostApproval` 参数都会直接在宿主执行，不再额外创建 Host Bash 审批。
- **Sandbox-on 审批保持不变**: 当 sandbox 有效开启时，普通 `bash` 仍优先进入 OS sandbox；显式 Host Bash 请求和 sandbox 权限失败仍会走原有审批与自动恢复流程。
- **重复审批防护**: 命中已批准 Host Bash 白名单的命令会直接走 `executeApprovedHostBash`，不会重新进入 sandbox shell，也不会触发二次审批。
- **回归测试补充**: 新增策略层测试覆盖 sandbox on/off 与 `hostApproval` 参数组合；补充 bash 输出测试覆盖 sandbox disabled 免审批直跑和 approved Host Bash 不调用 sandbox shell。

### 独立思考消息与最新进度模式 (Separate Reasoning Messages & Latest Progress Mode)
- **`/showreasoning new` 模式**: `showReasoning` 配置扩展为 `off/on/stream/new`，聊天命令、Settings → System 下拉选项、settings schema/sanitize/store 均接受并保留 `new`。
- **思考与答案分离**: `DisplayFormatter` 新增独立的答案与 reasoning 渲染方法。Telegram 与 Feishu 不再把 reasoning 拼进最终答案消息，避免打开思考后需要先翻过大段 reasoning 才能看到正文。
- **Telegram 实时展示优化**: Telegram 运行时新增独立 `reasoningMessageId`。`thinking_delta` 只刷新独立思考消息，`text_delta` 只刷新答案消息；`new` 模式运行中只显示最近一句思考，结束后删除临时思考进度消息。
- **Feishu 流式会话适配**: Feishu CardKit 答案卡片保持原有流式输出，reasoning 改为独立可编辑文本消息；`new` 模式结束时将临时思考消息收尾为“思考完成”。
- **回归测试补充**: `FeishuStreamingSession` 新增 reasoning 独立消息测试，覆盖思考内容不创建空答案卡片的路径。

### 主答案生命周期与跨渠道展示冻结 (Main Answer Lifecycle & Display Commit)
- **Runner 主答案提交语义**: 在共享 `MomContext` 中新增可选 `commitMainAnswer` 与 `sendSupplement` 语义。Runner 会按模型返回的 terminal assistant 消息边界展示内容：一条返回一条，多条则第一条作为主答案、后续条作为补充消息，不再用最后一条覆盖前面的完整答案。
- **共享文本渠道冻结逻辑**: `buildTextChannelContext` 增加 `draft/committed` 主答案阶段。Weixin / QQ 等不支持编辑的渠道在 draft 阶段仍可通过 buffer 替换草稿，但 committed 后的后续文本会作为补充发送，不会从 `messagesBuffer` 中删除已提交主答案。
- **Telegram / Feishu 对齐**: Telegram 手写 context 与 Feishu 卡片流式会话接入同样的提交语义。主答案 committed 后，后续 assistant 文本或续写结果改为补充消息/详情，不再编辑覆盖原主答案。
- **回归测试补充**: 为 shared context 增加 committed 后 replacement 转补充的单元测试，覆盖不支持编辑渠道最容易丢失主答案的路径。

## 2026-05-30

### 微信通道底层 SDK 升级与上下文 Token 持久化 (Weixin SDK Upstream Upgrade & Context Token Persistence)
- **底层 SDK 协议同步与升级**: 同步了本地 `package/weixin-agent-sdk` 至最新的 `openclaw-weixin` upstream 版本（版本号升至 `0.3.1`），移除了所有 OpenClaw 专属插件 Hook (如 `channel.ts` 等) 以保持 SDK 的独立性。
- **上下文 Token 磁盘持久化**: 在 `package/weixin-agent-sdk/src/messaging/inbound.ts` 中实现了上下文 Token 磁盘持久化机制 (`persistContextTokens`, `restoreContextTokens`)。当 Weixin 轮询到新消息时，其对应的 `context_token` 会自动保存至 `{accountId}.context-tokens.json` 文件中，系统重启后会自动重新载入内存，彻底解决了服务器重启时丢失上下文 Token 导致无法主动回复消息的问题。
- **WeChat 账号清理行为增强**: 在 `clearWeixinAccount` 中增加了同步清理对应的 `.sync.json` 和 `.context-tokens.json` 文件的逻辑，确保敏感凭证与缓存数据能够被物理清除。
- **长轮询中止链路补齐**: 在 `package/weixin-agent-sdk/src/api/api.ts` 中补齐了 `combineAbortSignals` 合并逻辑，并让 `getUpdates` 走支持外部 `AbortSignal` 的 `apiPostFetch`。这样 Weixin 长轮询在停止、热重载或运行时切换时可以立即中断，不再依赖超时自然返回。
- **SvelteKit 运行期无缝对接与自愈**:
  - 重写了 `src/lib/server/channels/weixin/client.ts`，在 Weixin 客户端启动与重连加载凭证时，自动调用 `restoreContextTokens` 载入历史 Token 缓存，并将 `getContextToken`/`setContextToken` 进行双向桥接，使 Svelte 运行期的所有发送与打字提示消息均获得持久化 Token 保护。
  - 针对扫码登录返回的 `binded_redirect` 重定向状态，实现了 `alreadyConnected` 状态捕获与自愈处理。如果用户扫描了已连接的机器人二维码，不会再抛出登录失败异常，而是自动解析加载已存的本地 credentials 并恢复正常服务。
- **去除过时的 Markdown 过滤规则**: 鉴于微信对 Markdown 的支持已趋于完善，移除或将 `filterWeixinMarkdown` 逻辑弱化为无操作（no-op）的透明管道，并在单元测试中更新回归校验，彻底避免因旧版 SDK 移除 Markdown 特性导致的 import 错误及格式破坏。

### 浏览器自动化超时可配置 (Browser Automation Timeout Configuration)
- **Settings 页面配置**: 在 Settings → System 页面新增「浏览器自动化」配置卡片，支持通过 Web UI 直接调整 `agent-browser` (Playwright) 的默认超时时间（毫秒），无需修改 `.env` 或重启服务。
- **全局显示、思考过程及沙盒安全可视化配置**: 
  - **显示与思考设置**: 在 Settings → System 页面新增「显示与思考设置」配置卡片，支持直接通过 Web UI 调整模型思考过程显示模式 (`showReasoning`)、工具执行进度展示详细度 (`toolProgress`) 及网关通知发送间隔 (`gatewayNotifyInterval`)，避免手动注入参数。
  - **工具沙盒安全限制**: 新增「工具沙盒安全限制」配置卡片，支持可视化一键开关全局 Bash 命令沙盒隔离 (`toolSandbox.enabled`)，并包含直达沙盒详细规则配置页面的链接，极大地提升了系统的安全易用性。
- **Schema 与持久化**: 在 `RuntimeSettings` 中新增 `browserAutomation: { defaultTimeoutMs }` 字段，配合完整的 sanitize、store 序列化/反序列化链路，确保配置修改即时生效且重启后持久保留。
- **环境变量自动注入**: `hostBashExec.ts` 的 `buildHostEnv` 自动将配置值注入为 `AGENT_BROWSER_DEFAULT_TIMEOUT` 环境变量，所有通过 Host Bash 执行的 `agent-browser` 命令自动继承。
- **默认值调整**: 默认超时从 25s 提升至 60s，解决了 feishu.cn 等加载较慢网站的超时问题。范围约束 5s~300s。
- **统一的渲染格式化层 (Unified DisplayFormatter)**: 实现了 [displayFormatter.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/displayFormatter.ts) 作为共享逻辑层。统一捕获 `thinking_start/delta/end`、工具调用与子智能体执行事件，规范化输出适用于各个渠道的 Markdown 排版，使得展示逻辑完全与 Channel 消息收发解耦，严格遵守 `AGENTS.md` 的规范边界。
- **展示设置持久化与校验逻辑**: 扩展了 `schema.ts`、`defaults.ts` 与 `sanitize.ts`，为 `RuntimeSettings` 及各渠道实例的 `ChannelInstanceSettings` 新增了 `display` 配置（包含 `toolProgress`、`showReasoning`、`gatewayNotifyInterval`）。升级了 sanitizer，打通了 SQLite `settings_channel_instances` 表中的 `display_json` 字段及 `settings.json` 中的全局 `display` 属性的持久化存储、动态读取与自动迁移，保证指令 `/toolprogress` 及 `/showreasoning` 的修改状态在系统重启后能够被持久保留。同时将展示配置指令与 `/sandbox` 多级控制指令统一整理编写为指南文档 [session-control-commands.md](docs/guides/session-control/session-control-commands.md)。
- **独立会话指令控制 (/toolprogress & /showreasoning)**: 在 [channelCommands.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/commands/channelCommands.ts) 中增加了 `/toolprogress` 与 `/showreasoning` 两个独立的聊天命令。仅修改并写回当前渠道的 Bot 实例设置，实现了精细化的 Bot (Channel Instance) 维度控制，各个平台/Bot 互不干扰。
- **多渠道渲染适配与进度拦截**:
  - **Telegram**: 重构了 Telegram 的消息发送与编辑管道，全面接入 `DisplayFormatter`；若 `toolProgress === 'off'`，则彻底跳过状态消息的生成与编辑。修复了在 `"new"` 进度显示级别下，最后一条临时状态（如 `⏳ 正在运行: bash...`）在智能体执行完成后仍残留于界面的 bug。现已支持在运行终期自动将其物理删除。
  - **Feishu**: 重构了 `FeishuStreamingSession` 与 `FeishuManager`，根据 `displayConfig` 动态渲染飞书流式交互卡片的工具进度及状态，当设为 `off` 时隐藏工具历史元素。
  - **QQ & Weixin (防刷屏气泡缓冲合并)**: 重构了 QQ 与微信的 `processEvent` 函数，分别获取当前实例的 `displayConfig`。当 `toolProgress === 'off'` 时跳过进度消息。同时，引入了 `messagesBuffer` 缓冲区，将工具进度日志、运行归档提示、错误信息及中间 streaming 结果在运行期间于内存中聚合，直至运行彻底结束、触发敏感授权（如 Host Bash 审批）或上传文件时才一次性拼接并通过单个气泡发出，彻底杜绝了这两个平台由于不支持消息编辑而产生多个消息气泡的刷屏缺陷。
- **`/help` 帮助指令丰富**: 在 [channelCommands.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/commands/channelCommands.ts) 的 `helpText` 帮助信息中，补充了包含会话（Session）、机器人实例（Bot）和智能体（Agent）多层覆盖的 `/sandbox` 开关指令及 `/toolprogress`、`/showreasoning` 展示指令的使用说明，方便用户随时查阅。
- **审批自愈流式自动恢复优化**: 移除了 Telegram 和 Feishu 渠道对 `executeApprovedHostBash` 的冗余重写，恢复复用 `baseRuntime.ts` 默认提供的审批自动唤醒流程。扩展了 `isSessionApprovalText` 会话批准正则，支持包括“允许本轮”、“本轮允许”、“本会话允许”等自然中文，并在自愈完成后添加了状态提示消息。
- **修复主机工具审批 Scope 冲突导致的卡顿缺陷**: 修复了由 `ToolRuntime`（对于插件/MCP工具）写入数据库的 `run_id` (实际为 UUID) 与 Channel 审批指令解析查询的 `scopeId` (实际为 chatId) 不匹配，导致审批时报错 `No matching pending Host Bash approval found.` 且执行流程卡死的 bug。`HostBashStore` 现支持 `sessionId` 级联 fallback 检索，全渠道及 Web 端审批完美打通。

### 智能体优化：审批深度传播与安全认证边界记录 (Review Optimization Tasks 4 & 5)
- **子智能体审批深度传播 (Subagent Approval Depth Propagation)**: 在 `createSubagentTool` 的选项中新增并传递了 `requestedByDepth` 参数，且在生成子智能体的 `hostApproval` 载荷时将其递增 `(options.requestedByDepth ?? 0) + 1`，确保子智能体执行敏感操作（如 `bash` 命令）时能够向上级与宿主持久化正确的调用层级深度，彻底修复了原先硬编码为 `1` 的逻辑缺陷。
- **TurnOrchestrator 认证边界文档化 (Actor Authentication Boundary Documentation)**: 在 `TurnOrchestrator.prepareTurn` 中为 SQLite `runs` 表写入 `actor_id` 时补充了明确的注释文档，声明 Channel 渠道运行时应在调用共享的 turn 编排管道前完成外部 Actor 的鉴权与授权，而 TurnOrchestrator 仅对已标准化的 `message.userId` 进行归档以做审计与工作区映射，明确了系统安全边界。
- **测试环境会话与沙盒隔离优化 (Test Session Isolation & Mock Alignment)**: 优化了 `runner.test.ts` 中硬编码 `session-1` 导致的并发或遗留锁冲突，改为在各测试用例中生成独一无二的随机 session ID 进行测试；同时在 store Mock 对象中对齐补全了 `getSessionSandboxOverride: () => null`，使得测试完全在干净且隔离的模拟数据库环境中执行，修复了多个脆弱与 flaky 的单元测试。

### 沙盒多层控制与审批自动恢复优化 (Sandbox Multi-Level Control & Approval Auto-Resume)
- **多层控制链 (Multi-level Control Chain)**: 支持 `Session Override > Bot Instance Override > Agent Override > Global Default` 的沙盒控制优先度。当底层检测到有 Session 级别的覆盖时优先使用该覆盖，方便针对单次会话灵活控制沙盒。
- **配置持久化与迁移 (Configuration Persistence & Migration)**: 在 `schema.ts`、`sanitize.ts` 和各个设置接口中打通了 `sandboxEnabled` 字段的读写，且在启动时通过 SQLite 迁移代码自动为 channels 表和 agents 表添加 `sandbox_enabled` 列。同时，在 Web、Telegram、Feishu、QQ、Weixin 的 Svelte 设置页面中全面接入了 `sandboxEnabled` 的字段加载与保存映射（并提供 UI 覆盖开关），彻底解决了保存其他渠道配置时 sandboxEnabled 字段被静默覆盖清空的数据丢失隐患。
- **沙盒开关控制指令 (Sandbox Command override)**: 新增 `/sandbox` 会话指令，支持展示当前有效沙盒状态，并可接受 `/sandbox session on/off`，`/sandbox bot on/off`，`/sandbox agent on/off` 级别覆盖重写。
- **主机命令审批自动恢复 (Approval Auto-Resume)**: 重构了主机命令批准后的执行流程，当用户通过客户端或 Web API 批准命令执行后，自动修改会话上下文中对应的 toolCall 对应的 toolResult 消息，将其内容替换为真实 stdout/stderr。随后，自动在后台重新触发 `runner.run(...)` 或 `runSharedTextTask(...)`，彻底解决以往命令审批通过后对话被截断的痛点。
- **主机工具运行目录定制 (Customizable Tooling Directory)**: 内置主机 bash 工具在执行前，将检查环境变量 `MOLIBOT_TOOLING_DIR`（默认 `~/.molibot/tooling`），并在此目录下单独建立 `venv`、`GOPATH` 和 `GOCACHE`，确保智能体独立运行环境持久化并独立管理，防止依赖包或环境配置污染。

### 命名沙盒安全策略卡片 (Named Sandbox Profiles)
- **定义标准沙盒策略模板**: 在 Web UI 中预定义了三种安全级别模板：`Observe`（只读，允许网络通配符，可写 `/tmp` 和 `scratch`），`Build`（可读写工作区，限制网络至标准依赖源），以及 `Strict`（极度隔离，无网络，仅可写 `/tmp`）。
- **动态策略匹配与状态检测**: 实现了 Svelte 端对当前生效沙盒规则的自动比对匹配。若检测到用户更改了底层任何细节，卡片状态将自动高亮显示“自定义配置策略 (Custom Profile)”，方便用户随时重置或查看。
- **可视化预设选择卡片**: 在 `/settings/sandbox` 顶部新增了三张拥有精美悬停悬浮阴影、过渡动效和当前生效激活边框的卡片。
- **完善的国际化支持**: 针对预设卡片名称、模式描述以及自定义状态和生效徽标等，全部提供了完整的中文与英文双语翻译支持。

### 可配置的智能体运行预算限制 (Configurable Run Budget Limits)
- **Schema 与配置持久化扩展**: 在 `RuntimeSettings` 接口和 `schema.ts` 中新增了 `budget: RunBudgetLimits` 结构，声明最大工具调用次数 (`maxToolCalls`)、最大允许工具失败次数 (`maxToolFailures`) 和最大模型尝试次数 (`maxModelAttempts`)，并增加对应环境变量 `MOLIBOT_MAX_TOOL_CALLS` 等的支持。
- **Sanitization 与 Clamping 保护机制**: 在 `sanitize.ts` 与 `store.ts` 中新增并集成了 `sanitizeBudgetSettings` 辅助方法，将用户的数值输入安全地夹逼（clamp）在合理范围（如工具调用最大限额 `1` 至 `500`），避免死循环或配置溢出。
- **Agent 预算动态实例化**: 重构了 `runner.ts` 中的 `RunBudget` 实例化逻辑，由原本的硬编码默认值 `DEFAULT_RUN_BUDGET` 改为优先读取当前 Settings 的 `settings.budget` 配置。
- **系统配置 Web UI 深度集成**: 在 `/settings/system`（系统配置）界面中新增了“智能体运行预算限制”配置卡片，支持中英文双语翻译与实时配置保存，完美对接 `/api/settings` 后端更新接口。

### Agent runner.ts 瘦身与输入 Enrichment 抽取 (v2.2 Phase 5)
- **Top-Level Helper 提取**: 将 `runner.ts` 顶部的 16 个辅助函数（如 `envVarForProvider`, `getMessageText`, `prepareMessagesForModelContext`, `validateRuntimeSettings` 等）完整提取至独立的 `runnerHelpers.ts` 文件中，使核心文件结构更为聚焦。
- **输入 Enrichment 模块抽取**: 将包含语音识别转写（STT）路由、视觉/图像路由降级（Vision Route/Image Fallback）以及候选模型兜底决议逻辑的 Enrichment 链条，从 `runner.ts` 的 `run()` 方法中提取至 `runnerInputEnricher.ts` 的 `prepareEnrichedInput()` 纯净辅助函数中。
- **`runner.ts` 代码精简与重构**: 更新 `runner.ts` 导入新抽取的 `runnerHelpers` 和 `runnerInputEnricher`。修改 `activeSelection` 解构为 `let` 变量以支持在模型候选重试循环中被重新赋值。彻底移除兼容旧版中断审批的 `blockedOnHostBashApproval` 临时逻辑与 `agent.abort()`，成功将文件精简至 1693 行。
- **`RunnerPool` 模块化解耦**: 将 `RunnerPool` 从 `runner.ts` 剥离至独立的 `runnerPool.ts`，并重构了所有渠道 runtime 与命令相关的引用路径，使得生命周期与池管理逻辑更清晰。
- **媒体路由类型安全化**: 在 `mediaFallback.ts` 中定义并导出了明确的 `AudioRouteDecision`、`VisionRouteDecision`、`ImageFallbackRouteDecision` 接口，解决跨模块导入类型推导问题，打通了 TypeScript 全局类型校验。

### 审批运行期阻塞唤醒与兼容性对齐 (v2.2 Phase 3D)
- **Tool 协程挂起与轮询**: 在 `toolRuntime.ts` 的 `executeToolCall` 中实现了 5 分钟超时限制的轮询机制，在需要审批且无授权时阻塞 Tool 的执行协程，待用户在客户端（Telegram / Web）做出选择后自动唤醒。
- **1.5s 审批 Debounce 聚合**: 针对 `low` 和 `medium` 风险的敏感操作实现了 1.5 秒 Debounce 合并逻辑，连续触发的类似审批会聚合成单张操作卡片，避免弹窗泛滥。
- **Capability 标识符映射**: 重构了 Host Bash 类型的能力标识符生成策略，统一映射为 `bash:${toolId}` 格式，完美兼容旧版控制命令和 `/settings/host-bash` 设置页中的 `LIKE 'bash:%'` 过滤规则。
- **重复执行并发拦截**: 在 `channelCommands.ts` 的审批执行方法中增加了 `isRunActive` 校验；如果被审批的 Run 当前处于 `'running'` 激活状态，将不调用后台并发执行通道，而是交由被挂起的协程直接继续完成执行，避免重复执行命令。
- **Abort 信号深度打通**: 在 `ToolExecutionContext` 中新增 `signal` 字段，并在 `tools/index.ts` 包装层及 `toolRuntime.ts` 轮询层进行对齐透传，当 Runner 主动中止（abort）时，被挂起的协程能够立刻感知并退出轮询。
- **暂停中断逻辑解耦**: 清理了 `runner.ts` 内部对 `waiting_for_approval` 中断的强制依赖，确保当审批挂起时 Runner 仍保持活跃 `running` 状态并正确持有分布式锁，只有在真正取消（`/stop`）时才中止。对 [runner.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/core/runner.test.ts) 中的审批通知推送与不中止执行流进行了同步重写与回归验证。

## 2026-05-29

### Legacy ACP 物理清理与工作区安全策略闭环 (Sprint A)
- **Legacy ACP 物理清理与依赖包外置**: 将遗留的 ACP (Agent-Channel Proxy) 模块从主代码库中彻底剥离并迁移至 `package/acp/`。删除了 `src/lib/server/acp/`、`src/routes/settings/acp/` 目录以及 `src/lib/server/channels/telegram/acpProgress.ts` 临时进度管理文件。
- **配置与设置层彻底解耦**: 移除了 `src/lib/server/settings/` 目录下 schema、defaults、sanitize 和 store 中所有关于 `acp` 的数据结构、验证、默认值和序列化逻辑。
- **外部依赖 subpath imports 注册**: 在根 `package.json` 的 `imports` 字段中注册了 `"#acp/*": "./package/acp/src/*"` 别名映射，以便在未来需要时可以将其作为标准外部依赖即插即用。
- **Feishu 渠道无用逻辑清理**: 移除了 `src/lib/server/channels/feishu/messaging.ts` 中未被引用的 `AcpPendingPermissionView` 导入和专属于 ACP 的卡片生成函数 `buildFeishuAcpPermissionCard` 与 `buildFeishuAcpPermissionResultCard`。
- **工作区工具与技能执行策略闭环**: 
  - **Tool 拦截**: 重构了 `ToolRuntime.executeToolCall`，使其读取当前工作区的 `enabledToolIds` 字段；当配置不为空且不包含 `*` 时，强行阻断所有未列入白名单的工具执行，并返回拒绝提示。
  - **Skill 过滤**: 扩展了 `loadSkillsFromWorkspace` 的 `SkillLoadOptions`，支持接收 `workspaceId` 并自动根据工作区的 `enabledSkillPaths` 过滤被加载的技能，且在 `runner.ts` 的执行流中对齐传递了活跃的 `workspaceId`。
- **单元测试与回归校验**: 在 `toolRuntime.test.ts` 与 `skills.test.ts` 中分别为工具及技能白名单过滤编写了高可靠性的单元测试，模拟创建测试工作区记录并验证策略阻断和过滤通过。所有 25/25 Agent 测试套件与 SvelteKit TypeScript 编译通过，无任何回归问题。

### 可插拔沙盒运行环境模块化重构 (Pluggable Sandbox Runtime)
- **解耦的沙盒接口定义**: 在 [sandbox.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/tools/sandbox.ts) 中定义了通用的 `SandboxProvider` 接口，以及与具体 SDK 无关的通用配置类型（`SandboxNetworkConfig`, `SandboxFilesystemConfig`, `SandboxRuntimeConfig`），确保底层沙盒逻辑与上层工具彻底解耦。
- **默认 Anthropic 沙盒包装器**: 实现了 `AnthropicSandboxProvider` 类，将原有的 `@anthropic-ai/sandbox-runtime` SDK 整合封装于其内，作为系统默认激活的沙盒后端。
- **沙盒管理器注册与动态切换**: 提供了 `getSandboxProvider()` 与 `setSandboxProvider()` 注册机制，支持运行时自由插拔更换底层沙盒实现（如 Docker、Bubblewrap 等）。重构了 `prepareToolSandboxExecution` 和 `getToolSandboxDiagnostics` 诊断函数，使其完全动态委托给当前激活的沙盒提供者。
- **自定义沙盒插拔测试验证**: 在 [sandbox.test.ts](file:///Users/gusi/Github/molipibot/src/lib/server/agent/tools/sandbox.test.ts) 中新增了 `pluggable sandbox provider dynamically intercepts sandbox execution` 单元测试，注册 Mock 沙盒提供者并验证其执行阻断、配置传递与环境隔离行为，且在测试结束后安全还原，确保测试隔离。运行 25/25 Agent 测试套件全部绿灯通过。

### ToolRuntime 与 ApprovalBroker 深度集成 (v2.2 Phase 3)
- **MCP 工具安全收口与动态包装**: 重构了 MCP 工具的加载与包装流程。在 `index.ts` 中更新 `wrapWithToolRuntime`，对以 `mcp__` 开头的 MCP 工具将其 `source` 统一标识为 `"mcp"`，并暴露出 `wrapTool` 辅助方法；在 `runner.ts` 的加载及刷新流程中，动态使用该方法将 MCP 工具包裹进 `ToolRuntime` 控制流下，确保 MCP 工具执行受到统一安全策略（沙箱/审批）监管。
- **子代理审批冒泡 (Subagent Approval Bubbling)**: 在 `subagent.ts` 中扩展 `createSubagentTool` 接收父任务的 `runId`，在子任务触发敏感工具需宿主审批时，将父任务的 `runId` 作为 `scopeId` 并将 `requestedByDepth` 设为 `1`。由此让前端 Channel 适配器能直接在主会话中为用户渲染并提醒子代理的审批请求。
- **审批深度持久化追踪**: 修改了 `HostBashStore.requestApproval` 存储适配层与 `bash.ts`，支持接收并持久化 `requestedByDepth` 参数，将其安全地记录在 SQLite 表 `approval_requests` 中，完成了子代理审批深度的库表字段落地。
- **测试回归验证**: 运行类型校验和 25/25 Agent 测试套件，以及 5/5 的 `approvalBroker.test.ts` / `approvalStore.test.ts` 测试套件，结果全部绿灯通过。

### TurnOrchestrator 核心生命周期接管与 runner.ts 瘦身 (v2.2 Phase 2)
- **核心生命周期委托**: 将原本耦合在 `runner.ts` 中的 Session 并发锁、10 分钟锁超时释放、内存同步与 Prompt 快照加载、以及上下文自动压缩机制全面委托给 `TurnOrchestrator` 管理。
- **并发锁与超时机制**: `TurnOrchestrator.prepareTurn` 实现了基于 SQLite 的 Session 锁，在同个会话出现并发调用时拦截并报错；支持 10 分钟锁自动超时置为 `failed` 状态并自动释放重构，保证系统不会因异常崩溃而产生永久死锁。
- **内存快照接管**: 实现了 `TurnOrchestrator.prepareTurnMemory`，统一封装 MemoryGateway 的外部记忆同步与快照 fingerprint 创建。
- **上下文压缩解耦**: 提取 `compact` 方法为 `TurnOrchestrator.compactSessionContext`。`runner.ts` 中的上下文超出临界值判定、自动压缩和重试流程现已全部委托其执行。
- **Turn 状态归档**: 提取 `commitTurn` 方法，集中管理最终 `RunSummary` 的保存及 SQLite runs 运行状态的更新（`completed`, `aborted`, `waiting_for_approval`, `failed`）。
- **`runner.ts` 瘦身**: 移除了 `runner.ts` 中上述大量的辅助状态与数据操作函数，让其核心只专注于 LLM 推理循环、工具预算和工具执行，文件可维护性极大提升。
- **回归测试验证**: 新增/重写了 `turnOrchestrator.test.ts` 中针对并发锁、超时释放、内存同步和归档提交等逻辑的 7 个细粒度单元测试；回归运行 25 个 Agent 测试套件，结果达成 **100% 全部通过** (25/25 passed)。

### Agent 目录重构与模块化治理 (Step 5)
- **目录结构清晰化**: 将原本存放在 `src/lib/server/agent/` 根目录下的数十个凌乱文件成功归类至以下子目录：
  - `core/`: 存放 Agent 核心逻辑、运行控制与生命周期管理（`runner.ts`、`turnOrchestrator.ts` 等）。
  - `routing/`: 媒体资源路由与备用决策（`modelRouting.ts` 等）。
  - `prompts/`: 提示词渲染、人设、模版和配置上下文加载（`prompt.ts`、`profiles.ts` 等）。
  - `tools/`: 工具定义、策略拦截与运行控制（`write.ts`、`bash.ts` 等）。
  - `skills/`: 自我演化与技能推荐机制（`skills.ts`、`self-evolution.ts` 等）。
  - `session/`: 会话历史持久化、归档与压缩机制（`session.ts`、`compaction.ts` 等）。
  - `identity/`: 鉴权鉴密管理（`auth.ts` 等）。
  - `common/`: 日志记录等辅助公共设施（`log.ts` 等）。
  - `commands/`: 终端命令与调试管理（`channelCommands.ts` 等）。
- **静态类型与导入路径纠正**: 对整个工作区中受到移动影响的 TS/JS/Svelte 文件进行全面重构，使用全新的 alias `"$lib/server/agent/..."`。
- **自定义 Node.js ESM 测试加载器**: 为规避 Node.js 对 Vite 特有的 `?raw` markdown 文件后缀静态引入抛出 `ERR_UNKNOWN_FILE_EXTENSION` 错误的问题，设计并引入了 `scripts/md-loader.js` 自定义 ESM 加载器，在测试执行期自动拦截并以 JavaScript 格式包装渲染 Markdown 字符串内容。
- **高风险写入路径和 Mock 稳健性修复**:
  - 修复 `write.ts` 无法自动创建缺失父级目录导致 `ENOENT` 异常的缺陷，改为前置安全调用 `fs.promises.mkdir` 递归建目录。
  - 修复了 `compaction.ts` 达到临界值时无法正确触发压缩的等于逻辑 bug。
  - 修复了 `self-evolution.test.ts` 因为迁移深度改变导致读取模板技能路径多了一层 `../` 的定位 bug。
  - 补充并对齐了 `runner.test.ts` 中模拟 error tracker 的 mock 对象，彻底消除了 `tracker.record is not a function` 的隐藏异常。
- **验证**: 运行 `npx node scripts/run-all-agent-tests.js` 对整个 agent 模块的 25 个测试套件进行了完整回归测试，达成 **100% 全部通过** (25/25 passed)，无任何类型或测试阻碍。

### ToolRuntime 和 ToolRegistry 深度集成 (Step 4)
- **内置工具 ToolDefinition 重构**: 内置工具（`read`、`write`、`edit`、`bash`）全部重构为 `ToolDefinition` 结构。工具逻辑彻底解耦，不直接导入 `node:fs` 或通过子进程直接执行 Host Bash。
- **ToolExecutionContext 真实 API 实现**: 移除了原有的 dummy 桩实现。`fs.readText`、`fs.writeText` 和 `fs.readBuffer` 实现了完整的 Workspace / CWD 路径安全性检查与节点文件系统读写能力。`shell.run` 在沙箱配置启用时自动执行沙箱指令包裹与状态跟踪。
- **ToolRuntime 集中拦截政策检查**: 使用自定义 `decidePolicy` 代代替原有的默认策略，拦截高风险命令（Host Bash / 越狱行为），根据 `hostBashStore` 的审批历史进行沙箱绕过或自动生成 `HostBashApprovalPrompt` 挂起审批。
- **向下兼容遗留桥接**: 实现并引入了 `toolDefToAgentTool` 桥接工具，对 `subagent.ts` 及各类旧测试代码透明，确保原有工具集继续跑通。
- **验证**: 单元测试和 TypeScript 类型检查全面通过，修改后的文件完全实现零 TS errors。

## 2026-05-28

### Agent v2.2 Runtime Integration
- **TurnOrchestrator 完整接入**: 新增 `src/lib/server/agent/turnOrchestrator.ts`，控制 run/session/workspace 元数据准备；`runner.ts` 现已在所有出口路径下调用 `updateRunStatus` 将 run 状态置为非 running。
- **启动死锁清理**: 在 `src/lib/server/app/runtime.ts` 的 `getRuntime()` 初始化段接入了 `getTurnOrchestrator().cleanupStaleRunningTurns(new SqliteTurnCleanupStore())`，在系统启动时自动清理过期的 runs 死锁。
- **渠道接入 TurnOrchestrator**: 修改 `baseRuntime.ts`，在 `runSharedTextTask` 处理消息前，直接调用 `TurnOrchestrator.prepareTurn()`，减少 `runner.ts` 内部对消息元数据处理的依赖。
- **ToolRuntime 统一拦截执行**: 所有由 `createMomTools()` 返回的内置工具均通过 `wrapWithToolRuntime` 动态注册至 `ToolRegistry` 并委托给 `ToolRuntime.executeToolCall()` 进行鉴权、审计及审批检查。
- **ApprovalBroker 与 SQLite 审批库**: 实现 SQLite 存储 `approval_requests` 和 `approval_grants`，并且 `HostBashStore` 已经完全重写直接使用该 SQLite 审批流。
- **ACP 设置面收缩与 Dynamic Settings 拆分**: ACP 主业务隔离，dynamic settings (Workspaces, Channel Instances, Custom Providers) 已经由 SettingsStore 自动支持 SQLite 拆分存储。
- **Runtime 模块化解耦**: 将包含 650+ 行配置清洗逻辑的 sanitizers 从 `runtime.ts` 提取至 `src/lib/server/settings/sanitize.ts`；将 channel 插件热装载逻辑 `applyChannelPlugins` 提取至 `src/lib/server/plugins/loader.ts`。`runtime.ts` 文件体积大幅缩减至 150 行以内，核心职责高度凝聚。
- **验证**: 单元测试和聚焦测试完全通过，TurnOrchestrator 补齐测试环境自动建表规避了 "no such table" 异常。

### Agent v2.2 Refactoring Design Spec (Refined)
- **精炼可执行架构规范**: 重新整合 v2.0 与 v2.1 方案优点，输出 `v2.2.md` 作为正式执行规范。明确了由 TurnOrchestrator、PiAgentRuntime、ToolRuntime、ApprovalBroker、Workspace 组成的 4 核心 1 边界的极简设计。
- **融合技术评审改进**: 根据 `v2.2-review.md` 评审，明确 Workspace ID 仅作为逻辑权限与隔离边界，绝不干涉或迁移物理文件目录结构。
- **平滑演进与细化切片**: 将 ACP 下线改为第一阶段仅清除活跃引用、最后阶段再物理删除代码；将 TurnOrchestrator 改为增量式接入与管道灰度升级；将 Phase 3 审批模块拆分成内置收口、Host Bash 兼容、Subagent 冒泡、Debounce超时 4 个更薄的细分切片。
- **细化模块接口与库表**: 设计并给出了 Workspace、ToolDefinition、ToolExecutionContext、ApprovalRequest、ApprovalGrant 的完整 TS 类型以及 SQLite 数据表结构，并在 SQLite schema 中补齐 `runs.status` 完整运行时状态与 `approval_requests` 性能优化索引。


### Minimum Workspace Boundary
- **默认 Workspace registry**: 新增 SQLite-backed `workspaces` registry，启动时确保默认 `personal` workspace 存在，并保留 `enabledSkillPaths`、`enabledToolIds`、`sandboxProfileId`、`approvalProfileId` 等后续边界字段为可选。
- **运行记录带 Workspace**: Shared channel runtime、Web chat API 和 streaming API 会给新消息注入默认 `workspaceId`，runner 兜底解析 workspace 并把 `workspaceId` 写入 run summary / run detail JSONL；当前不迁移已有 session/chat 文件布局。


## 2026-05-27

### Agent v2.1 simplification planning
- **可执行 TODO 计划**: 当时曾把 `v2.1.md` 拆成 80 条执行项，用于推进“删除 ACP 主路径 + 引入最小 Workspace 边界”、TurnOrchestrator、ToolRuntime、Approval scope 和 Settings 渐进拆分；该过程计划现已从主 docs 树清理，长期架构结论保留在 Agent redesign 设计文档中。

### ACP active runtime path removal
- **ACP 主路径下线**: Web/Telegram/Feishu/QQ/Weixin 的共享 channel runtime 不再实例化 `AcpService`，各渠道移除 ACP 自动代理、ACP 命令模板、权限回调和运行提示；`/acp`、`/approve`、`/deny` 统一返回 inactive-path 提示。
- **设置入口下线**: Settings 左侧导航和总览页不再展示 `/settings/acp`，README 将 ACP 标记为 legacy inactive surface；旧 `settings.acp` schema 与 `src/lib/server/acp/` 仍保留兼容，不做破坏性迁移。

### Agent session persistence hardening
- **Compaction 顺序修正**: Runner 自动压缩上下文时先写入 compaction entry，再追加本轮用户消息，避免当前 prompt 被新 compaction 快照截断。
- **错误 assistant 上下文隔离**: 没有 partial 文本的 assistant error 仍作为审计消息保存在 Agent session，但从下一轮模型上下文中过滤，避免空 assistant error turn 污染推理。
- **Sandbox 写权限收窄**: Longbridge 日志目录不再被加入所有 sandbox 命令的默认 `allowWrite`，后续如需放行应走命令级或配置级边界。

## 2026-05-26

### Agent session persistence parity
- **失败轮次保存对齐 Pi/Pae**: Runner 现在在本轮开始时保存用户消息，并在 assistant 成功、失败、partial 输出或工具结果完成时追加 Agent session 记录；自动重试和工具预算续写可继续隔离错误 assistant 的模型上下文，但不会删除 session 审计历史。

### Host Bash tool display accuracy
- **Host Bash 显示名修正**: `bash` 命中已批准 Host Bash 白名单或当前 session host fallback 时，runner 进度、run detail 和客户端诊断显示为 `Host Bash`，不再因为全局 sandbox 开启而误标成 `Sandbox` / `Sandbox disabled`。

## 2026-05-25

### Subagent sandbox research and product boundary
- **竞品调研文档**: 新增 `docs/research/sandbox/subagent-sandbox.md`，系统梳理 Claude Code、Codex、GitHub Copilot cloud agent、Replit Agent、Devin、OpenHands、Cursor 在 subagent、sandbox、审批、环境快照、回滚和页面交互上的实现方式。
- **下一阶段边界明确**: 文档把 Molibot 当前第一版能力和缺口拆成 P0/P1/P2/P3，建议先补齐策略模板、run ledger、审批/产物/诊断关联和恢复边界，再扩大 host access 或 Docker sandbox provider。

### Host approval environment hotfix
- **Host approval env 恢复继承**: approved Host Bash / legacy host tool 执行器恢复继承宿主 `process.env`，避免开启 sandbox 后审批执行拿不到 API key、PATH、HOME 等运行变量。
- **env allowlist 暂保留兼容**: `envAllowlist` 仍保留在审批记录和白名单结构里，但当前热修复不再把它作为默认清空宿主环境的强制边界；后续再设计可审计的敏感 env 审批。
- **Subagent 审批等待状态修复**: subagent chain/parallel 汇总现在保留 `waiting_for_approval`，chain 在子任务等待审批或失败时停止继续传递 `{previous}`；Web chat 和 streaming API 不再把等待审批提示持久化为普通 assistant 会话消息。
- **审批后自动执行路径修复**: 新建 Host Bash pending action 统一使用 `run_approved_host_bash`，审批后的自动执行恢复拿到原始命令 payload，并从 chat scratch 目录运行，避免相对路径偏移到 chat 根目录。
- **审批等待不再被内部 abort 覆盖**: Host Bash 审批触发的内部 `abort()` 不再把 runner 最终状态改回 `aborted`，Telegram 因此不会在等待审批路径额外发送 `Stopped.`。
- **审批后空输出减噪**: Host Bash pending action 自动执行成功但无 stdout/stderr 时，不再向 Telegram/Feishu/Web/Base 额外发送 `(no output)`，只保留审批已执行的确认消息；失败输出仍照常展示。
- **Telegram 审批点击立即反馈**: Telegram Host Bash 按钮现在先确认 callback 并把审批卡改成“已收到/执行中”，再执行可能较慢的 Host Bash pending action，避免 Telegram callback 超时后用户看不出点击是否生效。

## 2026-05-24

### Host Bash approval friction reduction
- **Host Bash 审批执行补齐**: approved Host Bash / legacy host tool 执行器补齐 session-only pending action 自动执行路径；环境变量默认继承行为已在 2026-05-25 热修复中恢复。
- **Session-only 执行闭环**: `approve-session` 不写长期白名单时，pending Host Bash action 也能用审批记录自身权限执行一次，避免“本 session 允许”后立即执行失败。
- **跨渠道审批执行补齐**: QQ / Weixin 通过共享 channel runtime 继承默认 Host Bash pending action 执行回调；Web Chat 新增 `/hosttools approve|approve-session|reject` 命令闭环。
- **上下文瘦身**: 等待 Host Bash 审批时回滚本轮模型消息，避免审批卡和 sandbox 长错误写入会话上下文；subagent 返回给父 Agent 的超长输出会压缩，完整结果保留在 tool details / run trace。

### Subagent artifact routing
- **Subagent 日期目录继承**: 主 Agent 传入的 `scratch_artifact_dir` 会继续传给 subagent 的 `bash/write` 工具；子 Agent 普通产物和主 Agent 一样默认进入 `scratch/YYYY/MM/DD/`，并在提示中要求回报 routed relative path。
- **修改型产物也归档**: `bash` 会比较根目录文件快照和修改时间，新建或修改过的普通产物都会移动到日期目录，避免子 Agent 重写同名报告时父 Agent 读到旧文件。
- **Host Bash 审批一致**: subagent 内部 `bash` 继承主 Agent 的 channel/chat/session/store 权限上下文，已批准 Host Bash 和 session-only sandbox fallback 对子 Agent 同样生效；子 Agent 需要新审批时会把审批请求冒泡给父 runner 和现有 channel 审批入口。

## 2026-05-23

### Session-scoped sandbox approval fallback
- **第三种审批选项**: host tool approval 现在新增 `This Session` / `approve-session` 路径，批准后不会把命令写进全局 `approvedTools`，只对当前聊天 session 生效。
- **sandbox 自动回退**: 一旦当前 session 进入该模式，后续被 sandbox 权限拦住的 `bash` 命令会直接 fallback 到 host bash 执行，不再对同一 session 中的每条命令重复审批。
- **生命周期正确**: 该放行状态存进 session header preference，不会作为普通对话消息回灌给模型；新建 session（如 `/new`）或切换 bot 后自然失效，并额外写入 runtime event 供排障查看。
- **交互入口补齐**: Telegram/Feishu 审批卡片现在有三种操作：`Approve`、`This Session`、`Reject`；无按钮渠道可用 `/hosttools approve-session <approvalId>` 或回复 `本session允许` / `approve session`。
- **回归覆盖**: 新增共享命令测试覆盖 session-only approval 行为，并补 bash 工具测试覆盖 session 模式下的 sandbox denial fallback 分支。


## Update Log
- 2026-05-13: Hardened `molibot manage` against terminal disconnects. Interactive `readline` prompts now swallow ignorable TTY read `EIO` failures, pending prompt waits resolve on interface close, and the menu exits cleanly instead of crashing with an unhandled `Interface` error when stdin disappears.
- 2026-05-11: Fixed Telegram shared live-control command registration. `/steer`, `/followup`, `/follow_up`, and `/queue` now enter the shared command handler before the busy-message enqueue path, so `/steer <queueId>` injects the referenced pending task into the active run instead of creating a new queued task id.
- 2026-04-29: Fixed image routing for dedicated vision models. When a different `visionModelKey` is configured, image messages now use that route before falling back to a vision-capable text route, so setups like text=`mimo-v2.5-pro` and vision=`mimo-v2.5` send the image turn to the intended vision model. If a vision-model request fails but a fallback model recovers the run, Telegram receives a separate failure notice and the assistant still continues processing.
- 2026-04-29: Added Anthropic protocol support for custom AI providers. `/settings/ai/providers` now lets custom providers choose OpenAI-compatible or Anthropic Messages protocol, defaulting old configs to OpenAI-compatible and switching Anthropic paths to `/v1/messages`; provider tests, direct Web custom-provider calls, runner/subagent model construction, SQLite persistence, and vision fallback payloads now branch by protocol. Follow-up polish made protocol switching update the endpoint path reactively, added an Anthropic adaptive thinking format, and changed Reasoning Effort Mapping to default to automatic per-format mappings with optional dropdown overrides.
- 2026-04-29: Improved custom provider test diagnostics. `/api/settings/provider-test` now formats JSON upstream errors and returns up to 4000 characters with an explicit truncation note, while the Providers page allows multi-line status text instead of collapsing long responses to a single ellipsis.
- 2026-04-29: Moved single-model provider test feedback into the tested model card on `/settings/ai/providers`, so Save-button status is reserved for page-level save/load results and each model keeps its own latest connectivity response.
- 2026-04-29: Fixed Anthropic custom-provider runtime endpoint construction. Runner/subagent model setup now passes the Anthropic SDK-style base URL by stripping the full `/v1/messages` suffix, matching the provider-test request URL; model error records also include a computed endpoint URL so `/settings/ai/errors` no longer forces operators to infer the failing path from base URL alone.
- 2026-04-26: Productized the Web chat files pane. Added shared file-preview classification in `src/lib/shared/filePreview.ts`, persisted Web session attachment metadata in `src/lib/shared/types/message.ts` and `src/lib/server/sessions/store.ts`, and introduced `src/routes/api/web/files/+server.ts` for current-session file listing plus raw preview/download responses. The main chat page now supports general file upload, richer pending-file chips, and a real right-side file workspace with search, type filters, preview, download, and copy-path actions.
- 2026-04-26: Updated `/settings/ai/usage` so range-tab clicks now automatically refresh backend stats. Switching `today / yesterday / last7Days / last30Days` immediately triggers `loadUsage()`, keeping the selected window, `generatedAt`, and KPI/chart payload in sync without a separate manual refresh click.
- 2026-04-26: Extended `/settings/ai/usage` with cache-hit observability. The dashboard now shows a cache-hit ratio KPI and a dedicated line chart, using the existing usage records only and defining hit rate explicitly as `cacheRead / (input + cacheRead)` so prompt-cache effectiveness is visible by time window and filters.
- 2026-04-26: Added a shared `src/styles/workbench.css` UI layer and switched Settings onto reusable workbench primitives instead of per-page CSS islands. `PageShell`, `Button`, `Card`, and `Alert` now expose the same material system; `/settings/ai/usage`, `/settings/ai/errors`, `/settings/ai/routing`, and `/settings/ai/providers` no longer keep page-local `<style>` blocks; the remaining settings pages and the main Web chat were restyled onto the same panel/toolbar/config-shell language without changing route behavior or data flow.
- 2026-04-26: Removed time-specific lines from the runtime-owned system prompt context in `src/lib/server/agent/prompt.ts`. Current time and today-date awareness now live only in the per-message `<env>` wrapper, so the cached system prompt no longer carries `Server timezone` / `run: date` guidance that was redundant after live input injection.
- 2026-04-26: Added structured per-message time context for model input. `src/lib/server/agent/promptInput.ts` now injects `<env>` metadata with `message_received_at`, `timezone`, and `today`; `src/lib/server/agent/runner.ts` uses that wrapper only for live model input and rewrites persisted context back to the raw user text plus attachment markers; `src/routes/settings/ai/routing/+page.svelte` now exposes runtime timezone as a dropdown built from IANA timezones, and `/api/settings` validates the saved timezone before persistence.
- 2026-04-26: Reorganized documentation responsibilities across `AGENTS.md`, `README.md`, `features.md`, `prd.md`, and `CHANGELOG.md`. Extracted only evergreen collaboration and architecture rules into `AGENTS.md`, added a doc-role table plus maintenance workflow to `README.md`, and recorded the change as a dedicated documentation-governance update so future edits keep stable rules separate from planned work and shipped history.
- 2026-04-26: Fixed three regressions in the new shared runner/subagent path. `src/lib/server/agent/runner.ts` now clears buffered streamed assistant text at the start of each new assistant message so retry/fallback partial output cannot leak stale text into later failures or continuations. `src/lib/server/agent/tools/subagent.ts` now rejects shell control operators in read-only subagent bash commands, and delegated roles now honor the checked-in per-agent `model:` hint instead of always inheriting the parent text model. Added focused regression tests in `src/lib/server/agent/runner.test.ts` and `src/lib/server/agent/tools/subagent.test.ts`.
- 2026-04-26: Refined the shared tool-execution guidance in `src/lib/server/agent/prompt.ts`. The system prompt no longer says to parallelize any “independent” tool calls by default; it now distinguishes safe local read-only parallelism from remote/network/search work that has timeouts, retries, fallbacks, quotas, or result-normalization concerns, and explicitly tells the agent to run fallback-dependent steps sequentially. Added `src/lib/server/agent/prompt.test.ts` to lock that wording in.
- 2026-04-26: Hardened the Molifin gold daily scheduled task outside the main app repo. The bot workspace now ships a dedicated `run_gold_daily_searches.py` wrapper that executes the four fixed gold-report queries strictly in series, gives each engine a fixed 60-second budget, automatically falls back across the documented web-search engine order on timeout/error/empty results, and writes one JSON + Markdown result bundle per day. The linked event prompt and `gold_daily_scheme.md` were bumped to V7 so the runtime stops spawning four parallel 30-second `bash` searches by default.
- 2026-04-26: Made live run control queue-aware. When a second message arrives during an active run, Telegram/Feishu/QQ/Weixin now reply with a queue id (`Queued as #...`). Shared `/steer <queueId>` and `/followup <queueId>` can promote that already-sent pending item directly from the SQLite inbound queue into the live runner without retyping its text.
- 2026-04-26: Added shared live run-control commands for active tasks. `src/lib/server/agent` now exposes `abort / steer / followUp` through the shared runner/pool layer, `/steer <text>` injects a correction into the current run, `/followup <text>` queues a live follow-up after the current run finishes, and `/stop` now hard-aborts after clearing any in-memory live-control queue entries.
- 2026-04-26: Changed shared channel stop semantics so `/stop` now aborts the current run and clears pending queued tasks in the same scope. Added shared queue cancellation support in the SQLite inbound queue layer, updated Telegram queue feedback text to explain the new behavior, and covered the change with queue/command tests.
- 2026-04-22: Replaced the old in-memory pending-message flow for Telegram, Feishu, QQ, and Weixin with a shared lightweight SQLite task queue. Incoming text/image/voice tasks now survive restart, support `/queue` listing, `/queue front`, and `/queue delete`.
- 2026-04-14: Fixed the invalid self-closing `textarea` in Skill Drafts settings so `npm run build` and dev startup no longer warn on that page.
| ENG-148 | Audio-input capability groundwork | Done | Added `audio_input` as a first-class model capability tag across settings schema, sanitization, provider test payloads, and AI Providers UI, while intentionally keeping its verification state `untested` until native audio prompt transport is implemented |
| ENG-149 | Verification-aware audio fallback routing | Done | Updated `runner.ts` to compute an explicit audio decision from `audio_input` and `stt` capability metadata, log the fallback reason, keep STT as the execution path while native audio transport is unavailable, and preserve voice-placeholder behavior when no STT target exists |
| ENG-150 | Telegram media pre-processing status + action retry hardening | Done | Added reusable pre-thinking status messages for inbound image/audio recognition, upgraded `sendChatAction` and status-edit paths with limited retry on transient network failures, and reused the seeded status message through `Recognizing... -> Thinking -> final answer` |
| ENG-151 | Telegram network-error diagnostics enrichment | Done | Added structured Telegram transport error diagnostics with nested `cause`/`code`/`errno`/`syscall`/`address` metadata on retry warnings and failure logs so generic grammY `Network request failed` events can be traced to real socket/DNS timeout causes |
| ENG-152 | Declared-vision-first native image routing | Done | Custom text/vision models that explicitly declare `vision` are now trusted for native image input even when verification is `untested` or `failed`; verification remains observable in logs, but no longer forces an unnecessary image-analysis fallback API call |
| ENG-153 | AI usage bot-dimension analytics and filtering | Done | Extended usage records with `botId`, added bot-level aggregation in usage tracker windows/breakdowns, and upgraded `/settings/ai/usage` with bot filter + bot ranking table to compare usage across different bot instances |
| ENG-276 | AI usage analytics chart/icon contrast fix | Done | Fixed `/settings/ai/usage` so its key accent icons, token badges, and Usage Timeline bars keep visible contrast under the shared settings theme instead of being flattened into near-background black/white tones |
| ENG-252 | Runner stream logging safety fix | Done | Removed the unsafe low-level stream wrapper from `runner.ts`, moved first-token logging onto real assistant delta events, and stopped auto-enabling pretty stdout logs unless `MOM_LOG_PRETTY=1` is explicitly set |
| ENG-253 | Weixin final-reply drop fix after progress updates | Done | Fixed `src/lib/server/channels/weixin/runtime.ts` so when Weixin has already sent progress updates (for example “搜索中”), the final answer is still sent out instead of being silently swallowed by replace-without-edit fallback |
| ENG-254 | QQ final-reply drop fix after progress updates | Done | Fixed `src/lib/server/channels/qq/runtime.ts` so when QQ has already sent progress updates, the final answer is still sent out instead of being silently swallowed by replace-without-edit fallback |
| ENG-255 | Weixin outbound markdown conversion routed to vendored SDK logic | Done | Weixin text/file-caption outbound now runs `#weixin-agent-sdk/src/messaging/send.ts` `markdownToPlainText` before sending, and removed local SDK barrel `src/lib/server/channels/weixin/sdk/index.ts` to avoid stale duplicate entry paths |
| ENG-256 | Weixin local type facade removal (phase-2 step-1) | Done | Removed local `src/lib/server/channels/weixin/sdk/types.ts` facade and switched Weixin channel modules to direct vendored type imports, while keeping send/receive runtime behavior unchanged for safe incremental migration |
| ENG-257 | Weixin local poll/login wrapper thinning (phase-2 step-2) | Done | Kept WeixinBot external interface unchanged but switched internal polling/config/typing calls in `sdk/client.ts` to direct vendored API usage, and removed now-unused local relay methods from `sdk/api.ts` |
| ENG-258 | Weixin local credential-storage thinning (phase-2 step-3) | Done | Kept workspace tokenPath isolation behavior, while syncing save/clear operations in `sdk/auth.ts` into vendored account storage and using vendored account store as fallback only when tokenPath is not provided |
| ENG-259 | Weixin direct third-party SDK cutover (remove local sdk directory) | Done | Removed local `src/lib/server/channels/weixin/sdk` API/Auth implementations and switched runtime/outbound/media paths to direct `#weixin-agent-sdk/*` usage, with a minimal channel bridge file retained at `src/lib/server/channels/weixin/client.ts` |
| ENG-260 | Bash Python sandbox virtualenv isolation | Done | `bash` tool now auto-runs commands with one shared Python virtualenv under `~/.molibot/tooling/python/venv`, and unifies `python/pip/uv` to this sandbox path so package installs do not pollute global Python |
| ENG-261 | Bot profile files management tool with inherit fallback | Done | Added `profile_files` tool so runtime can read/bootstrap/write/edit bot-level profile files (`BOT/SOUL/USER/TOOLS/IDENTITY/SONG`) with fallback chain `bot -> agent -> global`, avoiding direct bash path edits for agent training/tuning workflows |
| ENG-262 | Telegram API call timeout-based retry unstick | Done | Added per-attempt timeout to Telegram send/edit/action API retry wrapper so stuck network calls fail fast with retry instead of hanging status updates indefinitely; timeout failures now count as retryable and include timeout metadata in logs |
| ENG-263 | Bash Python command hard-binding to sandbox venv | Done | Hardened bash tool Python isolation by forcing `python/python3/pip/pip3` inside executed shell to resolve to the unified sandbox interpreter, auto-healing missing pip via `ensurepip`, and stripping unsupported `--break-system-packages` flags so skill scripts no longer fail when bootstrapping dependencies |
| ENG-264 | Settings tasks cross-channel visibility and trigger routing | Done | Expanded `/api/settings/tasks` and `/settings/tasks` from Telegram-only scope to all built-in channels (`telegram`/`feishu`/`qq`/`weixin`), added channel-aware path validation and counts, and wired manual trigger dispatch by channel manager with new `triggerTask` support in QQ/Feishu/Weixin runtimes |
| ENG-265 | Session token visibility and QQ audio URL voice routing | Done | `/status` now shows current session context estimate plus accumulated per-session token usage, and QQ outbound media now routes remote audio URLs onto the native voice send path instead of misclassifying them as generic attachments |
| ENG-226 | ACP compact settled-history progress display | Done | ACP now emits normalized progress events, Telegram keeps one live progress message with current state plus recent completed/failed history instead of overwriting everything, and the shared ACP proxy rule is centralized so active ACP sessions keep slash-style input on the remote side unless it is an ACP control command |
| ENG-187 | Telegram stream output toggle per bot | Done | Added per-bot `streamOutput` setting (default on) on `/settings/telegram`; Telegram runtime now supports stream-on incremental status editing and stream-off final one-shot output |
| ENG-188 | WeChat channel integration via Node SDK | Done | Added built-in WeChat channel plugin and settings page; later migrated the runtime off the buggy published `@pinixai/weixin-bot` package and onto a project-local Weixin SDK bridge derived from the newer `weixin-agent-sdk` flow so WeChat no longer depends on that npm package at runtime |
| ENG-189 | WeChat login-link QR generator in settings | Done | Added a QR tool to `/settings/weixin` so operators can paste the SDK login link from logs and instantly render a scannable QR code in the browser for phone-based WeChat login confirmation |
| ENG-190 | Telegram Codex ACP command path MVP | Done | Added ACP settings + Codex target preset, Telegram `/acp` / `/approve` / `/deny` commands, project registration, chat-scoped ACP session lifecycle, live status updates, and permission request handling for Codex-style remote coding control without altering the normal Telegram chat runner |
| ENG-191 | ACP web settings workspace | Done | Added `/settings/acp` with structured ACP target/project management, approval-mode defaults, absolute-path project allowlist editing, and settings overview/navigation entry so Codex ACP can be configured from the web UI instead of command-only setup |
| ENG-192 | Shared Button click event forwarding | Done | Fixed `src/lib/ui/Button.svelte` to forward native `click` events from the inner `<button>`, restoring all settings actions wired as `<Button on:click={...}>`, including ACP `Add Project` / `Add Target`, bot add/remove controls, MCP parse/save, memory actions, and task bulk operations |
| ENG-193 | ACP stdio framing compatibility fix | Done | Fixed `src/lib/server/acp/connection.ts` to send newline-delimited JSON over stdio for ACP adapters instead of LSP-style `Content-Length` frames, while still accepting `Content-Length` input for compatibility; this resolves Codex ACP initialization parse failures and removes silent `/acp new` hangs caused by transport mismatch |
| ENG-194 | Codex ACP auth preflight hinting | Done | Improved `src/lib/server/acp/service.ts` startup error reporting so Codex-like ACP targets now append a concrete auth hint when Molibot has neither `OPENAI_API_KEY` nor `CODEX_API_KEY`, clarifying that Telegram ACP cannot complete interactive `codex --login` and needs pre-provisioned host auth or target env credentials |
| ENG-221 | pi-ai 0.62 OAuth import compatibility fix | Done | Moved runtime OAuth helper imports in `src/lib/server/agent/auth.ts` from `@mariozechner/pi-ai` to `@mariozechner/pi-ai/oauth`, restoring production build compatibility after upgrading `pi-ai` to `0.62.x` |
| ENG-195 | Codex auth.json reuse + ACP startup timeout tuning | Done | Verified that Codex ACP can reuse local `~/.codex/auth.json` ChatGPT login state in a non-interactive process, then updated `src/lib/server/acp/service.ts` to detect file-based auth before warning about missing credentials and increased ACP startup timeouts (`initialize` 30s, `session/new` 60s) so Codex adapter warm-up no longer fails under transient model-refresh latency |
| ENG-196 | Telegram ACP status flood protection | Done | Hardened `src/lib/server/channels/telegram/formatting.ts` and `runtime.ts` so Telegram `429 Too Many Requests` with `retry_after` is retried correctly, ignorable `message is not modified` edits no longer bubble as fatal errors, and ACP task status updates are throttled plus wrapped in warning-only fallback logic instead of crashing the whole Node process |
| ENG-197 | ACP tool-event noise reduction | Done | Stopped emitting one Telegram message per completed ACP tool call in `src/lib/server/acp/service.ts`; Telegram now keeps permission/plan events but rolls tool activity into the final `/acp task` summary with completed/failed counts and touched file locations, preventing tool-call spam from flooding the chat |
| ENG-198 | ACP final-result Markdown structuring | Done | Updated Telegram ACP task dispatch in `src/lib/server/channels/telegram/runtime.ts` to automatically append output-format instructions that require concise Markdown sections (`Summary` / `Changes` / `Verification` / `Notes`), and reformatted the local task-finished summary into Markdown bullets so final responses render as readable structured reports instead of plain-text walls |
| ENG-199 | ACP session persistence and restore | Done | Added persisted ACP chat-session metadata under each Telegram bot workspace, taught `src/lib/server/acp/service.ts` to restore saved remote sessions through ACP `session/load`, and updated Telegram ACP commands to auto-restore on `/acp status`, `/acp task`, `/acp mode`, and `/acp cancel`, so service restarts no longer force a fresh `/acp new` when the remote Codex session still exists |
| ENG-200 | ACP available-commands object rendering fix | Done | Fixed ACP command parsing in `src/lib/server/acp/service.ts` so `availableCommands` arrays containing objects are normalized by `name`/`id` instead of `String(object)`, eliminating `/acp status` output like `[object Object]` and restoring readable command lists |
| ENG-201 | ACP sessions command | Done | Added `/acp sessions` command in Telegram runtime and ACP service support for `session/list`, with project-aware filtering and readable formatting, so operators can inspect restorable remote Codex sessions instead of relying only on implicit auto-restore |
| ENG-202 | ACP permission inline-card UX | Done | Reworked Telegram ACP permission handling from raw text instructions into inline button cards with one-tap approve/deny actions and a guided “deny with note” follow-up flow, while keeping legacy `/approve` and `/deny` commands as fallback |
| ENG-203 | Feature plugin MVP + Cloudflare HTML publish | Done | Added first-class built-in feature plugin plumbing, a configurable Cloudflare HTML publish plugin in `/settings/plugins`, system-prompt plugin guidance, and a `publish_html` agent tool that uploads complete HTML documents to Cloudflare R2 and returns the public link |
| ENG-203 | ACP execution-context output guardrail | Done | Updated Telegram ACP task prompt template to require a mandatory `Execution Context` section that prints raw runtime diagnostics (`pwd`, `ls -la`, python/uv resolution, DB env values, command + exit code), improving root-cause visibility when ACP execution differs from local terminal runs |
| ENG-204 | ACP stop command alias | Done | Added `/acp stop` command alias in Telegram ACP command router (same path as `/acp cancel`) and updated ACP help output so operators can immediately terminate running ACP tasks with a more intuitive stop action |
| ENG-237 | Cloudflare HTML plugin ownership cleanup | Done | Moved the Cloudflare HTML publish runtime action into `src/lib/server/plugins/cloudflareHtml/`, made the feature registry the only registration path, and split final-link settings to use a dedicated Worker base host while still reading older saved `publicBaseUrl` values |
| ENG-238 | Feature plugin dynamic settings form | Done | Feature plugins can now declare their own settings fields in the registry, and `/settings/plugins` renders/saves those fields dynamically instead of hard-coding a dedicated Cloudflare HTML form block |
| ENG-239 | Feature plugin subdirectory declarations | Done | Plugin-specific feature declarations now live inside each plugin subdirectory (`src/lib/server/plugins/<plugin>/plugin.ts`), while the root feature registry is reduced to a thin aggregator that imports and combines built-in plugins |
| ENG-240 | Cloudflare HTML Worker template | Done | Added a Worker-side HTML serving template under `src/lib/server/plugins/cloudflareHtml/worker/`, including the Worker source, example Wrangler config, and setup notes so the plugin ships both the upload side and the public-serving side together |
| ENG-241 | Cloudflare HTML Worker custom filename support | Done | Relaxed the Worker-side filename guard so public routes can serve normal safe `.html` names like `gold_daily_20260420_v5.html`, instead of only accepting one hard-coded random-name pattern |
| ENG-242 | Cloudflare HTML dual public-link modes | Done | Cloudflare HTML publish can now return either Worker-based links or direct public R2 links, with plugin settings and docs updated so operators can choose between the two without removing the optional Worker path |
| ENG-243 | Cloudflare plugin partial-update validation fix | Done | Fixed plugin settings validation so partial `plugins.cloudflareHtml` updates are merged with current saved values before required-field checks run, preventing false failures and `.trim()` crashes during incremental updates |
| ENG-266 | Cloudflare HTML file-path upload input | Done | Changed `publishHtml` to accept a local `filePath` instead of inline HTML content, so the tool reads and validates the file inside runtime, keeps workspace path-guard enforcement, and avoids pushing large HTML payloads into model context |
| ENG-235 | Weixin OGG voice auto-transcode | Done | Weixin outbound voice now detects Telegram-style `ogg/opus` files, converts them to `mp3` before upload, and then retries native Weixin voice delivery instead of treating them as unsupported binary blobs |
| ENG-236 | Weixin SDK import cleanup and install repair | Done | Removed all app-side `../../../../node_modules/...` Weixin SDK imports, switched Weixin channel code to normal SDK subpath imports, and added a postinstall repair script so the broken published package exports are fixed automatically after dependency install |
| ENG-205 | Skill protocol slimming + multiline frontmatter compatibility | Done | Prompt now prefers global `skill-creator` when `~/.molibot/skills/skill-creator/SKILL.md` exists, hides `Skill Diagnostics`, skill inventory no longer prints `base_dir`, and skill frontmatter parser now supports YAML block-style multiline `description` (`>` / `|`) across runtime and settings inventory |
| ENG-206 | Explicit slash skill invocation normalization | Done | Skill invocation detection now accepts direct slash form such as `/skill-name` and `/skill-name@bot`, matches normalized names case-insensitively (`space`/`_`/`-` treated equivalently), injects explicit invocation context into runner input, and keeps MCP skill-gating aligned with the same matcher |
| ENG-207 | Explicit skill path injection and SKILL.md execution guard | Done | Runner explicit-skill context now includes authoritative `name/scope/skill_file` fields to avoid global-path guessing for bot-scoped skills, and prompt skill protocol now explicitly forbids running `SKILL.md` via `sh/bash` directly (must read first, then execute documented scripts) |
| ENG-212 | ACP multi-provider adapter profiles and command unification | Done | Split ACP target behavior into explicit provider files for Codex and Claude Code, added `adapter` metadata plus dual built-in presets, removed Codex-only project defaults/auth branching from the service layer, and standardized Telegram/UI exposure so the public control surface stays `/acp ...` while provider-specific remote commands are shown with prefixes like `codex:/...` and `claude-code:/...` |
| ENG-213 | ACP remote command execution entrypoint | Done | Added Telegram `/acp remote <command> [args]` command and ACP-side provider-aware remote-command resolution/validation, so operators can execute adapter-reported remote commands directly with unified syntax while still distinguishing providers via `codex:/...` or `claude-code:/...` prefixes |
| ENG-214 | ACP active-session default proxy mode | Done | Added Telegram ACP auto-proxy middleware so when a chat has an active ACP session, all non-control text (including slash commands like `/help`) is forwarded directly to the active Codex/Claude ACP session; `/acp ...`, `/approve ...`, and `/deny ...` stay as reserved control commands, and `/acp close` exits proxy mode |
| ENG-215 | ACP all-channel runtime support | Done | Extended ACP from Telegram-only to Telegram, Feishu, and QQ runtimes, moved ACP task prompt policy into a shared ACP module, added channel-level `/acp` / `/approve` / `/deny` command handling plus active-session default proxy mode in Feishu and QQ, and updated the ACP operator doc to describe channel-wide behavior instead of Telegram-only behavior |
| ENG-216 | Weixin ACP parity | Done | Added ACP support to the Weixin runtime so it now matches Telegram, Feishu, and QQ with `/acp` / `/approve` / `/deny`, active-session default proxying, remote command execution, approval handling, and updated channel-wide ACP documentation |
| ENG-217 | ACP shared channel control layer | Done | Centralized ACP slash-command parsing, approval handling, reserved-control detection, and channel help lines into a shared channel controller so Telegram, Feishu, QQ, and Weixin now use one ACP behavior core instead of copy-pasted per-channel command logic |
| ENG-218 | ACP text-channel template | Done | Added a reusable ACP channel template for text-oriented runtimes and moved Weixin, QQ, and Feishu to that template so future channel onboarding only needs message I/O wiring instead of rebuilding ACP proxy/control flow |
| ENG-219 | Weixin inbound media intake parity | Done | Weixin runtime now parses raw `item_list` media payloads, downloads/decrypts inbound image/file/voice/video attachments from the Weixin CDN, stores them in the chat workspace, feeds images into vision input, and no longer drops attachment-only messages as empty text |
| ENG-220 | Weixin inline voice-text STT skip | Done | When a Weixin voice message already carries built-in text content, runtime now marks it as already transcribed and skips the second STT pass, avoiding redundant tool churn and failed `.silk` re-decoding attempts |
| ENG-231 | Weixin outbound image/voice media delivery | Done | Replaced the fake `[file] path` fallback in Weixin uploads with real CDN-backed media sending: images now go out as native image messages, audio tries native voice first with file fallback, and other binaries send as actual file attachments |
| ENG-232 | Skill-first prompt routing and slash-alias hardening | Done | Removed hardcoded skill-name assumptions from the runtime prompt, added general explicit-skill rules adapted from the Claude-style skill semantics, and fixed slash invocation matching to honor both `SKILL.md` `name` and skill directory aliases so runtime can pass the exact `skill_file` path instead of guessing |
| ENG-233 | Tool-priority and memory-governance prompt upgrade | Done | Upgraded runtime/tool templates with dedicated-tool-first execution rules (`read/edit/write/create_event/memory` before bash), parallel-call guidance, and practical memory governance constraints (what to store, what not to store, stale-memory verification) adapted from the Claude-style guidance but aligned to Molibot runtime tools |
| ENG-234 | Prompt mainline reordering and dynamic payload compression | Done | Reordered runtime prompt so execution rules/tooling/skill policy appear before environment noise, compacted the injected skill inventory into a short index, and trimmed current-memory injection into a bounded snapshot so the model sees the stable high-value instructions first |
| ENG-237 | Memory write-time classification and prompt filtering | Done | Added shared memory classification so new memories are auto-tagged on write, flush/import paths reuse the same classifier, and prompt injection now prioritizes collaboration/project/reference memories while isolating lifestyle and temporary records unless the current query actually needs them |
| ENG-238 | General-agent prompt hardening | Done | Filled non-coding prompt gaps by adding task-framing, freshness verification, external-content injection resistance, and broader action-confirmation rules so Molibot behaves more like a reliable general-purpose agent instead of a file-centric coding assistant |
| ENG-242 | Weixin inbound voice/file media fallback hardening | Done | Weixin inbound media intake now no longer drops voice/file/video items when `media.aes_key` is absent or when the SDK payload provides only hex `aeskey`; it falls back to plain CDN download or hex-key normalization so real user voice/file messages reach the agent |
| ENG-243 | Channel-agnostic attachment tool wording | Done | Fixed the runtime attachment tool description so it no longer falsely says files can only be sent to Telegram; this prevents the agent from misreading Weixin/QQ/Feishu as attachment-incapable and refusing image/audio/file replies |
| ENG-246 | System prompt skill-first routing optimization | Done | Merged Task Framing + Capability Use Order + Skill Routing into unified Message Processing Pipeline with CRITICAL markers; skill matching elevated to Step 0; enhanced Tools section with mapping table; deduplicated Skills Protocol from ~60 to ~15 lines; simplified TOOLS.template.md (91→31 lines) and IDENTITY.template.md (34→23 lines) |
| ENG-244 | Weixin outbound CDN upload diagnostics | Done | Expanded Weixin media-upload failures with concrete request context (source file, media type, host/path, key/size summary) so blank 400 responses from the CDN can be diagnosed instead of collapsing into an empty generic error |
| ENG-245 | Explicit skill file injection in shared runner | Done | Shared agent runner now injects the actual `SKILL.md` content for explicitly-invoked skills into the turn input, so all channels use the same hard skill context instead of trusting the model to honor only a skill name/path marker |
| ENG-246 | Image skill output-path hardening and bash output compression | Done | Tightened the shared image-generation skill to require outputs under the active chat workspace instead of `/tmp` or the skill directory, and changed bash output compression to keep both the start and end of long logs while collapsing noisy carriage-return progress spam |
| ENG-247 | Image skill path portability cleanup | Done | Removed machine-specific absolute paths from the shared `image-generate` skill and changed it to require the caller to pass the output path explicitly, so the skill remains reusable across different users and runtimes |
| ENG-248 | Weixin full upload-parameter diagnostics | Done | Added full local diagnostics for Weixin media upload: request body sent to `getuploadurl`, returned upload parameters, exact CDN upload URL/headers, and chunked raw response body, so blank 400 failures can be inspected from logs instead of inferred indirectly |
| ENG-249 | Weixin CDN upload protocol alignment | Done | Corrected Weixin media upload to follow the documented protocol: CDN requests now use `encrypted_query_param` instead of the wrong query key, stop sending the extra file-key header, and read the returned media token from the `x-encrypted-param` response header before falling back to body parsing |
| ENG-250 | Shared text-channel runtime skeleton refactor | Done | Added shared runtime skeleton/helpers under `src/lib/server/channels/shared/`, moved Feishu/QQ/Weixin onto the shared queue/dedupe/stop/prompt-preview/context path, and switched Telegram onto the shared safe skeleton pieces only so channel-specific streaming/interactive behavior stays intact |
| ENG-251 | Weixin outbound delivery audit and retry | Done | Added structured Weixin outbound send attempt/success/failure logs, automatic retry for transient `sendmessage` failures, and per-chat `delivery.jsonl` records so “model finished but user received nothing” cases can be traced without digging through session context files |
| ENG-252 | Prompt layering hardening with project-context discovery | Done | Upgraded prompt assembly with identity-first layering (`SOUL.md`/`IDENTITY.md`), workspace project-context priority discovery (`.hermes.md -> AGENTS.md -> CLAUDE.md -> .cursorrules`) plus injection scan/truncation, short-TTL skills index cache for prompt rendering, and expanded prompt-source observability (`identity_sources` / `project_context_sources`) |
| ENG-240 | Profile template deduplication and noise reduction | Done | Tightened AGENTS/IDENTITY/SOUL/USER/BOOTSTRAP templates so each file owns a single responsibility, removed repeated runtime rules from profile templates, reduced low-value lifestyle/default-init noise, and kept only the long-term collaboration signals that help a general-purpose agent stay stable |
| ENG-241 | Skill/tool-before-coding decision order | Done | Tightened runtime prompt and tool template rules so outcome requests such as voice/image/search/reminder are treated as requests to use existing capabilities first; the agent must try installed skills or dedicated tools before considering code changes, and a missed first attempt no longer justifies jumping straight into implementation |
| ENG-239 | Weixin SDK migration off buggy npm package | Done | Removed the `@pinixai/weixin-bot` dependency entirely, vendored a local Weixin SDK bridge under `src/lib/server/channels/weixin/sdk/`, and rewired runtime/media/outbound paths to use that bridge instead of the buggy old npm package |
| ENG-240 | Weixin command-reply userId fix after SDK migration | Done | Fixed the migrated Weixin command layer to reply using the actual `userId` field on incoming messages instead of the old nonexistent `sender.id`, which was crashing slash-command handling right after startup |
| ENG-222 | Agent tool safety preflight + serialized mutators | Done | Added unified runtime tool-policy checks in `src/lib/server/agent/toolPolicy.ts` and wired `runner.ts` + `tools/index.ts` so destructive bash commands, secret/settings/auth file edits, and reminder-like memory writes are blocked before execution, while mutating tools (`bash`/`edit`/`write`/`switch_model`/`load_mcp`/event/mutating memory ops) are serialized instead of racing in parallel |
| ENG-223 | Model responsibility routing hardening | Done | Tightened `runner.ts` custom-model selection so text turns only choose text-capable models, vision turns only choose vision-capable models, same-provider fallbacks stay capability-aligned, and Agent session/transport are now refreshed per active route/model to better match upgraded `pi-agent-core` provider caching and transport behavior |
| ENG-224 | Agent transport and retry-cap integration | Done | Added shared runtime Agent options in `src/lib/server/agent/runtimeOptions.ts` and wired both `runner.ts` and `assistantService.ts` to use upgraded `pi-agent-core` transport selection plus `maxRetryDelayMs`, so Codex-capable models can opt into automatic transport choice while long hidden provider retry sleeps are capped consistently across chat entry points |
| ENG-227 | Web thinking controls and visible reasoning trace | Done | Web chat now exposes per-send thinking level selection (`off/low/medium/high`), sends that level with requests, and shows request/payload diagnostics plus captured thinking text so operators can verify whether reasoning was requested and actually streamed |
| ENG-228 | Runner delta-stream bridge for Web and Telegram | Done | Runner now forwards assistant `message_update` deltas instead of waiting for final `message_end`, `/api/stream` uses the real runner path for SSE streaming, Web keeps thinking details above the answer in a collapsible panel, and Telegram batches live edits, avoids duplicate fallback sends, and logs effective thinking settings for each run |
| ENG-229 | Telegram session status + per-session thinking override | Done | Telegram now exposes `/status` and `/state` to show active session/runtime/model/thinking state, and `/thinking <default|off|low|medium|high>` to override thinking only for the current session without changing the global default or future new sessions |
| ENG-230 | Shared channel command and session-control layer | Done | Moved public text-channel commands (`/new`, `/clear`, `/sessions`, `/delete_sessions`, `/models`, `/compact`, `/login`, `/logout`, `/skills`, `/status`, `/state`, `/thinking`, `/help`) into `src/lib/server/agent/channelCommands.ts`, so Telegram/Feishu/QQ/Weixin now keep channel-local intake/delivery logic while shared session/model/thinking handling lives in the agent core |
| ENG-268 | Runner budget and structured run summary | Done | Added run-level tool/model budget limits, failure-stop handling, per-chat `run-summaries.jsonl` logging, and a unified closing summary message in `src/lib/server/agent/runner.ts` / `store.ts` |
| ENG-269 | Skill draft management and post-run workflow capture | Done | Added `skill_manage` tool plus automatic reusable workflow draft generation under `skill-drafts/` after complex successful runs, and updated prompt rules so validated workflows can be drafted before becoming live skills |
| ENG-270 | Memory snapshot prompt freezing and richer run reflection | Done | Each run now freezes one memory snapshot before prompt assembly, uses that fixed snapshot for the whole run, and records richer reflection fields in run summaries including memory counts, outcome classification, and next-action guidance |
| ENG-271 | Memory write governance and draft-to-skill promotion | Done | Added explicit memory write rejection rules for reminders, transient run logs, bare links, and todo-style notes; `skill_manage` now supports promoting reviewed drafts into live skills without carrying draft-only metadata |
| ENG-272 | Self-evolution review pages for runs and drafts | Done | Added Settings pages and APIs to inspect recent run history, review saved skill drafts, edit draft content, and promote reviewed drafts into live skills from the UI |
| ENG-273 | Skill draft generation rules and workflow-skill binding | Done | Added configurable auto-save rules on `/settings/skill-drafts`, requiring a standard workflow `SKILL.md` path before auto generation can be enabled and making new drafts follow that workflow's structure |
| ENG-273 | Similar-case draft merge and memory rejection review | Done | Similar workflow drafts and matching live skills now merge instead of creating near-duplicate files, and blocked memory writes are recorded to a governance log with a dedicated Settings review page |


## Update Log
- 2026-04-11: Added automatic similar-case merging for self-evolution artifacts. New workflow drafts now reuse and update a matching draft instead of creating duplicate files, promoted skills can merge into an existing similar skill, and draft review now shows how many cases have been merged into one entry.
- 2026-04-11: Added memory-governance rejection logging under `memory-governance/rejections.jsonl` plus `/settings/memory-rejections`, so blocked memory writes can be reviewed by reason, content, source scope, and action type instead of disappearing as one-off errors.
- 2026-04-11: Added Settings review surfaces for self-evolution data. `/settings/run-history` now shows per-chat run outcomes, follow-up suggestions, tool usage, and saved draft links from `run-summaries.jsonl`; `/settings/skill-drafts` lists saved workflow drafts, allows inline edits, and can promote reviewed drafts into chat/bot/global skills through `/api/settings/skill-drafts`.
- 2026-04-19: Added configurable draft-generation rules on `/settings/skill-drafts`. Automatic draft generation now requires a standard workflow `SKILL.md` path before it can be enabled, uses that workflow as the structure source for new drafts, and enforces the configured minimum tool-call threshold instead of letting recovery cases bypass it.
- 2026-04-11: `src/lib/server/agent/reviewData.ts` now scans bot/chat workspaces for run summaries and skill drafts, while `store.ts` stamps each appended run summary with `createdAt` so operator review pages can sort records by real run time.