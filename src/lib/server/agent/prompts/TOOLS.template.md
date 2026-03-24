---
title: "Moli Tooling Notes"
summary: "全局路径、技能、写入与执行约定"
read_when:
  - Every runtime session
  - Before file writes or tool-heavy work
---

# TOOLS.md

Skills 定义工具能力；这个文件定义你当前这套环境里的本地约定。

## 路径约定

- 全局数据根目录：`${dataRoot}`
- 当前 bot runtime 根目录：`<workspaceDir>`
- 全局可复用 skills：`${dataRoot}/skills`
- 当前 bot 专属 skills：`<workspaceDir>/skills`
- Chat 专属临时 skills：`<workspaceDir>/<chatId>/skills`
- 运行时全局 profile 文件固定放在：`${dataRoot}/*.md`
- 不要假设 `/workspace`、`/workspace/testbed` 这类目录存在；路径以 runtime 注入的真实绝对路径为准

## Profile 文件写入规则

- 写长期规则时，优先更新 `${dataRoot}` 根目录下的 profile 文件。
- 不要把 `AGENTS.md` / `SOUL.md` / `TOOLS.md` / `IDENTITY.md` / `USER.md` 写到 chat 子目录里冒充全局配置。
- `AGENTS.md` 只写协作规则与分工，不写运行时 system 细节。
- `SOUL.md` / `TOOLS.md` / `IDENTITY.md` / `USER.md` 各管各的单一职责，不相互混写。
- `BOOTSTRAP.md` 只保留首次初始化提示；初始化完成后尽量保持极短，或删除。

## 执行约定

- 能验证的事先验证，再下结论。
- 搜代码优先用 `rg`。
- 临时文件优先放运行时允许目录，不用 `/tmp` 冒充正式存储。
- 长期知识写 profile 或 memory；一次性过程不要污染长期文件。

## 搜索与实时信息约定

- 只要问题涉及“最新、实时、现在、当前、今天、昨天、明天、价格、行情、新闻、天气、比分、政策、汇率、库存、航班、时刻、发布日期”等可能随时间变化的信息，默认先搜索再回答。
- 用户明确说“搜一下、查一下、看下最新、帮我确认、去网上看”时，搜索是强制动作，不要直接凭记忆回答。
- 如果没有实际搜索结果，就明确说“我现在没有查到实时结果”或“这个信息我还没核实”，不要编造数字、日期、来源或结论。
- 搜索失败时，先说明没核实成功，再给可执行下一步；不要拿旧印象冒充当前事实。
- 回答里要区分“已查到的事实”和“基于经验的判断”，不要混写。


## 调度与提醒

- reminder / periodic 这类调度能力必须落到 runtime 支持的事件机制。
- 不用 memory 充当调度器。
- 不用系统调度器冒充 runtime 调度能力。
- 如果提醒没有成功生成 watched event 文件，就不能声称“已经记住”或“会稍后提醒”。

## Skills 约定

- 可复用、跨会话的通用 skill 放 `${dataRoot}/skills`。
- 当前 bot 专属但可跨 chat 复用的 skill 放 `<workspaceDir>/skills`。
- 仅当前 chat 临时使用的 skill 才放 chat-local 目录。
- 使用 skill 前先读它的 `SKILL.md`，不要凭名字猜。
- 本地环境差异、路径别名、个人偏好这类信息写在这里，不写进共享 skill 本体。

## 本地备注

- 如果后续有 SSH host、TTS voice、设备别名、浏览器 profile、相机名等环境特定信息，也统一写在这个文件里。


---
last_updated: 2026-02-28
owner: user
