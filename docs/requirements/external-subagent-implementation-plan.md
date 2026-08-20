# External Subagent 内置插件实现计划

> 状态：待实现  
> 目标读者：负责落地实现的编码 Agent  
> 核心约束：Molibot 继续运行在 pi runtime 上；Codex、Claude Code 仅作为外部 Subagent；不引入 Cordis、DeepSeek Agent、DeepSeek Session 或完整 DeepSeek Subagent Runtime。

## 1. 最终决策

一期采用“External Subagent 内置 Feature Plugin + 两个直接 Provider Adapter”。

```text
Molibot 主 Agent（继续使用 pi runtime）
            │
            │ 调用工具
            ▼
BuiltIn Feature Plugin: external-subagent
├── codexSubagent
└── claudeCodeSubagent
            │
            ▼
package/external-subagent
├── ExternalSubagentProvider 接口
├── 统一超时 / 取消 / 进程树清理
├── Codex Provider
│   └── codex app-server --stdio
└── Claude Code Provider
    └── Claude Agent SDK
```

现有 `src/lib/server/agent/tools/subagent.ts` 保持 pi Subagent 语义：

```text
subagent            → 现有 pi 子 Agent
codexSubagent       → 外部 Codex
claudeCodeSubagent  → 外部 Claude Code
```

不要给现有 `subagent` 工具增加 `provider` 参数，也不要把现有 pi Subagent 迁移到新接口。这一期只新增能力，不推翻现有运行链路。

## 2. 一期范围

### 2.1 必须实现

- Codex 一次性 Subagent。
- Claude Code 一次性 Subagent。
- 以内置 Feature Plugin 的形式注册。
- 设置中可以整体启用，并分别启用 Codex、Claude Code。
- 使用安全的非交互权限模式。
- 父运行取消时终止外部 Agent。
- 超时后终止整个子进程树。
- 只把最终文本和安全诊断返回父 Agent。
- 提供结构化日志，不污染模型会话。
- Web/Desktop 插件设置可保存，重启后可恢复。
- 正式发布包包含当前平台的 Codex/Claude 可执行 payload。

### 2.2 一期明确不实现

- ACP Provider。
- 外部 Subagent 会话恢复、continuation、resume。
- 后台任务和 Job 系统。
- 外部 Agent 与用户交互式审批。
- 外部 Agent 继承父会话历史。
- 图片二进制直接传入 Provider。
- 多轮 Codex thread 或 Claude session。
- 外部 Agent 的思考、工具调用和中间消息逐条转发。
- 将 Codex、Claude Code 改造成 Molibot 的底层模型 Provider。
- 重构现有 pi Subagent。

文件或图片分析以后可以通过任务文本传递工作区文件路径，例如：

```text
请读取 ./artifacts/image.png，分析其中的界面问题。
```

因此一期不需要先设计多模态 ContentBlock 协议。

## 3. 目录规划

新增独立实现包：

```text
package/external-subagent/
├── package.json
├── README.md
├── NOTICE.md
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── runtime.ts
│   ├── environment.ts
│   ├── managedProcess.ts
│   ├── jsonRpcLineTransport.ts
│   └── providers/
│       ├── codex/
│       │   ├── provider.ts
│       │   └── wire.ts
│       └── claude-code/
│           ├── provider.ts
│           └── processAdapter.ts
└── test/
    ├── runtime.test.ts
    ├── managedProcess.test.ts
    ├── codexWire.test.ts
    ├── codexProvider.test.ts
    ├── claudeProvider.test.ts
    └── fixtures/
```

Molibot 内只保留薄 Adapter：

```text
src/lib/server/plugins/externalSubagent/
├── plugin.ts
├── tools.ts
└── tools.test.ts
```

需要接线的现有文件：

```text
package.json
src/lib/server/plugins/feature-registry.ts
src/lib/server/plugins/types.ts
src/lib/server/settings/schema.ts
src/lib/server/settings/defaults.ts
src/lib/server/settings/store.ts
src/lib/server/settings/handlers/plugins.test.ts
src/lib/server/agent/tools/index.ts
src/lib/server/agent/tools/toolClassification.ts
src/lib/server/agent/tools/toolPolicy.ts
bin/molibot-release.sh
scripts/runtime/release-bundle.test.mjs
```

不要写从 `src` 指向 `package` 的跨目录长相对路径。在根 `package.json` 增加正式入口：

```json
{
  "imports": {
    "#external-subagent": "./package/external-subagent/src/index.ts"
  }
}
```

插件只能从 `#external-subagent` 公共入口导入，不能导入包内私有文件。

## 4. 核心接口

在 `package/external-subagent/src/types.ts` 定义：

```ts
export type ExternalSubagentProviderId = "codex" | "claude-code";

export type ExternalSubagentStopReason =
  | "completed"
  | "aborted"
  | "timeout"
  | "error";

export interface ExternalSubagentRequest {
  task: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface ExternalSubagentResult {
  provider: ExternalSubagentProviderId;
  output: string;
  stopReason: ExternalSubagentStopReason;
  diagnostic?: string;
  durationMs: number;
}

export interface ExternalSubagentProvider {
  readonly id: ExternalSubagentProviderId;

  run(request: ExternalSubagentRequest): Promise<ExternalSubagentResult>;
}
```

必须由实现和测试共同保证：

- `task` 必须是非空文本。
- `cwd` 必须真实存在并且是目录。
- 工具调用方不能通过参数指定 `cwd`。
- 每次调用创建全新的外部进程和产品会话。
- `run()` 返回前必须完成子进程树清理。
- 用户取消必须分类为 `aborted`，不能误报 `timeout`。
- timeout 和 abort 只能有一个最终分类。
- 原始 stderr、认证信息、协议 payload 不进入父模型上下文。

`runtime.ts` 负责：

- 注册两个 Provider。
- 根据 Provider ID 分发。
- 创建 timeout signal。
- 区分父取消和超时。
- 统一结果格式。
- 保证 `finally` 清理。

不要把 Codex thread、turn 或 Claude Query 等产品私有概念暴露到公共接口。

## 5. DeepSeek Harness 复用策略

参考源代码位置使用机器无关占位符：

```text
<deepseek-harness>/packages/subagent/subagent-codex/
<deepseek-harness>/packages/subagent/subagent-claude-code/
<deepseek-harness>/packages/subprocess/
```

### 5.1 Codex：高比例移植

主要参考：

```text
<deepseek-harness>/packages/subagent/subagent-codex/src/run.ts
<deepseek-harness>/packages/subagent/subagent-codex/src/wire.ts
```

保留：

- 使用 package-local `@openai/codex`。
- 启动 `codex app-server --stdio`。
- `initialize → thread/start → turn/start` 流程。
- `ephemeral: true`。
- thread/turn ID 过滤。
- 最终答案选择逻辑。
- permission request 的无人值守处理。
- `turn/interrupt`。
- Codex 错误分类。
- stderr 固定特征识别。
- 取消和清理顺序。

删除或替换：

- 删除 Cordis `Context`。
- 删除 `ctx.subagents`。
- 删除 `dsh-subagent` 类型。
- 删除 `dsh-session` 和 `SessionId`。
- 删除 `dsh-subprocess`。
- 删除 `dsh-sdk-protocol`。
- 删除 `settleRunResult`、`subprocessRunHandle`。
- 使用本包的 `ManagedProcess` 和 `JsonRpcLineTransport`。

Codex 权限模式：

```ts
type CodexPermissionMode =
  | "never"
  | "approve-for-me"
  | "dangerously-bypass-approvals-and-sandbox";
```

默认必须是 `never`。

### 5.2 Claude Code：高比例移植

主要参考：

```text
<deepseek-harness>/packages/subagent/subagent-claude-code/src/run.ts
<deepseek-harness>/packages/subagent/subagent-claude-code/src/process.ts
```

保留：

- 官方 `@anthropic-ai/claude-agent-sdk`。
- `query()`。
- `spawnClaudeCodeProcess` 自定义进程接管。
- `persistSession: false`。
- 禁止 `AskUserQuestion`。
- MCP elicitation 自动拒绝。
- 非交互 permission callback。
- 只接受严格的成功 result。
- SDK 错误 subtype 分类。
- Query close + 进程树终止。

删除或替换：

- 删除 Cordis。
- 删除 DeepSeek Subagent、Session、Subprocess 类型。
- 使用本包的统一 Request/Result。
- 使用本包 `ManagedProcess`。

Claude Code 权限模式：

```ts
type ClaudeCodePermissionMode =
  | "dontAsk"
  | "acceptEdits"
  | "auto"
  | "plan"
  | "bypassPermissions";
```

默认必须是 `dontAsk`。

### 5.3 禁止引入

不要添加以下依赖：

- `@deepseek-ai/dsh-subagent`
- `@deepseek-ai/dsh-agent`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-subprocess`
- `@deepseek-ai/cordis`
- `subagent-acp`

也不要用 Molibot 现有 `package/acp` 作为新实现基础。该模块面向 Telegram ACP 长会话，并且当前进程终止能力不足以承担新的外部 Agent 生命周期。

## 6. 进程管理

`managedProcess.ts` 必须实现：

- 不通过 shell 拼接命令。
- 参数使用独立 argv。
- POSIX 使用独立 process group。
- Windows 使用 `taskkill /PID <pid> /T`，必要时增加 `/F`。
- 正常结束 stdin。
- 先发送 SIGTERM。
- 等待固定 grace，默认 3000ms。
- 仍未退出再发送 SIGKILL。
- 等待进程树确认退出后才 resolve。
- `terminate()` 幂等。
- spawn 失败后调用 terminate 不得抛错。
- 父 signal 在 spawn 前已经 aborted 时不得启动进程。
- 应用退出时不能留下 Codex/Claude 后台进程。

环境变量策略：

1. 保留 `PATH`、`HOME`、`CODEX_HOME` 等普通运行环境。
2. 默认移除 credential-shaped 环境变量。
3. 只重新加入当前 Provider 允许的认证变量。

建议白名单：

```text
Codex:
OPENAI_API_KEY
CODEX_API_KEY
OPENAI_BASE_URL

Claude Code:
ANTHROPIC_API_KEY
ANTHROPIC_BASE_URL
```

不能把 Telegram、Feishu、QQ、数据库、MCP 等其他凭证传给外部 Agent。

## 7. 插件工具设计

不要做一个带动态 `provider` 字段的大工具。注册两个静态工具：

```text
codexSubagent
claudeCodeSubagent
```

两个工具都只接受：

```ts
{
  task: string;
}
```

工具使用当前运行的 `cwd`，绝不能接受模型传入任意目录。

使用静态工具的原因：

- 模型更容易选对。
- 每个工具描述能说明产品差异。
- 可以单独启用和禁用。
- 未来替换某一个 Provider 不影响另一个。
- 工具调用日志天然能区分 Provider。
- 不需要把 Provider 注册表暴露给模型。

完成结果：

```ts
{
  content: [{ type: "text", text: compressedOutput }],
  details: {
    provider,
    stopReason,
    durationMs,
    diagnostic
  }
}
```

父上下文输出最多保留约 6000 字符，使用头部 + 尾部压缩。不要在 `details` 中再保存一份完整输出。

失败时只返回安全诊断，例如：

```text
Codex external subagent failed (stage: turn; category: sandbox-error).
```

不能返回：

- 原始 stderr。
- HTTP 响应体。
- API Key。
- 完整环境变量。
- 原始 JSON-RPC 消息。

## 8. 插件设置

新增：

```ts
interface ExternalSubagentPluginSettings {
  enabled: boolean;
  codexEnabled: boolean;
  codexPermissionMode: CodexPermissionMode;
  claudeCodeEnabled: boolean;
  claudeCodePermissionMode: ClaudeCodePermissionMode;
}
```

挂载位置：

```ts
settings.plugins.externalSubagent
```

默认值：

```ts
{
  enabled: false,
  codexEnabled: true,
  codexPermissionMode: "never",
  claudeCodeEnabled: true,
  claudeCodePermissionMode: "dontAsk"
}
```

整体默认关闭，防止安装升级后突然向主 Agent 暴露两个具有文件修改能力的新工具。

设置字段：

- 启用 External Subagent。
- 启用 Codex。
- Codex 权限模式。
- 启用 Claude Code。
- Claude Code 权限模式。

危险模式必须在描述中明确说明：

```text
dangerously-bypass-approvals-and-sandbox
bypassPermissions
```

设置字段需要中英本地化，不能只写一套英文硬编码。如果现有插件字段元数据不能引用翻译 key，给 `PluginSettingField` 增加 `labelKey`、`descriptionKey`，Web 和 Desktop 使用当前 locale 解析；不要为 External Subagent 写专属设置页面。

设置持久化必须使用临时数据库完成完整 round-trip 测试：

```text
save
→ 销毁 SettingsStore
→ 创建新 SettingsStore
→ load
→ 对比完整 externalSubagent 对象
```

## 9. 工具安全分类

现有未知工具会落到 `builtin + low + read`，External Subagent 绝不能使用这个默认分类。

扩展内置 Feature Plugin 工具贡献结构：

```ts
interface FeaturePluginToolContribution {
  tool: AgentTool<any>;
  classification: {
    risk: "high";
    source: "plugin";
    effect: "execute";
  };
}
```

两个 External Subagent 工具声明为：

```text
risk   = high
source = plugin
effect = execute
```

不要在 `toolClassification.ts` 根据工具名称添加两个插件特判；分类应该由插件声明，通用工具层读取。

同时将两个工具加入 `src/lib/server/agent/tools/toolPolicy.ts` 的串行工具集合：

```text
codexSubagent
claudeCodeSubagent
```

外部 Agent 会绕过 Molibot 自己的 `edit/write` 文件锁，同时修改同一工作区容易互相覆盖。一期默认串行，后续有隔离工作区后再考虑并行。

Plan 模式继续只暴露当前只读工具，不得暴露这两个外部执行工具。

## 10. 依赖和正式打包

根 `package.json` 精确锁定 DeepSeek Harness 已验证的版本：

```json
{
  "dependencies": {
    "@openai/codex": "0.147.0",
    "@anthropic-ai/claude-agent-sdk": "0.3.220"
  }
}
```

不要使用 `^`。

`bin/molibot-release.sh` 当前使用：

```bash
pnpm install --prod --no-optional --frozen-lockfile
```

Codex 和 Claude Code 的平台可执行文件属于 optional platform dependency。保留 `--no-optional` 会导致开发环境通过、正式发布包第一次调用必然失败。必须改为：

```bash
pnpm install --prod --frozen-lockfile
```

增加发布测试：

- 发布目录能 resolve `@openai/codex/package.json`。
- 能根据 package manifest 找到 Codex wrapper。
- Claude Agent SDK 能找到当前平台 CLI。
- 不允许回退到系统 `PATH` 上的 `codex` 或 `claude`。
- 缺少平台 payload 时返回明确 startup failure，不得假装成功。

需要在 README 中披露安装体积影响。按照参考实现当前锁定版本的 macOS arm64 数据，两个平台包的解压体积合计可能超过 500 MB。这是使用固定官方版本、不依赖用户本机 CLI 的代价。

## 11. 实现顺序

### 阶段 0：建立需求记录和基线

1. 在 `prd.md` 新增 External Subagent P1 条目。
2. 记录一期范围和明确不做项。
3. 运行当前 Subagent、插件设置和生产构建测试。
4. 保存基线结果。

验收：未改代码前相关测试全部通过。

### 阶段 1：建立独立 package 和进程管理

1. 创建 `package/external-subagent`。
2. 实现 types。
3. 实现环境变量过滤。
4. 实现 ManagedProcess。
5. 实现 timeout/abort runtime。
6. 添加 package import alias。
7. 编写进程 fixture 测试。

验收：

- Abort 前不 spawn。
- Abort 后整个进程树退出。
- Timeout 后整个进程树退出。
- terminate 两次不报错。
- 不泄漏不相关凭证。
- 该阶段还不接 Molibot 工具。

### 阶段 2：Codex Provider

1. 精确加入 `@openai/codex@0.147.0`。
2. 移植 JSON-RPC transport。
3. 移植 Codex wire。
4. 移植 Codex run lifecycle。
5. 改为本包接口。
6. 补齐 Codex fixtures。

验收：

- 正确发送 initialize。
- thread 使用 `ephemeral: true`。
- cwd 正确。
- 最终答案优先于 commentary。
- 错误 thread/turn 消息被忽略。
- 权限请求无人值守拒绝。
- Abort 会发送 interrupt 并清理进程。
- 成功、错误、EOF、进程退出都不会留下进程。

### 阶段 3：Claude Code Provider

1. 精确加入 Claude Agent SDK。
2. 移植 SDK process adapter。
3. 移植 query lifecycle。
4. 接入统一接口。
5. 补齐 SDK 消息 fixtures。

验收：

- `persistSession: false`。
- `AskUserQuestion` 被禁用。
- 严格成功 result 才算完成。
- blank result 算失败。
- SDK error subtype 正确分类。
- Abort、timeout、process exit 均清理进程树。
- 不依赖系统 `claude` 命令。

### 阶段 4：内置插件和工具

1. 创建 `externalSubagentFeaturePlugin`。
2. 注册两个静态工具。
3. 在 feature registry 注册。
4. 增加插件工具分类声明。
5. 增加串行化。
6. 增加简短、稳定的 prompt section。

Prompt 只说明：

- pi `subagent` 是默认内部委派。
- Codex/Claude 工具适合显式外部复核或用户指定。
- 外部 Agent 拿不到父对话，task 必须自包含。
- 外部 Agent 可以修改当前工作区。

验收：

- 插件关闭时两个工具都不存在。
- 只开启 Codex 时只出现 Codex 工具。
- 只开启 Claude 时只出现 Claude 工具。
- Plan 模式两个工具都不存在。
- 工具分类为 `high/plugin/execute`。
- 两次并行调用实际串行执行。

### 阶段 5：设置和 UI

1. 增加 schema/default/sanitize。
2. 注册动态设置字段。
3. 完成中英文翻译。
4. Web 和 Desktop 使用现有动态插件设置 UI。
5. 增加 save/restart/load 测试。
6. 验证明暗主题、移动宽度和语言即时切换。

验收：

- 切换后正确保存。
- 重启后不丢字段。
- 未知插件字段不被 sanitizer 删除。
- 密码或环境变量不通过设置 API 暴露。
- 不新增 External Subagent 专属手写页面。

### 阶段 6：发布链路

1. 修正 `--no-optional`。
2. 更新 lockfile。
3. 添加平台 payload 测试。
4. 验证 Desktop sidecar。
5. 验证 standalone release。
6. 增加第三方许可证说明。

验收：从全新发布目录冷启动并真实调用一次 Codex、一次 Claude Code。

### 阶段 7：文档与交付

按项目规则更新：

- `features.md`
- `prd.md`
- `CHANGELOG.md`
- `README.md`
- `docs/guides/plugins/plugin-authoring.md`
- `package/external-subagent/README.md`
- 第三方 Notice

README 至少说明：

- 如何启用。
- 需要先完成 Codex/Claude 本地登录，或者提供对应环境变量。
- 安全默认权限模式。
- 每次调用都是新会话。
- 不支持交互审批和恢复。
- 外部 Agent 可能修改当前工作区。
- 安装体积影响。

## 12. 验证命令

实现 Agent 应按顺序执行，不要只跑新增测试：

```bash
node --import ./scripts/register-loader.js --import tsx --test \
  package/external-subagent/test/*.test.ts \
  src/lib/server/plugins/externalSubagent/*.test.ts \
  src/lib/server/settings/handlers/plugins.test.ts \
  src/lib/server/agent/tools/toolClassification.test.ts \
  src/lib/server/agent/tools/subagent.test.ts
```

然后执行：

```bash
npx tsc --noEmit
pnpm run build
pnpm run desktop:check
pnpm run test:desktop-release
pnpm run test:service-bootstrap
```

真实冷路径：

```text
启动 Molibot
→ 打开插件设置
→ 启用 External Subagent
→ 保存
→ 重启 Molibot
→ 确认设置仍然存在
→ 创建一个临时 git 项目
→ Codex 执行只读分析
→ Claude Code 执行只读分析
→ 执行一个允许写文件的任务
→ 中途 Stop
→ 确认父运行停止
→ 确认没有 codex/claude 残留进程
→ 再启动一次任务确认运行时仍可用
```

涉及设置、SQLite 和运行状态的测试必须使用临时数据库或可注入 store，禁止读写真实用户数据目录。

## 13. 完成标准

只有同时满足以下条件才能标记完成：

- pi 主 Runtime 没有被替换。
- 现有 pi Subagent 行为和测试不变。
- 没有引入任何 DeepSeek/Cordis Runtime 依赖。
- Codex 与 Claude Code 都通过官方固定版本的本地实现启动。
- 插件关闭时系统完全看不到外部工具。
- 取消和超时后不存在残留进程。
- 外部 Agent 不收到 Molibot 的其他凭证。
- 原始 stderr 和协议内容不进入模型历史。
- 设置重启 round-trip 通过。
- 发布包真实包含当前平台 payload。
- Web、Desktop 和正式发布构建全部通过。
- 文档明确说明权限和安装体积。

## 14. 对抗式审查重点

交付前必须主动攻击并验证以下问题：

1. **发布包缺少 optional platform payload**：开发机正常，正式发布第一次调用失败。
2. **子进程树泄漏**：只杀 wrapper，Codex/Claude 的后代进程继续存活。
3. **工具安全分类错误**：插件工具落入未知工具的 `low/read` 默认值。
4. **凭证泄漏**：外部 Agent 继承 Telegram、Feishu、数据库或其他 Provider 密钥。
5. **并发覆盖文件**：两个外部 Agent 同时修改工作区，绕过 Molibot 文件锁。
6. **错误污染模型上下文**：原始 stderr、HTTP body 或协议 payload 被返回给父 Agent。
7. **取消被误判为超时**：用户 Stop 后父运行显示 timeout 或 error。
8. **协议版本漂移**：升级 Codex/Claude SDK 后仍沿用旧协议假设却没有重新跑 fixtures。

如果上述前四项没有各自的自动化测试证据，不得宣布功能完成。
