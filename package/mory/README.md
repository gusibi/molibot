# @molibot/mory

`mory` 是一个面向 Agent 的记忆核心 SDK（当前是纯逻辑层，不绑定具体数据库驱动，不自动接入业务系统）。

## 功能清单（完成 / TODO）

### 已完成

- [完成] `mory://` 路径规范与类型注册（`MemoryType`、路径白名单、默认冲突策略）
- [完成] 路径归一化（别名纠偏、动态路径标准化、canonical 校验）
- [完成] 写入门控（`insert/update/skip`，相似度去重、策略化更新）
- [完成] 写入评分门控（`importance/novelty/utility/confidence`，weighted/product 两种模式）
- [完成] 冲突解析与版本推进逻辑（矛盾检测、`supersedes/version/conflictFlag` 决策结果）
- [完成] 检索路由规划（query -> intent -> memoryTypes/pathPrefixes/topK）
- [完成] 语义压缩（episodic -> semantic 规则提炼）
- [完成] 任务态工作记忆辅助（session-scoped task path、TTL 判断）
- [完成] SQLite / pgvector SQL 模板（schema、upsert、vector search 模板）
- [完成] 集成参考实现（`moryIntegration.ts`，用于指导接入现有 memory core）
- [完成] 独立 npm 包结构（`src/` + `test/` + `build/test/smoke`）
- [完成] 单元测试（当前 19 项通过）

### TODO

- [TODO] `moryEngine` 编排层（统一 `ingest/retrieve/commit/readByPath`）
- [TODO] `read_memory(path)` 可执行 API（当前仅在集成参考说明中出现）
- [TODO] 异步 commit 流水线（对话后提取 -> 评分 -> 冲突解析 -> 持久化）
- [TODO] 存储适配器实现（SQLite/pgvector 真正执行器，而不只是 SQL 模板）
- [TODO] 版本化持久化 schema 对齐（把 `version/supersedes/conflictFlag` 落库）
- [TODO] 检索执行器（planner + 向量召回 + 精排 + L0/L1/L2 注入）
- [TODO] 遗忘/归档引擎（时间衰减、访问频率、容量控制）
- [TODO] 提取结果校验器（LLM 输出 JSON -> `CanonicalMemory` 严格校验）
- [TODO] 可观测性指标模块（命中率、重复率、冲突率、token 成本）
- [TODO] 组合级 E2E 测试（覆盖完整记忆闭环）

## 安装

```bash
npm install @molibot/mory
```

## 快速示例

```ts
import {
  normalizeMoryPath,
  defaultPolicyFor,
  decideWrite,
  scoreWriteCandidate,
  type CanonicalMemory,
  type StoredMemoryNode,
} from "@molibot/mory";

const canonicalPath = normalizeMoryPath("/profile/preferences/language");

const incoming: CanonicalMemory = {
  path: canonicalPath,
  type: "user_preference",
  subject: "language",
  value: "用户更喜欢中文回答",
  confidence: 0.9,
  updatedPolicy: defaultPolicyFor(canonicalPath),
};

const existing: StoredMemoryNode[] = await loadByPath(userId, canonicalPath);
const gate = scoreWriteCandidate(existing, incoming);
if (!gate.shouldWrite) return;

const decision = decideWrite(existing, incoming);
if (decision.action === "insert") await insertNode(userId, incoming);
if (decision.action === "update") await updateNode(decision.target.id, decision.patch);
```

## SQL 模板（SQLite / pgvector）

```ts
import {
  SQLITE_SCHEMA_SQL,
  SQLITE_UPSERT_SQL,
  pgvectorSchemaSql,
  PGVECTOR_UPSERT_SQL,
  PGVECTOR_SEARCH_SQL,
} from "@molibot/mory";
```

- `SQLITE_SCHEMA_SQL`: `memory_nodes` 表 + 索引
- `SQLITE_UPSERT_SQL`: `(user_id, path)` 维度 upsert
- `pgvectorSchemaSql(dim)`: Postgres + `vector(dim)` schema
- `PGVECTOR_UPSERT_SQL`: pgvector upsert 模板
- `PGVECTOR_SEARCH_SQL`: 向量检索 + type/pathPrefix 过滤模板

## 脚本

```bash
npm run build
npm run test
npm run smoke
```
