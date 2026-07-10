# Project 级技能加载（`<projectRoot>/.agents/skills/`）

> 日期：2026-07-10
> 来源：从 `memory-improvement-plan.md` v2 拆出（原 T9）。平台任务，与记忆主线无代码耦合，可独立派发。

## 任务 [P1]

**现状问题**：技能加载只有三层根目录（`src/lib/server/agent/skills/skills.ts:266`）——bot（`<workspaceDir>/skills`）、global（`<dataRoot>/skills`）、chat（`<workspaceDir>/<chatId>/skills`）——没有 project 层。Project 会话在 `runner.ts:816` 只用 `store.getWorkspaceDir()` 加载技能，项目目录里的技能完全不可见。而 project 恰恰是最需要专属技能的场景（构建命令、部署流程、项目特有的数据处理），bot 和 chat 都有自己的技能目录，唯独 project 没有，层级不一致。

**为什么要改**：owner 计划把魔魔人设落地、配图管线等功能以 Project 形式承载在独立代码目录里，项目级技能是这些 Project 的工具载体。同时这与 Claude Code 的项目级技能惯例（`.claude/skills`）一致。

**改进目标**：

1. **目录约定**：Project 会话额外加载 `<projectRoot>/.agents/skills/`，scope 标记为 `"project"`。只认这一个路径，不做多路径兼容。
2. **优先级**：现有去重是先到先得（`skills.ts:311`，同名后来者被忽略，root 顺序即优先级），project 根插入到**最前**：`project > bot > global > chat`，同名时项目技能覆盖工作区/全局技能，duplicate 照常写入 diagnostics。
3. **信任模型（owner 已决策，实现时不要加码）**：**不做信任开关、不做注入扫描门禁**——项目目录下有技能就加载，项目内容由用户自行控制。`disabledSkillPaths` 继续作为逐个禁用的手段。
4. **穿透调用点**：`loadSkillsFromWorkspace` 增加可选 projectRoot 参数（或改为 roots 数组），需要穿透：
   - `agent/core/runner.ts:816`（运行时技能清单与显式调用匹配）；
   - `agent/prompts/prompt.ts:754`（系统提示词技能列表，**其缓存 key `${workspaceDir}::${chatId}::…` 必须加入 projectRoot**，否则同一 bot 在不同项目间会串技能）；
   - `agent/tools/skillSearch.ts:253`（skillSearch 工具需要感知项目上下文）；
   - `agent/commands/channelCommands.ts`（技能列表命令，项目会话中应显示 project scope）。
5. **写入边界不变**：技能保存 / skill-drafter 的产物仍写入 workspace，不在项目目录创建运行时文件；仅当用户显式要求「把这个技能存到项目里」时才写 `<projectRoot>/.agents/skills/`。

**验收标准**：

- 注册的 Project 下存在 `.agents/skills/foo/SKILL.md` 时，该项目会话的技能清单包含 `foo`（skillSearch 可命中、`/skill` 类命令可见、system prompt 技能列表包含），同一 bot 的非项目会话不包含。
- 项目技能与 workspace 技能同名时，项目版本生效，diagnostics 记录被忽略的一方。
- 同一 bot 先后进入项目 A、项目 B 的会话，各自拿到自己的项目技能列表（验证 prompt 缓存 key 隔离）。
- 删除项目技能目录后会话正常回退到 bot/global/chat 三层。

**依赖**：无。
