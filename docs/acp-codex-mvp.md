# ACP Multi-Provider MVP

## Purpose

This document captures the current first usable version for channel-driven coding control through ACP.

## Product Goal

Turn Molibot into a controlled remote coding client:

- Telegram, Feishu, QQ, and Weixin can all act as the operator UI.
- ACP is the protocol layer.
- Codex and Claude Code are the currently supported controlled coding agents.
- Every risky step remains visible and controllable.

## Scope of V1

Included:

- Codex ACP target preset
- Claude Code ACP target preset
- ACP project registry (allowlist)
- Channel commands to open a coding session and run a task
- Runtime status updates back to the active channel
- Permission approval flow through the active channel
- Session cancel / close controls
- Persistent ACP settings for targets and projects
- Web settings UI for ACP at `/settings/acp`

Not included yet:

- Gemini ACP
- Multiple concurrent ACP sessions per chat
- Git push / deploy flows
- Arbitrary path execution without registration

## Core Decisions

### 1. Project selection is explicit

The agent must always know which project to work on.

V1 rule:

- Only registered projects may be used.
- A chat cannot point an ACP target at an arbitrary path directly.
- Operators register a project once, then reuse its ID.

### 2. ACP control is command-driven first

To keep the first release predictable, V1 uses channel commands instead of free-form natural-language routing.

The public operator interface stays unified:

- all providers use the same `/acp ...` command family
- provider-specific remote commands are exposed as prefixed names such as `codex:/...` or `claude-code:/...`

Proxy behavior:

- when a chat has an active ACP session, channel messages are proxied to ACP by default
- `/acp ...`, `/approve ...`, and `/deny ...` remain reserved as control commands
- `/acp close` exits proxy mode and returns the chat to normal Molibot handling

### 3. Approval remains client-side

Approval mode is enforced by Molibot on incoming ACP permission requests.

Modes:

- `manual`: every permission request waits for operator approval
- `auto-safe`: auto-approve safe read/test commands only
- `auto-all`: auto-approve the first allow option returned by the adapter

### 4. Chat flow switches by ACP session state

Without an active ACP session, the channel continues to use the existing Molibot runner.
With an active ACP session, chat messages are proxied to ACP by default until `/acp close`.

### 5. New channels should use the shared ACP template

ACP behavior should not be reimplemented channel by channel.

For future text-oriented channels, the expected pattern is:

- reuse the shared ACP channel template in `src/lib/server/channels/shared/acp.ts`
- keep only transport-specific code inside the channel runtime
- avoid copy-pasting `/acp`, `/approve`, `/deny`, and proxy-state rules again

## Channel Commands

### Session and config

- `/acp help`
- `/acp targets`
- `/acp projects`
- `/acp add-project <id> <absolute-path>`
- `/acp remove-project <id>`
- `/acp new <targetId> <projectId> [manual|auto-safe|auto-all]`
- `/acp status`
- `/acp remote <command> [args]`
- `/acp mode <manual|auto-safe|auto-all>`
- `/acp close`

### Task execution

- `/acp task <instructions>`
- `/acp remote <command> [args]`
- `/acp cancel`

### Permission handling

- `/approve <requestId> <optionId>`
- `/deny <requestId>`

## First-Run Example

### 1. Register a project

```text
/acp add-project molipibot /Users/gusi/Github/molipibot
```

### 2. Start a Codex ACP session

```text
/acp new codex molipibot manual
```

Or start a Claude Code ACP session:

```text
/acp new claude-code molipibot manual
```

### 3. Submit a coding task

```text
/acp task 在 molibot 里实现 Telegram 到 Codex 的 ACP 最小链路。
要求：
1. 新增项目注册表
2. 新增会话管理
3. 支持权限回传
4. 不要破坏原有 Telegram 聊天
5. 完成后跑 build
```

### 4. Approve a risky step

```text
/approve 17 allow_once
```

or reject it:

```text
/deny 17
```

## Runtime Behavior

### During a task

The active channel should receive:

- current status edits
- important tool completion/failure notes
- permission request messages with exact options
- final completion/failure summary

### At completion

Molibot should report:

- stop reason
- key files touched
- final assistant output
- whether the task ended cleanly or failed

## Built-in Target Presets

V1 ships with two ACP presets:

- `codex`
  - transport: `stdio`
  - default command: `npx -y @zed-industries/codex-acp`
- `claude-code`
  - transport: `stdio`
  - default command: `npx -y @zed-industries/claude-code-acp`

Notes:

- This requires the ACP adapter to be available at runtime.
- The target runtime should already be authenticated on the machine.
- If the adapter is missing or auth is not ready, Molibot should surface the adapter error directly in the active channel.

## Risks and Mitigations

### Risk: unclear working directory

Mitigation:

- force project registration before session creation

### Risk: queue deadlock during approval

Mitigation:

- ACP execution is handled via Telegram command path, not the normal queued runner path
- approval commands are handled independently

### Risk: unsafe auto-approval

Mitigation:

- default is `manual`
- `auto-safe` only covers obvious read/test operations
- edits, installs, deletes, network-like actions stay manual

### Risk: adapter instability or missing install

Mitigation:

- keep target config explicit and replaceable
- return raw adapter error to the operator

## Phase Plan

### Phase 1

Ship the multi-provider ACP MVP described above.

### Phase 2

Improve operator ergonomics:

- better approval summaries
- session history and restore

### Phase 3

Add more ACP targets:

- Gemini

## Acceptance Criteria

V1 is considered done when:

- a project can be registered from Telegram
- a Codex or Claude Code ACP session can be opened for that project
- a task can be sent through ACP
- permission requests are surfaced back to Telegram
- the operator can approve or deny the request from Telegram
- the task can be cancelled and closed cleanly
- final status is visible in Telegram
