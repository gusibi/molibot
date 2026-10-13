# Findings

- Desktop uses Tauri 2 and Svelte 5, with a pre-existing browser preview transport.
- Existing desktop tests cover helpers, stores, source guards and Rust; no UI runner dependency is installed.
- DATA_DIR isolation and eval service lifecycle helpers already exist.
- Current capability matrix defines shipped scope; dynamic decomposition and calendar/email integrations are excluded.

## Pi audit — 2026-10-13
- Existing A Room restart+review works; non-Room delivery lacks production acceptance.
- C/D model calls bypass native owned tasks, use repeated budget keys and random usage IDs. Image usage is recorded after artifact writes.
- Extension ctx.signal is detached; command input lacks active run host.
- OAuth default callback is loopback; step-up reports an error without resumable authorization.
- Existing check failures: conversations response narrowing and UI harness onLog declaration.

- Production extension IPC callbacks lost AsyncLocalStorage invocation; binding host handlers fixes the owning layer. Extension composite effects must not hold the shared serializer while waiting on owned children; a delegatesEffects flag separates orchestration from replay safety.
- External Channel transcript evidence lives in Agent Context, not SessionStore Web/project metadata. Channel recovery acceptance reads native context and outgoing ledger.
- Installed slash commands now enter the ordinary Runner as explicit native ToolTasks, without a model request; active-run commands fail busy rather than borrow another run.

### Pi capability completion — 最终发现

显式 compact 不能复用被禁用的自动压缩 hook；现已允许显式原生任务、使用原预算并从原生 UsageDoc 投影独立用量。扩展 IPC 需要 AsyncResource 保留原生调用上下文、结束后拒绝在途响应，并使每个取消带原调用 token。媒体费用先记录再保存制品。MCP 窄屏按钮原会挤占文本，按 DESIGN 既有堆叠规则修复。证据和限制：`docs/work/progress/pi-capability-completion/validation.md`。
