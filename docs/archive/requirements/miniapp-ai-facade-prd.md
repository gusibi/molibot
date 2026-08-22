# Mini App AI 能力门面（Host AI Facade）PRD

> 状态：平台、转写链路与内置 meeting-notes 已实施（2026-08-06）；macOS dev/打包态麦克风人工矩阵仍待验收，见 §7
> 前置阅读：`AGENTS.md`、`CLAUDE.md`（尤其 pitfalls #6/#11/#13/#21d/#23f）、`docs/requirements/miniapp-platform-implementation-plan.md`
> 关联：`miniapp-message-actions-plan.md`、`miniapp-composer-bridge-plan.md`
> 量级提示：这是平台级能力，建议独立排期，不与前两份方案混在一个 slice。

## 1. 背景与动机

Mini App 目前是"带 UI 和工具的私有数据库"。本方案让 App 的服务端代码可以调用**宿主已配置的模型能力**——App 声明"我需要文本生成/语音转写"，宿主按用户在 Provider/Agent 设置里的配置解析到具体模型并代理调用。驱动场景：会议记录 App——面板里点"开始"，录音分段上传，App 服务端调宿主转写能力逐段出字，结束后再调文本能力生成纪要。

三条设计立场：

1. **API key 永远不出宿主**（pitfall #6）。App 拿到的是能力门面，不是凭据；用户的模型配置只存在一处。
2. **这不是新增攻击面**。App 服务端代码本来就 in-process、无沙箱运行（manifest 注释原文：install source 是"来源记录，不是权限边界"）。门面把 App 本来就能绕路做的事收编进一个可观测、可记账的通道。
3. **App 说能力，不说型号**。App 声明 `"transcription"`，永远不指名 `whisper-x`——模型选择是用户在宿主设置里的决定。

## 2. 契约设计

### 2.1 Manifest 声明

```jsonc
{
  // ...既有字段...
  "ai": {
    "capabilities": ["text", "transcription"]   // 首期只有这两种
  }
}
```

- `ai` 加入 manifest 顶层白名单；内部同样白名单校验。
- `capabilities` 非空数组、枚举校验、去重。声明了 `ai` 的 App 必须把 `engines.molibot` 提升到 `>=2.9.8`（与 `contributions` 同一兼容策略：老宿主整 App 拒装，失败落在语义清晰的引擎检查处）。
- 未声明某能力的 App 在运行时调用该能力 → 结构化错误 `capability_not_declared`（能力是声明制不是权限制——见立场 2——但声明让 Manager 能向用户如实展示"这个 App 会用你的模型"）。

### 2.2 运行时门面

`MiniAppRuntimeContext`（`src/lib/server/miniapps/types.ts`）新增 `ai` 字段：

```ts
export interface MiniAppAiFacade {
  /**
   * Single-shot text generation. Non-streaming in v1.
   * Rejects with a structured MiniAppAiError; never leaks provider names,
   * key material, or host paths in the message.
   */
  generateText(request: {
    prompt: string;
    system?: string;
    /** Hard output cap. Host clamps to its own ceiling regardless. */
    maxOutputTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;

  /**
   * Transcribe one audio segment (<= 10 min / <= 25 MiB per call).
   * Long recordings are the APP's job to segment — see §5 job pattern.
   */
  transcribe(request: {
    /** Absolute path INSIDE the app's own dataDir. The facade validates containment. */
    audioPath: string;
    language?: string;   // BCP-47 hint, optional
    signal?: AbortSignal;
  }): Promise<{ text: string; durationSeconds: number }>;
}

export interface MiniAppRuntimeContext {
  appId: string;
  dataDir: string;
  logger: MiniAppLogger;
  ai: MiniAppAiFacade;   // 新增；未声明能力的 App 也拿到对象，调用时报 capability_not_declared
}
```

设计约束：

- **门面参数在副作用前逐项校验**（pitfall #26d）：`prompt` 必须是非空 string（防 `"[object Object]"` 一族）；`audioPath` 必须真实包含在该 App 的 dataDir 内（realpath 包含性，复用 `paths.ts` 的既有做法）。
- **错误消息面向 App 开发者但经过 sanitize**：不含 provider 名、key、host 绝对路径；与 `invokeTool` 的既有错误纪律一致。
- v1 不做流式。会议场景靠分段转写 + revision 轮询获得"逐段出字"的体验（§5），不需要 SSE。流式列入 v2。

### 2.3 模型解析（宿主侧）

新增设置项（Settings → Mini Apps 区）：

- **Mini App 文本模型**：从已配置的模型里选，默认跟随全局默认模型。
- **Mini App 转写模型**：从已配置的、具备音频输入能力的模型里选；一个都没有时门面调用报 `capability_unavailable`，Manager 里对声明了 `transcription` 的 App 显示黄色提示"未配置转写模型"。
- 可选的**按 App 覆盖**（v1 可不做，manifest 里预留不出现）。

强制检查两条既有 pitfall：

- **#11 设置往返**：新字段必须过 save → 新 store → load 回归（临时库），且每个手写投影（设置页 loadAll、序列化器）都要带上——在对应投影单测里断言。
- **#13 设置失效**：模型配置变更后发布共享 same-document settings 事件；门面每次调用时解析（不缓存模型选择），Manager 的黄色提示同样事件驱动刷新。

## 3. 计量与可观测（in-process 信任模型下，可观测就是防线）

- 门面每次调用写一条结构化记账：`appId`、能力、模型 id、input/output tokens（或音频秒数）、耗时、成败。存放沿用宿主既有的用量记录基建；若无现成表则新建 `miniapp_ai_usage`（迁移走既有 db 迁移机制）。
- Mini App Manager 每个 App 详情里展示近 30 天用量汇总；声明了 `ai` 的 App 在安装确认界面明确展示"此应用会使用你配置的模型（产生调用费用）"。
- 频控：单 App 并发上限 2、每分钟调用上限 30（常量集中定义，超限报 `rate_limited`）。不是安全边界，是防 App 写出死循环烧钱的护栏（对齐 pitfall #23e"自动重放需要边界"的精神）。

## 4. 音频上传：body 上限决策

宿主对 `/miniapps/<id>/api/*` 统一 1 MiB body 上限，录音必然撞上。**决策：不做全局放宽，manifest 按路由声明**：

```jsonc
"ai": {
  "capabilities": ["transcription"],
  "uploadLimits": [{ "pathPrefix": "/api/recordings", "maxBodyBytes": 26214400 }]  // ≤ 25 MiB
}
```

- 仅声明了 `transcription` 能力的 App 允许出现 `uploadLimits`；上限硬顶 25 MiB；`pathPrefix` 必须以 `/api/` 开头。
- `httpRoute.ts` 读该声明按前缀放宽，其余路由维持 1 MiB。放宽是**精确的、App 自己声明的、Manager 里可见的**，不是平台默认。
- App 侧长录音自行分段上传（模板给 60s/段的 MediaRecorder 参考实现）。

## 5. 长任务形态：job 模式（写死在参考实现里，防止执行者做成同步长请求）

会议记录参考流程（进 `skills/miniapp-creator/reference.md` + 一个新的参考 App，见 §8）：

1. 面板点"开始"→ App `/api/recordings` 建 job 落库（SQLite，状态 `recording`）→ 返回 jobId。
2. UI 每 60s 上传一段音频 → App 存入 dataDir、入队。
3. App 服务端逐段调 `ctx.ai.transcribe`，每段完成写库并 `changed: true` → revision 递增 → 面板轮询看到逐段出字。**每段一个独立 await 且有 try/catch**；单段失败重试 2 次后标记该段 `failed` 并继续后段——绝不让一段失败杀掉整个 job（pitfall #21d/#23f：未处理的 rejection 会杀死整个服务进程，App 模板必须示范正确写法）。
4. 点"结束"→ 尾段转写完成后调 `ctx.ai.generateText` 生成纪要 → job 状态 `done`。
5. 服务重启后 `recording`/`transcribing` 状态的 job 标记为 `interrupted`，面板可见并可对已有分段重跑纪要（呼应 pitfall #23a：重启后不存在仍然活着的 in-process job）。

## 6. 测试要求

| 测试 | 断言 |
|---|---|
| manifest 校验 | `ai` 白名单；capabilities 枚举/非空/去重；`uploadLimits` 仅随 `transcription`、硬顶 25 MiB、前缀必须 `/api/` |
| 门面单测（provider 打桩） | prompt 非 string 零副作用；audioPath 越界拒绝；未声明能力报 `capability_not_declared`；未配置转写模型报 `capability_unavailable`；错误消息不含 provider 名/绝对路径；`maxOutputTokens` 被宿主上限钳制 |
| 计量 | 成功/失败都落账；频控超限报 `rate_limited` 且不打到 provider |
| 设置往返 | 新设置字段 save→fresh store→load 存活；投影单测断言字段（pitfall #11） |
| `httpRoute.test.ts` | 声明前缀内 25 MiB 通过、之外 1 MiB 照旧、未声明 App 全部 1 MiB |
| 设置失效 | 改模型后门面下一次调用用新模型（事件驱动，无缓存） |

## 7. 前置 spike（实施前必须先验证，结论写回本文档）

> 2026-08-06 实施记录：iframe 已按 transcription capability 条件添加 `allow="microphone"`，Meeting Notes 已使用 60 秒 `MediaRecorder` 分段，并通过生产构建与无麦克风依赖的恢复/幂等测试。当前执行环境无法操作 Tauri 系统权限弹窗和真实音频设备，因此 **A/B/C 尚未定论**；不得把这些机器证据写成真实麦克风验收。发布前仍须分别在 `desktop:dev` 与打包 App 完成下述人工矩阵；若结果为 B/C，按本节路线回到 bridge/native 规划，不把 direct-iframe 录音作为已验证能力。

**Tauri WebView + `molibot-miniapp://` 自定义协议 iframe 内的 `getUserMedia` 麦克风权限行为**——这是会议记录场景唯一无把握的技术点。验证矩阵：macOS 打包态 + `pnpm desktop:dev` 两种形态。可能结论与对应路线：

- A. iframe 内可用（可能需要 iframe `allow="microphone"` 与 Tauri 配置）→ 直接按本 PRD 走。
- B. iframe 内不可用但宿主主 frame 可用 → 录音上移到宿主：composer 桥新增宿主级录音动作，音频由宿主写入 App dataDir 后通知 App（桥协议升 version）。
- C. 都不可用 → 走 Tauri 原生层录音插件，量级重估。

spike 结论未出之前，`generateText` 相关部分（提示词优化、纪要生成等纯文本场景）不受影响，可以先行实施——建议就按"文本先行、转写随 spike 结论"拆两个 slice。

## 8. 配套更新

- 参考 App：新增内置或模板级 `meeting-notes` 参考实现（含 §5 全部纪律）；`miniapp-creator` 的 `reference.md` 补 `ctx.ai` 章节 + 错误码表 + "能力是声明制"的信任模型说明；Skill 版本 bump。
- `features.md` + `CHANGELOG.md` 按 pitfall #9 记录验证结果。

## 9. 非目标

- App 自带 provider/key 配置（永久非目标：与立场 1 冲突）。
- 流式输出、图像生成/识别能力、embedding（列入 roadmap，v2 按需求排）。
- 把门面暴露到 App 的 **UI 侧**（iframe 里直接调模型）——模型调用只发生在 App 服务端，UI 永远通过 App 自己的 `/api/*` 间接使用。

> Archived: 2026-08-22 (delivered/superseded or never-started plan; see docs/requirements/ and features.md for current authority)
