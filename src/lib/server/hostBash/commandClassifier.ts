import { basename } from "node:path";
import type {
  HostBashCapability,
  HostBashCommandClassification,
  HostBashSafeGlue,
  HostBashSafeHelper
} from "$lib/server/hostBash/types.js";

type ShellPlanNode =
  | { type: "command"; words: string[]; original: string }
  | { type: "glue"; token: HostBashSafeGlue["token"]; original: string }
  | { type: "unsupported"; token: string; reason: string };

interface LexWordToken {
  type: "word";
  value: string;
  original: string;
  start: number;
  end: number;
}

interface LexOperatorToken {
  type: "operator";
  value: string;
  original: string;
}

type LexToken = LexWordToken | LexOperatorToken;

const FORBIDDEN_COMMANDS = new Set(["bash", "sh", "zsh", "fish", "node", "python", "python3", "ruby", "perl"]);
const STRICT_HELPER_NAMES = new Set(["head", "tail", "wc", "sort", "uniq", "cut", "tr", "jq", "grep", "rg", "sed", "sleep", "true", "false"]);
const UNSAFE_HELPER_COMMANDS = new Set(["tee", "xargs"]);
const SAFE_GLUE_REASONS: Record<HostBashSafeGlue["token"], string> = {
  "|": "pipeline",
  "&&": "success chaining",
  ";": "sequential execution",
  "2>&1": "stderr merge",
  "1>&2": "stdout merge"
};

function sanitizeToolId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function baseCommandName(executable: string): string {
  return basename(executable).toLowerCase();
}

function isEnvAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(value);
}

function hasGlobToken(value: string): boolean {
  return /[*?[]/.test(value);
}

function safeHelperReason(command: string): string {
  if (command === "sleep" || command === "true" || command === "false") return "timing or no-op helper";
  if (command === "wc" || command === "sort" || command === "uniq") return "read-only output helper";
  return "output filtering helper";
}

function validateHeadTailArgs(argv: string[]): boolean {
  if (argv.length === 0) return true;
  if (argv.length === 1) return /^-\d+$/.test(argv[0]) || /^\d+$/.test(argv[0]);
  return argv.length === 2 && argv[0] === "-n" && /^\d+$/.test(argv[1]);
}

function validateWcArgs(argv: string[]): boolean {
  return argv.length === 0 || (argv.length === 1 && ["-l", "-c", "-m"].includes(argv[0]));
}

function validateUniqArgs(argv: string[]): boolean {
  return argv.length === 0 || (argv.length === 1 && argv[0] === "-c");
}

function validateCutArgs(argv: string[]): boolean {
  if (argv.length === 2 && argv[0] === "-c") return /^[0-9,-]+$/.test(argv[1]);
  if (argv.length === 4 && argv[0] === "-d" && argv[2] === "-f") return argv[1].length > 0 && /^[0-9,-]+$/.test(argv[3]);
  return false;
}

function validateTrArgs(argv: string[]): boolean {
  if (argv.length === 2 && argv[0] !== "-d") return true;
  return argv.length === 2 && argv[0] === "-d";
}

function validateJqArgs(argv: string[]): boolean {
  return argv.length === 1 && !argv[0].startsWith("-");
}

function validateGrepArgs(argv: string[], allowedFlags: string[]): boolean {
  if (argv.length === 1) return true;
  return argv.length === 2 && allowedFlags.includes(argv[0]) && !argv[1].startsWith("-");
}

function validateSedArgs(argv: string[]): boolean {
  if (argv.length !== 2 || argv[0] !== "-n") return false;
  const script = argv[1];
  if (!script.includes("p")) return false;
  if (/[wire]/i.test(script)) return false;
  return /^[0-9,$; p]+$/.test(script);
}

function validateSleepArgs(argv: string[]): boolean {
  if (argv.length !== 1) return false;
  const value = Number(argv[0]);
  return Number.isFinite(value) && value >= 0 && value <= 30;
}

function validateSafeHelper(executable: string, argv: string[]): string | null {
  const name = baseCommandName(executable);
  if (name === "head" || name === "tail") return validateHeadTailArgs(argv) ? safeHelperReason(name) : null;
  if (name === "wc") return validateWcArgs(argv) ? safeHelperReason(name) : null;
  if (name === "sort") return argv.length === 0 ? safeHelperReason(name) : null;
  if (name === "uniq") return validateUniqArgs(argv) ? safeHelperReason(name) : null;
  if (name === "cut") return validateCutArgs(argv) ? safeHelperReason(name) : null;
  if (name === "tr") return validateTrArgs(argv) ? safeHelperReason(name) : null;
  if (name === "jq") return validateJqArgs(argv) ? safeHelperReason(name) : null;
  if (name === "grep") return validateGrepArgs(argv, ["-i", "-E", "-v"]) ? safeHelperReason(name) : null;
  if (name === "rg") return validateGrepArgs(argv, ["-i", "-n"]) ? safeHelperReason(name) : null;
  if (name === "sed") return validateSedArgs(argv) ? safeHelperReason(name) : null;
  if (name === "sleep") return validateSleepArgs(argv) ? safeHelperReason(name) : null;
  if (name === "true" || name === "false") return argv.length === 0 ? safeHelperReason(name) : null;
  return null;
}

function lexShell(input: string): { ok: true; tokens: LexToken[] } | { ok: false; reason: string; token: string } {
  const tokens: LexToken[] = [];
  let index = 0;

  while (index < input.length) {
    const ch = input[index] ?? "";

    if (/\s/.test(ch)) {
      if (ch === "\n" || ch === "\r") {
        tokens.push({ type: "operator", value: ";", original: ch });
      }
      index += 1;
      continue;
    }

    const rest = input.slice(index);
    if (rest.startsWith("2>&1") || rest.startsWith("1>&2")) {
      const value = rest.startsWith("2>&1") ? "2>&1" : "1>&2";
      tokens.push({ type: "operator", value, original: value });
      index += value.length;
      continue;
    }
    if (rest.startsWith("&&")) {
      tokens.push({ type: "operator", value: "&&", original: "&&" });
      index += 2;
      continue;
    }
    if (rest.startsWith("||") || rest.startsWith(">>") || rest.startsWith("<<") || rest.startsWith("2>") || rest.startsWith("&>") || rest.startsWith(">|")) {
      const value = rest.startsWith("||") ? "||"
        : rest.startsWith(">>") ? ">>"
        : rest.startsWith("<<") ? "<<"
        : rest.startsWith("2>") ? "2>"
        : rest.startsWith("&>") ? "&>"
        : ">|";
      return { ok: false, reason: `Unsupported shell operator: ${value}`, token: value };
    }
    if (rest.startsWith("<<<") || rest.startsWith("<(") || rest.startsWith(">(") || rest.startsWith("$(")) {
      const value = rest.startsWith("$(") ? "$(" : rest.startsWith("<<<") ? "<<<" : rest.startsWith("<(") ? "<(" : ">(";
      return {
        ok: false,
        reason: value === "$(" ? "Command substitution is not allowed." : `Unsupported shell operator: ${value}`,
        token: value
      };
    }
    if (ch === "`") {
      return { ok: false, reason: "Command substitution is not allowed.", token: "`" };
    }
    if (ch === "|" || ch === ";" || ch === "&" || ch === "<" || ch === ">" || ch === "(" || ch === ")" || ch === "{"
      || ch === "}") {
      if (ch === "|" || ch === ";") {
        tokens.push({ type: "operator", value: ch, original: ch });
        index += 1;
        continue;
      }
      return { ok: false, reason: `Unsupported shell operator: ${ch}`, token: ch };
    }

    const start = index;
    let value = "";
    let original = "";
    let quote: "'" | "\"" | null = null;
    let escaping = false;
    while (index < input.length) {
      const current = input[index] ?? "";
      const next = input[index + 1] ?? "";
      if (!quote && !escaping && /\s/.test(current)) break;
      if (!quote && !escaping && ["|", ";", "&", "<", ">", "(", ")", "{", "}"].includes(current)) break;
      if (!quote && !escaping && current === "$" && next === "(") {
        return { ok: false, reason: "Command substitution is not allowed.", token: "$(" };
      }
      original += current;
      index += 1;
      if (escaping) {
        value += current;
        escaping = false;
        continue;
      }
      if (current === "\\") {
        escaping = true;
        original = original.slice(0, -1);
        continue;
      }
      if (quote) {
        if (current === quote) {
          quote = null;
        } else {
          value += current;
        }
        continue;
      }
      if (current === "'" || current === "\"") {
        quote = current;
        original = original.slice(0, -1);
        continue;
      }
      value += current;
    }
    if (escaping || quote) {
      return { ok: false, reason: "Unmatched quotes or escapes.", token: input.slice(start, index) };
    }
    tokens.push({ type: "word", value, original: input.slice(start, index), start, end: index });
  }

  return { ok: true, tokens };
}

function toPlanNodes(input: string): { ok: true; nodes: ShellPlanNode[] } | { ok: false; reason: string; token: string } {
  const lexed = lexShell(input);
  if (!lexed.ok) return lexed;

  const nodes: ShellPlanNode[] = [];
  let currentWords: LexWordToken[] = [];

  const flushCurrent = (): void => {
    if (currentWords.length === 0) return;
    const start = currentWords[0]?.start ?? 0;
    const end = currentWords[currentWords.length - 1]?.end ?? start;
    nodes.push({
      type: "command",
      words: currentWords.map((item) => item.value),
      original: input.slice(start, end).trim()
    });
    currentWords = [];
  };

  for (const token of lexed.tokens) {
    if (token.type === "word") {
      currentWords.push(token);
      continue;
    }
    flushCurrent();
    if (token.value === "|" || token.value === "&&" || token.value === ";" || token.value === "2>&1" || token.value === "1>&2") {
      nodes.push({ type: "glue", token: token.value, original: token.original });
      continue;
    }
    nodes.push({ type: "unsupported", token: token.value, reason: `Unsupported shell operator: ${token.value}` });
  }
  flushCurrent();
  return { ok: true, nodes };
}

function classifyCommandNode(node: Extract<ShellPlanNode, { type: "command" }>): { type: "capability"; value: HostBashCapability } | { type: "helper"; value: HostBashSafeHelper } | { type: "unsupported"; reason: string; token: string } {
  const [executable, ...argv] = node.words;
  if (!executable) return { type: "unsupported", reason: "Empty command segment.", token: "" };
  if (isEnvAssignment(executable)) {
    return { type: "unsupported", reason: "Environment assignment prefixes are not allowed.", token: executable };
  }
  if (baseCommandName(executable) === "env") {
    return { type: "unsupported", reason: "env-based command prefixes are not allowed.", token: executable };
  }
  if (hasGlobToken(executable) || argv.some(hasGlobToken)) {
    return { type: "unsupported", reason: "Glob expansion tokens are not allowed.", token: executable };
  }

  const helperReason = validateSafeHelper(executable, argv);
  if (helperReason) {
    return {
      type: "helper",
      value: {
        executable,
        argv,
        originalSegment: node.original,
        reason: helperReason
      }
    };
  }

  if (STRICT_HELPER_NAMES.has(baseCommandName(executable))) {
    return {
      type: "unsupported",
      reason: `${baseCommandName(executable)} is only allowed as a safe helper in restricted forms.`,
      token: executable
    };
  }

  if (UNSAFE_HELPER_COMMANDS.has(baseCommandName(executable))) {
    return {
      type: "unsupported",
      reason: `${baseCommandName(executable)} is not allowed as a safe helper.`,
      token: executable
    };
  }

  const commandName = baseCommandName(executable);
  if (FORBIDDEN_COMMANDS.has(commandName)) {
    return { type: "unsupported", reason: `Host Bash command is not allowed: ${commandName}`, token: executable };
  }

  return {
    type: "capability",
    value: {
      executable,
      toolId: sanitizeToolId(executable),
      argv,
      originalSegment: node.original
    }
  };
}

export function classifyHostBashCommand(input: string): HostBashCommandClassification {
  const originalCommand = input.trim().slice(0, 4000);
  if (!originalCommand) {
    return {
      kind: "one-time-script",
      originalCommand,
      reason: "command is required for host bash approval requests.",
      detectedTokens: []
    };
  }

  const plan = toPlanNodes(originalCommand);
  if (!plan.ok) {
    return {
      kind: "one-time-script",
      originalCommand,
      reason: plan.reason,
      detectedTokens: [plan.token]
    };
  }

  const capabilities: HostBashCapability[] = [];
  const safeHelpers: HostBashSafeHelper[] = [];
  const safeGlue: HostBashSafeGlue[] = [];

  for (const node of plan.nodes) {
    if (node.type === "glue") {
      safeGlue.push({ token: node.token, reason: SAFE_GLUE_REASONS[node.token] });
      continue;
    }
    if (node.type === "unsupported") {
      return {
        kind: "one-time-script",
        originalCommand,
        reason: node.reason,
        detectedTokens: [node.token]
      };
    }
    const classified = classifyCommandNode(node);
    if (classified.type === "unsupported") {
      return {
        kind: "one-time-script",
        originalCommand,
        reason: classified.reason,
        detectedTokens: [classified.token]
      };
    }
    if (classified.type === "helper") {
      safeHelpers.push(classified.value);
      continue;
    }
    capabilities.push(classified.value);
  }

  if (capabilities.length === 0) {
    return {
      kind: "one-time-script",
      originalCommand,
      reason: "Command does not contain a reusable host capability.",
      detectedTokens: safeHelpers.map((item) => item.executable)
    };
  }

  if (capabilities.length === 1) {
    return {
      kind: "persistent-capability",
      capability: capabilities[0],
      capabilities,
      originalCommand,
      safeHelpers,
      safeGlue,
      warnings: []
    };
  }

  return {
    kind: "compound-capabilities",
    capabilities,
    originalCommand,
    safeHelpers,
    safeGlue,
    warnings: []
  };
}
