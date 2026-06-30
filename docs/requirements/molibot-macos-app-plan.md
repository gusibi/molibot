# Molibot macOS App 实施计划

- 状态：In Progress
- 优先级：P0
- 目标版本：Unsigned Beta
- 目标平台：Apple Silicon，macOS 13+
- 产品名称：Molibot
- Bundle ID：`com.eztoolab.molibot`
- 发布渠道：GitHub Releases
- 需求确认日期：2026-06-27

## 1. 目标

在保留现有 Web、Telegram、Feishu、QQ、Weixin 能力和数据模型的前提下，新增一个可独立安装的 macOS App。App 使用 Tauri 提供原生窗口、菜单栏、通知和生命周期管理，内置 Node 22 sidecar 运行现有 Molibot 服务。

桌面端与 Web 共享后端、Web Profile、session、设置和 `~/.molibot` 数据，但使用完全独立的 Svelte UI，不嵌入或复用现有 Web 页面。视觉以仓库根目录的 `DESIGN.md` 和 `Momo for Mac (standalone).html` 为参考，最终产品统一命名为 Molibot。

首个交付物是 Apple Silicon unsigned beta。工程按将来 Developer ID 签名、公证和安全自动更新的标准组织，但 unsigned beta 不宣称可以绕过 Gatekeeper 直接公开安装。

## 2. 成功标准

首版完成时必须满足：

1. 从 DMG 安装后可以启动 Molibot，不要求用户另外安装 Node。
2. App 启动本地服务，默认只监听 `127.0.0.1`；现有 Web 功能和独立 server 启动方式保持可用。
3. 关闭主窗口后服务与渠道继续运行；只有明确退出时才停止由 App 启动的 sidecar。
4. 桌面 Chat 与 Web 共享 Web Profile 和 session 数据，但桌面 UI、路由和样式完全独立。
5. Desktop Chat 覆盖现有 Web Chat 的核心运行闭环。
6. Telegram、Feishu、QQ、Weixin 会话可在桌面端按渠道和 Bot 实例只读查看，并实时更新。
7. Desktop Settings 覆盖现有全部设置能力，并保持细粒度保存、中英双语、明暗主题和响应式布局。
8. 全新用户可以通过首次启动引导完成模型配置；已有 `~/.molibot` 用户不会被强制重新配置。
9. 所有自动化测试使用临时数据库或可注入 store，不读取或写入真实用户数据。
10. GitHub Release 可以产出可复现的 Apple Silicon unsigned DMG 和校验信息。

## 3. 明确不做

首版不包含：

- Intel 或 Universal Binary。
- Mac App Store 分发。
- 纯 Rust 后端重写。
- 嵌入、套壳或共享现有 Web UI 页面。
- 从桌面端向外部渠道发送回复。
- 外部渠道会话的重命名、删除、归档或清空。
- 跨全部会话的消息全文索引。
- 跨 session 文件中心；右侧文件面板只索引当前本地 session。
- 外部渠道附件进入本地 session 文件面板。
- 自动补拉旧渠道历史、旧头像或过期附件。
- unsigned beta 的静默自动更新。
- 首版凭据加密或 Keychain 迁移。
- 将 Python、ffmpeg、Git 等完整工具链全部塞入安装包。
- 删除 App 时删除 `~/.molibot`。

## 4. 产品形态

### 4.1 窗口

首版只允许：

- 一个 Chat 主窗口。
- 一个 Settings 窗口。

`Command+N` 新建会话，不新建窗口。重复打开 Settings 时聚焦已有窗口。模板中的 Chat 和 Settings 必须落成两个真正的 macOS 窗口；不在应用内容中绘制假菜单栏、假桌面壁纸、假标题栏或假交通灯。

关闭主窗口后：

- Molibot 继续运行。
- Dock 图标保留。
- 菜单栏状态项保留。
- 点击 Dock 图标或菜单栏“打开 Molibot”恢复主窗口。

菜单栏至少提供：

- 打开 Molibot。
- 打开 Web。
- 渠道与 Bot 实例连接状态。
- 重新启动服务。
- 查看日志或打开诊断。
- 退出 Molibot。

### 4.2 服务所有权

- App 启动的 sidecar 由 App 管理，明确退出 Molibot 时停止。
- App 启动前已经存在的兼容 Molibot 服务视为外部服务；退出 App 只断开 UI，不停止该服务。
- 停止外部服务必须是服务管理页中的独立明确操作。
- UI 必须显示当前服务是“由 Molibot 管理”还是“外部服务”。

### 4.3 登录启动

支持“登录时自动启动 Molibot”，默认关闭。启用后登录 macOS 自动启动到菜单栏，不强制弹出主窗口。使用 Tauri/macOS 正式登录项能力，不由业务代码直接写 OS scheduler。

## 5. 运行架构

### 5.1 进程关系

```text
Molibot.app
├── Tauri host
│   ├── Chat window
│   ├── Settings window
│   ├── menu bar / Dock / notifications
│   └── desktop-only capability token
└── bundled Node 22 sidecar
    ├── existing SvelteKit API and Web UI
    ├── shared Agent runtime
    ├── Telegram / Feishu / QQ / Weixin runtimes
    └── ~/.molibot data
```

Tauri 负责原生宿主能力和 sidecar 生命周期；Node sidecar 继续负责现有业务、Agent 和渠道运行时。不得为桌面端复制第二套 Agent 编排、队列、审批、session 或 settings 核心。

### 5.2 本地服务地址

- 默认仅监听 `127.0.0.1`。
- 优先使用现有配置端口，默认 `3000`。
- 端口被非 Molibot 程序占用时自动选择空闲端口，不终止占用者。
- 实际地址写入仅供本机进程发现的运行状态文件。
- Tauri 窗口和“打开 Web”不得硬编码端口。
- 如果端口上已有 Molibot，先做版本和 capability handshake，再决定连接或提示升级。

### 5.3 单实例和数据锁

- 同一用户只允许一个 App 主实例。
- 同一 `~/.molibot` 数据目录只允许一个可写服务实例。
- 已有兼容服务时连接已有服务，不再启动第二份 sidecar。
- 版本不兼容时提示升级外部服务，或让用户明确停止外部服务后启动内置版本。
- 不允许两个服务同时操作相同 SQLite、队列库或运行时目录。

### 5.4 崩溃恢复

- Tauri 监控自己启动的 sidecar。
- sidecar 异常退出后按退避策略自动重启。
- 短时间连续失败达到上限后停止重试，菜单栏进入错误状态并发送通知。
- 提供“重新启动服务”“查看日志”“打开诊断”。
- 用户主动退出不触发自动重启。
- 恢复必须复用共享队列、事件 lease、session 和幂等机制，不得复制入站任务。

## 6. 代码边界

建议目录：

```text
apps/desktop/
├── src/                 # 独立 Svelte 5 Desktop UI
├── src-tauri/           # Tauri Rust host
├── vite.config.*
└── package.json
```

根目录现有 SvelteKit 继续承载 Web UI、API 和 Node 服务。桌面端只共享：

- API contract 与数据类型。
- i18n 基础设施中真正通用的部分。
- 与页面无关的设计 token。
- 共享运行时事件 schema。

桌面端不得导入现有 Web 页面、Web 页面 CSS 或把 `/settings` 嵌入 WebView。跨目录共享必须提供正式 alias 或 package 入口，不使用超长相对路径。

## 7. Desktop Chat

### 7.1 本地会话

桌面端的“本地”继续使用现有 `channel=web` 会话模型：

- 与 Web 共享 Web Profile、session、消息、附件、标题和运行状态。
- 不新增 `desktop` channel。
- 一次只激活一个 Web Profile。
- 侧栏仅显示当前 Profile 的本地会话。
- 切换 Profile 时恢复各自最后打开的会话。

Desktop Chat 必须覆盖：

- Web Profile 与 session 管理。
- 新建、选择、重命名和删除本地会话。
- 流式回答。
- thinking 展开与收起。
- 模型与 thinking level 选择。
- Markdown、代码块、附件和运行进度展示。
- 文件上传。
- 语音录制与发送。
- 停止、steer、follow-up 和队列状态。
- Host Bash 审批。
- 当前 session 文件面板、搜索、类型筛选、预览、导出和 Finder 定位。

### 7.2 外部渠道会话

Telegram、Feishu、QQ、Weixin 在桌面端只读展示：

- 按渠道分组。
- 单实例时直接显示会话。
- 多实例时自动增加“渠道 → Bot 实例 → 会话”层级。
- 显示来源渠道、Bot 实例、发送者、会话标题和线程/Topic 信息。
- 支持查看、搜索当前 transcript、复制和打开原平台。
- 不提供输入框。
- 不允许重命名、删除、归档或清空。

现有 session schema 需要向后兼容地增加可选元数据：

- Bot 实例标识与显示名。
- sender ID、显示名和头像引用。
- 群聊、私聊、频道、线程或 Topic 标识与显示标题。
- 消息来源平台元数据。
- 外部附件元数据。

元数据定义和持久化必须放在共享 session/运行时层；Channel 只负责原始平台字段到统一结构的转换。旧记录缺失元数据时使用稳定 fallback，不回头批量请求平台补全。

### 7.3 实时事件

外部渠道收到消息、Agent 回复、连接状态变化或会话摘要变化时，桌面端必须实时更新：

- 侧栏最后消息与时间。
- 未读状态。
- 当前打开 transcript。
- Bot 实例连接状态。
- 待审批状态。

共享运行时应发布统一事件，桌面端订阅事件流。不得在每个 Channel 中分别实现“通知桌面”，也不得依靠高频轮询 SQLite。

### 7.4 搜索

首版只做：

- 侧栏按会话标题、渠道和 Bot 实例筛选。
- 当前 transcript 内搜索，并支持上一个/下一个匹配。

不做跨全部会话的全文索引。

### 7.5 文件与附件

- 右侧文件面板只索引当前本地 session。
- 外部渠道附件在原消息位置展示。
- 外部附件不进入本地 session 文件面板。
- 本地已有安全缓存时可 Quick Look；否则打开原平台。
- 不扫描用户整个磁盘。

## 8. Desktop Settings

Settings 首版必须保留现有全部设置能力，包括 AI Provider、模型路由、Agent、Web Profile、Skills、MCP、Telegram、Feishu、QQ、Weixin、沙箱、Host Bash、任务、内存、插件、搜索、图像、视频、语音、Trace、用量和运行历史等。

要求：

- 使用独立 Desktop UI，不嵌入现有 `/settings`。
- 复用现有细粒度 API、校验和存储路径。
- 不用一个大 settings 对象覆盖其他动态配置。
- 保存按钮使用固定底栏。
- 采用共享语义 CSS、设计 token 和 `shadcn-svelte`/既有组件能力。
- 支持中文和英文即时切换。
- 支持 Light、Dark、System，默认跟随系统。
- 支持窗口缩放和小尺寸布局。
- Svelte 交互状态使用显式响应式状态，不把依赖藏在模板调用的无参数 helper 中。

## 9. 首次启动引导

### 9.1 分流

- 全新安装：完整引导。
- 已存在可用 Provider/模型：显示一次迁移和健康检查摘要，然后进入 Chat。
- 配置存在但不可用：进入精简修复引导，不覆盖原数据。
- 渠道连接失败不阻止进入，只在摘要中明确标记。

### 9.2 完整引导

至少覆盖：

1. 选择、配置并验证 AI Provider、模型和凭据。
2. 创建或确认默认 Agent / Web Profile。
3. 可选连接渠道。
4. 选择是否登录时启动，默认关闭。
5. 展示运行环境诊断。

没有可用模型时不得假装配置完成，但允许进入 Settings 排障。

## 10. 依赖管理

安装包只强制内置 Node 22 sidecar。其他依赖按需检测和安装。

“运行环境”页必须显示：

- 依赖名称和用途。
- 当前状态和版本。
- 安装来源。
- 预计体积。
- 安装前将执行的准确命令。
- 实时日志、取消、失败重试和安装后复检。

安装规则：

- 用户逐项明确授权，禁止静默安装。
- 已有 Homebrew 时可用于 ffmpeg、Git 等系统二进制。
- 不自动安装 Homebrew，不代填管理员密码。
- Python 包、Node CLI 和 Skill 专用依赖优先安装到 `~/.molibot/tooling`。
- 禁止 `sudo pip`、全局 `npm -g` 和修改系统 Python。
- Skill 只能声明依赖并跳转到统一安装页，不能绕过安装器。
- 安装事实记录为不会回灌模型上下文的结构化运行事件。
- App 从 Finder 启动时恢复常见用户 PATH，包括 Homebrew 路径；不得无差别导入用户 shell 中的所有 secrets。

## 11. 安全与隐私

### 11.1 Desktop capability token

现有本机 Web 继续按当前方式访问。以下桌面专用高权限能力必须使用 App 每次启动生成的临时 token：

- 跨渠道会话聚合。
- sidecar 与服务控制。
- 依赖安装。
- 外部渠道统一审批。
- 桌面诊断和退出控制。

token 只注入 Tauri 窗口，不写 URL、日志或持久化设置。普通本机浏览器不能调用这些能力。

### 11.2 凭据

unsigned beta 暂不迁移 Keychain：

- 继续兼容 `~/.molibot` 中现有 SQLite / `.env` 存储。
- 检查并修正敏感数据文件为仅当前用户可读写。
- UI、日志、诊断导出和 API 默认掩码，不回显完整 Secret。
- Keychain/统一 credential store 是正式签名公开版的阻断项。

### 11.3 诊断与遥测

- 默认不上传遥测。
- 本地保存轮转日志和崩溃摘要。
- 用户主动导出诊断包。
- 导出前列明内容并自动脱敏。
- 后续引入远程崩溃平台必须单独 opt-in。

## 12. 统一审批中心

桌面 App 可处理本地和外部渠道产生的 Host Bash / 高风险操作审批，但这不改变外部 transcript 的只读属性。

审批 UI 必须显示：

- 来源渠道、Bot 和会话。
- 命令、工作目录和风险说明。
- 仅本次允许、按现有规则长期允许、拒绝。

审批结果必须通过共享 runtime 恢复原任务，不把临时控制指令持久化为普通 session 消息。持久化结构化审批事件，并由原渠道发送面向用户的状态说明。

## 13. 通知

默认只通知需要用户处理的事件：

- 本地任务完成。
- Host Bash / 高风险操作等待审批。
- 渠道断线且自动重连失败。
- 定时任务失败。

外部渠道普通消息默认不产生重复系统通知；设置中允许按渠道开启。

## 14. 视觉与可访问性

- 优先使用 macOS 原生透明、模糊和 vibrancy 材质。
- CSS token 负责内容层，不在窗口内部绘制假壁纸。
- macOS 13–15 使用兼容材质降级。
- macOS 26 使用可用的更接近 Liquid Glass 的系统效果。
- 开启“减少透明度”时使用实色表面。
- 尊重 `prefers-reduced-motion`。
- 状态不得只靠颜色表达。
- Light、Dark、System 均需保持对比度和可读性。
- App 图标基于现有巴哥犬品牌重新设计，聚焦头部和小尺寸辨识度；同时产出菜单栏单色 template icon。

## 15. 数据迁移与保留

- App 沿用 `~/.molibot`。
- 删除 App 不删除 `~/.molibot`，保证用户仍可用 server 方式启动。
- Settings 分离提供“导出数据”“重置应用”“删除全部本地数据”；任何删除必须二次确认。
- schema 或数据格式迁移前自动备份受影响的 SQLite、session index 和结构化文件。
- 迁移必须原子化；失败时停止服务并提供恢复，不带着半迁移数据继续运行。
- 自动保留最近 3 份迁移备份。
- 不复制大型附件，只备份索引和元数据。

## 16. 更新与发布

### 16.1 Unsigned Beta

- 使用 GitHub Releases 发布 Apple Silicon DMG。
- 同时发布 checksum、版本号、Git commit 和构建环境信息。
- App 提供“检查更新”，发现新版本后展示 release notes 并打开下载页。
- unsigned beta 不自动替换 App。

### 16.2 正式公开版前置条件

- Apple Developer Program。
- Developer ID Application 签名。
- Apple notarization。
- 签名更新包和 Tauri updater 验证。
- Keychain/credential store 方案落地。

Molibot 的本地服务、Host Bash、技能工具和文件访问不按 Mac App Store 沙箱设计。

## 17. 分阶段实施

### Phase 1：Tauri 壳与服务生命周期

范围：

- `apps/desktop` 工程骨架。
- Chat / Settings 双窗口与单实例。
- Node sidecar 打包、启动、健康检查和停止。
- 服务所有权、数据锁、版本握手和端口回退。
- Dock、菜单栏、关闭窗口继续运行、明确退出。
- 登录启动开关。
- sidecar 崩溃重启和诊断入口。

验收：

- 安装后无需系统 Node 即可启动。
- 关闭窗口后渠道服务不断线。
- App 管理和外部服务两种模式退出行为正确。
- 现有 Web build、启动和核心页面无回归。

### Phase 2：Desktop Chat 本地闭环

范围：

- 独立 Chat UI。
- Web Profile / session 共享。
- 流式消息、thinking、模型选择、工具进度。
- 停止、steer、follow-up、队列与审批。
- 上传、语音和当前 session 文件面板。

验收：

- 同一会话可在 Web 与 Desktop 之间继续。
- Desktop UI 不导入现有 Web 页面或页面 CSS。
- Web Chat 功能不回归。

### Phase 3：外部渠道只读聚合

范围：

- 共享会话/消息元数据扩展。
- 按渠道和 Bot 实例聚合。
- 实时会话事件流。
- 外部 transcript、附件和当前对话搜索。
- 统一审批中心和通知。

验收：

- 四个渠道的新消息与 Agent 回复实时出现。
- 多 Bot 实例不会混淆。
- 外部渠道无输入框和写操作。
- 元数据和实时事件逻辑位于共享上层，不下沉为 Channel 桌面逻辑。

### Phase 4：Settings、引导与依赖管理

范围：

- 完整 Desktop Settings。
- 新装、已有配置和损坏配置三类引导分流。
- Provider 验证、默认 Agent/Profile。
- 运行环境诊断和授权安装器。
- 中英、主题、响应式和固定保存底栏。

验收：

- 所有现有设置能力均可操作。
- 保存只修改对应实体或动态 key。
- 缺少可选依赖不阻止基础聊天启动。
- 安装依赖前有明确授权，安装日志不进入模型上下文。

### Phase 5：产品化与发布

范围：

- 原生材质、减少透明度、辅助功能和动效降级。
- App icon、菜单栏 icon 和 DMG 视觉。
- 本地日志、脱敏诊断导出和迁移备份。
- GitHub Actions / Release 构建。
- unsigned beta 实机回归。

验收：

- Apple Silicon、macOS 13+ 实机通过。
- DMG 可安装并完成完整首次启动。
- GitHub Release 产物可复现并带校验信息。
- 包体目标以实测为准，DMG 以不超过约 100 MB 为优化目标而非虚假承诺。

## 18. 测试策略

### 自动化

- Tauri Rust 单元测试：服务发现、端口选择、进程所有权、退出和重启策略。
- Node 测试：版本握手、desktop token、聚合 API、事件流、session 元数据和迁移。
- Svelte 测试：窗口状态、会话切换、Profile 切换、只读边界和 Settings 表单。
- 集成测试：使用临时 `DATA_DIR`、临时 SQLite 和 mock channel runtime。
- 构建 smoke：验证 `.app` 中资源路径不依赖源码目录或 `process.cwd()`。
- Web 回归：现有 SvelteKit build 和关键 API 测试继续通过。

### 真实环境 smoke test

- 只在用户明确触发时使用现有真实渠道配置。
- 测试前显示将连接的 Bot 实例和可能产生的消息。
- 默认只做只读状态检查。
- 发送测试消息前再次确认。
- 涉及迁移时先备份结构化数据。

## 19. 主要风险

### Node sidecar 包体与资源定位

现有服务包含动态依赖、内置模板和运行时资源。构建不能假设源码目录或仓库 cwd 存在。需要逐项审计 `process.cwd()`、源码文件读取、动态 import 和 vendored package 入口。

### Web 与 Desktop 双 UI 漂移

两个 UI 不共享页面，但共享 API contract。必须用稳定 contract 和行为测试控制漂移，不能复制业务校验到两个前端各自维护。

### 跨渠道历史元数据不足

旧 session 缺少发送者和线程元数据。首版只保证新消息完整，旧数据使用 fallback，不承诺无损回填。

### unsigned 分发限制

没有 Developer ID 时 Gatekeeper 体验不符合真正公开发布标准。unsigned beta 只能作为阶段性交付，正式公开版必须完成签名和公证。

### 外部工具环境

Finder 启动的 PATH 与终端不同。基础功能不得依赖可选工具；环境恢复、诊断和安装必须可观测且需要用户授权。

## 20. 文档维护

- 本文件维护计划、阶段、技术边界和验收口径。
- `prd.md` 只保留产品优先级、摘要和本文件入口。
- 完成功能和细粒度实施记录写入 `features.md`。
- 对外高层发布摘要写入 `CHANGELOG.md`。
- 使用入口、安装方式和文档导航变化写入 `README.md`。
