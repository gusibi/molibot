/**
 * Deterministic "changed path → verification scope" mapping for
 * `pnpm verify:feature`.
 *
 * The mapping is data, not judgement: given the same changed paths it always
 * produces the same scope. Agents may append tags on top, never remove what the
 * mapping selected. See docs/requirements/feature-verification-spec.md.
 */

/** Always run these suites; they keep startup and message sends working. */
export const SMOKE_SUITES = [
  "scripts/verify/selection.test.mjs",
  "tests/ui/support/guard.test.ts",
  "tests/ui/support/model-service.test.ts",
  "src/routes/api/stream/stop/server.test.ts",
  "src/routes/api/stream/steer/server.test.ts",
  "src/routes/api/chat/webCommands.test.ts",
  "src/lib/server/sessions/store.test.ts",
  "apps/desktop/src/lib/api.test.ts"
];

export const UI_TAGS = ["@chat", "@approval", "@navigation", "@recovery", "@settings", "@failure"];

/** Settings changes also run the整对象 round-trip regression at the integration layer. */
export const SETTINGS_SUITES = [
  "src/lib/server/settings/store.test.ts",
  "src/lib/server/settings/sanitize.test.ts",
  "src/lib/server/settings/personalAgentRoundtrip.test.ts",
  "src/lib/server/settings/sessionAutoArchiveRoundtrip.test.ts"
];

/**
 * Rules are evaluated in order; every matching rule contributes. A change that
 * matches no rule gets the conservative fallback (smoke + full core).
 */
const RULES = [
  {
    id: "native",
    // Tauri code, the desktop API transport, supervisor/startup/handshake.
    match: /^(apps\/desktop\/src-tauri\/|apps\/desktop\/src\/lib\/(api|desktop|native)|src\/lib\/server\/app\/(desktopHandshake|desktopBootstrap|serviceOwnership|dataDirScope)|scripts\/start-server\.mjs|scripts\/runtime\/service-|scripts\/runtime\/runtime-paths)/,
    native: true,
    fullCore: true
  },
  {
    id: "agent-runtime",
    // Agent runtime, queue, approvals, session progression, stream routing.
    match: /^(src\/lib\/server\/agent\/|src\/lib\/server\/approval\/|src\/lib\/server\/hostBash\/|src\/routes\/api\/stream\/|src\/routes\/api\/chat\/|src\/lib\/server\/sessions\/)/,
    fullCore: true,
    tags: ["@chat", "@approval", "@navigation", "@recovery"]
  },
  {
    id: "chat-ui",
    match: /^apps\/desktop\/src\/(lib\/chat\/|ChatView\.svelte)/,
    tags: ["@chat", "@approval", "@navigation"]
  },
  {
    id: "navigation-ui",
    match: /^apps\/desktop\/src\/(lib\/(settings|navigation)|.*Sidebar.*|AgentHome\.svelte)/,
    tags: ["@navigation"]
  },
  {
    id: "settings",
    match: /(^|\/)(settings|preferences)(\/|\.|-|$)/,
    tags: ["@settings"],
    settingsRoundTrip: true
  }
];

/**
 * @param {string[]} changedPaths repo-relative paths (POSIX separators)
 * @returns {{ uiTags: string[], fullCore: boolean, native: boolean, settingsRoundTrip: boolean, matchedRules: string[], fallback: boolean }}
 */
export function selectScope(changedPaths) {
  const tags = new Set();
  const matchedRules = [];
  let fullCore = false;
  let native = false;
  let settingsRoundTrip = false;

  for (const path of changedPaths) {
    // A test file is not product code: changing it must not pull in product
    // rules (native tests, runtime scope) just because it shares a directory.
    if (/\.(test|spec)\.[a-z]+$/.test(path)) continue;
    for (const rule of RULES) {
      if (!rule.match.test(path)) continue;
      if (!matchedRules.includes(rule.id)) matchedRules.push(rule.id);
      if (rule.fullCore) fullCore = true;
      if (rule.native) native = true;
      if (rule.settingsRoundTrip) settingsRoundTrip = true;
      for (const tag of rule.tags ?? []) tags.add(tag);
    }
  }

  const fallback = matchedRules.length === 0;
  if (fallback) fullCore = true;

  const uiTags = [...tags].sort();
  return {
    uiTags,
    fullCore,
    native,
    settingsRoundTrip,
    matchedRules,
    fallback
  };
}

/** UI tags to grep for: the selected ones plus smoke, never fewer than smoke. */
export function uiGrepExpression(scope, appendedTags = []) {
  const tags = new Set(["@smoke", ...scope.uiTags, ...appendedTags]);
  return [...tags].sort().join("|");
}
