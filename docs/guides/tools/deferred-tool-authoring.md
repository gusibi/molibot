# Deferred Tool 接入指南

本文说明如何在 Molibot 中实现一个类似 `imageGenerate` 的内置 deferred tool。

Deferred tool 默认只向模型暴露名称，不持续占用完整 JSON Schema 的上下文；模型确认需要后，通过 `toolSearch` 加载完整 Schema，再调用真实工具。

## 1. 先判断是否应该使用 Deferred Tool

适合 deferred：

- 功能专用、参数较多，但不是每轮对话都会使用。
- 希望由 Agent 统一调用，所有 Channel 共享。
- 需要避免完整工具说明和参数 Schema 长期占用模型上下文。

不适合 deferred：

- 几乎每轮都会调用的基础工具。
- 必须在模型第一次响应中立即可调用，且不能接受先调用一次 `toolSearch`。
- 只属于某个 Channel 的消息收发或平台适配能力。

Deferred tool 必须放在共享 Agent 层。Channel 层只负责消息收发、平台适配，以及原始消息和统一消息结构之间的转换。

## 2. 运行链路

```text
用户表达需求
  -> 系统提示词进行语义意图判断
  -> Agent 调用 toolSearch({ query: "select:toolName" })
  -> toolSearch 从 deferred registry 找到工具并加载完整 Schema
  -> onLocalToolsChanged 更新当前 Agent 可调用工具
  -> Agent 调用真实 toolName(params)
  -> 工具执行并返回标准结果
```

关键代码：

- `src/lib/server/agent/tools/index.ts`：创建真实工具实例、注册 deferred entry、加载工具。
- `src/lib/server/agent/tools/toolSearch.ts`：发现 deferred tool 并注入完整 Schema。
- `src/lib/server/agent/prompts/prompt.ts`：向模型列出 deferred tool，并定义高价值工具的语义路由。

## 3. 最小必需实现

### 3.1 创建真实工具工厂

建议将每个复杂工具放在独立目录：

```text
src/lib/server/agent/exampleTool/
  exampleTool.ts
  exampleTool.test.ts
  types.ts          # 可选
  providers.ts      # 多 provider 工具可选
```

真实工具使用 `AgentTool` 和 TypeBox Schema：

```ts
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const exampleSchema = Type.Object({
  input: Type.String({
    description: "The input to process."
  })
});

export function createExampleTool(): AgentTool<typeof exampleSchema> {
  return {
    name: "exampleTool",
    label: "exampleTool",
    description: [
      "What this tool does.",
      "When it should be used.",
      "Important constraints and output behavior."
    ].join("\n"),
    parameters: exampleSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error("Aborted");

      return {
        content: [{ type: "text", text: `Processed: ${params.input}` }],
        details: { input: params.input }
      };
    }
  };
}
```

要求：

- `name`、`label`、注册名保持一致，使用稳定的 camelCase 名称。
- Schema 描述应足以让模型正确填写参数。
- 详细使用规则写进真实工具的 `description`，因为它只会在加载后进入上下文。
- 执行时尊重 `AbortSignal`，特别是网络请求、轮询和长任务。
- 返回 `content` 供模型阅读，返回 `details` 供运行时和 UI 排障。
- 不要在工具实现中加入 Channel 特定逻辑。

### 3.2 在 `createMomTools()` 中创建运行时实例

在 `src/lib/server/agent/tools/index.ts` 导入并创建工具：

```ts
import { createExampleTool } from "$lib/server/agent/exampleTool/exampleTool.js";

const exampleRuntimeTool = wrapSerializedTool(createExampleTool({
  // 只传真实需要的共享依赖
}));
```

通常应使用 `wrapSerializedTool`，让工具遵守项目已有的执行序列策略。

### 3.3 注册 Deferred Entry

将工具加入 `deferredEntries`：

```ts
createDeferredToolEntry({
  name: "exampleTool",
  description: "Short description used during deferred-tool discovery.",
  keywords: ["example", "process", "transform"],
  tool: exampleRuntimeTool,
  loadDeferredTools
})
```

字段职责：

- `name`：稳定工具名，也是 `select:exampleTool` 的目标。
- `description`：未加载完整 Schema 前用于发现的简短说明。
- `keywords`：为模糊英文搜索提供少量发现提示，不是意图识别词库。
- `tool`：真实工具实例。
- `loadDeferredTools`：使用 `createMomTools()` 内现有加载函数。
- `exposeStub`：默认 `true`。只有明确需要禁止轻量 stub 顶层暴露时才设为 `false`。

不要为中文、日语、西班牙语等逐一堆积关键词。用户的跨语言表达应由模型做语义意图判断；当工具名已知时，提示词应引导模型直接调用：

```text
toolSearch({ query: "select:exampleTool" })
```

### 3.4 将名称加入 Prompt 的 Deferred Tool 列表

在 `src/lib/server/agent/prompts/prompt.ts` 的 `buildAvailableDeferredToolsSection()` 中加入名称：

```ts
function buildAvailableDeferredToolsSection(): string {
  return xmlBlock("available-deferred-tools", [
    // ...
    "exampleTool"
  ].join("\n"));
}
```

这里的名称必须和 `deferredEntries` 注册名一致。否则会出现两类故障：

- Prompt 声称工具可用，但 `toolSearch` 找不到。
- Runtime 已注册工具，但模型不知道它存在。

### 3.5 为明确意图添加语义路由

如果某类需求应该优先使用该工具，应在 `prompt.ts` 的工具选择规则中加入简短、语义化的路由说明：

```text
For requests that clearly require <capability>, infer the intent semantically,
call toolSearch with select:exampleTool, then call exampleTool.
```

路由规则应说明：

- 哪类用户意图应触发工具。
- 应直接使用 `select:exampleTool`，而不是先翻译并搜索关键词。
- 哪些通用 fallback 不应抢先执行，例如 bash、skill 或浏览器。
- 工具不可用或执行失败时，才允许使用什么 fallback。

不要把完整参数 Schema 或大段工具手册复制进系统提示词。

## 4. 可选扩展

### 4.1 配置型工具

工具需要 API key、开关、默认 provider 等配置时，需要贯通：

- `src/lib/server/settings/schema.ts`：运行时类型。
- `src/lib/server/settings/defaults.ts`：默认值和环境变量映射。
- `src/lib/server/settings/sanitize.ts`：更新配置时的清洗和兼容。
- `src/lib/server/settings/store.ts`：从持久化配置加载、清洗和保存。

当前项目的 settings 加载和更新路径各有 sanitizer。新增配置字段时必须同时验证两条路径：

1. 旧 `settings.json` 启动后能补齐默认值。
2. 设置页保存后再读取，值不会丢失或被错误覆盖。

工具执行时通过 `getSettings()` 获取最新配置，不要只使用工具创建时捕获的旧配置。

### 4.2 设置页和测试 API

需要用户管理配置时，可增加：

- `src/routes/settings/<tool>/+page.svelte`
- `src/routes/api/settings/<tool>/test/+server.ts`
- `src/routes/settings/+layout.svelte` 中的导航入口

测试 API 应尽量复用真实工具工厂和 settings sanitizer，避免生产执行与测试执行产生两套逻辑。测试生成的文件必须写入 Molibot 数据目录或受控 scratch 目录，不能写入仓库根目录。

### 4.3 多 Provider 工具

建议分层：

```text
tool.ts       -> 参数校验、provider 选择、fallback、结果标准化
providers.ts  -> 第三方 API 请求和响应映射
types.ts      -> provider 输入、输出和配置类型
```

provider 层不负责 Agent 路由、Channel 上传或设置页逻辑。

### 4.4 文件输出和聊天回传

生成文件的工具应：

- 使用 `resolveToolPath` 和 `createPathGuard` 校验输出路径。
- 默认写入 runtime 提供的 dated scratch artifact 目录。
- 需要回传聊天时，通过共享的 `uploadFile` 能力完成。
- 不直接导入 Telegram、Feishu、Weixin 等 Channel 实现。

### 4.5 风险和审批分类

默认 deferred tool 会进入共享 `ToolRuntime`。如果工具有写入、网络、主机或高风险行为，检查：

- `src/lib/server/agent/tools/toolClassification.ts`
- `src/lib/server/agent/tools/toolRuntime.ts`
- 相关 approval policy

只有确实需要时才提高风险等级；不要为了 deferred 注册本身增加审批。

## 5. 必需测试

至少覆盖以下三层。

### 5.1 真实工具行为测试

在工具目录测试：

- 正常执行和标准结果。
- 必填参数校验。
- 配置禁用或缺失时的错误。
- provider 选择、fallback、错误映射。
- 文件路径、上传或其他工具特有行为。
- AbortSignal 中止行为，适用于长任务。

第三方 API 应 mock，不在单元测试中消耗真实配额。

### 5.2 Deferred 注册测试

在 `src/lib/server/agent/tools/index.test.ts` 验证：

- 工具工厂已接入。
- deferred entry 名称和真实工具实例一致。
- discovery keywords 简洁且只承担发现职责。
- stub 暴露策略符合预期。

### 5.3 ToolSearch 和 Prompt 路由测试

在 `src/lib/server/agent/tools/toolSearch.test.ts` 验证 `select:exampleTool` 能够加载工具并返回完整 Schema。

在 `src/lib/server/agent/prompts/prompt.test.ts` 验证：

- `available-deferred-tools` 包含工具名。
- 明确意图会优先走 `toolSearch select:exampleTool`。
- 不会被不应优先的 skill、bash 或其他 fallback 抢走。

## 6. 验收清单

- [ ] 工具位于共享 Agent 层，不包含 Channel 特定逻辑。
- [ ] 工具具有稳定名称、TypeBox Schema、清晰 description 和标准返回值。
- [ ] 工具尊重 AbortSignal，并正确处理外部请求失败。
- [ ] `createMomTools()` 创建了真实运行时工具实例。
- [ ] `deferredEntries` 注册了同名工具。
- [ ] Prompt 的 `available-deferred-tools` 包含同名工具。
- [ ] 明确意图使用语义路由和 `select:<toolName>`，没有堆积多语言关键词。
- [ ] 工具单元测试通过。
- [ ] `toolSearch select:<toolName>` 加载测试通过。
- [ ] Prompt 路由测试通过。
- [ ] 配置型工具已验证 defaults、sanitize、store、旧配置兼容和保存回读。
- [ ] 文件输出使用受控路径，并按需通过共享能力回传。
- [ ] 风险分类和审批行为符合工具实际能力。
- [ ] `npm run build` 通过。

## 7. 常见故障

### `toolSearch` 找不到工具

检查 deferred entry、注册名和 `select:<toolName>` 是否一致，确认不是只更新了 Prompt 列表。

### 模型知道工具名但不调用

检查 Prompt 是否包含工具名和语义路由。不要依赖 keywords 识别跨语言意图；工具名已知时直接使用 `select:<toolName>`。同时检查 skill、bash 或其他 fallback 是否抢先。

### 工具加载后参数调用失败

检查真实工具的 TypeBox Schema、字段描述和必填/可选定义。Deferred entry 的简短 description 不能替代真实工具 Schema。

### 设置已保存但运行时仍提示未配置

检查 `schema.ts`、`defaults.ts`、`sanitize.ts`、`store.ts` 是否全部接入，工具执行时是否重新调用 `getSettings()`，旧配置是否被正确兼容，以及开发服务器中的 runtime 单例是否需要重启。

### 工具执行成功但用户看不到文件

检查文件是否写入允许路径、是否通过共享 `uploadFile` 能力回传、工具是否返回可排障的 `details.path`。不要在工具中直接调用某个 Channel。
