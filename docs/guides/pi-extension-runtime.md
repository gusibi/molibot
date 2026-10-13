# Pi 扩展的服务器运行接口

适用版本：仓库锁定的 Pi 1.0。扩展在独立子进程中运行；此接口支持服务器执行，不保证任意终端扩展可直接运行。

将扩展放入数据目录的 `extensions/<id>/index.ts`，通过 Pi 的 `registerTool`、`registerCommand` 和事件注册 API 提供入口。工具通过普通 Agent 对话调用；命令通过原会话的 `/命令 参数` 调用。内置命令优先，同一会话忙碌时拒绝新扩展命令。命令会创建原生执行，不需要额外模型请求。

## 调用归属和失败

每次工具、命令或事件调用得到当前运行的快照及 IPC token。快照读取保持同步，只包含当前获准的 Agent Context；下一次调用重新生成。调用结束后 token 失效，迟到响应不能用于后续运行。模型与嵌套工具经过共享权限、审批、预算和原生任务；事件调用身份包含扩展、handler 和原生父调用，恢复时保持稳定；`hasConfiguredAuth` 表示配置了凭据，不表示本次调用获准。

`ctx.signal` 绑定原执行。停止先通知扩展；忽略取消的扩展在 250ms 宽限后被终止。单次调用默认期限为 60s，扩展加载期限为 20s；进程内存上限为 256MiB。IPC 请求和结果上限为 64MiB，单个流事件上限为 256KiB。超过限制返回明确错误；已经产生的用量和媒体制品保留。

模型请求先写原生 intent，原始响应先提交再回传。恢复复用已提交响应；未知收费结果阻止同一执行用新 call ID 重新提交相同操作。并行调用保留各自身份。分类和图片接口没有 Deferred handle；chat 的 Deferred handle 使用原请求继续轮询。JavaScript 内存状态不作为持久化检查点，脚本中断后依照部分结果与剩余工作的现有流程继续。

## ExtensionContext

| 方法或字段 | 语义 | 验证 |
| --- | --- | --- |
| `cwd`, `model`, `thinkingLevel`, `scopedModels` | 同步读取调用时的真实运行配置；无额外模型范围配置时 `scopedModels` 为空 | `runtimeSnapshot.test.ts`, `runtimeContext.test.ts`, `runnerModels.integration.test.ts` |
| `isIdle()`, `hasPendingMessages()` | 同步读取真实 streaming 与排队状态 | `runtimeSnapshot.test.ts`, `runtimeContext.test.ts` |
| `getContextUsage()`, `getSystemPrompt()` | 同步读取实际上下文估算和最终渲染提示词；没有估算时返回未知 | 同上，真实 Runner 请求断言 |
| `signal` | 原执行的 AbortSignal，同时传给工具 `execute` | `executeTool.test.ts` |
| `abort()` | void 控制当前原执行；控制请求失败使该次扩展调用失败 | `executeTool.test.ts` |
| `compact({customInstructions})` | void 发起显式原生压缩；父执行保留控制请求直至结算，使用原预算与用量归属；Plan/只读模式拒绝 | `runnerModels.integration.test.ts` 的 compact 场景，`executeTool.test.ts` |
| `compact` 的 `onComplete/onError` | 明确拒绝：原生压缩的结果通过当前 Session 呈现，不提供终端回调形状 | 子进程命名错误 |
| `shutdown()` | 明确拒绝，扩展不能关闭服务 | `runtimeContext.test.ts` |
| `hasUI` / print mode | `hasUI: false`；`ui.notify` 可向宿主提供提示 | `runtimeContext.test.ts`, command 场景 |
| 终端 UI 方法 | `select/confirm/input`、终端输入、状态栏、工作消息、widget、布局、editor 等明确拒绝，不能将默认 false 当业务审批 | `runtimeContext.test.ts` |
| `tools`, `executeTool(name,args,options)` | 当前允许的工具目录；异步返回 `AgentToolCallOutcome`，未知工具/校验/权限/执行失败返回 `isError`；支持 `options.signal/onUpdate`，原生拥有嵌套任务 | `executeTool.test.ts`, 真实 Runner extension/command 场景 |

## ReadonlySessionManager

以下方法保持同步：`getCwd/getSessionDir/getSessionId/getSessionFile/getSessionName/getHeader/getLeafId/getLeafEntry/getEntry/getLabel/getBranch/getEntries/getTree/buildContextEntries/buildSessionProjection`。

它们读取原生 store 已解析的活跃上下文，不读取其他 Session 或 UI 的完整历史。当前原生日志不提供终端 JSONL 的分支、标签和时间字段：`parentId: null`、`timestamp: ""`、标签为 `undefined`、tree 为平铺记录。记录保留原生 id 和每条贡献的 `messages`；无模型消息的记录为 custom entry。传入其他上下文的 branch id 会报错。快照只读意味着不能改宿主记录；扩展可修改自己的副本。

证据：`sessionSnapshot.test.ts`、`runtimeSnapshot.test.ts`、真实 Runner extension/command 场景。

## ModelRegistry

| 公开方法 | 语义 | 验证 |
| --- | --- | --- |
| `getAll/getAvailable/find/findOfType/getModelsOfType/getModelOfType` | 同步读取当前配置目录，区分 chat/classifier/image | `modelRegistry.test.ts`, `modelCatalog.test.ts` |
| `getAvailableOfType` | 异步返回快照中具有凭据的指定类型模型 | `modelRegistry.test.ts` |
| `hasConfiguredAuth/isUsingOAuth/getProviderDisplayName/getRegisteredProviderIds/getError` | 同步、无凭据的发现；显示名当前为 provider id；成功加载的快照没有 catalog error | `modelCatalog.test.ts`, `modelRegistry.test.ts` |
| `classify/generateImages` | 异步调用共享模型操作，返回 Pi 结果形状和用量；失败返回 error 结果；支持取消 signal | `modelRegistry.test.ts`, `modelOperations.test.ts`, 真实 Runner 场景 |
| `stream/streamSimple` | 同步返回异步可迭代事件流，`result()` 等待终态，无需先消费事件；成功返回最终消息，失败拒绝；支持取消；simple 使用 Pi 的 provider-neutral 接口 | `modelStream.test.ts`, Runner stream/stream_cancel/deferred 场景 |
| `complete` | 异步消费流并返回最终消息 | 同上 |
| `refresh` | 明确拒绝；目录按调用刷新 | `modelRegistry.test.ts` |
| `getApiKeyAndHeaders/getApiKeyForProvider/getProviderAuth/getProviderAuthStatus` | 明确拒绝，凭据由宿主解析 | `modelRegistry.test.ts` |
| `getProvider/getRegisteredProviderConfig/getRegisteredNativeProvider` | 明确拒绝，不能暴露可执行 Provider 或含凭据的配置 | 命名错误 |
| `registerProvider/unregisterProvider/registerVirtualModel/unregisterVirtualModel` | 明确拒绝，扩展不能修改全局 Provider 或模型 | `modelRegistry.test.ts` |

分类/图片的额外 request options、尺寸、seed、metadata 不在当前受控接口内，传入时返回明确错误，不静默丢弃。chat 接受已实现的标准采样、thinking、cache、timeout、transport、metadata、toolChoice 和 Deferred 选项；凭据、header、endpoint 覆盖及未支持的 Provider 专用选项拒绝。自动请求重试由宿主关闭，避免重复提交未知收费操作。

图片落入共享媒体任务，保留 Session、运行、模型、用量、多图及伴随文本。生成成功但制品保存失败仍保留原始响应与费用。大图展示使用安全制品引用，模型提示词不包含隐藏的模型执行工具和长静态接口说明。

## 验证入口

使用临时数据库和本地模型运行接口测试：

```sh
node --import ./scripts/register-loader.js --import tsx --test \
  src/lib/server/plugins/piExtensions/*.test.ts \
  src/lib/server/agent/models/*.test.ts
```

首次使用先在隔离实例里加载扩展，确认真实工具/命令返回内容、原 Session 收据及用量，再检查停止与权限拒绝。真实账号与付费 Provider 的验收需要单独提供资源及授权。

参考图每张最大 10 MiB，内联图片按解码后的大小校验；远端图片在流读取期间累计大小，超限取消下载，不发起模型请求。
