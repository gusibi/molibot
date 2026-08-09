import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Evaluating one task's assertions against one run's outcome.
 *
 * Everything here is pure with respect to the model: it reads the reply, the
 * tool trace and the throwaway data directory the run wrote into. That is the
 * point — an eval whose verdict depends on a second model's opinion tells you
 * far less than one that checks whether the file actually changed.
 *
 * The three tiers, most to least trustworthy:
 *   1. state       — `file_exists`, `file_contains`, `sqlite`: did the world
 *                    actually change?
 *   2. trace       — `tool_used`: did it do the work, or only describe it?
 *   3. text, judge — `reply_contains` and friends: last resort, answer quality.
 */

const MAX_MATCH_DEPTH = 12;

/**
 * Resolves an assertion's file pattern inside the run's data directory.
 *
 * `**​/notes.md` matches that filename at any depth, and the tail may carry
 * directories and one `*` wildcard (`**​/events/*.json`). Tasks need this
 * because the runtime, not the eval, chooses which workspace directory a
 * session writes into — asserting an absolute path would make the check a test
 * of the harness's guess rather than of the Agent's work.
 */
export function resolveFilePattern(rootDir, pattern) {
  if (!pattern.startsWith("**/")) {
    const direct = path.resolve(rootDir, pattern);
    return existsPath(direct) ? [direct] : [];
  }
  const tail = pattern.slice(3);
  const segments = tail.split("/");
  const wantedName = segments.at(-1);
  const wantedDirs = segments.slice(0, -1);
  const nameMatches = wantedName.includes("*")
    ? (name) => new RegExp(`^${wantedName.split("*").map(escapeRegExp).join(".*")}$`).test(name)
    : (name) => name === wantedName;

  const matches = [];
  const walk = (dir, depth) => {
    if (depth > MAX_MATCH_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Dependency trees dwarf everything a task writes and would make the
        // walk both slow and ambiguous.
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "venv") continue;
        walk(full, depth + 1);
      } else if (nameMatches(entry.name) && hasParentChain(full, wantedDirs)) {
        matches.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return matches.sort();
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasParentChain(file, wantedDirs) {
  if (wantedDirs.length === 0) return true;
  const parts = path.dirname(file).split(path.sep);
  const tail = parts.slice(-wantedDirs.length);
  return tail.length === wantedDirs.length && tail.every((part, index) => part === wantedDirs[index]);
}

function existsPath(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * The first matching file that contains `text`, or null.
 *
 * Any match counts, not just the first on disk: a pattern like
 * `**​/events/*.json` legitimately resolves to several files and the assertion
 * asks whether the Agent produced *one* with the expected content.
 */
function findContaining(matches, text) {
  for (const match of matches) {
    try {
      if (readFileSync(match, "utf8").includes(text)) return match;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function tier(kind) {
  if (kind.startsWith("file_") || kind === "sqlite") return "state";
  if (kind.startsWith("tool_")) return "trace";
  return "text";
}

/**
 * @param outcome {{reply: string, tools: string[], dataDir: string, sqliteQuery?: Function, judge?: Function}}
 */
export async function evaluateAssertion(assertion, outcome) {
  const [kind] = Object.keys(assertion);
  const value = assertion[kind];
  const result = (ok, detail) => ({ kind, tier: tier(kind), ok, detail });
  const reply = outcome.reply ?? "";
  const tools = outcome.tools ?? [];

  switch (kind) {
    case "reply_contains": {
      const missing = asList(value).filter((text) => !reply.includes(text));
      return result(missing.length === 0, missing.length === 0 ? "" : `missing: ${missing.join(" | ")}`);
    }
    case "reply_contains_any": {
      const options = asList(value);
      const hit = options.find((text) => reply.includes(text));
      return result(Boolean(hit), hit ? `matched "${hit}"` : `none of: ${options.join(" | ")}`);
    }
    case "reply_not_contains": {
      const present = asList(value).filter((text) => reply.includes(text));
      return result(present.length === 0, present.length === 0 ? "" : `found: ${present.join(" | ")}`);
    }
    case "reply_matches": {
      const ok = new RegExp(value, "s").test(reply);
      return result(ok, ok ? "" : `no match for /${value}/`);
    }
    case "reply_not_matches": {
      const ok = !new RegExp(value, "s").test(reply);
      return result(ok, ok ? "" : `matched /${value}/`);
    }
    case "tool_used": {
      const missing = asList(value).filter((name) => !tools.includes(name));
      return result(missing.length === 0, missing.length === 0 ? "" : `never called: ${missing.join(", ")}`);
    }
    case "tool_used_any": {
      const options = asList(value);
      const hit = options.find((name) => tools.includes(name));
      return result(Boolean(hit), hit ? `called ${hit}` : `called none of: ${options.join(", ")}`);
    }
    case "tool_not_used": {
      const used = asList(value).filter((name) => tools.includes(name));
      return result(used.length === 0, used.length === 0 ? "" : `called: ${used.join(", ")}`);
    }
    case "file_exists": {
      const matches = resolveFilePattern(outcome.dataDir, value);
      return result(matches.length > 0, matches.length > 0 ? matches[0] : `no file matched ${value}`);
    }
    case "file_absent": {
      const matches = resolveFilePattern(outcome.dataDir, value);
      return result(matches.length === 0, matches.length === 0 ? "" : `exists: ${matches[0]}`);
    }
    case "file_contains": {
      const matches = resolveFilePattern(outcome.dataDir, value.file);
      if (matches.length === 0) return result(false, `no file matched ${value.file}`);
      const hit = findContaining(matches, value.text);
      return result(
        Boolean(hit),
        hit ?? `none of ${matches.length} file(s) matching ${value.file} contain "${value.text}"`
      );
    }
    case "file_not_contains": {
      const matches = resolveFilePattern(outcome.dataDir, value.file);
      const hit = findContaining(matches, value.text);
      return result(hit === null, hit === null ? "" : `${hit} contains "${value.text}"`);
    }
    case "sqlite": {
      if (!outcome.sqliteQuery) return result(false, "sqlite assertions need a query function");
      const dbPath = path.resolve(outcome.dataDir, value.file);
      let rows;
      try {
        rows = await outcome.sqliteQuery(dbPath, value.query);
      } catch (error) {
        return result(false, `query failed: ${error?.message ?? error}`);
      }
      if (value.min_rows !== undefined && rows.length < value.min_rows) {
        return result(false, `expected >= ${value.min_rows} rows, got ${rows.length}`);
      }
      if (value.matches !== undefined) {
        const serialized = JSON.stringify(rows);
        const ok = new RegExp(value.matches, "s").test(serialized);
        return result(ok, ok ? `${rows.length} row(s)` : `no row matched /${value.matches}/ in ${serialized.slice(0, 400)}`);
      }
      return result(true, `${rows.length} row(s)`);
    }
    case "judge": {
      // Never silently pass: without a judge model this is unproven, and an
      // unproven assertion is reported as such rather than counted as green.
      if (!outcome.judge) return { kind, tier: "text", ok: null, detail: "no judge model configured" };
      return outcome.judge(value.rubric, reply);
    }
    default:
      return result(false, `unknown assertion kind ${kind}`);
  }
}

export async function evaluateTask(task, outcome) {
  const checks = [];
  for (const assertion of task.assertions) {
    checks.push(await evaluateAssertion(assertion, outcome));
  }
  const failed = checks.filter((check) => check.ok === false);
  const unproven = checks.filter((check) => check.ok === null);
  const status = failed.length > 0 ? "fail" : unproven.length > 0 ? "unproven" : "pass";
  return { checks, status };
}
