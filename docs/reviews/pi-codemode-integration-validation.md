# Pi Codemode 接入验证

日期：2026-10-28。范围：Pi 1.3.0 官方 Durable Codemode 在正式 Runner 中的复用。验证只使用临时数据库、临时制品与本地模拟模型。

## 责任划分

`pi-durable/codemode.createCodemodeExtension()` 提供工具定义、说明、模型参数校验、工具相关性搜索、声明生成、输出格式、store、确定性执行日志与恢复。`pi-codemode.CodemodeSandbox` 管理 QuickJS worker；本地 `codemode-worker.mjs` 已删除。

Molibot 的适配器把工具发现限制在当前授权目录，把每次实际调用交给共享入口，再由 Pi `api.executeTool()` 执行。Pi `NestedCallDoc` 保存稳定调用身份与结果；宿主继续执行权限、审批、预算、Trace 和副作用收据。叶子调用不创建额外对话或虚构 assistant 消息。脚本编排不持有叶子写执行槽。分类和图片请求经过共享模型操作服务，继续使用原生任务、未知收费请求守卫、用量记录和媒体制品。

官方模型参数和结果不另起同名协议：

```js
const modelsAvailable = await models.getAvailableOfType("classifier");
const result = await models.classify(modelsAvailable[0], {
  state: { text: "hello" },
  questions: { flag: { type: "bool", instructions: "Is this a greeting?", criteria: { true: "yes", false: "no" } } }
});
text(result.answers);
```

图片使用 `models.generateImages(model, { input: [...] })`，通过 `image(result.output[i])` 展示图片块。宿主暂不支持分类模型的参考图片输入，调用时明确拒绝。`tools.*` 返回 Molibot 的工具结果对象，其中包含 `content` 与 `details`；`describeTool()` 提供对应声明。

## 状态与恢复

官方 `store/load` 存在于当前原生 conversation 内，只有成功脚本提交写入。Molibot 当前按运行分配原生数据库，所以该存储可用于同一次运行的多段脚本及中断恢复，不承诺跨用户轮次共享。

脚本的官方执行日志和内部调用收据共同支持恢复：已经提交的写入不重做，未完成的安全读取可以继续。审批保留原请求和任务，批准后续接剩余操作。未知写入或收费请求结果仍阻止自动重发；脚本整体可恢复不等于每个叶子操作可安全重试。失败脚本不撤销已完成操作。

取消等待已发起的宿主操作结束，保留有界部分输出。默认 worker 截止时间及单次 worker 上限为 300 秒，显式脚本期限可以更短；QuickJS 内存上限 64 MiB。官方输出预算超限后保存完整文本，文件和图片位于当前 scratch。超过内联上限的生成图片只返回可读取的工作区相对引用。

## 原生 Durable 接合

正式路径为 `MomRunner → PiRunSession → PiConversationRuntime → Harness`。`piToolRegistry.ts` 只适配业务授权、准备、记账和事件；执行调度、嵌套结果复用与日志由 Pi 管理。旧的 `PiDurableKernel` 执行类已删除，原有回归与子进程恢复 fixture 使用正式会话生命周期。

原生嵌套调用使用父任务与 key 关联。宿主沿父任务追溯真实 assistant，处理嵌套结果事件并使用同一身份计算预算。内部分类、图片和流式模型工具声明 `callers: ["tools"]`，不暴露给主模型；工具刷新保留这些注册。流式回调使用原请求身份映射，避免原生调用 ID 改变后丢事件。

传给 Pi 的局部取消信号只终止等待。因此宿主收到局部超时后，还调用 Pi 的任务取消并等待处理器结束。启动恢复同时检查 model 与 nested 任务；不安全叶子调用的结果未知时阻止自动重发。无原执行的恢复请求直接拒绝，不创建新数据库。

## 验证

- Codemode 单元与装配测试覆盖批量筛选、权限拒绝、预算、串行写、审批收据、取消、部分输出、超时、内存耗尽、完整文本制品和超大图片引用。
- 原生会话测试覆盖相关性搜索、工具声明、失败脚本不提交 store、完成写入后中断并重开，以及审批后续接原脚本。
- 正式 Runner 测试覆盖官方模型 API、付费操作的权限和预算、分类用量去重、多图及参考图片、原会话媒体记录和最终模型输入。
- 39 项 Codemode、原生恢复与共享模型测试连续 5 次全部通过；另有 9 项正式 Runner、只读装配、打包及能力矩阵检查通过。搜索、重开与审批续接守卫在原实现上失败；把未知写入错误标成可重放时，未知结果守卫也会失败。

本次原生嵌套调用调整：正式会话、执行恢复与结果适配的 63 项定向回归通过，Codemode 29 项、共享模型与扩展 30 项、Runner 实际写入预算守卫 1 项通过；新增结构化结果守卫在修复前失败，结果适配 3 项连续 5 次通过。原生去重、拒绝、隐藏模型流、取消收敛、启动分类、无执行恢复和 Codemode 恢复共 13 项连续 5 次通过。能力矩阵 3 项检查通过。迁移后的执行回归共 23 项，包含 Deferred 强杀恢复、未知副作用阻断、审批续接和 Stop。

本次相关 TypeScript 错误已修复；最后一次仓库类型检查仍被本次范围外的 `app/conversationProjection.ts` 中未定义的 `displaySteps` 阻塞，该文件属于工作区其他未完成改动，未修改。

未调用真实 Provider，未重启用户服务，未生成或替换原生安装包。没有以筛选结果的字符减少推断模型费用下降。全量验收保留 `pnpm verify:feature` 由用户按需执行。
