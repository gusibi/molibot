# @molibot/external-subagent

Isolated runtime and adapters for executing external coding agents (OpenAI Codex and Claude Code) as standalone, non-interactive subagents.

## Architecture

- **`ExternalSubagentRuntime`**: Central orchestrator managing subagent runs, timeouts, cancellation, and output compression.
- **`ManagedProcess`**: Process lifecycle management with POSIX process group detachment and Windows `taskkill /T /F` tree-level termination, enforcing SIGTERM -> grace timeout -> SIGKILL escalation without leaving orphaned child processes.
- **`JsonRpcLineTransport`**: Clean newline-delimited JSON-RPC 2.0 transport over Node.js streams.
- **`CodexAppServerWire` / `CodexProvider`**: Protocol adapter communicating with Codex `app-server --stdio` over ephemeral threads with unattended permission rejection.
- **`ClaudeCodeProvider` / `ManagedClaudeCodeProcess`**: SDK/CLI adapter executing isolated Claude Code subtasks.
- **`environment.ts`**: Strict environment scrubber removing all ambient credentials except provider-specific allowed keys (`OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, etc.).

## Usage

```ts
import { ExternalSubagentRuntime } from "#external-subagent";

const runtime = new ExternalSubagentRuntime({
  runtimesDir: "/path/to/runtimes"
});

const result = await runtime.run("codex", {
  task: "Refactor the authentication module to use JWT tokens.",
  cwd: "/path/to/workspace",
  timeoutMs: 600_000
});

console.log(result.output);
```
