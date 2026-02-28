# @molibot/mory

`mory` 是一个可独立使用的 Agent memory SDK。

它解决的是这类问题：
- 把对话或结构化信息写成稳定的 memory 记录
- 避免重复写入、低价值写入、冲突写入
- 支持按路径读取、按问题检索、按版本归档
- 支持 SQLite 本地落库
- 支持 PostgreSQL + pgvector 做向量检索

这个包不是“只有类型和接口”的内部模块。它本身就可以被外部项目直接安装和运行。

## 适合什么场景

- 你要给 Agent / Chatbot / Copilot 加长期记忆
- 你希望 memory 路径是稳定、可审计、可版本化的
- 你希望先用 SQLite 起步，后续再切到 PostgreSQL + pgvector
- 你希望宿主应用只负责业务编排，不自己重写 memory core

## 包内自带什么

- SQLite driver：基于 Node 内置 `node:sqlite`
- PostgreSQL driver：基于 `pg`
- SQLite schema / upsert
- pgvector schema / upsert / search SQL
- 内存版 adapter：用于测试或纯内存运行
- `MoryEngine`：统一编排入口

## 宿主仍需提供什么

- `userId`
- 你的业务输入来源
- 如果要做语义检索：`embedder(text) => number[]`
- 如果用 pgvector：数据库本身，以及启用 `CREATE EXTENSION vector`

## 安装

要求：
- Node `>=22`

安装：

```bash
npm install @molibot/mory
```

如果你要用 PostgreSQL / pgvector，还需要准备数据库，不需要再单独安装 `pg`，包内已经声明依赖。

## 先理解 3 个入口

大多数项目只会用这 3 个入口：

1. `engine.ingest()`
用途：你已经有结构化 memory，直接写入

2. `engine.commit()`
用途：你只有对话文本，让 `extractor` 先提取，再写入

3. `engine.retrieve()`
用途：用户问问题时，从 memory 里检索相关记录，生成 prompt context

## 最小可运行示例：SQLite

这是最推荐的起步方式。

```ts
import { MoryEngine, createSqliteStorageAdapter } from "@molibot/mory";

const storage = createSqliteStorageAdapter("./mory.db");

const engine = new MoryEngine({
  storage,
});

await engine.init();

await engine.ingest({
  userId: "u1",
  memory: {
    path: "mory://user_preference/language",
    type: "user_preference",
    subject: "language",
    value: "用户更喜欢中文回答",
    confidence: 0.92,
    updatedPolicy: "overwrite",
  },
});

const rows = await engine.readByPath("u1", "mory://user_preference/language");
console.log(rows);
```

这段代码会：
- 自动初始化 SQLite schema
- 把一条 memory 写入 `./mory.db`
- 再按路径读回来

## 推荐使用方式

### 1. 你已经有结构化 memory：用 `ingest`

```ts
await engine.ingest({
  userId: "u1",
  memory: {
    path: "mory://user_fact/name",
    type: "user_fact",
    subject: "name",
    value: "用户叫 Voldemomo",
    confidence: 0.95,
    updatedPolicy: "overwrite",
    title: "用户名",
  },
});
```

适合：
- 用户资料
- 偏好
- 明确规则
- 明确任务状态

### 2. 你只有对话：用 `commit`

你给 `MoryEngine` 一个 `extractor`，它会先抽取 memory，再走完整写入链路。

```ts
import { MoryEngine, createSqliteStorageAdapter } from "@molibot/mory";

const storage = createSqliteStorageAdapter("./mory.db");

const engine = new MoryEngine({
  storage,
  extractor: async (dialogue: string) => {
    return {
      memories: [
        {
          path: "mory://user_preference/language",
          type: "user_preference",
          subject: "language",
          value: "用户更喜欢中文回答",
          confidence: 0.9,
          updatedPolicy: "overwrite",
        },
      ],
    };
  },
});

await engine.init();

const result = await engine.commit({
  userId: "u1",
  dialogue: "以后请尽量用中文回答我。",
  source: "chat-session-1",
});

console.log(result);
```

`commit()` 的链路是：

`dialogue -> extractor -> validation -> scoring -> conflict resolution -> versioned persistence`

### 3. 用户提问时检索 memory：用 `retrieve`

```ts
const result = await engine.retrieve("u1", "我喜欢什么语言回答？", {
  topK: 5,
});

console.log(result.hits);
console.log(result.promptContext);
```

返回值里最常用的是：
- `hits`: 命中的 memory
- `promptContext`: 已经整理好的 L0/L1/L2 文本，可直接注入上层 prompt

## 如果你要语义检索：加 `embedder`

如果不传 `embedder`，`mory` 仍然能工作，但只会做非向量链路。

如果你要用：
- SQLite 本地 embedding 持久化 + 本地 cosine rerank
- PostgreSQL + pgvector 真正向量检索

就传一个 `embedder`：

```ts
const engine = new MoryEngine({
  storage,
  embedder: async (text: string) => {
    const vector = await yourEmbeddingFunction(text);
    return vector;
  },
});
```

## PostgreSQL / pgvector 用法

适合：
- 记录量更大
- 需要更稳定的向量检索
- 多实例共享 memory 库

```ts
import { MoryEngine, createPgvectorStorageAdapter } from "@molibot/mory";

const storage = createPgvectorStorageAdapter(process.env.DATABASE_URL!, 1536);

const engine = new MoryEngine({
  storage,
  embedder: async (text: string) => {
    return await yourEmbeddingFunction(text);
  },
});

await engine.init();
```

说明：
- 第一次 `init()` 会执行 schema SQL
- 你的数据库需要支持 `pgvector`
- `1536` 是 embedding 维度，必须和你的 embedding 模型输出维度一致

## SQLite 和 pgvector 应该怎么选

先用 SQLite：
- 单机
- 本地开发
- 小规模项目
- 你想先把链路跑通

再切 pgvector：
- 数据量明显增大
- 你需要跨实例共享
- 你更依赖语义检索质量

## `MoryEngine` 提供的方法

### `await engine.init()`

初始化底层存储。

### `await engine.ingest({ userId, memory, source?, observedAt? })`

写入单条结构化 memory。

### `await engine.commit({ userId, dialogue?, extracted?, source?, observedAt? })`

从对话或已抽取结果批量写入。

### `await engine.readByPath(userId, rawPath)`

按路径读取记录。`rawPath` 可以是标准 `mory://...`，也可以是别名路径，内部会规范化。

### `await engine.retrieve(userId, query, options?)`

按 query 检索并返回 prompt context。

### `engine.getMetrics()`

返回当前 engine 的指标统计。

## `read_memory(path)` 风格工具

如果你的上层是 Agent / Tool runtime，可以直接暴露这个 helper：

```ts
import { createReadMemoryTool } from "@molibot/mory";

const readMemory = createReadMemoryTool(engine, "u1");
const result = await readMemory("/profile/preferences/language");
console.log(result);
```

## 独立 SDK 的典型集成方式

### 模式 A：Web / API 服务

- 请求进来
- 先 `retrieve()`
- 把 `promptContext` 注入模型
- 模型回复后再 `commit()`

### 模式 B：本地 Agent

- Agent 在运行时调用 `readByPath()` / `retrieve()`
- 关键事实确认后调用 `ingest()`

### 模式 C：批处理整理

- 从聊天日志、工单、文档中离线抽取
- 调用 `commit()` 批量入库

## SQLite 示例：完整闭环

```ts
import { MoryEngine, createSqliteStorageAdapter } from "@molibot/mory";

const engine = new MoryEngine({
  storage: createSqliteStorageAdapter("./mory.db"),
  extractor: async (dialogue) => ({
    memories: dialogue.includes("中文")
      ? [
          {
            path: "mory://user_preference/language",
            type: "user_preference",
            subject: "language",
            value: "用户更喜欢中文回答",
            confidence: 0.9,
            updatedPolicy: "overwrite",
          },
        ]
      : [],
  }),
});

await engine.init();

await engine.commit({
  userId: "u1",
  dialogue: "以后用中文回答我。",
});

const retrieval = await engine.retrieve("u1", "我喜欢什么语言？", {
  topK: 5,
});

console.log(retrieval.promptContext);
```

## 导出的底层能力

除了 `MoryEngine`，你还可以单独用这些模块：

- 路径规范化：`normalizeMoryPath`
- 写入门控：`decideWrite`
- 评分门控：`scoreWriteCandidate`
- 冲突处理：`resolveMemoryConflict`
- 检索规划：`buildRetrievalPlan`
- 遗忘策略：`planForgetting` / `applyForgettingPolicy`
- SQL 模板：
  - `SQLITE_SCHEMA_SQL`
  - `SQLITE_UPSERT_SQL`
  - `pgvectorSchemaSql(dim)`
  - `PGVECTOR_UPSERT_SQL`
  - `PGVECTOR_SEARCH_SQL`

## 当前交付边界

`mory` 当前已经内置：
- SQLite 持久化 driver
- PostgreSQL query driver
- pgvector schema / upsert / search SQL
- 本地内存适配器
- engine 编排层

`mory` 当前仍然由宿主提供：
- embedding 函数
- PostgreSQL 数据库实例本身
- 你的业务抽取逻辑或 LLM extractor
- HTTP API / Agent runtime / 任务系统等上层编排

## 功能状态

### 已完成

- [完成] `mory://` 路径规范与类型注册
- [完成] 路径归一化
- [完成] 写入门控
- [完成] 写入评分门控
- [完成] 冲突解析与版本推进逻辑
- [完成] 检索路由规划
- [完成] 语义压缩
- [完成] 任务态工作记忆辅助
- [完成] SQLite / pgvector SQL 模板
- [完成] `moryEngine`
- [完成] `read_memory(path)` 工具接口
- [完成] 异步 commit 流水线
- [完成] `InMemoryStorageAdapter`
- [完成] `SqliteStorageAdapter`
- [完成] `PgvectorStorageAdapter`
- [完成] `NodeSqliteDriver`
- [完成] `NodePgDriver`
- [完成] `createSqliteStorageAdapter`
- [完成] `createPgvectorStorageAdapter`
- [完成] 遗忘 / 归档引擎
- [完成] 校验器
- [完成] 指标统计
- [完成] 组合级 E2E 测试

## 开发命令

```bash
npm run build
npm run test
npm run smoke
```
