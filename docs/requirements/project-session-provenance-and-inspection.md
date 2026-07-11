# Project Session 文件与变更检查方案

> 状态：方案已收敛，待实施
>
> 优先级：P1；其中 Project 模式的 Bash 自动搬家问题按 P0 先止血
>
> 范围：Project Session 的输出路由、项目文件检查、Git 变更检查和附件展示
>
> 前置条件：明确 Project 文件与 runtime 临时产物的输出边界

## 1. 这次要解决什么问题

用户在 Project Session 中需要看到三类内容：

1. Project 当前有哪些文件；
2. Project 当前有哪些 Git 变更；
3. 当前 Session 的消息上传了或附带了哪些文件。

这三类内容不需要一套复杂的 run 级文件账本。

Project 根目录是多个 Session、Agent、用户编辑器和其他进程共享的工作区。文件变更天然属于 Project，而不是某个 Session。无论用户从哪个 Session 打开文件面板，都应该看到同一份项目文件树和同一份 Git 工作区状态。

只有消息附件需要保留 Session 归属。附件已经挂在会话消息上，并保存在对应 Project runtime 中，不需要再建一套 provenance 存储。

因此，本方案只新增两个能力：

- **RunOutputLayout**：决定工具输出写入 Project 根目录，还是 Project runtime scratch。
- **ProjectInspection**：只读检查注册 Project 的文件树和当前 Git 状态。

本方案不再建设 `TurnFileProvenance`，也不追踪“某一轮具体修改了哪些项目文件”。

## 2. 产品边界

### 2.1 Project 文件和变更采用全局视角

`Files` 和 `Changes` 都属于 Project。它们不属于当前 Session，也不属于某个 run。

例如，两个 Session 同时修改不同文件时，任意一个 Session 打开 `Changes`，都能看到两个文件的当前 Git 变更。用户在编辑器里做的修改也显示在同一个列表中。

界面只表达“Project 当前是什么状态”，不猜测修改来源。

### 2.2 消息附件保留 Session 归属

用户上传的文件，以及 Agent 通过 `uploadFile` 附加到回复中的文件，继续跟随会话消息保存。打开历史 Session 时，用户仍能看到这些附件。

现有附件副本可以直接复用。实现时只需让 Project Session 的附件读取和预览走正确的 Project runtime，不再复制一份文件，也不新增附件账本。

### 2.3 普通 scratch 产物属于 Project runtime

没有附加到消息中的临时图片、音频、视频、下载文件和中间结果，写入 Project runtime scratch：

```text
<dataDir>/projects/<projectId>/runtime/<user>/scratch/YYYY/MM/DD/
```

V1 按日期组织，不增加 Session 或 run 目录。它们是 Project 级临时产物，不承诺从历史消息中还原“哪一轮生成了哪个文件”。

如果将来确实需要 per-turn 产物历史，再单独设计稳定的 artifact ledger。当前版本不提前建设。

## 3. 用户看到什么

Project Session 的文件面板包含三个标签页：

| 标签页 | 展示内容 | 数据来源 | 作用域 |
| --- | --- | --- | --- |
| `文件` | Project 当前文件树 | 实时读取 Project root | Project 全局 |
| `变更` | 当前 Git status 和 diff | 实时执行受限 Git 只读命令 | Project 全局 |
| `附件` | 当前 Session 消息中的附件 | 会话消息和现有附件存储 | Session |

界面必须使用准确的表达：

- 可以说“当前项目变更”；
- 可以说“当前 Git diff”；
- 不说“本轮修改”；
- 不说“Agent 修改”；
- 不把工具活动记录当成完整文件历史。

非 Git Project 仍能使用 `文件` 和 `附件`。`变更` 显示“当前目录不是 Git 仓库”，不做 manifest 快照，也不模拟一套变更历史。

## 4. 当前实现的问题

### 4.1 Bash 会误搬用户文件

当前 Bash 工具会在命令执行前后比较 Project 根目录文件的 mtime。只要 mtime 变化，且扩展名命中产物列表，就会把文件移动到日期目录。

这会误伤用户并发保存的 `README.md`、`notes.md`、JSON、HTML 等正常项目文件。Project 模式必须立即禁用这套自动搬家逻辑。

普通 Bot workspace 可以在过渡期保留现有行为。完成显式输出路由后，应删除基于 mtime 猜测产物的机制。

### 4.2 `write` 会误判裸文件名

当前 `write` 只要看到不含目录的文件名，就会把它路由到日期目录。因此 `README.md` 也会离开 Project 根目录。

新方案不再从文件名猜用途。工具通过明确的 `target` 决定输出位置。

### 4.3 Bash 完整输出会污染 Project 根目录

截断后的 Bash 完整日志目前写入执行目录下的 `.mom-tool-output`。Project 模式下，执行目录就是用户 Project root，这违反“Project 根目录不写 Molibot 元数据”的约束。

这些日志必须写到 Project runtime 的专用目录。

### 4.4 现有文件面板不理解 Project

Desktop 当前调用普通 Web 的附件接口。它既不能读取 Project root，也不能正确解析 Project Session 的附件。

新的 Project 文件面板必须通过 Project 专属接口读取文件树和 Git 状态，并通过 Project-aware 的会话路径读取附件。

## 5. 不可破坏的规则

1. **Molibot 元数据不得写入用户 Project root。** scratch、Bash 完整日志、附件副本和运行记录都留在 Project runtime。
2. **Project 文件面板只读。** 它不能 stage、commit、restore、checkout、reset，也不能删除或改写项目文件。
3. **Project 变更是全局状态。** 不按 Session 或 run 过滤，不推断修改来源。
4. **API 不返回绝对路径。** Desktop 只接收相对 Project root 或 runtime 根目录的规范化路径。
5. **不通过 Agent Bash 做检查。** ProjectInspection 直接调用固定的文件系统和 Git 只读接口。
6. **所有读取都有上限。** 树遍历、文件预览、Git status、diff 都必须有条目、字节和超时限制。
7. **软链接不能越界。** 可以显示软链接本身，但不能递归、预览或 diff Project root 外的目标。
8. **设置页和面板遵循设计规范。** Desktop 面板以 `DESIGN.vercel.md`（Geist）为准，服务端/共享部分沿用 `DESIGN.md` 约定。使用现有 shadcn-svelte 组件、语义样式和主题 token，并验证中英、明暗主题、键盘操作和窄窗口。

## 6. 输出路由怎么工作

### 6.1 统一的输出布局

共享 Agent 层提供 `RunOutputLayout`，Channel 只传入 Project 上下文，不自行决定文件路径。

```ts
interface RunOutputLayout {
  projectRoot?: string;
  scratchRoot: string;
  toolOutputRoot: string;
}
```

Project Session 中：

```text
projectRoot    = 注册的 Project root
scratchRoot    = <project runtime>/<user>/scratch/YYYY/MM/DD
toolOutputRoot = <project runtime>/<user>/tool-output
```

普通 Bot Session 继续使用自己的 runtime workspace，不复用 Project 路径。

所有路径在运行时可以是绝对路径，但写入数据库、返回 Desktop 和显示给用户时，必须转换成带 root kind 的相对路径。

### 6.2 工具显式选择目标

文本写入工具增加明确的目标：

```ts
target?: "project" | "scratch"
```

默认规则：

- Project Session 的 `write`、`edit` 默认写 `project`；
- 图片、音频、视频、下载和转换工具默认写 `scratch`；
- 普通 Bot Session 默认写 `scratch`；
- 用户或任务明确给出目录时，尊重显式路径，但仍要通过允许根目录检查；
- 不再根据“是不是裸文件名”判断项目文件或临时产物，Project 与 Bot 模式一致。

相对路径的解析基准由 target 决定：

- `target = "project"`：相对 `projectRoot` 解析；
- `target = "scratch"`：相对 `scratchRoot`（已含日期段）解析；
- 绝对路径不受 target 影响，但必须通过允许根目录检查。

普通 Bot Session 的默认 target 是 `scratch`，而 `scratchRoot` 本身就是日期目录，因此 `write("report.md")` 仍落在当天目录下——现有 Bot 行为由默认 target 自然保留，不需要任何按文件名猜测的逻辑。

`edit` 只能编辑已存在的明确路径，不做默认文件名搬运。

### 6.3 工具返回结构化路径

`write`、`edit`、媒体和附件工具在成功后返回统一的结构化详情：

```ts
interface FileToolDetails {
  requestedPath?: string;
  relativePath: string;
  rootKind: "project" | "scratch" | "attachment";
  action: "created" | "modified" | "generated" | "attached";
  sizeBytes?: number;
}
```

这些字段用于工具卡片、点击打开和运行排障。它们不是完整的 per-turn 文件清单，也不写入新的 provenance SQLite 表。

## 7. ProjectInspection 怎么工作

建议位置：`src/lib/server/projects/inspection.ts`。

接口保持小而明确：

```ts
listTree(project: ProjectRecord, input: TreeQuery): Promise<TreePage>;
readFile(project: ProjectRecord, input: FileQuery): Promise<FilePreviewResult>;
getGitStatus(project: ProjectRecord): Promise<GitStatusResult>;
getGitDiff(project: ProjectRecord, input: DiffQuery): Promise<GitDiffResult>;
```

### 7.1 文件树

文件树按目录懒加载，不一次扫描整个 Project。

每个请求都要：

1. 重新读取已注册的 Project root；
2. 解析并规范化请求中的相对路径；
3. 用 `realpath` 检查实际目标仍在 Project root 内；
4. 对软链接只返回链接元数据，不跟随越界目标；
5. 限制单页条目数、目录深度和耗时；
6. 返回稳定 cursor 和明确的截断状态。

默认隐藏 `.git` 内部文件。依赖和缓存目录是否隐藏由文件树展示配置决定，但不能影响路径安全。

文件树中的文本文件支持只读预览，通过独立的 `readFile` 接口返回。它复用与 diff 相同的 realpath 校验、字节上限和状态语义：二进制返回元数据不渲染内容，超限返回大小与截断原因。

### 7.2 Git status

Git status 展示 Project 当前的整体状态：

```text
git -C <projectRoot> status --porcelain=v2 -z --untracked-files=all -- .
```

必须使用 `-z` 解析文件名，不能按换行切割。注意 `--porcelain=v2` 的 rename 记录携带 NUL 分隔的新旧两个路径，解析器必须按记录类型区分，不能统一按单路径切。结果统一转换为相对 Project root 的路径；当 rename 的一侧位于 Project root 之外（Project 是大仓库子目录时可能发生），越界一侧只标记为“来自项目外”，不得返回具体父目录路径。

如果 Project root 位于一个更大仓库的子目录中，查询范围仍只允许当前 Project。任何父目录路径都不能返回给 Desktop。

被 `.gitignore` 忽略的文件默认不出现在 `Changes`。V1 不启用无界的 `--ignored` 扫描，避免把依赖、缓存和秘密文件大量暴露到面板。界面需要说明：Git 忽略文件不在变更列表中。

### 7.3 Git diff

Git diff 只接受已校验的 Project 相对路径：

```text
git -C <projectRoot> diff HEAD --no-ext-diff --no-textconv --no-color -- <relativePath>
```

必须使用 `diff HEAD` 而不是裸 `diff`：status 会显示 index 中已暂存的变更，而裸 `diff` 只比较工作区与 index，会让“仅暂存未再修改”的文件在 `Changes` 列表中显示为已修改、点开却是空 diff。`diff HEAD` 展示工作区相对上次提交的完整差异，与 `Changes` 的全局语义一致。

仓库尚无任何 commit（无 HEAD）时，`diff HEAD` 不可用：此时所有文件都按未跟踪预览路径返回，不报错。

不同文件返回明确状态：

- tracked 文本文件：返回有大小上限的 diff；
- untracked 文本文件：返回有大小上限的文件预览，并标记为“未跟踪文件”，不冒充 Git patch；
- binary：返回文件元数据，不读取或渲染二进制内容；
- deleted：返回删除状态和可用的受限 diff；
- oversized：返回大小和截断原因；
- outside-root：拒绝请求；
- no HEAD（空仓库）：按未跟踪预览语义返回，不报错；
- unavailable：Git 不可用或当前目录不是仓库。

### 7.4 Git 子进程安全

ProjectInspection 不接受模型提供的命令字符串。它使用固定 Git 可执行文件和结构化 argv，不经过 shell。

运行环境至少满足：

- `GIT_OPTIONAL_LOCKS=0`；
- `GIT_CONFIG_NOSYSTEM=1`；
- 隔离或清空 `HOME`、`XDG_CONFIG_HOME`；
- `GIT_PAGER=cat`、`PAGER=cat`；
- `-c core.fsmonitor=false`：`GIT_CONFIG_NOSYSTEM` 和隔离 `HOME` 无法屏蔽仓库自带的 `.git/config`，而 `core.fsmonitor` 可让 `git status` 执行任意外部命令，必须用 argv 显式覆盖；
- `-c core.hooksPath=` 与 `-c submodule.recurse=false` 作为纵深防御；
- diff 使用 `--no-ext-diff` 和 `--no-textconv`；
- stdin 关闭；
- stdout/stderr 分别设置字节上限；
- 超时后终止整个子进程组；
- 不执行任何 Git 写命令，也不访问网络。

仓库内的 `.gitattributes` 和本地配置仍可能影响 Git 行为。实现和测试必须确认上述隔离不会启动外部 diff、textconv、pager 或 fsmonitor 程序；测试需包含一个在 `.git/config` 中把 `core.fsmonitor` 指向外部命令的 fixture 仓库，验证 status 和 diff 都不会执行它。

## 8. HTTP 接口

接口保持 loopback-only，并挂在现有 Project 路由下：

```text
GET /api/settings/projects/:projectId/inspection/tree?path=&cursor=
GET /api/settings/projects/:projectId/inspection/file?path=
GET /api/settings/projects/:projectId/inspection/git/status
GET /api/settings/projects/:projectId/inspection/git/diff?path=
GET /api/settings/projects/:projectId/sessions/:sessionId/attachments
```

每个接口都要验证：

- `projectId` 对应有效且未断开的 Project；
- `sessionId` 确实属于该 Project；
- 请求路径通过规范化和 realpath containment；
- 返回值不包含本机绝对路径。

统一状态包括：

```text
ready | empty | unavailable | truncated | binary | oversized | outside-root
```

文件树使用 cursor 分页。diff 和预览只返回文本，并带上实际字节数、截断状态和原因。

## 9. Desktop 交互

复用现有 Project header 和会话页面，不创建第二套聊天实现。

- Project header 的文件按钮打开 Project 文件面板；
- `文件` 和 `变更` 在同一 Project 的所有 Session 中显示相同内容；
- `附件` 只显示当前 Session 消息中的附件；
- 面板每次打开时重新拉取当前视图，并提供手动刷新入口；切换 Session 时，文件树和 Git 状态可以复用 Project 级缓存，但附件列表随 Session 更新；
- 不再增加消息下方的“本轮改动”卡片；
- 工具卡片可以根据结构化 details 显示最终路径，并提供安全的打开入口；
- 文件和 diff 内容使用等宽字体，但按钮、标签和说明沿用 Geist/现有主题样式；
- 窄窗口下列表和详情上下堆叠，不产生横向溢出；
- 中英文切换必须即时生效；
- 明暗主题、键盘焦点、loading、empty、error、no-Git、binary、oversized 和 truncated 状态都要有完整表现。

面板只读。V1 不提供删除、重命名、恢复、stage 或 commit 操作，因此不需要保存按钮和设置页固定底栏。

## 10. 数据和生命周期

本方案不新增 Project 文件 provenance 表，也不保存文件快照或历史 diff。

现有数据继续按各自规则保存：

- Project 文件由用户和 Git 管理；
- 附件跟随 Session 消息和附件存储；
- scratch 与 `.mom-tool-output` 留在 Project runtime；
- run detail 和 trace 使用现有运行记录系统。

V1 不自动按时间删除 runtime 文件。后续清理功能必须满足：

- 只能清理 Project runtime，绝不触碰 Project root；
- 不能删除仍被消息附件引用的文件；
- 清理前展示范围、数量和大小；
- 用户显式确认；
- 支持按日期或容量上限清理 scratch/tool-output；
- 清理过程不能影响正在运行的任务。

删除 Session 时继续按现有语义处理消息和附件，不删除 Project root。删除 Project history 时可以删除对应 runtime；断开 Project 时保留历史 Session 和附件，但禁止新的执行和实时 ProjectInspection。

## 11. 实施切片

### Slice A：P0 止血

- Project 模式禁用 Bash 的 mtime 自动搬家；
- Bash 截断完整日志改写到 runtime `tool-output`；
- 普通 Bot 行为保持兼容；
- 测试用户并发修改 Project 根文件时，Molibot 不会移动它。

### Slice B：输出路由

- 引入共享 `RunOutputLayout`；
- Project `write/edit` 与媒体工具使用明确 target；
- scratch 使用 Project runtime 下的绝对日期目录；
- 删除按裸文件名猜测输出位置的逻辑（Project 与 Bot 一致；Bot 行为由默认 `scratch` target 保留）；
- 工具成功结果返回结构化 `FileToolDetails`。

### Slice C：只读 ProjectInspection

- 实现懒加载文件树；
- 实现全局 Git status 和路径级 diff；
- 实现 untracked preview、binary/oversized/truncated 状态；
- 加固 Git 子进程；
- 覆盖软链接、嵌套仓库、非 Git、超时和大输出测试。

### Slice D：Desktop 文件面板

- 接入 `文件 / 变更 / 附件` 三个标签页；
- 复用现有 Project 会话和附件数据；
- 支持工具结果中的安全文件打开；
- 验证中英、明暗主题、键盘焦点和窄窗口。

### 后续：runtime 清理

- 设计 scratch/tool-output 的保留期和容量上限；
- 提供显式预览与清理入口；
- 不把清理功能塞进首批文件检查实现。

## 12. 验收矩阵

| 场景 | 预期结果 |
| --- | --- |
| Session A 修改 `src/a.ts`，Session B 修改 `src/b.ts` | 两个 Session 打开 `变更` 都看到两个文件的当前状态 |
| 用户在 IDE 中修改 `README.md` | `Changes` 如实显示；Molibot 不宣称修改来自 Agent |
| Bash 运行期间用户保存根目录 Markdown | 文件留在原位置，不被日期目录搬走 |
| `write` 创建 Project 根 `README.md` | 默认写入 Project root，不进入 scratch 日期目录 |
| 图片工具未指定输出目录 | 文件写入 Project runtime scratch，不污染 Project root |
| Bash 输出被截断 | 完整日志写入 runtime `tool-output`，Project root 不出现 `.mom-tool-output` |
| 两个 Session 同时工作 | 不做归属判断，不需要并发标记，Project 全局状态保持一致 |
| Project 有未跟踪文件 | status 返回具体文件；文本文件可查看受限预览 |
| 文件仅被 `git add` 暂存后未再修改 | `变更` 列表显示该文件，diff 展示相对 HEAD 的完整差异，不为空 |
| Git 仓库尚无任何 commit | status 正常显示未跟踪文件；diff 走未跟踪预览语义，不报错 |
| 仓库 `.git/config` 配置了指向外部命令的 `core.fsmonitor` | status 和 diff 正常返回，且绝不执行该命令 |
| 文件被 `.gitignore` 忽略 | 默认不出现在 `Changes`，界面说明观察范围 |
| Project root 是大仓库子目录 | 只显示当前 Project 范围，不暴露父目录文件 |
| 软链接指向 Project 外 | 可以显示链接本身，但拒绝递归、预览和 diff |
| 非 Git Project | `文件` 和 `附件` 可用，`变更` 显示不适用 |
| 当前 Session 有上传附件 | `附件` 显示并可预览，切换 Session 后列表同步变化 |
| diff 过大或文件为二进制 | 返回明确状态，不读取或渲染无界内容 |
| 断开 Project | 历史 Session/附件保留，实时文件和 Git 检查不可用 |

## 13. 明确不做什么

- 不记录某个 Session 或 run 修改了哪些 Project 文件；
- 不建立 `TurnFileProvenance`、文件 baseline、manifest 或 effect ledger；
- 不保存 Project 文件快照和历史 diff；
- 不尝试区分 Agent、用户编辑器、其他 Session 或外部进程的修改；
- 不提供通用宿主文件浏览器；
- 不自动 stage、commit、restore、reset、checkout 或切换分支；
- 不在首批实现中加入 runtime 自动清理；
- 不把工具结构化 details 宣称为完整的文件修改历史。

最终边界很简单：Project 文件和 Git 变更采用全局实时视角；消息附件保留 Session 归属；普通临时产物留在 Project runtime。Molibot 负责安全地展示当前状态，不再维护一套不可靠的文件归因系统。
