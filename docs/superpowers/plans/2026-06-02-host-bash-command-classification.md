# Host Bash Command Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce unnecessary one-time Host Bash approvals by classifying compound shell commands into reusable host capabilities plus safe glue/helper commands.

**Architecture:** Add a focused classifier under `src/lib/server/hostBash/` that tokenizes a conservative subset of shell syntax and returns structured approval intent. Wire that classifier into the existing Host Bash approval path in `approval.ts` and `bash.ts`, keeping channel runtimes unchanged and storing optional audit metadata in existing `action_json`.

**Tech Stack:** TypeScript, Node 22 `node:test`, SvelteKit, SQLite-backed Host Bash approval store, existing shadcn-svelte settings UI.

---

## Source Spec

Implementation should follow:

- `docs/sandbox-approval/host-bash-command-classification-design.md`
- Existing Host Bash flow in `src/lib/server/hostBash/approval.ts`
- Existing bash tool flow in `src/lib/server/agent/tools/bash.ts`
- Existing Host Bash tests in `src/lib/server/agent/tools/bash-output.test.ts`

## File Structure

Create:

- `src/lib/server/hostBash/commandClassifier.ts`
  - Owns shell tokenization, safe glue detection, safe helper validation, capability extraction, and one-time degradation reasons.
- `src/lib/server/hostBash/commandClassifier.test.ts`
  - Unit tests for classifier behavior, independent from bash execution.

Modify:

- `src/lib/server/hostBash/index.ts`
  - Re-export classifier types/functions.
- `src/lib/server/hostBash/types.ts`
  - Add optional classification metadata types to approval records and prompt request payload.
- `src/lib/server/hostBash/approval.ts`
  - Use classifier in `parseHostBashApprovalCommand()`.
  - Include classification metadata in `createHostBashApprovalRecord()`.
  - Make prompt text explain persistent vs one-time classification.
- `src/lib/server/hostBash/store.ts`
  - Persist `classification` inside existing `action_json`.
  - Read it back into approval records.
- `src/lib/server/agent/tools/bash.ts`
  - Recognize approved capabilities in compound commands with only safe glue/helpers.
  - Preserve one-time behavior for unsafe compound commands.
- `src/lib/server/agent/tools/bash-output.test.ts`
  - Add regression tests for approved and unapproved compound commands.
- `src/routes/settings/host-bash/+page.svelte`
  - Display classification metadata in audit tables.
- `docs/sandbox-approval/host-bash-command-classification-design.md`
  - Update after implementation only if behavior changes from the design.
- `features.md`, `prd.md`, `CHANGELOG.md`, `README.md`
  - Update at the end because this is a user-visible Host Bash behavior change.

## Task 1: Add Classifier Unit Tests

**Files:**
- Create: `src/lib/server/hostBash/commandClassifier.test.ts`
- Later implementation target: `src/lib/server/hostBash/commandClassifier.ts`

- [ ] **Step 1: Create failing classifier tests**

Create `src/lib/server/hostBash/commandClassifier.test.ts` with:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { classifyHostBashCommand } from "$lib/server/hostBash/commandClassifier.js";

test("classifies longbridge piped to head as persistent capability plus safe helper", () => {
  const result = classifyHostBashCommand("longbridge news FIG.US 2>&1 | head -30");

  assert.equal(result.kind, "persistent-capability");
  assert.equal(result.capability.toolId, "longbridge");
  assert.deepEqual(result.capability.argv, ["news", "FIG.US"]);
  assert.deepEqual(result.safeGlue.map((item) => item.token), ["2>&1", "|"]);
  assert.deepEqual(result.safeHelpers.map((item) => item.originalSegment), ["head -30"]);
});

test("classifies repeated agent-browser chain as compound capabilities for one tool id", () => {
  const result = classifyHostBashCommand("agent-browser open https://example.com && sleep 3 && agent-browser wait --load networkidle && agent-browser close");

  assert.equal(result.kind, "compound-capabilities");
  assert.deepEqual([...new Set(result.capabilities.map((item) => item.toolId))], ["agent-browser"]);
  assert.deepEqual(result.safeHelpers.map((item) => item.originalSegment), ["sleep 3"]);
  assert.equal(result.capabilities.length, 3);
});

test("classifies script with stderr merge as persistent capability", () => {
  const result = classifyHostBashCommand("skills/web-search/scripts/baidu_fast_search.sh '{\"query\":\"robotics\",\"max_results\":5}' 2>&1");

  assert.equal(result.kind, "persistent-capability");
  assert.equal(result.capability.executable, "skills/web-search/scripts/baidu_fast_search.sh");
  assert.equal(result.capability.toolId, "skills-web-search-scripts-baidu-fast-search.sh");
  assert.deepEqual(result.safeGlue.map((item) => item.token), ["2>&1"]);
});

test("degrades tee output write to one-time script", () => {
  const result = classifyHostBashCommand("longbridge quote FIG.US | tee quote.txt");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /tee/i);
});

test("degrades command substitution to one-time script", () => {
  const result = classifyHostBashCommand("longbridge quote $(cat ticker.txt)");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /command substitution/i);
});

test("degrades file output redirection to one-time script", () => {
  const result = classifyHostBashCommand("longbridge quote FIG.US > out.txt");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /redirect/i);
});

test("does not treat helper file arguments as safe", () => {
  const result = classifyHostBashCommand("longbridge quote FIG.US | head /etc/passwd");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /head/i);
});

test("degrades env assignment prefix to one-time script", () => {
  const result = classifyHostBashCommand("LONGBRIDGE_DEBUG=1 longbridge quote FIG.US");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /environment assignment/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --import tsx --test src/lib/server/hostBash/commandClassifier.test.ts
```

Expected:

```text
FAIL
Cannot find module .../src/lib/server/hostBash/commandClassifier.js
```

- [ ] **Step 3: Commit failing tests**

```bash
git add src/lib/server/hostBash/commandClassifier.test.ts
git commit -m "test: cover host bash command classification"
```

## Task 2: Implement Host Bash Command Classifier

**Files:**
- Create: `src/lib/server/hostBash/commandClassifier.ts`
- Modify: `src/lib/server/hostBash/index.ts`
- Test: `src/lib/server/hostBash/commandClassifier.test.ts`

- [ ] **Step 1: Create classifier implementation**

Create `src/lib/server/hostBash/commandClassifier.ts` with:

```ts
import { basename } from "node:path";
import { sanitizeHostBashId, sanitizeHostBashCommand } from "$lib/server/hostBash/approval.js";

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
  token: "|" | "&&" | ";" | "2>&1" | "1>&2";
  reason: string;
}

export type HostBashCommandClassification =
  | {
      kind: "persistent-capability";
      capability: HostBashCapability;
      capabilities: HostBashCapability[];
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

type ShellPlanNode =
  | { type: "command"; words: string[]; original: string }
  | { type: "glue"; token: HostBashSafeGlue["token"]; original: string }
  | { type: "unsupported"; token: string; reason: string };

const FORBIDDEN_EXECUTABLES = new Set(["bash", "sh", "zsh", "fish", "node", "python", "python3", "ruby", "perl"]);
const UNSAFE_HELPERS = new Set(["tee", "xargs", "find", "awk", "curl", "wget", "npm", "pnpm", "yarn", "brew", "rm", "mv", "cp", "mkdir", "chmod", "chown", "open", "osascript", "launchctl", "git"]);

function oneTime(originalCommand: string, reason: string, detectedTokens: string[] = []): HostBashCommandClassification {
  return {
    kind: "one-time-script",
    originalCommand,
    reason,
    detectedTokens
  };
}

function executableName(value: string): string {
  return basename(value).toLowerCase();
}

function capabilityFromWords(words: string[], originalSegment: string): HostBashCapability | null {
  const executable = words[0] ?? "";
  const command = sanitizeHostBashCommand(executable);
  if (!command) return null;
  return {
    executable,
    toolId: sanitizeHostBashId(command),
    argv: words.slice(1).map((item) => item.slice(0, 4096)).slice(0, 80),
    originalSegment
  };
}

function isPlainPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function isHeadTailArgs(argv: string[]): boolean {
  if (argv.length === 0) return true;
  if (argv.length === 1) return /^-\d+$/.test(argv[0] ?? "");
  return argv.length === 2 && argv[0] === "-n" && isPlainPositiveInteger(argv[1] ?? "");
}

function isWcArgs(argv: string[]): boolean {
  return argv.length === 0 || (argv.length === 1 && ["-l", "-c", "-m"].includes(argv[0] ?? ""));
}

function isSortArgs(argv: string[]): boolean {
  return argv.length === 0;
}

function isUniqArgs(argv: string[]): boolean {
  return argv.length === 0 || (argv.length === 1 && argv[0] === "-c");
}

function isCutArgs(argv: string[]): boolean {
  if (argv.length === 2 && argv[0] === "-c") return /^[0-9,-]+$/.test(argv[1] ?? "");
  if (argv.length === 4 && argv[0] === "-d" && argv[2] === "-f") return /^[0-9,-]+$/.test(argv[3] ?? "");
  return false;
}

function isTrArgs(argv: string[]): boolean {
  if (argv.length === 2) return true;
  return argv.length === 2 && argv[0] === "-d";
}

function isJqArgs(argv: string[]): boolean {
  if (argv.length !== 1) return false;
  return !argv[0]?.startsWith("-");
}

function isGrepArgs(argv: string[]): boolean {
  if (argv.length === 1) return true;
  if (argv.length === 2 && ["-i", "-E", "-v", "-n"].includes(argv[0] ?? "")) return true;
  return false;
}

function isRgArgs(argv: string[]): boolean {
  if (argv.length === 1) return true;
  if (argv.length === 2 && ["-i", "-n"].includes(argv[0] ?? "")) return true;
  return false;
}

function isSedArgs(argv: string[]): boolean {
  if (argv.length !== 2 || argv[0] !== "-n") return false;
  const script = argv[1] ?? "";
  if (/[iweqr]/.test(script)) return false;
  return /p\s*$/.test(script);
}

function isSleepArgs(argv: string[]): boolean {
  if (argv.length !== 1 || !/^\d+(?:\.\d+)?$/.test(argv[0] ?? "")) return false;
  const seconds = Number(argv[0]);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 30;
}

function classifySafeHelper(words: string[], originalSegment: string): HostBashSafeHelper | null {
  const executable = executableName(words[0] ?? "");
  const argv = words.slice(1);
  const allowed =
    (executable === "head" && isHeadTailArgs(argv)) ||
    (executable === "tail" && isHeadTailArgs(argv)) ||
    (executable === "wc" && isWcArgs(argv)) ||
    (executable === "sort" && isSortArgs(argv)) ||
    (executable === "uniq" && isUniqArgs(argv)) ||
    (executable === "cut" && isCutArgs(argv)) ||
    (executable === "tr" && isTrArgs(argv)) ||
    (executable === "jq" && isJqArgs(argv)) ||
    (executable === "grep" && isGrepArgs(argv)) ||
    (executable === "rg" && isRgArgs(argv)) ||
    (executable === "sed" && isSedArgs(argv)) ||
    (executable === "sleep" && isSleepArgs(argv)) ||
    (executable === "true" && argv.length === 0) ||
    (executable === "false" && argv.length === 0);
  return allowed
    ? { executable, argv, originalSegment, reason: executable === "sleep" ? "timing helper" : "read-only output helper" }
    : null;
}

function glueReason(token: HostBashSafeGlue["token"]): string {
  if (token === "2>&1") return "stderr merge";
  if (token === "1>&2") return "stdout merge";
  if (token === "|") return "pipeline";
  if (token === "&&") return "success chain";
  return "command separator";
}

function lexShellPlan(raw: string): ShellPlanNode[] {
  const nodes: ShellPlanNode[] = [];
  let words: string[] = [];
  let current = "";
  let segmentStart = 0;
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  const pushWord = (): void => {
    if (!current) return;
    words.push(current);
    current = "";
  };

  const pushCommand = (endIndex: number): void => {
    pushWord();
    if (words.length === 0) return;
    nodes.push({
      type: "command",
      words,
      original: raw.slice(segmentStart, endIndex).trim()
    });
    words = [];
  };

  const pushGlue = (token: HostBashSafeGlue["token"], start: number, end: number): void => {
    pushCommand(start);
    nodes.push({ type: "glue", token, original: raw.slice(start, end) });
    segmentStart = end;
  };

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? "";
    const next = raw[i + 1] ?? "";
    const two = `${ch}${next}`;
    const four = raw.slice(i, i + 4);

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null; else current += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (ch === "`" || (ch === "$" && next === "(")) {
      nodes.push({ type: "unsupported", token: ch === "`" ? "`" : "$(", reason: "command substitution is not safe for reusable Host Bash approval" });
      return nodes;
    }
    if (four === "2>&1" || four === "1>&2") {
      pushGlue(four as HostBashSafeGlue["token"], i, i + 4);
      i += 3;
      continue;
    }
    if (two === "&&") {
      pushGlue("&&", i, i + 2);
      i += 1;
      continue;
    }
    if (two === "||" || two === ">>" || two === "<<" || two === "&>" || two === ">|") {
      nodes.push({ type: "unsupported", token: two, reason: `unsupported shell operator ${two}` });
      return nodes;
    }
    if (ch === "|" || ch === ";") {
      pushGlue(ch as HostBashSafeGlue["token"], i, i + 1);
      continue;
    }
    if ([">", "<", "&", "(", ")", "{", "}"].includes(ch)) {
      nodes.push({ type: "unsupported", token: ch, reason: `unsupported shell token ${ch}` });
      return nodes;
    }
    if (/\s/.test(ch)) {
      pushWord();
      continue;
    }
    current += ch;
  }

  if (escaping || quote) {
    nodes.push({ type: "unsupported", token: quote ?? "\\", reason: "unmatched shell quote or escape" });
    return nodes;
  }
  pushCommand(raw.length);
  return nodes;
}

export function classifyHostBashCommand(input: string): HostBashCommandClassification {
  const raw = String(input ?? "").trim();
  if (!raw) return oneTime(raw, "command is empty");
  if (/[\r\n]/.test(raw)) return oneTime(raw, "multi-line shell scripts require one-time approval", ["newline"]);
  if (/\b[A-Za-z_][A-Za-z0-9_]*=/.test(raw.split(/\s+/)[0] ?? "")) {
    return oneTime(raw, "environment assignment prefixes require one-time approval", [raw.split(/\s+/)[0] ?? ""]);
  }

  const nodes = lexShellPlan(raw);
  const unsupported = nodes.find((node) => node.type === "unsupported");
  if (unsupported?.type === "unsupported") return oneTime(raw, unsupported.reason, [unsupported.token]);

  const capabilities: HostBashCapability[] = [];
  const safeHelpers: HostBashSafeHelper[] = [];
  const safeGlue: HostBashSafeGlue[] = [];

  for (const node of nodes) {
    if (node.type === "glue") {
      safeGlue.push({ token: node.token, reason: glueReason(node.token) });
      continue;
    }
    if (node.type !== "command") continue;

    const executable = executableName(node.words[0] ?? "");
    const safeHelper = classifySafeHelper(node.words, node.original);
    if (safeHelper) {
      safeHelpers.push(safeHelper);
      continue;
    }
    if (UNSAFE_HELPERS.has(executable)) return oneTime(raw, `${executable} is not a safe helper`, [executable]);
    if (FORBIDDEN_EXECUTABLES.has(executable)) return oneTime(raw, `${executable} cannot be approved as a reusable Host Bash capability`, [executable]);

    const capability = capabilityFromWords(node.words, node.original);
    if (!capability) return oneTime(raw, `could not derive a Host Bash capability from ${node.original}`, [node.original]);
    capabilities.push(capability);
  }

  if (capabilities.length === 0) return oneTime(raw, "command has no reusable Host Bash capability");
  if (capabilities.length === 1) {
    return {
      kind: "persistent-capability",
      capability: capabilities[0],
      capabilities,
      originalCommand: raw,
      safeHelpers,
      safeGlue,
      warnings: []
    };
  }

  return {
    kind: "compound-capabilities",
    capabilities,
    originalCommand: raw,
    safeHelpers,
    safeGlue,
    warnings: []
  };
}
```

- [ ] **Step 2: Re-export classifier**

Modify `src/lib/server/hostBash/index.ts` to:

```ts
export * from "$lib/server/hostBash/types.js";
export * from "$lib/server/hostBash/approval.js";
export * from "$lib/server/hostBash/store.js";
export * from "$lib/server/hostBash/commandClassifier.js";
```

- [ ] **Step 3: Run classifier tests**

Run:

```bash
node --import tsx --test src/lib/server/hostBash/commandClassifier.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 4: Commit classifier**

```bash
git add src/lib/server/hostBash/commandClassifier.ts src/lib/server/hostBash/index.ts src/lib/server/hostBash/commandClassifier.test.ts
git commit -m "feat: classify host bash compound commands"
```

## Task 3: Wire Classifier Into Approval Records

**Files:**
- Modify: `src/lib/server/hostBash/types.ts`
- Modify: `src/lib/server/hostBash/approval.ts`
- Modify: `src/lib/server/hostBash/store.ts`
- Test: `src/lib/server/hostBash/commandClassifier.test.ts`

- [ ] **Step 1: Add classification metadata types**

Modify `src/lib/server/hostBash/types.ts` by adding these interfaces after `HostBashPermissions`:

```ts
export interface HostBashCapabilityClassification {
  executable: string;
  toolId: string;
  argv: string[];
  originalSegment: string;
}

export interface HostBashSafeHelperClassification {
  executable: string;
  argv: string[];
  originalSegment: string;
  reason: string;
}

export interface HostBashSafeGlueClassification {
  token: string;
  reason: string;
}

export interface HostBashApprovalClassification {
  kind: "persistent-capability" | "compound-capabilities" | "one-time-script";
  capabilities?: HostBashCapabilityClassification[];
  safeHelpers?: HostBashSafeHelperClassification[];
  safeGlue?: HostBashSafeGlueClassification[];
  reason?: string;
  detectedTokens?: string[];
  warnings?: string[];
}
```

Then add this optional field to `HostBashApprovalRecord`:

```ts
classification?: HostBashApprovalClassification;
```

And add this optional field to `HostBashApprovalPrompt["request"]`:

```ts
classification?: HostBashApprovalClassification;
```

- [ ] **Step 2: Extend parsed approval command types**

Modify `src/lib/server/hostBash/approval.ts` imports:

```ts
import { classifyHostBashCommand, type HostBashCommandClassification } from "$lib/server/hostBash/commandClassifier.js";
```

Extend `PersistentHostBashCommand` and `EphemeralHostBashCommand`:

```ts
interface PersistentHostBashCommand {
  approvalMode: "persistent";
  toolId: string;
  command: string;
  args: string[];
  originalCommand: string;
  classification?: HostBashApprovalRecord["classification"];
}

interface EphemeralHostBashCommand {
  approvalMode: "ephemeral";
  toolId: string;
  command: string;
  originalCommand: string;
  classification?: HostBashApprovalRecord["classification"];
}
```

Add helper functions before `parseHostBashApprovalCommand()`:

```ts
function toApprovalClassification(classification: HostBashCommandClassification): HostBashApprovalRecord["classification"] {
  if (classification.kind === "one-time-script") {
    return {
      kind: "one-time-script",
      reason: classification.reason,
      detectedTokens: classification.detectedTokens
    };
  }
  return {
    kind: classification.kind,
    capabilities: classification.capabilities,
    safeHelpers: classification.safeHelpers,
    safeGlue: classification.safeGlue,
    warnings: classification.warnings
  };
}

function uniqueCapabilityIds(classification: Exclude<HostBashCommandClassification, { kind: "one-time-script" }>): string[] {
  return [...new Set(classification.capabilities.map((item) => item.toolId).filter(Boolean))];
}
```

- [ ] **Step 3: Replace approval parsing logic**

Replace the body of `parseHostBashApprovalCommand()` in `src/lib/server/hostBash/approval.ts` with:

```ts
export function parseHostBashApprovalCommand(input: string): ParsedHostBashApprovalCommand {
  const raw = sanitizeString(input);
  if (!raw) throw new Error("command is required for host bash approval requests.");

  const classification = classifyHostBashCommand(raw);
  if (classification.kind === "one-time-script") {
    const firstToken = raw.split(/\s+/)[0] ?? "";
    const sanitizedFirst = sanitizeHostBashCommand(firstToken);
    const toolId = sanitizeHostBashId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script");
    return {
      approvalMode: "ephemeral",
      toolId,
      command: raw.slice(0, 240),
      originalCommand: raw.slice(0, 4000),
      classification: toApprovalClassification(classification)
    };
  }

  const uniqueIds = uniqueCapabilityIds(classification);
  if (uniqueIds.length > 1) {
    const firstToken = raw.split(/\s+/)[0] ?? "";
    const sanitizedFirst = sanitizeHostBashCommand(firstToken);
    const toolId = sanitizeHostBashId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script");
    return {
      approvalMode: "ephemeral",
      toolId,
      command: raw.slice(0, 240),
      originalCommand: raw.slice(0, 4000),
      classification: {
        ...toApprovalClassification(classification),
        kind: "one-time-script",
        reason: "multiple unapproved Host Bash capabilities require one-time approval in V1",
        detectedTokens: uniqueIds
      }
    };
  }

  const capability = classification.capabilities[0];
  return {
    approvalMode: "persistent",
    toolId: capability.toolId,
    command: capability.executable,
    args: capability.argv,
    originalCommand: raw.slice(0, 4000),
    classification: toApprovalClassification(classification)
  };
}
```

- [ ] **Step 4: Store classification in approval records**

In `createHostBashApprovalRecord()` in `src/lib/server/hostBash/approval.ts`, add `classification` to the input object type:

```ts
classification?: unknown;
```

Add this sanitizer near `sanitizeHostBashPendingAction()`:

```ts
function sanitizeHostBashClassification(input: unknown): HostBashApprovalRecord["classification"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const kind = sanitizeString(source.kind);
  if (kind !== "persistent-capability" && kind !== "compound-capabilities" && kind !== "one-time-script") return undefined;
  return {
    kind,
    capabilities: Array.isArray(source.capabilities) ? source.capabilities as any : undefined,
    safeHelpers: Array.isArray(source.safeHelpers) ? source.safeHelpers as any : undefined,
    safeGlue: Array.isArray(source.safeGlue) ? source.safeGlue as any : undefined,
    reason: sanitizeOptionalString(source.reason, 1000),
    detectedTokens: sanitizeStringList(source.detectedTokens),
    warnings: sanitizeStringList(source.warnings)
  };
}
```

In the returned record object, add:

```ts
classification: sanitizeHostBashClassification(input.classification),
```

- [ ] **Step 5: Persist classification through store**

In `src/lib/server/hostBash/store.ts`, update `rowToApprovalRecord()` by adding:

```ts
classification: action.classification || undefined,
```

In `requestApproval()`, add `classification` to the `action` object:

```ts
classification: record.classification
```

- [ ] **Step 6: Pass parsed classification from bash approval request**

In `requestApprovalFromBash()` in `src/lib/server/agent/tools/bash.ts`, add this property to `store.requestApproval({ ... })`:

```ts
classification: parsed.classification,
```

The call should still pass `toolId`, `command`, `approvalMode`, `pendingAction`, and all channel/session fields.

- [ ] **Step 7: Run existing tests**

Run:

```bash
node --import tsx --test src/lib/server/hostBash/commandClassifier.test.ts src/lib/server/agent/tools/bash-output.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 8: Commit approval metadata wiring**

```bash
git add src/lib/server/hostBash/types.ts src/lib/server/hostBash/approval.ts src/lib/server/hostBash/store.ts src/lib/server/agent/tools/bash.ts
git commit -m "feat: store host bash command classification"
```

## Task 4: Auto-Run Approved Compound Capabilities

**Files:**
- Modify: `src/lib/server/agent/tools/bash.ts`
- Modify: `src/lib/server/agent/tools/bash-output.test.ts`
- Test: `src/lib/server/agent/tools/bash-output.test.ts`

- [ ] **Step 1: Add tests for approved compound commands**

Append these tests to `src/lib/server/agent/tools/bash-output.test.ts`:

```ts
test("bash executes approved Host Bash command with safe head pipeline without sandbox shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const approvedHostBash: ApprovedHostBashEntry = {
    id: "hbw-printf",
    toolId: "printf",
    displayName: "printf",
    command: "printf",
    reason: "approved for host execution",
    permissions: {
      envAllowlist: ["PATH"],
      filesystem: "scratch-only",
      network: "none"
    },
    approvedAt: "2026-06-02T00:00:00.000Z",
    approvedFromRecordId: "hba-printf",
    channel: "telegram",
    chatId: "chat-1",
    scopeId: "chat-1",
    enabled: true
  };
  let shellCalled = false;
  try {
    const def = getBashToolDefinition({
      cwd,
      sandbox: {
        settings: { ...defaultToolSandboxSettings, enabled: true },
        workspaceDir: cwd
      },
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: {
          getApprovedEntry: (toolId: string) => toolId === "printf" ? approvedHostBash : undefined
        } as any
      }
    });
    const result = await def.handler({
      label: "bash",
      command: "printf '%s\\n%s\\n' first second 2>&1 | head -1"
    }, {
      runId: "tool-1",
      sessionId: "session-1",
      workspaceId: "personal",
      actorId: "chat-1",
      cwd,
      fs: {
        readText: async () => "",
        writeText: async () => {}
      },
      shell: {
        run: async () => {
          shellCalled = true;
          return { exitCode: 1, stdout: "", stderr: "sandbox should not run" };
        }
      },
      network: {
        fetch: async () => ({})
      },
      emit: () => {}
    } satisfies ToolExecutionContext);

    assert.equal(result.ok, true);
    const item = Array.isArray(result.content) ? result.content[0] : undefined;
    assert.equal(item?.type === "text" ? item.text : "", "first");
    assert.equal(shellCalled, false);
    assert.equal((result.details as { hostBash?: boolean } | undefined)?.hostBash, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash requests persistent approval for unapproved command with safe head pipeline", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const pendingApprovals: HostBashApprovalRecord[] = [];
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: capturingHostBashStore(pendingApprovals)
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "longbridge news FIG.US 2>&1 | head -30",
      hostApproval: {
        reason: "Needs Longbridge host credentials or network outside the sandbox."
      }
    });

    assert.equal(pendingApprovals.length, 1);
    assert.equal(pendingApprovals[0]?.command, "longbridge");
    assert.equal(pendingApprovals[0]?.approvalMode, "persistent");
    assert.equal(pendingApprovals[0]?.pendingAction?.kind, "run_approved_host_bash");
    assert.equal(pendingApprovals[0]?.pendingAction?.originalCommand, "longbridge news FIG.US 2>&1 | head -30");
    assert.equal(pendingApprovals[0]?.classification?.kind, "persistent-capability");
    assert.match(firstText(result), /Host Bash approval requested/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify current behavior fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/tools/bash-output.test.ts
```

Expected:

```text
FAIL
```

The first new test should fail because `tryParseHostBashCommand()` still rejects pipes. The second new test should fail if the compound command is still treated as one-time.

- [ ] **Step 3: Add approved capability resolver**

In `src/lib/server/agent/tools/bash.ts`, update imports:

```ts
import {
  buildHostBashApprovalPrompt,
  classifyHostBashCommand,
  getHostBashStore,
  parseHostBashApprovalCommand,
  parseHostBashShellCommand,
  sanitizeHostBashId
} from "$lib/server/hostBash/index.js";
```

Add this interface near `ParsedHostBashCommand`:

```ts
interface ParsedHostBashCapabilityCommand {
  command: string;
  args: string[];
  originalCommand: string;
  requiredToolIds: string[];
}
```

Replace `tryParseHostBashCommand()` with:

```ts
export function tryParseHostBashCommand(command: string): ParsedHostBashCapabilityCommand | null {
  try {
    const parsed = parseHostBashShellCommand(command);
    return {
      command: parsed.command,
      args: parsed.args,
      originalCommand: parsed.originalCommand,
      requiredToolIds: [sanitizeHostBashId(parsed.command)]
    };
  } catch {
    const classified = classifyHostBashCommand(command);
    if (classified.kind === "one-time-script") return null;
    const requiredToolIds = [...new Set(classified.capabilities.map((item) => item.toolId).filter(Boolean))];
    if (requiredToolIds.length === 0) return null;
    const primary = classified.capabilities[0];
    return {
      command: primary.executable,
      args: primary.argv,
      originalCommand: classified.originalCommand,
      requiredToolIds
    };
  }
}
```

Replace `findApprovedHostBash()` with:

```ts
export function findApprovedHostBash(
  store: HostBashStore,
  parsed: ParsedHostBashCapabilityCommand | null
): ApprovedHostBashEntry | undefined {
  if (!parsed) return undefined;
  const approvedEntries = parsed.requiredToolIds
    .map((toolId) => store.getApprovedEntry(toolId))
    .filter((entry): entry is ApprovedHostBashEntry => Boolean(entry?.enabled));
  if (approvedEntries.length !== parsed.requiredToolIds.length) return undefined;
  return approvedEntries[0];
}
```

- [ ] **Step 4: Run bash tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/tools/bash-output.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 5: Commit auto-run behavior**

```bash
git add src/lib/server/agent/tools/bash.ts src/lib/server/agent/tools/bash-output.test.ts
git commit -m "feat: auto-run approved host bash pipelines"
```

## Task 5: Improve Approval Prompt and Settings Audit Display

**Files:**
- Modify: `src/lib/server/hostBash/approval.ts`
- Modify: `src/routes/settings/host-bash/+page.svelte`
- Test: `src/lib/server/agent/tools/bash-output.test.ts`

- [ ] **Step 1: Improve approval prompt text**

In `buildHostBashApprovalPrompt()` in `src/lib/server/hostBash/approval.ts`, add these helpers before the function:

```ts
function formatClassificationLines(request: HostBashApprovalRecord): string[] {
  const classification = request.classification;
  if (!classification) return [];
  if (classification.kind === "one-time-script") {
    return [
      classification.reason ? `One-time reason: ${classification.reason}` : "",
      classification.detectedTokens?.length ? `Detected tokens: ${classification.detectedTokens.join(", ")}` : ""
    ].filter(Boolean);
  }
  return [
    classification.capabilities?.length ? `Capabilities: ${classification.capabilities.map((item) => item.toolId).join(", ")}` : "",
    classification.safeHelpers?.length ? `Ignored safe helpers: ${classification.safeHelpers.map((item) => item.originalSegment).join(", ")}` : "",
    classification.safeGlue?.length ? `Ignored safe glue: ${classification.safeGlue.map((item) => item.token).join(", ")}` : ""
  ].filter(Boolean);
}
```

Then add `...formatClassificationLines(request),` inside the prompt `body` array after the `Command:` line.

Also add `classification: request.classification` inside `request: { ... }`.

- [ ] **Step 2: Extend settings page types**

In `src/routes/settings/host-bash/+page.svelte`, add these interfaces after `HostBashPendingAction`:

```ts
interface HostBashClassification {
  kind: "persistent-capability" | "compound-capabilities" | "one-time-script";
  capabilities?: Array<{ toolId: string; originalSegment: string }>;
  safeHelpers?: Array<{ originalSegment: string }>;
  safeGlue?: Array<{ token: string }>;
  reason?: string;
  detectedTokens?: string[];
}
```

Add to `PendingRecord`:

```ts
classification?: HostBashClassification;
```

Add this formatter near `formatPermissions()`:

```ts
function formatClassification(item: PendingRecord): string {
  const classification = item.classification;
  if (!classification) return "—";
  if (classification.kind === "one-time-script") {
    return classification.reason || "one-time script";
  }
  const helpers = classification.safeHelpers?.map((helper) => helper.originalSegment).join(", ") || "";
  const glue = classification.safeGlue?.map((entry) => entry.token).join(", ") || "";
  return [helpers ? `helpers: ${helpers}` : "", glue ? `glue: ${glue}` : ""].filter(Boolean).join(" / ") || classification.kind;
}
```

- [ ] **Step 3: Display classification in Pending table**

In the Pending table header, add a table head after `Command`:

```svelte
<TableHead>Classification</TableHead>
```

Update the empty-state colspan from `6` to `7`.

Add a cell after the command cell:

```svelte
<TableCell class="max-w-[22rem] text-xs">{formatClassification(item)}</TableCell>
```

- [ ] **Step 4: Display classification in History table**

Find the History table in the same file and add the same `Classification` column near `Command`. Use:

```svelte
<TableCell class="max-w-[22rem] text-xs">{formatClassification(item)}</TableCell>
```

Update the empty-state colspan for the History table by adding one to the current value.

- [ ] **Step 5: Run focused tests and build check**

Run:

```bash
node --import tsx --test src/lib/server/agent/tools/bash-output.test.ts
npm run build
```

Expected:

```text
PASS
build completes without TypeScript or Svelte errors
```

- [ ] **Step 6: Commit prompt and audit display**

```bash
git add src/lib/server/hostBash/approval.ts src/routes/settings/host-bash/+page.svelte
git commit -m "feat: explain host bash command classification"
```

## Task 6: Update Product Docs

**Files:**
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Optionally modify: `docs/sandbox-approval/host-bash-command-classification-design.md`

- [ ] **Step 1: Update `features.md`**

Add a dated entry under the most relevant Host Bash or execution section:

```md
### 2026-06-02 - Host Bash command classification

- Added command classification for Host Bash approval requests.
- Approved reusable capabilities such as `longbridge` and `agent-browser` can now cover safe shell glue and read-only output helpers like `2>&1`, `|`, `head`, and `sleep`.
- Unsafe shell constructs, file mutation, dynamic execution, and unclear scripts remain one-time approvals.
```

- [ ] **Step 2: Update `prd.md`**

Move or mark the Host Bash approval-noise requirement as delivered. Add this acceptance text if there is no existing section:

```md
### Host Bash command classification

Status: Delivered
Priority: High

Acceptance:
- `longbridge news FIG.US 2>&1 | head -30` uses the `longbridge` persistent approval when available.
- Unapproved reusable commands with safe glue request persistent approval instead of one-time approval.
- Commands with file mutation, dynamic shell execution, or unsupported syntax remain one-time approvals.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add a high-level release note:

```md
## 2026-06-02

- Improved Host Bash approvals so safe output helpers and shell glue no longer force reusable commands into one-time approval prompts.
```

- [ ] **Step 4: Update `README.md`**

If README has a docs navigation section, add or update a link:

```md
- Host Bash command classification design: `docs/sandbox-approval/host-bash-command-classification-design.md`
```

If README does not have a suitable docs navigation section, add the link near existing sandbox or Host Bash documentation links.

- [ ] **Step 5: Run final verification**

Run:

```bash
node --import tsx --test src/lib/server/hostBash/commandClassifier.test.ts src/lib/server/agent/tools/bash-output.test.ts
npm run build
```

Expected:

```text
PASS
build completes without TypeScript or Svelte errors
```

- [ ] **Step 6: Commit docs**

```bash
git add features.md prd.md CHANGELOG.md README.md docs/sandbox-approval/host-bash-command-classification-design.md
git commit -m "docs: record host bash classification behavior"
```

## Security Review Checklist

Run this checklist before merging:

- [ ] `head /etc/passwd` is not a safe helper.
- [ ] `grep pattern file.txt` is not a safe helper in V1.
- [ ] `rg pattern path` is not a safe helper in V1.
- [ ] `sed -i 's/a/b/' file` is one-time.
- [ ] `longbridge quote FIG.US > out.txt` is one-time.
- [ ] `longbridge quote FIG.US | tee out.txt` is one-time.
- [ ] `curl URL | bash` is one-time or rejected.
- [ ] `python -c 'print(1)'` is one-time or rejected.
- [ ] `LONGBRIDGE_DEBUG=1 longbridge quote FIG.US` is one-time.
- [ ] Approval prompt shows the exact original command that will execute.
- [ ] Approval prompt shows ignored helpers/glue for persistent capability approvals.
- [ ] Channels only render approval prompts; channel runtimes do not perform classification.

## Final Verification Commands

Run:

```bash
node --import tsx --test src/lib/server/hostBash/commandClassifier.test.ts src/lib/server/agent/tools/bash-output.test.ts
npm run build
```

Expected:

```text
PASS
build completes without TypeScript or Svelte errors
```

## Rollback Plan

If classification causes approval confusion:

1. Revert the `bash.ts` integration commit first. This returns runtime behavior to the old parser while keeping classifier tests available.
2. Keep `commandClassifier.ts` only if it is not imported by runtime code.
3. Revert prompt/UI metadata commits if they reference fields no longer populated.
4. Existing approval records remain readable because metadata was stored inside optional `action_json.classification`.

## Self-Review

Spec coverage:

- Persistent vs one-time approval decision: covered in Tasks 2, 3, and 4.
- Safe glue/helper allowlist: covered in Task 2 classifier implementation and Task 1 tests.
- Auto-run approved `longbridge`/`agent-browser` patterns: covered in Task 4 tests.
- Unsafe shell degradation: covered in Task 1 tests and Security Review Checklist.
- Audit/prompt visibility: covered in Task 5.
- Project documentation maintenance: covered in Task 6.

Placeholder scan:

- No placeholder markers are intentionally left in this plan.
- Every task includes exact files, commands, expected results, and commit points.

Type consistency:

- Classifier exports `HostBashCommandClassification`.
- Approval record stores `HostBashApprovalClassification`.
- `classification.kind` values are consistent across classifier, approval record, prompt, and UI.
