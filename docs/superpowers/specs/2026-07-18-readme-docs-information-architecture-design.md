# README 与文档体系重构设计

## 目标

让 README 回到项目入口的职责：用最短路径说明 Molibot 的定位、真实能力、启动方式和文档入口。

Molibot 对外定位为记忆优先、可长期成长的个人 AI Agent。它不是用功能数量与通用 Agent 竞争，而是帮助用户在自己设备上长期积累可控的偏好、项目上下文与工作记忆。魔魔（Momo）是这套体验的示范角色：一个会记住、复盘、成长并表达的个人 Agent。

本次重构同时解决文档职责混杂的问题：功能介绍集中到 `docs/features/`，开发期间的计划、交接、进度和审计材料迁移到 `docs/work/`。

## 非目标

- 不宣称尚未完成的群聊协作、自动社交发布或成长日志功能已经可用。
- 不修改运行时代码或产品行为。
- 不删除历史文档；只移动并更新引用。
- 不将魔魔设定成使用 Molibot 的前置条件。用户仍可以创建自己的 Agent。

## README 设计

README 控制为产品入口，不再承担完整功能记录、开发手册、运维手册或发布历史的职责。

### 新结构

1. **定位与价值主张**
   - 标题：`Molibot`。
   - 主张：记忆优先、可长期成长的个人 AI Agent。
   - 简述：在自己的设备上运行，保留对话、偏好、项目和工作方式的连续上下文。

2. **为什么不是另一个聊天窗口**
   - 解释长期记忆、可配置 Agent、可控任务执行、本地数据与审批边界。
   - 不与 OpenClaw、Hermes 或其他产品作贬低式比较。

3. **当前可用能力**
   - 只列出五项高层能力，并链接到 `docs/features/`：
     - 个人 Agent 与记忆
     - 渠道与界面
     - 工具、Skills 与 MCP
     - 自动化、审批与执行控制
     - Desktop 项目工作区
   - 每项只写用户价值和入口，不罗列实现细节、历史修复或版本记录。

4. **魔魔成长计划**
   - 将魔魔描述为 Molibot 的示范角色：持续理解用户、沉淀记忆、形成成长叙事。
   - 区分现状和计划：当前已有记忆、工具、任务、审批与多入口；每日对话复盘、成长日志和内容候选属于正在建设的成长计划。
   - 链接到路线图或市场/角色文档，避免在 README 中写完整 IP 设定。

5. **快速启动**
   - 保留最短安装、初始化、运行命令。
   - 将 Provider、渠道、部署、环境变量等高级配置链接到 guides 和 `.env.example`。

6. **渠道与界面**
   - 使用紧凑表格列出 Web、macOS Desktop、Telegram、Feishu、Weixin、QQ、CLI。
   - 只说明入口和用途，不使用易过期的成熟度星级。

7. **文档导航**
   - 指向功能介绍、使用指南、开发与架构、部署、更新日志和贡献规则。

8. **当前边界**
   - 单机、本地优先部署。
   - 用户需要自行配置模型服务。
   - 成长日志和内容候选尚在建设，默认不自动对外发布。

### 从 README 移出的内容

- `Key Highlights` 的发布流水与实现细节。
- 完整 Telegram 命令表。
- 完整 Settings 页面和环境变量表。
- 完整数据目录树、服务守护脚本和远程控制 daemon 说明。
- 细粒度 Desktop 开发状态、内部架构解释和历史成熟度统计。

这些内容将改为链接至功能页、指南、参考资料、`features.md` 或 `CHANGELOG.md`。

## 文档目录设计

```text
docs/
├── features/       # 面向使用者：能力说明、场景、入口、限制
├── guides/         # 使用、配置、部署、扩展指南
├── requirements/   # 规划中需求与验收范围
├── designs/        # 长期有效的架构与技术设计
├── research/       # 市场、竞品和技术研究
├── reviews/        # 可长期参考的技术审查结论
├── work/           # 开发过程材料，不作为稳定文档入口
│   ├── plans/
│   ├── handoffs/
│   ├── progress/
│   ├── audits/
│   └── reviews/
├── archive/        # 历史 changelog、features、prd
├── reference/      # 外部 API、提示词和原始资料
├── images/         # 公共图片资产
├── agent-dev-series/
└── superpowers/    # 保持既有独立结构
```

### `docs/features/` 的首批页面

1. `personal-agent-and-memory.md`
   - 个人 Agent、持久会话、记忆治理、可见性和用户控制。

2. `channels-and-surfaces.md`
   - Web、Desktop、Telegram、Feishu、Weixin、QQ 与 CLI 的入口和边界。

3. `tools-skills-and-mcp.md`
   - 内置工具、Skills、MCP、Profile 以及适用场景。

4. `automation-approvals-and-sandbox.md`
   - 定时任务、审批、执行记录、沙盒和恢复边界。

5. `desktop-project-workspace.md`
   - macOS Desktop 的聊天、项目、文件和设置工作区。

每页均使用相同结构：解决的问题、当前能力、开始使用、限制、关联指南/架构/更新记录。

### 过程文件迁移规则

下列文件属于短期执行材料，迁移至 `docs/work/`：

- `docs/designs/*-plan.md`、`docs/designs/*-completion-plan.md`、`docs/designs/*-deferred.md`、`docs/designs/*-board.md` → `docs/work/plans/`。
- `docs/designs/*-handoff.md` → `docs/work/handoffs/`。
- `docs/designs/desktop-settings-parity-2026-06-29/{findings.md,progress.md,task_plan.md}` → `docs/work/progress/desktop-settings-parity-2026-06-29/`。
- `docs/reviews/macos-web-settings-gap-2026-06-29/{findings.md,progress.md,task_plan.md}` → `docs/work/reviews/macos-web-settings-gap-2026-06-29/`；长期结论 `report.md` 保留在 `docs/reviews/`。
- `docs/audits/` → `docs/work/audits/`。

命名中带有 `plan` 的文件不自动等同于过程文件：如果它定义了仍然有效的产品需求、长期技术方案或验收边界，则继续放在 `requirements/` 或 `designs/`。迁移前逐项检查正文和被引用情况。

## 导航与链接

- `docs/README.md` 更新目录地图、常用入口和归档规则，明确 `work/` 不是稳定产品文档入口。
- 根 README 只链接到 `docs/features/`、`docs/guides/` 和长期架构设计；不再直接链接过程文件。
- 移动文件后，使用仓库搜索更新所有 Markdown 链接和源码内文档链接。
- 保留 Git 跟踪的移动操作，以维持历史可追溯性。

## 验收标准

1. README 能在两分钟内回答：Molibot 是什么、适合谁、现在能做什么、如何开始、到哪里看细节。
2. README 不再包含发布流水、全量命令参考、全量环境变量、内部实现细节或过期统计。
3. 每项用户可见的核心能力都能从 README 到达 `docs/features/` 对应页面。
4. 稳定设计与开发过程材料分离；`docs/work/` 集中一次性计划、交接、进度、审计和执行 review。
5. `docs/README.md` 的目录说明、入口链接和归档规则与实际目录一致。
6. 所有被移动文档的仓库内链接可解析。

## 验证方式

- 检查 README、`docs/README.md` 与首批功能页的链接。
- 使用仓库搜索检查旧路径引用，逐项替换。
- 运行 Markdown 链接检查工具；若仓库没有现成工具，则使用可复现的本地链接扫描脚本。
- 审核 `git diff --summary`，确保过程文件以重命名而非无意删除的方式迁移。
