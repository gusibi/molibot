# Findings

## 2026-02-28

- 示例 `example/pi-mono/packages/mom/src/agent.ts` 的 `buildSystemPrompt()` 将稳定的系统规则、环境说明、技能协议、事件协议直接定义在代码中，再按运行时数据动态插值。
- 当前 `src/lib/server/mom/runner.ts` 将整份默认 system prompt 存在 `src/lib/server/mom/prompts/AGENTS.default.md`，并在没有工作区 `AGENTS.md` 时把它直接当成 system prompt。
- `docs/prompt_desc.md` 明确区分了职责：system prompt 是代码动态构建且 OpenClaw/运行时所有；`AGENTS.md` 是用户可编辑、每次注入的操作指令文件，不等于 system prompt。
- 当前实现存在职责混叠：`AGENTS.default.md` 名称上像 bootstrap 文件，内容上却是运行时系统规则，容易让工作区 `AGENTS.md` 与默认 system prompt 的边界失真。
- `/Users/gusi/.molibot/TOOLS.md`、`/Users/gusi/.molibot/IDENTITY.md`、`/Users/gusi/.molibot/BOOTSTRAP.md` 是空文件；现有逻辑将“空文件”和“未定义文件”都视为缺失，缺少显式的 profile 状态。
- `/Users/gusi/.molibot/AGENTS.md` 当前承载了大量本应由代码维护的运行时规则（环境、技能、事件、memory、工具列表等），这与 `docs/prompt_desc.md` 中 AGENTS.md 的定位不一致。
- 2026-02-28 的提醒失败不是 event watcher 故障，而是活跃模型 `讯飞 / xopkimik25` 在该次请求里没有触发任何工具调用，只输出了普通文本承诺。
- `write.ts`、`bash.ts`、`memory.ts` 本身都保留了 reminder/event 的正确约束；缺口在于“明确相对提醒请求”仍然依赖模型主动调工具，没有服务端硬兜底。
- `package/mory` 原状态更像“接口边界包”：声明了 `SqliteStorageAdapter` / `PgvectorStorageAdapter`，但没有包内 SQLite driver，也没有包内 PostgreSQL driver，不符合独立 SDK 的交付预期。
- 对独立 SDK 来说，SQLite 直接基于 Node 内置 `node:sqlite` 最合适；这样无需 native addon，也不依赖宿主额外注入 driver。
- `pgvector` 在 Node 侧不需要额外专用客户端库就能成立；通过 `pg` driver + SQL 模板即可构成 SDK 自带的 PostgreSQL 接入层。
- 原 SQLite schema 没有 `embedding` 列，导致 SQLite 适配器无法真正保存 embedding，也无法在不接 pgvector 时完成本地 cosine rerank。
