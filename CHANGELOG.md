# Molibot ChangeLog

## Version 1.0

---

## 2026-05-20

### Telegram group mention trigger
- **启动时先拿 bot username**: Telegram 运行时现在先通过 `getMe()` 初始化 bot username，再开始 polling，避免运行期间 username 为空导致直接 `@bot` 被误判为未提及。
- **直接 @ 可触发**: Telegram 群聊和超群现在会同时识别 message entities 与纯文本 `@username`，避免直接 `@bot` 的消息已经入站却被当成未提及 bot 丢弃。
- **回复路径保持不变**: 回复 bot 消息仍然继续放行，只是 direct mention 的入口补齐到同等可靠。

## 2026-05-19

### Approved host tool shell parity
- **已批准命令回到 shell 语义**: reusable approved host tool 命中后现在执行原始命令字符串，不再把命令拆成 `command + argv` 直接 `spawn`。
- **环境变量展开一致**: `curl -H "Authorization: Bearer $WEREAD_API_KEY"` 这类命令会按普通 shell 规则展开环境变量，避免把 `$WEREAD_API_KEY` 字面量发给远端服务。
- **sandbox 分支保持清晰**: 未命中 approved host tool 时仍按设置走 sandbox；未开启 sandbox 时继续走普通 bash/shell。

### Sandbox env precedence and missing-key audit
- **env 文件优先，系统变量兜底**: sandbox allowlist 变量现在同时从宿主进程环境变量和 `.env.sandbox.local` 解析，同名 key 仍以 `.env.sandbox.local` 为准。
- **启动期缺失告警**: runtime 启动时会检查 sandbox allowlist 中声明但两处都未提供的变量，并把缺失 key 名打印到日志，方便尽早发现配置漏项。
- **诊断面补齐**: `/settings/sandbox` 与诊断 API 现在会额外返回缺失的 allowlist key，只显示变量名，不暴露值。

### WeRead skill env/error discipline
- **先验环境再下结论**: 全局 WeRead skill 现在必须先执行 `printenv WEREAD_API_KEY`，只有检查为空时才允许提示用户重新 `export WEREAD_API_KEY=...`。
- **失败必须回显真实调用**: WeRead 请求失败时，skill 现在必须带上实际 `api_name` 和最终请求体上下文，不再只给笼统的“环境变量缺失”判断。
- **服务端业务错不再误判成本地缺 env**: 对 `用户不存在`、鉴权失败、`errcode != 0` 这类 WeRead 服务端返回，skill 现在默认视为真实业务/鉴权错误，而不是自动归因到 sandbox 注入失败。

### Host approval waiting-state semantics
- **等待不再伪装成停止**: sandbox host approval 挂起当前轮次时，runner 现在返回专门的 `waiting_for_approval` 状态，不再复用通用 `aborted`。
- **Telegram 不再误报已停止**: Telegram 运行时不再把这条路径当成手动停止处理，因此不会在审批尚未发生时额外发送误导性的 `Stopped.` 收尾消息。
- **等待提示不写回会话**: Telegram 不再把“Waiting for your decision”这类临时等待提示持久化成正常 assistant 会话内容，避免审批后续跑时带着伪最终答案污染上下文。

## 2026-05-16

### Layered skills command output
- **默认先看索引**: `/skills` 现在只返回已加载技能的名字和路径，不再默认把 description、aliases 等完整元数据全部刷出来。
- **摘要改成表格**: `/skills` 的默认索引视图现在使用和 `/models` 一样的 Markdown 表格输出，按 `编号 / 名称 / 路径` 展示，扫读更稳定。
- **按需下钻详情**: 新增 `/skills <id>` 单项详情查看，按技能名或 alias 命中后返回 scope、description、aliases、MCP servers、file/base dir 等完整信息。
- **保留完整清单入口**: 新增 `/skills-detail`，用于查看所有已加载技能的完整详情列表；共享聊天命令和 Web chat 的本地命令处理已经统一到同一套输出规则。

### Archived run details and success-path chat cleanup
- **成功后不再挂着大段运行详情**: 成功执行后，Telegram 会把原 `运行详情` 消息收尾替换成一条简短归档提示；QQ / Weixin / Feishu 会补发同样的归档提示，而不是把成功路径的长执行记录一直留在聊天流里。
- **完整记录转为按 run 归档**: runner 现在会把结构化执行明细按 run 写入每个 chat 工作区的 `run-details/*.jsonl`，保留工具开始/结束、重要说明和最终状态，便于之后追查“前几次失败、最后一次成功”的整条执行轨迹。
- **按需查看入口**: 共享命令层新增 `/runlog latest` 与 `/runlog <runId>`，会优先把归档执行记录作为 `.txt` 文件返回到支持文件发送的聊天渠道，避免再次把超长日志刷进会话；Web 现有诊断视图保持不变。
- **Telegram 结果默认引用原消息**: Telegram 最终答案首发和必要时单独发送的成功归档提示，现在都会默认引用用户原始提问消息，便于在聊天流里快速看出“这条结果是回复哪一句”的对应关系。

### Weixin / QQ host approval text fallback
- **无按钮渠道改明示指令**: 微信和 QQ 在收到 host tool approval 时，不再提示用户去点不存在的按钮；现在会发送共享的纯文本降级说明，明确告诉操作者可以直接回复 `批准` / `安装` / `approve` 或 `拒绝` / `reject`。
- **多待审批也可拒绝**: 共享命令层补上 `/hosttools reject <approvalId>`，让无按钮渠道在存在多条 pending approval 时也能像 approve 一样按 id 精确拒绝。
- **共享层收口**: 非交互渠道的 host approval 提示文案现在由共享 formatter 统一生成，QQ/Weixin 只负责消费运行时事件，不再各自复写一套审批说明。

### Single vs one-time host approval
- **两层审批模型**: host approval 现在明确区分“单命令持久授权”和“多命令一次性授权”。像 `mv` / `pip` / `mkdir` 这类单 executable 命令，审批一次后会继续进入 `approvedTools` 复用；带换行、`&&`、管道或其他复合 shell 语法的安装脚本，则只会生成一条精确的一次性 host action 审批。
- **不再伪装成单命令**: 多步骤 shell 流程不再被错误塞进 `mkdir` 之类的持久 host tool 记录里执行，避免“批准的是 mkdir，实际执行的是整段安装脚本”这种语义错位。
- **待审批列表收紧**: 已批准/已拒绝请求现在会从 `pendingApprovals` 挪到独立 history；`pendingApprovals` 只保留真正还在等待操作员处理的请求。

## 2026-05-15

### DESIGN.md 页面改动治理
- **AGENTS 规则补充**: 新增长期协作规则，凡是页面、界面、交互样式等前端展示改动，都必须先遵循 `DESIGN.md`，但不把具体设计细节重复搬进 `AGENTS.md`。
- **文档分工对齐**: `README.md` 与 `prd.md` 现在都把 `DESIGN.md` 标记为页面设计事实来源，避免后续 UI 改动时只看协作规则、不看设计规范。
- **流程约束落地**: `README.md` 的 Documentation Workflow 新增一步，要求页面/UI 改动先校对 `DESIGN.md` 再动代码或样式。

### shadcn-first 页面组件原则
- **组件优先级明确**: 新增长期规则，页面/UI 改动默认优先使用 `shadcn-svelte` 和 `src/lib/components/ui`，除非现有组件体系确实无法实现需求，否则不要回退到非 shadcn 组件。
- **流程同步**: `README.md` 的文档流程与 `prd.md` 的文档结构说明已同步这条原则，后续前端改动会按同一口径执行。

### Settings 首屏框架统一
- **共享壳层收口**: `src/routes/settings/+layout.svelte` 现在统一了暖色设置工作台外壳、左侧导航层级、顶部工具条和移动端导航折叠样式。
- **首屏层级统一**: `src/styles/workbench.css` 新增一套针对 settings 的共享画布、hero、卡片和按钮规则，让各设置页进入后的第一屏先具备一致的宽度节奏、视觉层级和主操作气质，而不需要先重写各页业务逻辑。
- **范围控制**: 这次主要统一框架与首屏，不重写各页面深层表单和保存流；后续如果继续打磨，会按页面逐个清理内部结构。

### Settings 视觉收敛回调
- **页头收紧**: 普通 settings 页面 header 不再被强行包装成大面积 hero，大标题区改回更紧凑的进入节奏，避免首屏空耗高度。
- **卡片边框降噪**: 共享 settings card 边框整体降对比，尤其暗色模式不再出现发白、发硬的简陋描边。
- **Providers 页面补齐**: `/settings/ai/providers` 旧的自定义 `div + header + action` 首屏结构也已改成紧凑 header，避免它继续保留一块明显更大的页头。
- **Card 基础组件去硬描边**: 共享 `Card` 组件默认不再使用 `ring-foreground/10 ring-1`，改成更柔和的边框和轻阴影，避免卡片出现生硬的黑边或亮边。
- **Tasks 页面防溢出**: `/settings/tasks` 现在会对长路径、长 id、错误文本和状态说明自动换行，并把表格列宽和操作按钮收进固定节奏里，不再被长文本顶出页面。

## 2026-05-13

### Concise sandbox labels and Weixin tool batches
- **展示文案收短**: 所有用户可见的 sandboxed bash 工具展示统一改为 `Sandbox`，初始化失败软降级时显示 `Sandbox disabled`，不再使用冗长的 `bash (sandbox)` / `bash (sandbox disabled)`。
- **微信批量工具进度可读性**: Weixin channel 现在会先聚合原始工具进度，再一次性格式化成多行列表发送，避免 5 次工具调用挤成一行。
- **回归覆盖**: 新增 Weixin runtime tests 覆盖多行工具进度格式化与批量发送行为，并同步更新 sandbox 展示名测试。

### Bash-routed host approval
- **入口收敛**: 移除单独的 `hostToolApproval` agent 工具，把 host capability 审批申请收回到 `bash` 入口。
- **审批保持不变**: `bash.hostApproval` 继续写入同一套 pending/approved host tool registry，聊天里的 `安装` / `批准` / `approve` 确认流程保持不变。
- **执行面内收**: `hostToolRun` 也已移除；审批通过后由运行时直接执行保存下来的受控 host action，不暴露第二个 agent 工具，也不会退化成 host shell。
- **结构化审批**: host approval 现在会产出结构化审批 payload，包含标题、正文、选项和请求元数据，供 API/Web/Telegram/Feishu 渲染原生按钮或卡片。
- **自动续跑**: 审批通过后会立刻执行挂起的 host action，不再停在“已批准、等待继续”这一步。
- **白名单直达**: `bash` 现在会先检查已批准 host capability 白名单；命中后直接执行内部 host action，不再先走 sandbox 再失败一次。
- **失败自动提审**: 对可解析成单个 executable + argv 的命令，sandbox 权限失败会直接创建结构化审批请求，而不是等模型再显式补发一次 `bash.hostApproval`。

### Interactive manager TTY disconnect guard
- **交互兜底**: `molibot manage` 现在会把 `readline` 上来自 TTY 断开的 `EIO` 读错误当成正常关闭处理，不再抛出未处理的 `Interface` error。
- **等待态收尾**: 菜单选择和“Press Enter to continue”这类挂起中的 prompt 会在接口关闭时自行结束，避免卡死在未完成的 `rl.question()`。
- **运维体验**: 关闭终端、断开附着会话，或其他导致 stdin 消失的场景下，管理器会安静退出而不是打印 Node 崩溃堆栈。

---

## 2026-05-14

### Host approval rejection acknowledgement
- **拒绝可见回执**: Telegram 和 Feishu 的 host approval 拒绝动作现在会额外发送一条普通文本回复，明确告知该审批已被拒绝，不再只依赖卡片/原消息状态变化。
- **审批阻塞当前轮次**: sandbox 权限失败自动触发 host approval 时，runner 现在会立刻中止本轮并停在“等待审批”状态，不再把“已发起审批”当成成功工具结果继续生成后续答案。

### Cross-channel subagent execution notices
- **统一事件层**: 共享 `subagent` 工具现在会发出 `subagent_execution` 运行事件，覆盖 run start/end 与 task start/end，不再只写 pretty log。
- **共享展示链路**: parent runner 会把这些事件转成与工具调用同级的 transient progress 提示，保持 delegation 能力在共享上层实现，而不是在各 Channel 里各写一套 subagent 逻辑。
- **各端可见性**: Telegram 直播进度块原生显示 Sub Agent 生命周期；Web SSE 把这些事件流式送到聊天诊断面板；Feishu/Weixin/QQ 通过共享文本运行时自动收到“Sub Agent started / task started / task finished / finished”提示。
- **失败隔离与收口**: subagent UI 事件现在走 runner 的 best-effort UI 队列，前端/通道 sink 抛错不再中断实际 delegation；同时 delegated run 失败时会补发终态 `end` 事件，避免跨端进度面板停在 started 状态。

---

## 2026-05-12

### Chat-first host tool approval
- **bash 入口路由**: host tool 审批申请现在由 `bash` 入口承接；模型在 sandbox 权限失败后通过 `bash.hostApproval` 创建 pending approval，不再暴露单独的 `hostToolApproval` agent 工具。
- **聊天确认**: Telegram/Feishu/QQ/Weixin 的共享命令层会拦截同一会话里的 `安装` / `批准` / `approve`，把对应 pending request 写入 approved host tool registry。
- **受控执行**: 审批后只能执行登记时固定的 command，并通过结构化 argv 传参；不使用 shell。
- **沙箱边界**: `bash` 不会自动升级成 host；已批准项是受控 host capability，不是通用 host shell。
- **提示词约束**: 系统提示词要求模型遇到 host-only 工具时通过 `bash.hostApproval` 申请审批，而不是继续用 sandbox bash 绕行。

---

### Manual `/compact` force behavior
- **Keep-window false negative fixed**: Manual `/compact` can now summarize older context even when `keepRecentTokens` is configured larger than the current session context.
- **Auto behavior preserved**: Threshold/overflow compaction still respects the configured keep-recent window; only explicit manual compaction gets force semantics.
- **Root cause clarified**: The previous runner/store sync fix worked for stale runner memory, but this case was caused by the keep-recent setting making the summarizable slice empty.

---

## 2026-05-11

### Manual `/compact` session-state sync
- **Idle runner reload**: Manual `/compact` now reloads the latest persisted session into the idle runner before summarizing.
- **False negative removed**: Fixes cases where `/status` reported a large live context but `/compact` incorrectly returned `Nothing to compact yet.` because runner memory was older than the session log.

### Telegram live-control 命令修复
- **命令入口补齐**: Telegram 现在会把 `/steer`、`/followup`、`/follow_up` 和 `/queue` 先交给共享命令处理器，而不是在忙碌时当成普通消息入队。
- **队列注入恢复**: `/steer <queueId>` 会按已有队列 ID 注入当前任务，不再出现 `/steer 352` 被重新排成 `#353` 的问题。
- **回归覆盖**: 新增 Telegram 命令注册测试，并继续覆盖共享 `/steer <queueId>` 提升逻辑。

---

## 2026-05-10

### Agent Bash OS Sandbox
- **默认关闭**: 新增 `toolSandbox` runtime settings，第一版只覆盖主 Agent `bash` 和内置 subagent `bash`，初始化失败默认软降级并告警。
- **环境变量 allowlist 注入**: Molibot 宿主解析 workspace `.env.sandbox.local`，只把 allowlisted key 注入 sandbox 子进程；诊断与 UI 只显示 key，不暴露 value。
- **边界清晰**: Browser、Computer Use、ACP、MCP、Channel 收发消息不进入该 sandbox；sandbox 开启时会阻断 `open`、`osascript`、直接启动浏览器等明显绕行命令。
- **设置与诊断**: 新增 `/settings/sandbox` 和只读诊断 API，可检查平台、依赖、env 文件、可注入 key、初始化状态、网络和文件系统策略。
- **输出标记**: sandbox 路径生效时，Web/Telegram/tool thread 展示为 `bash (sandbox)`；初始化失败软降级时展示为 `bash (sandbox disabled)`。
- **回归覆盖**: 新增 settings sanitization、env 注入、env 文件 denyRead/denyWrite、host app bypass、sandbox 关闭旧行为保持等 focused tests。

### Scratch 生成物日期归档
- **默认日期目录**: 每轮模型输入新增 transient `scratch_artifact_dir`，普通会话生成物默认进入 `scratch/YYYY/MM/DD/`，不再继续堆在 chat scratch 根目录。
- **工具层兜底**: `write` 工具会把普通文件名自动路由到当天目录；`bash` 暴露 `$MOLIBOT_SCRATCH_ARTIFACT_DIR`，并在命令结束后把新生成在 scratch 根目录的普通产物搬进当天目录。
- **运行时目录不动**: `scratch` 仍是工具 cwd，`scratch/events` 等 watched event/control 路径保持原语义，显式路径不会被日期规则改写。
- **附件兼容**: 如果模型随后仍按旧根路径 attach，`attach` 会查找当天目录里的同名文件，避免 bash 自动归档后发送失败。
- **回归覆盖**: 新增测试覆盖 transient env 字段、`write` basename 路由、显式 `events/...` 路径保持不变、bash artifact env 变量、bash 根目录产物归档，以及 attach 兼容查找。

---

## 2026-05-06

### Skill Draft metadata 规范化
- **skill-creator 规则落地**: 自动 Skill Draft 生成现在会在配置的 workflow `SKILL.md` 使用 skill-creator 规则时，按“功能标识符 + 触发描述”生成 frontmatter metadata，不再把用户原话直接写成 `name`。
- **专用子代理生成**: 新增内置 `skill-drafter` subagent；自动保存草稿前会优先用隔离子代理生成 metadata，失败时回退到本地规范化逻辑。
- **重试类消息兜底**: “重试一下 / 再试一次”这类泛化消息不会成为草稿名；系统会优先从最终结果和工具路径推断可复用功能名。
- **回归覆盖**: 新增自演化测试覆盖昨日数据回顾命名和重试消息命名，保证草稿 `name` 保持可用。

### Settings shadcn-svelte 迁移基线
- **组件体系切换起点**: 新增 shadcn-svelte `components.json`，并生成 Settings 后续会复用的 Button、Card、Alert、Badge、Input、NativeSelect、Separator、Table、Tabs 等源码组件。
- **系统配置页样板**: `/settings/system` 已从旧本地 UI wrapper 和 workbench 页面样式迁移到 shadcn 风格的语义组件组合，作为后续 Settings 页面迁移模板。
- **Web Profiles 表单样板**: `/settings/web` 已迁移为 shadcn 风格的 profile 列表 + 配置表单，覆盖 Switch、NativeSelect、Textarea、Skeleton loading 和 Alert feedback 等更常见的管理页控件。
- **Providers/Tasks 补齐**: `/settings/ai/providers` 的 provider/model 表单、状态反馈和模型发现控件已切到 shadcn-svelte 组件；`/settings/tasks` 行选择框改用共享 Checkbox；旧 providers-page 全局样式钩子已移除。
- **Skill Drafts 扫读优化**: `/settings/skill-drafts` 的长草稿内容默认只显示前 10 行，完整内容通过弹窗表单编辑并保存。
- **聊天页不变**: 本轮只迁移 Settings 基础组件、系统配置页和 Web Profiles 页，主聊天页未改动。

---

## 2026-05-04

### Telegram typing 超时非阻塞化
- **非关键动作降级**: `setTyping` 中 `sendChatAction(typing)` 在超时重试耗尽后改为仅记录 `ctx_set_typing_failed_non_blocking` 告警日志，不再抛错中断整轮运行。
- **运行连续性修复**: typing 指示与最终消息发送解耦；即使 typing API 失败，本轮最终正文或错误提示仍可继续发送给用户。

### Weixin 工具进度发送修复
- **纯文本进度**: Weixin 工具进度批次不再发送 `_→ ..._` Markdown 样式，改为微信更稳的 `工具调用：...` 纯文本格式。
- **停止坏消息重试**: 已经进入 outbox 的旧工具进度批次会在重试时自动改写；如果微信仍返回 `code=-2`，这类非关键进度消息会被丢弃，不再无限重试。

### AI Providers 模型拉取体验
- **批量拉取入口**: `/settings/ai/providers` 的 Custom Provider 新增“开始”按钮，可直接请求远端 provider 的 `/models` 列表。
- **逐条确认加入**: 拉取结果列表在每个模型右侧提供 `+` 按钮，点击后将该模型加入当前 provider 的 Attached Models，避免手动逐条输入模型 ID。
- **新接口**: 新增 `/api/settings/provider-models`，按 provider 协议（OpenAI-compatible / Anthropic）自动拼装模型列表请求并返回去重排序后的模型 ID。
- **保存去重兜底**: 修复 `/api/settings` 在同一 provider 出现重复模型 ID 时触发 SQLite 唯一键冲突的问题；保存时会忽略空模型 ID 和重复 model_id，避免 500。

---

## 2026-05-02

### Weixin 图片消息修复
- **原生图片发送**: Weixin 本地图片附件现在复用 `package/weixin-agent-sdk` 的媒体上传与 `IMAGE` 消息协议，避免维护两套图片 payload 实现。
- **图片链接转发**: 当 Weixin 回复内容是单个图片 URL 或 Markdown 图片引用时，channel 会下载图片并转发为原生图片消息，不再只把链接作为文本发给用户。
- **Weixin 进度压缩**: Weixin channel 现在首条工具进度单独发送，后续工具进度每 5 条合并发送；成功运行不发送中间错误，整轮没有正常答案时才发送最后一条错误说明。
- **QQ 进度压缩**: QQ channel 现在使用同样的 channel-local 压缩策略，首条工具进度单独发送，后续工具进度每 5 条合并发送；中间错误仍只保留最后一条兜底发送。
- **回归覆盖**: 新增 Weixin outbound 测试，覆盖本地图片文件发送和 Markdown 图片链接转图片消息。

---

## 2026-05-01

### Subagent 路由与可见性
- **Subagent 模型级别路由**: `/settings/ai/routing` 新增 subagent fallback route，并支持把 `haiku` / `sonnet` / `opus` / `thinking` 四个抽象级别映射到任意已配置文本模型；内置 scout/planner/worker/reviewer 不再展示未配置的具体 Claude 型号作为默认模型。
- **设置持久化修复**: 修复 runtime settings 更新路径丢弃 subagent 路由字段的问题，保存后的 DeepSeek/Sub2API 等 subagent 路由现在会真实参与后续运行与页面展示。
- **Agents 页面只读清单**: `/settings/agents` 新增单独的 Subagents 侧边入口，右侧展示 role、描述、工具、模型级别和当前真实生效模型来源，不提供编辑入口。
- **提前委派策略**: 代码库任务现在会被明确要求在预计 8 次以上直接工具调用时提前使用 subagent；父 run 连续使用 12 次工具且还没用过 subagent 时，runtime 会插入一次临时委派提示，避免等到 24 次硬上限才进入无工具续写。
- **运行可见性**: Web trace 现在记录工具 start/end，Telegram 工具进度可识别 subagent 调用，并将工具结果摘要限制到 20 个字符。

### Weixin SDK 协议同步
- **生命周期通知**: `package/weixin-agent-sdk` 新增 `notifyStart` / `notifyStop`，高层 SDK 启停流程会尽力通知 Weixin 后端。
- **BotAgent 元数据**: 所有 SDK API 请求的 `base_info` 现在带有经过格式清洗的 `bot_agent`，便于后端日志归因；非法值会安全降级为 `OpenClaw`。
- **扫码登录升级**: QR 登录改为 POST 本地 token hint，支持手机配对码、验证码锁定、已绑定提示和 IDC redirect 状态。
- **回归覆盖**: 新增 API 测试覆盖 `bot_agent` 清洗、生命周期通知请求体，以及已有发送失败/长轮询 abort 行为。

### QQ SDK 上游能力同步
- **SDK 对齐 v1.7.1**: `package/qqbot` 升级到上游 QQ Bot SDK v1.7.1 源码形态，补齐群策略、引用消息上下文、Slash 命令、审批交互、输入状态、流式消息、STT 附件处理等模块。
- **媒体发送增强**: QQ 出站媒体现在包含分片上传、上传缓存、受保护的远程下载、图片/语音/视频/文件统一发送队列，以及更稳定的用户可见错误映射。
- **Molibot 边界适配**: 保留 molibot 的共享队列、会话推进和任务编排职责在上层，QQ SDK 只承担平台协议、消息转换和媒体传输；同时移除了对不存在的 `openclaw/plugin-sdk/core` 运行时入口依赖，并把 `/bot-upgrade` 默认保持为文档指引模式。
- **直连模式修复**: Molibot 通过 `onEvent` 接管 QQ 入站时，SDK 不再触发 OpenClaw runtime 预检、审批 gateway、SDK slash 拦截或消息处理时的 `getQQBotRuntime()`，避免 `QQBot runtime not initialized` 引发重连风暴和 QQ `/gateway` 限频。
- **回归覆盖**: 更新 `package/qqbot` 媒体出站测试，覆盖缺失凭证短路和稳定错误文案映射；`package/qqbot` 编译与主工程生产构建均已通过。

### 生产部署与自动更新
- **Release Bundle**: 新增 `npm run release` / `bin/molibot-release.sh`，可构建 `dist/molibot-release`，包含 `build/`、生产依赖、运行所需模板资源和 service 脚本，生产运行不再需要源码目录。
- **GitHub 自动更新**: 新增 `bin/molibot-update.sh`，支持拉取 GitHub 仓库、构建 timestamped release、原子切换 `current`，并用 `MOLIBOT_APP_DIR` 重启托管进程。
- **Service 启动目录控制**: `bin/molibot-service.sh` 支持 `MOLIBOT_APP_DIR` / `MOLIBOT_START_COMMAND`，可以从 release bundle 或其他构建产物目录启动。
- **Docker 运行路径**: 新增多阶段 `Dockerfile`、`.dockerignore` 和 `docker-compose.yml`，支持镜像化生产部署。
- **生产依赖补齐**: 将 Weixin QR 登录运行时会动态导入的 `qrcode-terminal` 提升为根包直接依赖，避免 release/Docker 环境缺失外置依赖。
- **交互式管理器**: 新增 `molibot manage`，用轻量菜单完成 GitHub 部署配置、安装/更新、启动、停止、重启、状态、日志查看和受保护的运行文件卸载。
- **目录覆盖保护**: 自动更新现在要求非空部署目录带有 `.molibot-deploy` 标记，release 打包也拒绝覆盖非 release 目录，避免误把已有开发 workspace 或配置目录清空。
- **Web 版本检查**: Web 右上角现在显示当前版本，并通过只读 `/api/version` 检查 GitHub 是否有新版本；浏览器只提示，不执行自动更新或重启。
- **系统配置页**: 新增 `/settings/system`，集中配置界面语言、运行时时区，并只读展示 GitHub 地址/ref 和版本状态；右上角版本徽标同步放大，避免版本文字不可见。
- **GitHub 默认来源**: 部署更新、管理器和版本检查默认使用 `https://github.com/gusibi/molibot` 的 `master` 分支，未配置时也能显示和检查默认仓库。
- **旧仓库安装兼容**: 自动更新在拉到的源码还没有 release 管理脚本时，会从当前安装器注入必要脚本后再构建；后续如果源码目录里残留旧的未跟踪注入脚本，也会刷新为当前安装器版本，避免首次安装旧提交时报 `./bin/molibot-release.sh` 不存在或继续复用 stale 脚本。
- **生产依赖自愈**: release 构建会在源码构建前补齐根包缺失的运行依赖（当前包括 `qrcode-terminal` 和 `mpg123-decoder`），避免旧源码 checkout 因子包动态依赖未提升到根包而构建失败。
- **Release 资源完整性**: release bundle 现在包含内置 subagent Markdown 定义，避免生产环境 `/api/settings/subagents` 因缺少 `scout.md` 等文件报 500 并影响 Agents 设置页显示。
- **轻量进程守护**: `bin/molibot-service.sh start` 现在启动脚本级 supervisor，Molibot 子进程异常退出后会自动延迟重启；`stop` 会写入停止标记，确保人工停止不会被守护循环重新拉起。

---

## 2026-04-30

### 图片识别传输格式修复
- **自定义视觉直传加验证门槛**: 自定义 provider 只有在模型 `vision` 能力验证通过后，图片消息才会走原生多模态 streaming transport；未验证但已声明 `vision` 的模型和备用候选不再宣告原生图片输入，改走 direct image-understanding fallback。
- **队列图片恢复修复**: Telegram/QQ/Weixin/Feishu 入队消息仍会清空大体积 base64，但出队处理时现在会用 workspace-relative 附件路径恢复 `imageContents`，避免图片只以文件路径形式进入模型而绕过 fallback。
- **MiMo Anthropic 角色格式修复**: 显式配置为 Anthropic 的 custom provider，其 runner 与图片 fallback 请求会把 `system`/`developer` 内容移到顶层 `system` 字段，不再发送 `messages[].role=system`；fallback 默认打印脱敏后的 `image_analysis_request`，请求头同时兼容 MiMo 的 `api-key`。
- **图片 payload 更可控**: fallback 路径继续使用显式 OpenAI-compatible `image_url` 或 Anthropic-compatible `image/source` 请求体，避免图片消息在未确认兼容的 SDK transport 中失效。
- **安装级图片测试资源**: `molibot init` 现在会把随包携带的 68-byte `vision-smoke.png` 复制到 `<DATA_DIR>/fixtures/vision-smoke.png`，provider vision 测试从用户工作区读取真实图片字节再发请求。
- **回归覆盖**: 新增 custom protocol helper、queued attachment rehydration 与 image fallback 请求体测试，覆盖 Anthropic baseUrl 推导、图片请求头构造、相对附件路径读回 base64，以及 OpenAI-compatible `image_url` / Anthropic `image/source` 两种真实图片 payload。

---

## 2026-04-29

### 自定义 Provider Anthropic 协议
- **协议选择持久化**: 自定义 AI provider 新增 `openai-compatible` / `anthropic` 协议配置，旧配置自动按 OpenAI-compatible 迁移，SQLite 设置表同步保存协议字段。
- **Anthropic Messages API 支持**: `/settings/ai/providers` 可选择 Anthropic Messages，默认路径切到 `/v1/messages`；连接测试使用 `x-api-key` 与 `anthropic-version` 请求头，并支持文本/视觉能力验证。
- **运行时协议分流**: Web custom-provider 直连、主 runner、自定义 subagent 模型构建、图片理解 fallback 都会按协议选择 OpenAI Chat Completions 或 Anthropic Messages payload/transport。
- **思考参数体验修正**: 协议切换现在会立即更新默认 endpoint 和 thinking format；Reasoning Effort Mapping 默认使用按格式内置的自动映射，只在选择 Custom override 时显示下拉覆盖值。
- **测试错误详情增强**: Provider 测试接口会格式化 JSON 错误并返回更长的上游响应片段，Providers 页面也不再把长状态压成单行省略号。
- **模型行内测试反馈**: 单个模型的 Test Connection 结果现在显示在对应模型卡片内，不再占用保存按钮旁边的页面级状态区。
- **Anthropic 运行时 endpoint 修复**: Runner/subagent 传给 Anthropic transport 的 base URL 现在与 `/v1/messages` endpoint 语义匹配，避免测试成功但实际对话请求到重复 `/v1` 路径而 404；模型错误日志同步展示推导后的 endpoint。
- **图片路由优先级修复**: 当 `visionModelKey` 单独配置了图片模型时，图片消息会优先使用该 vision 路由，而不是被同样声明 `vision` 的 text 路由抢走；如果 vision 请求失败但 fallback 恢复成功，会先发送一条独立失败提醒再继续输出结果。

---

## 2026-04-26

### 文档治理整理
- **AGENTS 规则提炼**: 从 `prd.md` / `features.md` 中抽出了长期有效的协作与架构规则，补充到 `AGENTS.md`，包括文档职责分层、事件调度落地边界、以及 prompt/profile 规则必须真实生效而不只是出现在 source 列表。
- **README 文档分工说明**: 更新 `README.md` 的文档说明区，明确 `README` / `AGENTS` / `prd` / `features` / `CHANGELOG` 各自职责，并补充统一的文档维护流程。
- **变更记录对齐**: 将这次文档治理调整同步记录到 `features.md`、`prd.md` 和 `CHANGELOG.md`，让规则、计划、已交付事实三者保持分层一致。

### 对话时间感知
- **每轮消息注入当前时间**: Runner 现在会在发送给模型的实时用户消息前注入结构化 `<env>` 块，包含 `message_received_at`、`timezone` 和 `today`，让模型能直接感知当前时间并更稳定地处理“今天/明天/下周”这类时间表达。
- **不污染持久化上下文**: 这段时间元数据只用于实时模型输入，保存到 session context 的仍是原始用户文本加附件标记，避免把临时环境信息塞进长期会话历史。
- **设置页时区入口**: `/settings/ai/routing` 新增 runtime timezone 下拉选择，优先展示常用时区并保留完整 IANA 列表；后端保存前仍会校验时区名，确保调度、用量统计和消息时间上下文使用同一时区基准。
- **系统提示词去时间化**: 运行时 system prompt 里原先的 `Server timezone` / `run: date` 提示已移除。当前时间感知只保留在每轮实时 `<env>` 注入里，避免把时间相关内容继续留在期望缓存的系统提示词层。

### Workbench UI 统一
- **共享 Workbench 样式层**: 新增 `src/styles/workbench.css`，把 hero、panel、toolbar、config shell、table、status line 等视觉规则收敛到共享层，不再让 Settings 页面各自携带一套私有样式。
- **AI 设置页去本地样式化**: `/settings/ai/usage`、`/settings/ai/errors`、`/settings/ai/routing`、`/settings/ai/providers` 已移除页面内 `<style>`，改由共享 workbench 体系统一接管。
- **Settings 全区同一产品语言**: Agents、Web Profiles、Telegram、Feishu、Weixin、QQ、MCP、Tasks、Skills、Skill Drafts、Run History、Memory Rejections、Plugins、ACP、Memory 等页面统一到同一套材质、间距和表单反馈规则。
- **主聊天页材质统一**: Web chat 保留对话优先的安静节奏，但侧边栏、顶部栏、Composer、Files pane、Prompt Preview / New Chat 弹层已切到同一套 workbench 材质体系，和 Settings 看起来像同一个产品。

### 缓存命中率可视化
- **缓存命中比例 KPI**: `/settings/ai/usage` 顶部新增缓存命中比例卡片，直接显示当前筛选范围内的 prompt cache 命中比例。
- **缓存命中趋势折线图**: 同页新增缓存命中比例趋势图，按当前时间窗口（小时或天）展示命中率变化，方便判断缓存是否持续有效。
- **口径明确**: 命中率统一按 `cache read / (input + cache read)` 计算，只看 prompt 侧 token，不把 output 或 cache write 混进去。

### Usage 时间窗自动刷新
- **点击时间范围即重拉数据**: `/settings/ai/usage` 的 `今天 / 昨天 / 最近 7 天 / 最近 30 天` 现在会在切换标签时立即调用后端重新拉取 usage 数据，不再只改本地 tab 状态。
- **无需二次点击刷新**: 切换时间范围后，顶部日期窗、`更新于` 时间和所有 KPI / 趋势图都会跟着同一轮新数据更新，不需要再手动点一次“刷新”。

### Web Chat 文件工作区
- **通用文件上传**: Web chat 输入区不再限制为仅图片上传；现在可以直接附加 PDF、Markdown、代码、JSON、音频、视频和其他常见文档文件。
- **右侧文件面板产品化**: 右侧 Files pane 从占位块升级成真实的当前会话附件工作区，支持搜索、类型筛选、待发送 / 已发送分组，以及会话切换联动刷新。
- **常见格式预览**: 图片、音频、视频、PDF、Markdown、文本/代码、JSON/CSV/YAML 现在可以内嵌预览；Office 和未知二进制格式会降级为元信息 + 下载。
- **安全浏览动作**: 面板提供下载和复制相对存储路径，不引入删除、重命名、移动这类高风险文件管理动作。

---

## 2026-03-29

### 核心功能优化
- **Python Sandbox 执行强化**: `bash` 工具现在强制所有 Python 命令使用统一的 sandbox 虚拟环境 (`~/.molibot/tooling/python/venv`)，自动修复缺失的 pip，禁用 `--break-system-packages` 标志，确保技能脚本依赖安装不污染全局 Python
- **Telegram 网络超时重试修复**: 添加每尝试 12 秒超时机制，防止 `editMessageText`/`sendMessage`/`sendChatAction` 在网络卡顿时无限挂起，超时会自动重试而非永久等待
- **Bot Profile 文件管理工具**: 新增 `profile_files` 工具，支持运行时读取/初始化/覆盖/编辑 bot 级别的 `BOT.md`/`SOUL.md`/`USER.md`/`TOOLS.md`/`IDENTITY.md`/`SONG.md`，继承链为 `bot -> agent -> global`

---

## 2026-03-28

### 系统提示词架构优化
- **Skill-First 路由优化**: 合并 Task Framing + Capability Use Order + Skill Routing 为统一的 Message Processing Pipeline，Skill 匹配提升为 Step 0，工具部分增强映射表，Skills Protocol 从 60 行精简到 15 行
- **模板简化**: TOOLS.template.md 从 91 行精简到 31 行，IDENTITY.template.md 从 34 行精简到 23 行

---

## 2026-03-26

### Weixin 迁移修复
- **Slash 命令回复修复**: 修复 Weixin 迁移后 `userId` 字段不匹配导致的 `/help`, `/new`, `/status` 等命令崩溃问题
- **SDK 迁移完成**: 完全移除 `@pinixai/weixin-bot` 依赖，使用项目本地 Weixin SDK bridge，基于 `weixin-agent-sdk` 风格的 login/polling 流程

---

## 2026-03-25

### 语音和架构优化
- **Weixin OGG 语音自动转码**: Weixin 出站语音现在检测 Telegram 风格的 `ogg/opus` 文件，自动转换为 `mp3` 后上传，支持原生 Weixin 语音投递
- **共享文本渠道运行时框架**: 添加共享运行时骨架/helpers，Feishu/QQ/Weixin 迁移到共享 queue/dedupe/stop/prompt-preview/context 路径，Telegram 使用共享安全骨架
- **Weixin 出站投递审计和重试**: 结构化 Weixin 出站发送尝试/成功/失败日志，自动重试瞬时 `sendmessage` 失败，按聊天 `delivery.jsonl` 记录

---

## 2026-03-22

### WeChat 渠道集成
- **WeChat 渠道集成**: 通过 npm 包 `@pinixai/weixin-bot` 添加内置 WeChat 渠道插件和设置页面
- **Vite 别名修复**: 添加 Vite 别名将 `@pinixai/weixin-bot/src/index` 解析到 npm 安装的包源文件，解决包导出检查失败问题
- **QR 生成器**: 在 `/settings/weixin` 添加 QR 工具，操作员可以粘贴 SDK 登录链接即时渲染可扫描 QR 码

---

## 2026-03-21

### ACP (Agent Control Plane) 增强
- **Provider/Profile 分层**: 新增 `src/lib/server/acp/providers/`，拆分 `codex.ts` 与 `claude-code.ts`
- **Preset 管理**: Preset / auth hint / adapter 识别集中管理
- **Schema 扩展**: 扩展 ACP target schema，新增 `adapter` 字段
- **默认配置**: 默认设置改为内置 Codex + Claude Code 两个 preset
- **配置兼容**: 旧配置自动推断 adapter，保持向后兼容
- **Telegram ACP 统一**: 统一 Telegram ACP 帮助文案与状态展示
- **远端 Adapter 命令**: 远端 adapter 命令改为带 provider 前缀显示（如 `codex:/...`、`claude-code:/...`）
- **设置页更新**: 更新 `/settings/acp`，新增 adapter 字段与 Codex / Claude Code / Custom 三种 target 添加入口
- **文档更新**: 更新 `features.md` 与 `prd.md` 记录本次交付

---

## 2026-03-20

### 内存和设置改进
- **Periodic 事件状态持久化**: 修复 watcher，periodic 事件每次执行时持久化 `lastTriggeredAt`, `runCount` 和错误状态
- **Mory 首次运行目录引导**: 确保 `${DATA_DIR}/memory` 和 SQLite 父目录在打开 Mory 数据库前创建
- **设置 Patch 合并**: 运行时设置更新路径现在重新加载最新 `settings.json` 后才应用 patch，防止陈旧的内存进程快照回滚配置
- **混合设置存储**: 动态设置迁移到 `settings.sqlite` 行存储，稳定引导字段保留在 `settings.json`
- **Channel Patch 合并**: 修复运行时 channel sanitizer 合并 patch 而非替换整个 map，保存 `channels.web` 不再清除 Telegram/Feishu
- **关系型设置表**: 替换单行动态 JSON 存储为规范化 SQLite 表 (`settings_agents`, `settings_channel_instances`, `settings_custom_providers`, `settings_custom_provider_models`)
- **设置单实体保存流**: 添加单记录设置 API，迁移 Agents/Web/Telegram/Feishu 页面仅保存选定行，选择变更时提示未保存编辑

---

## 2026-03-15

### ACP 增强和命令
- **ACP 会话命令**: 添加 `/acp sessions` 命令和 ACP service 支持 `session/list`，支持 project-aware 过滤和格式化
- **ACP 权限内联卡片 UX**: 重构 Telegram ACP 权限处理为内联按钮卡片，支持一键批准/拒绝和引导式“带注释拒绝”流程
- **ACP 执行上下文输出护栏**: 更新 Telegram ACP 任务提示模板，要求必须包含 `Execution Context` 段落，打印 `pwd`, `ls -la`, python/uv 解析, DB env 值, 命令 + 退出码
- **ACP 停止命令别名**: 添加 `/acp stop` 作为 `/acp cancel` 的别名
- **ACP 可用命令对象渲染修复**: 修复 ACP 命令解析，支持对象形式命令条目，消除 `[object Object]` 输出
- **ACP 会话持久化和恢复**: 添加持久化 ACP 聊天会话元数据，支持服务重启后自动恢复远程会话
- **ACP 最终结果 Markdown 结构化**: 更新 Telegram ACP 任务分发，自动附加 Markdown 格式要求，本地完成摘要转为 Markdown 子弹列表
- **ACP 工具事件噪音减少**: 停止为每个完成的 ACP 工具调用发送 Telegram 消息，汇总到最终任务摘要
- **ACP 状态洪泛保护**: 强化 Telegram 429 重试逻辑，ACP 状态更新节流和降级
- **ACP 认证预检提示**: 改进 ACP 启动错误报告，Codex-like target 超时且无 API key 时附加认证提示

---

## 2026-03-14

### 集成和兼容性
- **pi-ai 0.62 OAuth 导入兼容性修复**: 将 OAuth helper 导入从 `@mariozechner/pi-ai` 移到 `@mariozechner/pi-ai/oauth`，恢复生产构建兼容性
- **Codex auth.json 重用 + ACP 启动超时调整**: 验证 Codex ACP 可在非交互进程重用本地 `~/.codex/auth.json`，增加 ACP 启动超时 (`initialize` 30s, `session/new` 60s)
- **共享 Button 点击事件转发**: 修复 `src/lib/ui/Button.svelte` 转发原生点击事件，恢复 ACP `Add Project` 等设置页面操作
- **ACP stdio 帧兼容性修复**: 修复 ACP stdio 传输帧发送换行分隔 JSON 而非 `Content-Length` 帧，解决 Codex ACP 初始化解析失败
- **Linus Torvalds 风格人设模板**: 添加 `IDENTITY.linus.template.md` 和 `SOUL.linus.template.md`，提供直率技术至上代理人格选项

---

## 2026-03-10

### 稳定性和路由优化
- **Periodic 事件更新 + 重复取代**: 更新 `create_event`，periodic 任务按 `chatId + schedule + timezone` 更新而非创建新文件，旧重复项标记 `completed` (`superseded_by_update`)
- **跨 Provider 模型回退**: Runner 和 assistant service 保留失败 context，自动重试替代 provider，聚合失败详情
- **声明优先的视觉路由**: 更新 runner，自定义文本/视觉模型声明 `vision` 后即使验证 `untested`/`failed` 也信任原生图像输入
- **音频输入能力基础**: 添加 `audio_input` 作为一级模型能力标签，验证状态保持 `untested`
- **验证感知的音频回退路由**: Runner 根据 `audio_input` 和 `stt` 元数据计算显式音频决策，记录回退原因
- **Telegram 媒体预处理状态 + 动作重试强化**: 添加入站图像/音频识别预处理状态，升级 `sendChatAction` 和状态编辑路径支持瞬时网络失败重试
- **Telegram 网络错误诊断丰富**: 添加结构化 Telegram 传输错误诊断，嵌套 `cause`/`code`/`errno`/`syscall`/`address` 元数据

---

## 2026-03-08

### UI/UX 主题和设置
- **主题和 i18n 基础**: 添加可替换主题令牌文件，切换聊天 + 设置 shell 到主题令牌渲染，添加 `system/light/dark` 切换和 `zh-CN`/`en-US` 语言切换
- **设置概览暗模式对比修复**: 更新 `/settings` 概览介绍和卡片描述，从硬编码 `text-slate-400` 到主题令牌 `text-[var(--muted-foreground)]`
- **Feishu 入站媒体解析和 Runner 就绪接收**: Feishu 运行时现在下载入站图像/音频/文件资源，持久化附件，将图像注入 runner 上下文
- **Mory 支持的内存网关核心切换**: 添加可选 `mory` provider 在内存网关中，保持 `json-file` 为默认
- **统一安全模型切换服务**: 添加共享 `settings/modelSwitch.ts`，Telegram + Feishu `/models` 命令使用共享流
- **Agent 设置文件 Shell 保护**: 强化 agent `bash` 工具阻止直接访问运行时设置文件
- **运行时 AI Token 使用跟踪器**: 添加仅追加 JSONL 使用日志，记录每次请求 provider/model/input/output/cache/total tokens
- **AI 设置使用仪表板**: `/settings/ai` 现在显示 today/yesterday/7-day/30-day token 总计，每日/每周/每月细分

---

## 2026-03-03

### 内存系统核心实现
- **内存 V2 分层 + 增量检索管道**: 添加分层内存 (`long_term`/`daily`)，后端能力协商，增量 `flush` 光标，混合搜索 (keyword+recency)
- **内存治理和操作控制台**: 添加事实键冲突检测 (`hasConflict`)，TTL 支持 (`expiresAt`)，API `list` 动作，`/settings/memory` 管理 UI
- **Telegram 内存统一到内存根**: Telegram mom 内存不再存在于聊天工作区目录，全局/聊天内存文件从统一 `memory/` 根迁移/读取
- **统一内存网关用于 Telegram Agent 操作**: 添加 Telegram `memory` 工具，阻止通过 `read/write/edit/bash` 工具直接内存文件访问
- **外部化 Telegram Runner 指令文件**: `runner.ts` 现在从代码构建运行时系统提示，然后从 data-root `~/.molibot` 合并指令/配置文件
- **Bot 提示自动维护协议**: 在捆绑的 AGENTS 模板中添加显式自动更新治理，用于 `USER.md`/`SOUL.md`/`TOOLS.md`/`IDENTITY.md`/`BOOTSTRAP.md`
- **AGENTS.md 工作区目标护栏**: 添加显式 bot 提示规则：编辑 AGENTS 指令时，始终目标 `${workspaceDir}/AGENTS.md`，永远不要项目根 `AGENTS.md`
- **`molibot init` 工作区引导命令**: 添加启动器子命令 `molibot init` 来初始化 `${DATA_DIR:-~/.molibot}` 并从捆绑的提示模板引导配置文件
- **全局配置文件路径强制执行**: 强化工具路径解析/保护，因此配置文件 (`SOUL.md`/`TOOLS.md`/`BOOTSTRAP.md`/`IDENTITY.md`/`USER.md`) 被规范化为 data-root 全局路径

---

## 2026-02-28

### 系统提示词和架构
- **全局提示源强制执行和源预览**: 提示文件加载器现在从 `${DATA_DIR}` (`~/.molibot`) 解析指令/配置文件，大小写不敏感文件名匹配
- **全局配置文件模板升级**: 使用受 OpenClaw 启发的模板样式 frontmatter 和更清晰的章节重构 `~/.molibot/AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `IDENTITY.md` / `BOOTSTRAP.md`
- **Init 配置文件模板包**: 从升级的全局配置文件添加 `src/lib/server/agent/prompts/*.template.md`，切换 `molibot init` 为复制这些模板
- **移除遗留 AGENTS.default 回退文件**: 删除 `src/lib/server/agent/prompts/AGENTS.default.md`，运行时回退/导入指向 `AGENTS.template.md`
- **提示构建器提取和运行时/配置文件拆分清理**: 将 Telegram mom 提示构建从 `runner.ts` 移到 `src/lib/server/agent/prompt.ts`，代码拥有的合约章节保留在代码中
- **提示预览动态章节排序清理**: 重新排序 `prompt.ts`，稳定的运行时合约章节保持在高变动运行时有效负载之前
- **配置文件注入清理**: 在将配置文件注入运行时提示前剥离 YAML frontmatter，重写 AGENTS 注入措辞
- **渠道特定提示章节**: 从核心提示中移除 Telegram 特定交付措辞，在 `src/lib/server/agent/prompt-channel.ts` 引入适配器可选渠道提示章节

---

## 2026-02-27

### 核心架构和内存系统
- **mory README 能力清单**: 更新 `package/mory/README.md` 为功能状态清单，按 `完成` / `TODO` 标注 mory 当前能力与未实现项
- **mory TODO 功能全量落地**: 添加 `moryEngine` 编排 (`ingest/retrieve/commit/readByPath/readMemory`)，`read_memory` 工具 API，异步 commit 管道，严格提取验证器，存储适配器 (`InMemory`/`SQLite`/`pgvector`)，版本化 schema 字段，检索执行器，遗忘/归档策略引擎，可观测性指标，全循环 E2E 测试
- **mory 认知控制模块**: 扩展 `package/mory`，添加纯逻辑模块用于写入评分门 (`moryScoring`)，冲突解决/版本控制 (`moryConflict`)，检索意图路由 (`moryPlanner`)，情景整合 (`moryConsolidation`)，任务范围工作区内存助手 (`moryWorkspace`)
- **定期事件生命周期修复**: `periodic` 任务首次执行后不再标记 `completed` 并从调度表移除，watcher 保持它们跨运行调度并记录 `lastTriggeredAt` 同时保留 `runCount`
- **Molibot 服务脚本状态说明**: 确认 `bin/molibot-service.sh` 仅反映其管理的后台实例状态，不能代表系统内不存在其他手动或开发模式运行中的 Molibot 进程
- **mory README 功能点状态清单**: 将 mory 全量功能点写入 `package/mory/README.md`，按 `完成` / `TODO` 明确当前实现边界
- **硬调度护栏**: 为 Telegram mom 运行时添加硬调度护栏，提示明确要求所有延迟/重复任务使用 watched event JSON 文件，`bash` 阻止外部调度器，`memory add` 拒绝提醒/计划类内容
- **mory 独立 SDK 完成**: 完成 `package/mory` 作为独立 Node 包，标准结构 (`src/`, `test/`, `README.md`, `package.json`, `tsconfig.build.json`)，可运行构建/测试/smoke 脚本
- **mory SQL 持久化模板**: 添加 `@molibot/mory` SQL 持久化模板，SQLite schema/upsert SQL 加 PostgreSQL pgvector schema/upsert/vector-search SQL
- **mory 写入门批量行为**: 改进 `mory` 写入门批量行为，批量缓存反映插入和更新决策，待处理 ID 现在是碰撞安全的
- **技能提供策略澄清**: README 澄清 `molibot init` 保持手动安装行为，添加从项目 `skills/` 到 `${DATA_DIR}/skills` 的显式手动安装命令
- **README 渠道状态措辞**: 修正 README 渠道状态措辞，Telegram 标记为实际使用中验证，Web Chat/CLI 标记为实现但尚未在此项目使用上下文中亲自验证
- **mory 写入时分类**: 添加共享内存分类，新内存写入时自动标记，flush/import 路径重用相同分类器，提示注入优先 collaboration/project/reference 内存
- **通用代理提示强化**: 填补非编码提示空白，添加任务框架、新鲜度验证、外部内容注入抵抗、更广泛的动作确认规则
- **Weixin 入站语音/文件媒体回退强化**: Weixin 入站媒体接收不再在 `media.aes_key` 缺失或 SDK payload 仅提供 hex `aeskey` 时丢弃语音/文件/视频项目，回退到纯 CDN 下载或 hex-key 规范化

---

## 2026-02-25

### 渠道和内存系统
- **渠道特定提示章节**: 从核心提示中移除 Telegram 特定交付措辞，引入适配器可选渠道提示章节
- **Mory 支持的内存网关核心切换**: 添加 `src/lib/server/memory/moryCore.ts`，注册可选 `mory` provider 在内存网关中
- **Feishu 入站媒体解析**: Feishu 运行时现在下载入站图像/音频/文件资源，持久化附件，将图像注入 runner 上下文
- **统一安全模型切换服务**: 添加共享 `settings/modelSwitch.ts`，窄 API `/api/settings/model-switch`
- **Agent 设置文件 Shell 保护**: 强化 agent `bash` 工具阻止直接访问运行时设置文件
- **运行时 AI Token 使用跟踪器**: 添加仅追加 JSONL 使用日志，记录每次请求 provider/model/input/output/cache/total tokens
- **AI 设置使用仪表板**: `/settings/ai` 显示 today/yesterday/7-day/30-day token 总计，每日/每周/每月细分
- **Mory 首次运行目录引导**: 确保 `${DATA_DIR}/memory` 和 SQLite 父目录在打开 Mory 数据库前创建
- **Agent 拥有的音频转录边界**: 将 STT 目标解析/转录流移到 `src/lib/server/agent/stt.ts`，附件元数据扩展 `mediaType`/`mimeType`
- **Provider 能力验证状态**: 添加每模型 `verification` 状态 (`untested`/`passed`/`failed`)，扩展 provider 测试 API
- **验证感知的视觉路由**: 更新 runner，图像输入仅在选定的自定义文本模型或专用视觉路由模型声明并验证通过 `vision` 时才通过原生多模态提示
- **音频输入能力基础**: 添加 `audio_input` 作为一级模型能力标签，验证状态故意保持 `untested`
- **验证感知的音频回退路由**: 更新 runner 从 `audio_input` 和 `stt` 能力元数据计算显式音频决策
- **Telegram 媒体预处理状态 + 动作重试强化**: 添加入站图像/音频识别预处理状态，升级 `sendChatAction` 和状态编辑路径支持瞬时网络失败重试
- **Telegram 网络错误诊断丰富**: 添加结构化 Telegram 传输错误诊断，嵌套 `cause`/`code`/`errno`/`syscall`/`address` 元数据
- **声明优先的视觉路由**: 显式声明 `vision` 的自定义文本/视觉模型现在即使验证 `untested` 或 `failed` 也被信任用于原生图像输入
- **AI 使用 Bot 维度分析和过滤**: 扩展使用记录添加 `botId`，在使用跟踪器窗口/细分中添加 bot 级聚合，升级 `/settings/ai/usage` 支持 bot 过滤 + bot 排名表
- **Runner 流日志安全修复**: 从 `runner.ts` 移除不安全的低级流包装器，将 first-token 日志移到真实 assistant delta 事件，停止自动启用 pretty stdout 日志除非显式设置 `MOM_LOG_PRETTY=1`

---

## 2026-02-23

### Web UI 重构
- **Web 应用 ChatGPT 风格 Tailwind 布局重构**: 重建聊天 + 设置页面 (`/`, `/settings`, `/settings/ai`, `/settings/telegram`) 为统一 ChatGPT 风格 shell，纯 Tailwind 样式
- **服务器生命周期脚本 + 运维文档**: 添加 `bin/start-molibot.sh`, `bin/stop-molibot.sh`, `bin/status-molibot.sh`, `bin/restart-molibot.sh`
- **统一服务控制脚本**: 添加 `bin/molibot-service.sh` (`start/stop/status/restart`) 作为单一运维入口
- **全局 `molibot` 启动器 + 家工作区迁移**: 添加 npm-linkable `molibot` 命令，将默认运行时数据根移到 `~/.molibot`，Telegram 工作区切换到 `~/.molibot/moli-t`

---

## 2026-02-20

### 核心功能实现
- **记忆网关 API 完成**: 实现稳定的记忆网关 API，支持可替换后端（JSON 文件默认），`add/search/flush/delete/update` API 端点
- **记忆 V2 分层 + 增量检索管道**: 添加分层记忆（`long_term`/`daily`），后端能力协商，增量 `flush` 光标，混合搜索（keyword+recency）
- **记忆治理和操作控制台**: 添加事实键冲突检测（`hasConflict`），TTL 支持（`expiresAt`），`/settings/memory` 管理 UI
- **Telegram 多 Bot 运行时 + 设置 UI**: 添加 `telegramBots[]` 设置 schema 和 `/settings/telegram` 多 bot 编辑器
- **事件交付模式拆分**: 添加可选事件字段 `delivery`，one-shot/immediate 默认 agent 执行，`delivery:"text"` 保持字面推送

---

## 2026-02-15

### ACP 和渠道增强
- **Telegram ACP 命令路径 MVP**: 添加 ACP 设置 + Codex target preset，Telegram `/acp` / `/approve` / `/deny` 命令，项目注册，聊天范围的 ACP 会话生命周期
- **ACP Web 设置工作区**: 添加 `/settings/acp`，结构化 ACP target/project 管理，批准模式默认值，绝对路径项目允许列表编辑
- **ACP 会话命令**: 添加 `/acp sessions` 命令，支持 ACP `session/list`，包括 target/project 上下文和当前会话标记
- **ACP 权限内联卡片 UX**: 重构 Telegram ACP 权限处理为内联按钮卡片，支持一键批准/拒绝和引导式“带注释拒绝”流程
- **ACP 执行上下文输出护栏**: 更新 Telegram ACP 任务提示模板，要求必须包含 `Execution Context` 段落
- **ACP 停止命令别名**: 添加 `/acp stop` 作为 `/acp cancel` 的别名

---

## 2026-02-11

### 项目启动和基础架构
- **V1 PRD 基线**: Must/Later 范围和验收标准定义
- **V1 架构基线**: 架构对齐到仅 Telegram + CLI + Web
- **双周冲刺计划**: 按周交付物和检查点定义
- **Telegram 技术决策**: V1 Telegram 适配器库固定为 `grammY`
- **持久化技术决策**: V1 会话/消息持久化改为 SQLite
- **文档清理**: 移除冗余文档，在 `readme.md` 中添加文件用途导航
- **代码骨架实现**: 实现 V1 代码骨架：Telegram (`grammY`), CLI, Web, 统一路由器, SQLite 持久化
- **运行时集成**: `assistantService.ts` 直接调用 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`
- **驱动兼容性修复**: 用内置 `node:sqlite` 替换 `better-sqlite3`，支持 Node 25 兼容性

---

## 总结

### 主要成就 (2026-02-11 至 2026-03-29)

#### 1. 架构重构 (3次重大重构)
- **模块重组**: 后端重组为 7 个显式模块（app, agent, channels, memory, sessions, settings, providers）
- **分层重构**: 共享命令层抽取，渠道 Runtime 清理，代码和文档同步
- **ACP 增强**: 完整的 Agent Control Plane，支持 Codex 和 Claude Code 双 preset

#### 2. 渠道支持 (4个主要渠道)
- **Telegram**: 完整入站和出站媒体支持，多 bot 运行时，ACP 集成
- **Feishu**: 完整入站媒体解析和出站文件/图像/音频交付
- **Weixin**: SDK 迁移完成，OGG 语音自动转码，媒体投递审计
- **QQ**: 基础运行时支持

#### 3. 内存系统 (30+ 相关功能项)
- **核心架构**: 分层内存 (`long_term`/`daily`)，混合检索 (keyword+recency)
- **网关 API**: 稳定的记忆网关，支持可替换后端（JSON 文件默认，Mory 可选）
- **治理控制台**: 事实键冲突检测，TTL 支持，`/settings/memory` 管理 UI
- **mory SDK**: 独立 Node 包，支持 SQLite/pgvector，完整认知控制模块

#### 4. 设置和配置 (25+ 功能项)
- **AI 设置**: 多 provider 架构，每模型能力标签和验证，可视化 provider 测试
- **模型路由**: 文本/视觉/STT/TTS 模型选择，跨 provider 自动回退
- **关系型设置**: 规范化 SQLite 表，单实体保存流，未保存变更提示
- **主题和 i18n**: Solar Dusk 调色板，`system/light/dark` 模式，`zh-CN`/`en-US` 切换

#### 5. 开发者体验和工具 (20+ 功能项)
- **Python Sandbox**: 统一虚拟环境，自动依赖管理，禁止系统包污染
- **Bash 工具强化**: 路径沙箱，命令白名单，输出压缩，超时处理
- **MCP 集成**: stdio 和 HTTP 传输支持，技能门控注入，动态加载工具
- **性能优化**: 提示刷新策略（仅变更时重建），流日志安全修复，定期事件锁机制

### 统计数据
- **总功能项**: 250+ 个已交付功能项
- **架构重构**: 3 次重大重构（模块重组、分层重构、ACP 增强）
- **渠道支持**: 4 个主要渠道（Telegram、Feishu、Weixin、QQ）完整媒体支持
- **内存系统**: 30+ 相关功能项，完整的记忆层实现
- **设置和配置**: 25+ 功能项，完整的设置架构
- **开发者工具**: 20+ 功能项，完整的开发体验

### 时间跨度
- **开始日期**: 2026-02-11
- **当前版本日期**: 2026-03-29
- **总开发周期**: 7 周
- **主要发布**: V1.0 (当前)
