# Host Bash Command Classification Design

Date: 2026-06-02

## Purpose

Molibot currently treats compound shell syntax as a strong signal that a Host Bash request must become a one-time approval. That is safe, but it creates unnecessary approval noise for common read-only wrappers such as:

```bash
longbridge news FIG.US 2>&1 | head -30
longbridge quote FIG.US 2>&1 | head -20
agent-browser open https://example.com && sleep 3 && agent-browser wait --load networkidle && agent-browser close
```

The product goal is to approve the real host capability, not harmless output trimming or shell glue. If `longbridge` is already trusted, `longbridge news FIG.US 2>&1 | head -30` should not become a new one-time approval just because it uses `head`.

This document defines a conservative command classifier that can decide:

- when a command can reuse a persistent Host Bash whitelist entry;
- when it should request a persistent whitelist approval;
- when it should request one-time approval for the exact shell script;
- which shell glue and helper commands are safe enough to ignore during approval classification.

This is a design document only. It does not change runtime behavior yet.

## Current Baseline

Relevant current files:

- `src/lib/server/hostBash/approval.ts`
  - `parseHostBashShellCommand()` parses a single executable command and rejects shell operators.
  - `parseHostBashApprovalCommand()` treats compound shell syntax as `ephemeral`.
  - `sanitizeHostBashCommand()` rejects shell interpreters and dynamic runtimes such as `bash`, `sh`, `zsh`, `node`, `python`, `ruby`, and `perl`.
- `src/lib/server/agent/tools/bash.ts`
  - `tryParseHostBashCommand()` delegates to `parseHostBashShellCommand()`.
  - `findApprovedHostBash()` looks up a persistent whitelist entry by executable-derived `toolId`.
  - approved Host Bash currently executes `parsedHostBashCommand.originalCommand`, not just the executable.
- `src/lib/server/agent/hostBashExec.ts`
  - executes the stored `originalCommand` through the user's shell.
- `src/lib/server/hostBash/store.ts`
  - stores approval requests and persistent whitelist grants in SQLite.

Current limitation:

```text
single executable command -> persistent approval candidate
any pipe / redirect / chain / newline -> one-time approval candidate
```

Desired behavior:

```text
compound command with only approved capabilities + safe glue/helpers -> auto-run
compound command with one unapproved reusable capability + safe glue/helpers -> persistent approval candidate
compound command with unsafe shell semantics or unsafe helpers -> one-time approval candidate
```

## Design Principles

1. Approve capabilities, not decoration.
   - `longbridge` is a host capability.
   - `head -30` after a pipe is output trimming.
   - `2>&1` is output stream glue.

2. Persistent whitelist approvals must be stable.
   - A persistent approval should represent a reusable executable capability such as `longbridge` or `agent-browser`.
   - A temporary generated script, multi-line install flow, or shell snippet should not become a persistent capability.

3. Auto-run requires all executable risk to be accounted for.
   - Safe glue can be ignored.
   - Safe helper commands can be ignored only under restricted forms.
   - Every non-helper command must map to an approved capability or create an approval request.

4. Unclear shell semantics must degrade to one-time approval.
   - If the parser cannot confidently understand the command, it should not infer safety.
   - Dynamic execution and code evaluation are always one-time approval candidates or rejected by policy.

5. Channel behavior stays unchanged.
   - Classification belongs in the shared Host Bash / bash tool layer.
   - Telegram, Feishu, QQ, Weixin, and Web should only render the resulting approval request.

## Concepts

### Capability Command

A command segment that represents host access Molibot may want to approve persistently.

Examples:

```bash
longbridge news FIG.US
agent-browser open https://www.feishu.cn
gh pr checks
scripts/search-news.sh '{"query":"robotics"}'
```

Persistent approval key:

```text
toolId = sanitizeHostBashId(executable)
```

For a path executable, use the normalized executable identity, not the whole argv:

```text
./scripts/search-news.sh -> scripts-search-news.sh
/opt/tools/search-news.sh -> opt-tools-search-news.sh
```

Do not persist machine-specific absolute paths as examples or defaults in user-facing docs. Runtime may still store an actual command path when the user approves it.

### Safe Glue

Shell syntax that connects or formats command execution but does not itself introduce an unapproved capability.

Allowed safe glue for the first version:

| Syntax | Meaning | Classification |
| --- | --- | --- |
| `|` | pipeline | safe glue |
| `2>&1` | merge stderr into stdout | safe glue |
| `1>&2` | merge stdout into stderr | safe glue |
| `&&` | run next command on success | safe glue, but both sides still classified |
| `;` | sequential execution | safe glue, but both sides still classified |

Do not treat these as safe in the first version:

| Syntax | Reason |
| --- | --- |
| `||` | often hides failure and changes control flow; defer until explicitly needed |
| `&` | background execution makes lifecycle/audit unclear |
| `(...)` | subshell changes cwd/env semantics |
| `{ ...; }` | grouping changes redirect scope |
| `<`, `<<`, `<<<` | file/stdin input can smuggle content or heredocs |
| `>`, `>>` | writes files |
| `2>`, `&>`, `>|` | writes or changes output destination beyond simple merge |
| `$()` | dynamic command substitution |
| backticks | dynamic command substitution |
| process substitution `<(...)` / `>(...)` | dynamic hidden commands |

### Safe Helper Command

A command that may be ignored for Host Bash approval only when it appears in a restricted, read-only form.

Safe helper does not mean globally safe. It means "safe enough for approval classification under strict syntax."

Initial allowlist:

| Command | Allowed forms | Notes |
| --- | --- | --- |
| `head` | `head`, `head -30`, `head -n 30` | output trimming only |
| `tail` | `tail`, `tail -30`, `tail -n 30` | output trimming only |
| `wc` | `wc`, `wc -l`, `wc -c`, `wc -m` | counting output |
| `sort` | `sort` | no file args in V1 |
| `uniq` | `uniq`, `uniq -c` | no file args in V1 |
| `cut` | `cut -d X -f N`, `cut -c N-M` | no file args in V1 |
| `tr` | `tr A B`, `tr -d A` | no file args in V1 |
| `jq` | `jq FILTER` | no `-f`, no file args, no output write |
| `grep` | `grep PATTERN`, `grep -i PATTERN`, `grep -E PATTERN`, `grep -v PATTERN` | only pipeline filter, no file args |
| `rg` | `rg PATTERN`, `rg -i PATTERN`, `rg -n PATTERN` | only pipeline filter, no path args in V1 |
| `sed` | `sed -n SCRIPT` where SCRIPT is print-only | reject `-i`, `w`, `r`, `e` commands |
| `sleep` | `sleep N` where `0 <= N <= 30` | safe timing helper |
| `true` | `true` | no-op |
| `false` | `false` | no-op failure marker |

Explicitly not safe helpers:

| Command | Reason |
| --- | --- |
| `tee` | writes files unless heavily restricted |
| `xargs` | dynamically executes commands |
| `find` | can traverse broad paths and run `-exec` |
| `awk` | full mini-language; defer until needed |
| `curl`, `wget` | network side effects and downloads |
| `bash`, `sh`, `zsh`, `fish` | arbitrary shell execution |
| `node`, `python`, `python3`, `ruby`, `perl` | arbitrary code execution |
| `npm`, `pnpm`, `yarn`, `brew` | install/runtime side effects |
| `rm`, `mv`, `cp`, `mkdir`, `chmod`, `chown` | filesystem mutation |
| `open`, `osascript`, `launchctl` | host/UI/system side effects |
| `git` | mixed read/write behavior; allow only through explicit future rules |

## Classification Output

Add a shared classifier that returns a structured result.

Suggested types:

```ts
export type HostBashCommandClassification =
  | {
      kind: "persistent-capability";
      capability: HostBashCapability;
      originalCommand: string;
      safeHelpers: HostBashSafeHelper[];
      safeGlue: HostBashSafeGlue[];
      warnings: string[];
    }
  | {
      kind: "compound-capabilities";
      capabilities: HostBashCapability[];
      originalCommand: string;
      safeHelpers: HostBashSafeHelper[];
      safeGlue: HostBashSafeGlue[];
      warnings: string[];
    }
  | {
      kind: "one-time-script";
      originalCommand: string;
      reason: string;
      detectedTokens: string[];
    };

export interface HostBashCapability {
  executable: string;
  toolId: string;
  argv: string[];
  originalSegment: string;
}

export interface HostBashSafeHelper {
  executable: string;
  argv: string[];
  originalSegment: string;
  reason: string;
}

export interface HostBashSafeGlue {
  token: string;
  reason: string;
}
```

Runtime decision derived from the classification:

```text
persistent-capability:
  if capability is whitelisted -> execute originalCommand
  else -> request persistent approval for capability

compound-capabilities:
  if all capabilities are whitelisted -> execute originalCommand
  if exactly one capability is not whitelisted -> request persistent approval for that capability
  if multiple capabilities are not whitelisted -> request grouped approvals or degrade to one-time based on UX readiness

one-time-script:
  request one-time approval for exact originalCommand
```

For V1, prefer this simpler product rule:

```text
multiple unapproved capabilities -> one-time approval
```

Reason: current Host Bash approval UI and auto-resume flow expect one pending action. Grouped approvals can be a follow-up.

## Parsing Strategy

### V1 Parser Scope

Implement a small shell lexer/parser, not a full shell interpreter.

Supported:

- words
- single quotes
- double quotes
- backslash escaping inside words
- safe glue listed above
- simple redirection token `2>&1` and `1>&2`

Rejected/degraded:

- unclosed quotes
- command substitution
- variable assignment prefixes such as `FOO=bar cmd`
- env invocation such as `env FOO=bar cmd`
- heredoc
- glob expansion with `*`, `?`, `[]`
- subshell/grouping
- redirects that read/write files
- background execution

The output should be a sequence of command segments and glue tokens:

```ts
type ShellPlanNode =
  | { type: "command"; words: string[]; original: string }
  | { type: "glue"; token: "|" | "&&" | ";" | "2>&1" | "1>&2"; original: string }
  | { type: "unsupported"; token: string; reason: string };
```

### Segment Classification

For each command segment:

1. If empty, ignore.
2. If executable matches safe helper and argv is allowed, classify as `safe-helper`.
3. Else if executable is forbidden (`bash`, `python`, `node`, etc.), classify whole command as `one-time-script`.
4. Else classify as `capability`.

Important detail:

```text
safe helper is only safe if every argument passes the command-specific validator
```

Examples:

```text
head -30 -> safe-helper
head /etc/passwd -> not safe helper
sed -n '1,30p' -> safe-helper
sed -i 's/a/b/' file -> one-time-script
grep error -> safe-helper when used as pipeline filter
grep error secrets.txt -> one-time-script
```

## Approval Mode Decision Table

| Classification | Whitelist state | Approval mode | Pending action |
| --- | --- | --- | --- |
| one capability + safe glue/helpers | capability approved | no approval; run original command | none |
| one capability + safe glue/helpers | capability not approved | persistent | `run_approved_host_bash` with original compound command |
| same capability repeated + safe glue/helpers | capability approved | no approval; run original command | none |
| same capability repeated + safe glue/helpers | capability not approved | persistent | `run_approved_host_bash` with original compound command |
| multiple capabilities + safe glue/helpers | all approved | no approval; run original command | none |
| multiple capabilities + safe glue/helpers | exactly one unapproved | persistent for the unapproved capability | `run_approved_host_bash` with original compound command |
| multiple capabilities + safe glue/helpers | more than one unapproved | one-time in V1 | `run_one_time_host_script` |
| unsafe helper or unsupported shell syntax | any | one-time | `run_one_time_host_script` |
| dynamic execution | any | one-time or reject | `run_one_time_host_script` only if operator explicitly approves |

Why a persistent approval can store a compound `originalCommand`:

- The persistent grant is for the capability executable.
- The pending action executes the exact original command that triggered approval.
- Future runs still classify the future original command before auto-running; they do not blindly reuse the old compound shell shape.

## Examples

### Longbridge With Output Trimming

Input:

```bash
longbridge news FIG.US 2>&1 | head -30
```

Classification:

```text
capability: longbridge ["news", "FIG.US"]
safe glue: 2>&1, |
safe helper: head ["-30"]
```

Decision:

- If `longbridge` is approved: auto-run original command.
- If not approved: persistent approval for `longbridge`.

### Longbridge Quote

Input:

```bash
longbridge quote FIG.US 2>&1 | head -20
```

Decision is the same as Longbridge news.

### Agent Browser Chain

Input:

```bash
agent-browser open https://www.feishu.cn && sleep 3 && agent-browser wait --load networkidle && agent-browser screenshot "$MOLIBOT_SCRATCH_ARTIFACT_DIR/feishu-screenshot.png" && agent-browser close
```

Classification:

```text
capability: agent-browser ["open", "https://www.feishu.cn"]
safe glue: &&
safe helper: sleep ["3"]
capability: agent-browser ["wait", "--load", "networkidle"]
safe glue: &&
capability: agent-browser ["screenshot", "$MOLIBOT_SCRATCH_ARTIFACT_DIR/feishu-screenshot.png"]
safe glue: &&
capability: agent-browser ["close"]
```

Decision:

- If `agent-browser` is approved: auto-run original command.
- If not approved: persistent approval for `agent-browser`.

Note: screenshot writes a file, but that side effect belongs to the approved `agent-browser` capability, not to shell glue. The approval prompt should show the full original command so the operator sees the screenshot path.

### Web Search Script

Input:

```bash
skills/web-search/scripts/baidu_fast_search.sh '{"query":"robotics","max_results":5}' 2>&1
```

Classification:

```text
capability: skills/web-search/scripts/baidu_fast_search.sh [...]
safe glue: 2>&1
```

Decision:

- If the script capability is approved: auto-run.
- If not approved: persistent approval for that script.

### Install Flow

Input:

```bash
mkdir -p ~/.molibot/skills
mv ./weread-skills ~/.molibot/skills/
```

Classification:

```text
one-time-script
reason: contains newline and filesystem mutation commands
```

Decision:

- one-time approval only.

### Dynamic Command Substitution

Input:

```bash
longbridge quote "$(cat ticker.txt)"
```

Classification:

```text
one-time-script
reason: command substitution is dynamic shell execution
```

Decision:

- one-time approval or reject.

## Approval Prompt Changes

The approval prompt should make the distinction visible to the operator.

For persistent capability approval:

```text
Mode: persistent
Capability: longbridge
Original command: longbridge news FIG.US 2>&1 | head -30
Ignored safe helpers: head -30
Ignored safe glue: 2>&1, |
Reason: Sandbox denied host-level access for longbridge.
Effect: Approving will allow future longbridge commands that pass command classification.
```

For one-time approval:

```text
Mode: one-time
Original command: mkdir -p ... && mv ...
Reason: contains filesystem mutation and cannot be safely reduced to one reusable capability.
Effect: Approving will run only this exact command once.
```

Do not hide safe helpers from the audit record. They should be marked as safe/ignored, not omitted.

## Data Model Impact

No schema change is required for V1.

Current fields can carry the needed information:

- `approval_requests.capability` stores `bash:${toolId}`.
- `approval_requests.action_json.pendingAction.originalCommand` stores the exact original command to execute.
- `approval_requests.action_json.pendingAction.args` can store the primary capability argv for persistent approvals.
- `approval_requests.action_json` can optionally add:

```json
{
  "classification": {
    "kind": "persistent-capability",
    "capabilities": [
      {
        "executable": "longbridge",
        "toolId": "longbridge",
        "argv": ["news", "FIG.US"],
        "originalSegment": "longbridge news FIG.US"
      }
    ],
    "safeHelpers": [
      {
        "executable": "head",
        "argv": ["-30"],
        "originalSegment": "head -30",
        "reason": "output trimming"
      }
    ],
    "safeGlue": [
      { "token": "2>&1", "reason": "stderr merge" },
      { "token": "|", "reason": "pipeline" }
    ],
    "warnings": []
  }
}
```

This is backward compatible because `action_json` is already JSON.

