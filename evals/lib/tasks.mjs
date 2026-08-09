import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * Loading and validating the golden set.
 *
 * The validation is deliberately strict and runs before any model is called: a
 * typo in an assertion key (`file_contain`, `tool_called`) would otherwise make
 * a task silently assert nothing and report a pass, which is the one failure
 * mode a scoreboard must never have.
 */

export const ASSERTION_KINDS = new Set([
  "reply_contains",
  "reply_contains_any",
  "reply_not_contains",
  "reply_matches",
  "reply_not_matches",
  "tool_used",
  "tool_used_any",
  "tool_not_used",
  "file_exists",
  "file_absent",
  "file_contains",
  "file_not_contains",
  "sqlite",
  "judge"
]);

const TASK_KEYS = new Set([
  "id",
  "title",
  "why",
  "prompt",
  "turns",
  "setup",
  "assert",
  "baseline",
  "tags",
  "timeout_ms",
  "auto_approve"
]);

const BASELINES = new Set(["pass", "fail", "unknown"]);

function fail(context, message) {
  throw new Error(`${context}: ${message}`);
}

function validateAssertion(context, assertion) {
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
    fail(context, "each assertion must be a mapping with exactly one kind");
  }
  const keys = Object.keys(assertion);
  if (keys.length !== 1) {
    fail(context, `expected exactly one assertion kind, got [${keys.join(", ")}]`);
  }
  const [kind] = keys;
  if (!ASSERTION_KINDS.has(kind)) {
    fail(context, `unknown assertion "${kind}". Known kinds: ${[...ASSERTION_KINDS].join(", ")}`);
  }
  const value = assertion[kind];

  switch (kind) {
    case "file_contains":
    case "file_not_contains":
      if (!value || typeof value.file !== "string" || typeof value.text !== "string") {
        fail(context, `${kind} needs { file, text }`);
      }
      break;
    case "sqlite":
      if (!value || typeof value.file !== "string" || typeof value.query !== "string") {
        fail(context, "sqlite needs { file, query, ... }");
      }
      if (value.min_rows === undefined && value.matches === undefined) {
        fail(context, "sqlite needs min_rows or matches");
      }
      break;
    case "judge":
      if (!value || typeof value.rubric !== "string") {
        fail(context, "judge needs { rubric }");
      }
      break;
    case "reply_matches":
    case "reply_not_matches":
      if (typeof value !== "string") fail(context, `${kind} needs a regular expression string`);
      try {
        new RegExp(value, "s");
      } catch (error) {
        fail(context, `${kind} is not a valid regular expression: ${error.message}`);
      }
      break;
    default:
      if (typeof value !== "string" && !Array.isArray(value)) {
        fail(context, `${kind} needs a string or a list of strings`);
      }
  }
}

function normalizeTurns(context, task) {
  if (task.turns !== undefined && task.prompt !== undefined) {
    fail(context, "use either prompt or turns, not both");
  }
  const turns = task.turns ?? (task.prompt === undefined ? undefined : [{ prompt: task.prompt }]);
  if (!Array.isArray(turns) || turns.length === 0) {
    fail(context, "needs a prompt or a non-empty turns list");
  }
  return turns.map((turn, index) => {
    if (!turn || typeof turn.prompt !== "string" || turn.prompt.trim() === "") {
      fail(`${context} turn ${index + 1}`, "needs a non-empty prompt");
    }
    const files = turn.files ?? [];
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
      fail(`${context} turn ${index + 1}`, "files must be a list of fixture paths");
    }
    return {
      prompt: turn.prompt,
      files,
      newSession: turn.new_session === true
    };
  });
}

export function validateTask(task, source) {
  const context = `${source}#${task?.id ?? "<no id>"}`;
  if (!task || typeof task !== "object") fail(context, "task must be a mapping");
  for (const key of Object.keys(task)) {
    if (!TASK_KEYS.has(key)) fail(context, `unknown field "${key}"`);
  }
  if (typeof task.id !== "string" || !/^[A-Z]\d+$/.test(task.id)) {
    fail(context, "id must look like A1, F5 …");
  }
  if (typeof task.title !== "string" || task.title.trim() === "") fail(context, "needs a title");
  if (!Array.isArray(task.assert) || task.assert.length === 0) {
    fail(context, "needs at least one assertion — a task that asserts nothing always passes");
  }
  task.assert.forEach((assertion, index) => validateAssertion(`${context} assert[${index}]`, assertion));
  if (task.baseline !== undefined && !BASELINES.has(task.baseline)) {
    fail(context, `baseline must be one of ${[...BASELINES].join(", ")}`);
  }
  if (task.auto_approve !== undefined && typeof task.auto_approve !== "boolean") {
    fail(context, "auto_approve must be a boolean");
  }

  const setupFiles = task.setup?.files ?? [];
  if (!Array.isArray(setupFiles)) fail(context, "setup.files must be a list");
  for (const entry of setupFiles) {
    if (!entry || typeof entry.path !== "string") fail(context, "setup.files[].path is required");
    if (typeof entry.text !== "string" && typeof entry.from !== "string") {
      fail(context, "setup.files[] needs text or from");
    }
  }

  return {
    id: task.id,
    title: task.title,
    why: task.why ?? "",
    group: task.id[0],
    tags: task.tags ?? [],
    baseline: task.baseline ?? "unknown",
    timeoutMs: task.timeout_ms ?? 180_000,
    autoApprove: task.auto_approve === true,
    setupFiles,
    turns: normalizeTurns(context, task),
    assertions: task.assert,
    source
  };
}

export function loadTasks(goldenDir) {
  const files = readdirSync(goldenDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
  const tasks = [];
  const seen = new Map();
  for (const name of files) {
    const parsed = parse(readFileSync(path.join(goldenDir, name), "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error(`${name}: expected a top-level list of tasks`);
    }
    for (const raw of parsed) {
      const task = validateTask(raw, name);
      if (seen.has(task.id)) {
        throw new Error(`duplicate task id ${task.id} in ${name} and ${seen.get(task.id)}`);
      }
      seen.set(task.id, name);
      tasks.push(task);
    }
  }
  return tasks;
}

export function selectTasks(tasks, filters) {
  const ids = new Set((filters.ids ?? []).map((id) => id.toUpperCase()));
  const groups = new Set((filters.groups ?? []).map((group) => group.toUpperCase()));
  return tasks.filter((task) => {
    if (ids.size > 0 && !ids.has(task.id)) return false;
    if (groups.size > 0 && !groups.has(task.group)) return false;
    return true;
  });
}
