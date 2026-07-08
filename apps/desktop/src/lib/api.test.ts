import assert from "node:assert/strict";
import test from "node:test";
import { transcriptDisplayContent } from "./chat/transcript";
import type { DesktopAgentItem, DesktopSessionFile, DesktopExternalSessionsSummary, DesktopRuntimeEnvSummary, DesktopWebProfile, DesktopChannelsSummary } from "@molibot/desktop-contract";
import { normalizeLocale } from "./i18n";
import { runDesktopConversationTurn } from "./chat/conversationTurn";
import {
  addToFollowUpQueue,
  applyDesktopSandboxPreset,
  buildDiagnosticsSummary,
  deleteDesktopProvider,
  discoverDesktopProviderModels,
  classifyFirstLaunch,
  buildOnboardingHealthCheck,
  consumeDesktopSse,
  desktopFileContentUrl,
  filterDesktopFiles,
  filterSessionsByTitle,
  findTranscriptMatches,
  formatDurationMs,
  formatTokenCount,
  formatExternalSessionPreview,
  groupExternalSessionsForView,
  buildExternalChannelNav,
  externalSessionsForBot,
  groupExternalTranscriptByRole,
  hasEnabledWebProfile,
  hostBashApprovalSubcommand,
  missingRuntimeDependencies,
  nextFollowUp,
  advanceOnboardingStep,
  normalizeTheme,
  parseDesktopActivity,
  reduceDesktopActivities,
  parseDesktopApproval,
  parseDesktopSandboxList,
  providerItemToUpdateRequest,
  detectDesktopSandboxPreset,
  resolveOnboardingAgentSelection,
  resolveOnboardingRepairTarget,
  resolveOnboardingStartStep,
  runDesktopMemoryAction,
  runDesktopTaskAction,
  loadDesktopMemoryRejections,
  loadDesktopTasks,
  loadDesktopProjects,
  createDesktopProject,
  deleteDesktopProject,
  loadDesktopProjectSessions,
  normalizeDesktopTaskSession,
  loadDesktopModelRouting,
  loadDesktopMediaTasks,
  sanitizeWebProfileName,
  shouldShowServiceReconnect,
  sendDesktopChatWithFiles,
  submitDesktopProvider,
  saveDesktopModelRouting,
  saveDesktopWebSearch,
  saveDesktopImageGenerate,
  saveDesktopVideoGenerate,
  saveDesktopTts,
  testDesktopWebSearchSettings,
  testDesktopImageGenerateSettings,
  testDesktopVideoGenerateSettings,
  testDesktopTtsSettings,
  deleteDesktopMediaTask,
  desktopTtsAudioUrl,
  summarizeDesktopReadiness,
  summarizeOnboardingChannels,
  summarizeOnboardingDiagnostics,
  validateProviderDraft,
  testDesktopProvider,
  updateDesktopProvider,
  updateDesktopProviderGlobals,
  ONBOARDING_STEPS
} from "./api";

test("shared transcript localizes the generic assistant failure without changing user text", () => {
  assert.equal(transcriptDisplayContent({ role: "assistant", content: "Sorry, something went wrong." }, "回复失败，请重试。"), "回复失败，请重试。");
  assert.equal(transcriptDisplayContent({ role: "user", content: "Sorry, something went wrong." }, "回复失败，请重试。"), "Sorry, something went wrong.");
});

test("structured tool activity merges start and end into one stable item", () => {
  const started = parseDesktopActivity("runner_event", { activity: { kind: "tool", key: "bash-1", label: "Run tests", state: "running" } });
  const ended = parseDesktopActivity("runner_event", { activity: { kind: "tool", key: "bash-1", label: "Run tests", state: "success", summary: "12 tests passed" } });
  assert.ok(started);
  assert.ok(ended);
  assert.deepEqual(reduceDesktopActivities(reduceDesktopActivities([], started), ended), [{
    kind: "tool",
    key: "bash-1",
    label: "Run tests",
    state: "success",
    summary: "12 tests passed"
  }]);
});

test("legacy task sessions decode JSON-string Agent blocks in the Desktop client", () => {
  assert.deepEqual(normalizeDesktopTaskSession({
    taskId: "task-1",
    sessionId: "session-1",
    messages: [
      { role: "user", content: JSON.stringify({ type: "text", text: "Run it" }) },
      { role: "assistant", content: JSON.stringify([{ type: "thinking", thinking: "private" }, { type: "text", text: "Done" }]) },
      { role: "toolResult", content: JSON.stringify({ type: "text", text: "hidden" }) }
    ]
  }), {
    taskId: "task-1",
    sessionId: "session-1",
    messages: [
      { role: "user", content: "Run it", createdAt: "" },
      { role: "assistant", content: "Done", createdAt: "" }
    ]
  });
});

test("service reconnect is only offered while the local service is unavailable", () => {
  assert.equal(shouldShowServiceReconnect(false), true);
  assert.equal(shouldShowServiceReconnect(true), false);
});

test("sandbox list parsing trims, splits, and deduplicates policy entries", () => {
  assert.deepEqual(parseDesktopSandboxList("github.com, npmjs.org\ngithub.com\n"), ["github.com", "npmjs.org"]);
});

test("sandbox presets match Web policy templates and detect custom changes", () => {
  const observe = applyDesktopSandboxPreset("observe");
  assert.deepEqual(observe.network?.allowedDomains, ["*"]);
  assert.deepEqual(observe.filesystem?.allowWrite, ["/tmp", "scratch"]);
  assert.equal(detectDesktopSandboxPreset(observe), "observe");

  const build = applyDesktopSandboxPreset("build");
  assert.equal(build.env?.inheritMode, "full");
  assert.deepEqual(build.filesystem?.allowWrite, [".", "/tmp", "scratch"]);
  assert.equal(detectDesktopSandboxPreset({ ...build, network: { ...build.network, deniedDomains: ["example.com"] } }), "custom");

  const strict = applyDesktopSandboxPreset("strict");
  assert.equal(strict.initFailureMode, "block");
  assert.deepEqual(strict.network?.allowedDomains, []);
  assert.equal(detectDesktopSandboxPreset(strict), "strict");
});

function externalSummary(overrides: Partial<DesktopExternalSessionsSummary> = {}): DesktopExternalSessionsSummary {
  return {
    groups: [
      {
        channel: "telegram",
        total: 2,
        sessions: [
          { id: "tg-1", title: "Sales chat", updatedAt: "2026-06-28T02:00:00.000Z", chatType: "group", senderName: "Alice", botInstanceName: "Sales Bot", threadTitle: "Engineering", platform: "telegram" },
          { id: "tg-2", title: "Support", updatedAt: "2026-06-28T01:00:00.000Z", chatType: "private", senderName: "12345678…", platform: "telegram" }
        ]
      },
      { channel: "weixin", total: 1, sessions: [{ id: "wx-1", title: "WeChat group", updatedAt: "2026-06-28T00:00:00.000Z", chatType: "channel", senderName: "", platform: "weixin" }] }
    ],
    counts: { totalSessions: 3 },
    ...overrides
  };
}

function file(id: string, mediaType: DesktopSessionFile["mediaType"]): DesktopSessionFile {
  return { id, original: `${id}.bin`, local: `files/${id}.bin`, mediaType, size: 10, createdAt: "2026-06-28T00:00:00.000Z" };
}

test("desktop SSE parsing preserves events split across arbitrary chunks", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    "event: thinking_delta\ndata: {\"delta\":\"plan\"}\n",
    "\nevent: token\ndata: {\"delta\":\"hel",
    "lo\"}\n\nevent: done\ndata: {\"response\":\"hello\"}\n\n"
  ];
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  }));
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];

  await consumeDesktopSse(response, (event, data) => {
    events.push({ event, data });
  });

  assert.deepEqual(events, [
    { event: "thinking_delta", data: { delta: "plan" } },
    { event: "token", data: { delta: "hello" } },
    { event: "done", data: { response: "hello" } }
  ]);
});

test("filterDesktopFiles returns all files when the filter is 'all'", () => {
  const files = [file("a", "image"), file("b", "file"), file("c", "video")];
  assert.deepEqual(filterDesktopFiles(files, "all"), files);
});

test("filterDesktopFiles keeps only the matching media type", () => {
  const files = [file("a", "image"), file("b", "file"), file("c", "image")];
  assert.deepEqual(
    filterDesktopFiles(files, "image").map((item) => item.id),
    ["a", "c"]
  );
});

test("desktopFileContentUrl scopes the request to the session file and adds download intent", () => {
  const inline = desktopFileContentUrl("http://127.0.0.1:3210/", "p1", "s1", "fid");
  assert.equal(
    inline,
    "http://127.0.0.1:3210/api/web/files?profileId=p1&sessionId=s1&fileId=fid"
  );
  const download = desktopFileContentUrl("http://127.0.0.1:3210", "p1", "s1", "fid", true);
  assert.equal(
    download,
    "http://127.0.0.1:3210/api/web/files?profileId=p1&sessionId=s1&fileId=fid&download=1"
  );
});

test("parseDesktopActivity maps tool start/end diagnostics to timeline entries", () => {
  assert.deepEqual(
    parseDesktopActivity("runner_event", { diagnostic: "tool_start=Bash, label=Run tests" }),
    { kind: "tool", key: "legacy-Bash", label: "Bash", state: "running" }
  );
  assert.deepEqual(
    parseDesktopActivity("runner_event", { diagnostic: "tool_end=Bash, status=ok, summary=done" }),
    { kind: "tool", key: "legacy-Bash", label: "Bash", state: "success" }
  );
  assert.deepEqual(
    parseDesktopActivity("runner_event", { diagnostic: "tool_end=Read, status=error, summary=boom" }),
    { kind: "tool", key: "legacy-Read", label: "Read", state: "error" }
  );
});

test("parseDesktopActivity surfaces thread notes and ignores plain token events", () => {
  assert.deepEqual(
    parseDesktopActivity("thread_note", { text: "Checked the config" }),
    { kind: "note", key: "note-Checked the config", label: "Checked the config", state: "info" }
  );
  assert.equal(parseDesktopActivity("token", { delta: "hi" }), null);
  assert.equal(parseDesktopActivity("runner_event", { diagnostic: "" }), null);
});

test("sendDesktopChatWithFiles posts a multipart turn to /api/chat with message, profile, and files", async () => {
  const original = globalThis.fetch;
  let capturedUrl: unknown = null;
  let capturedBody: unknown = null;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    capturedUrl = url;
    capturedBody = init?.body;
    return new Response(
      JSON.stringify({ ok: true, response: "ack", conversationId: "s1", stopReason: "completed" }),
      { headers: { "content-type": "application/json" } }
    );
  }) as typeof globalThis.fetch;

  try {
    const file = new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" });
    const result = await sendDesktopChatWithFiles("http://127.0.0.1:3210", {
      profileId: "p1",
      sessionId: "s1",
      message: "hi",
      thinkingLevel: "medium",
      files: [file]
    });

    assert.deepEqual(result, { response: "ack", conversationId: "s1", stopReason: "completed" });
    assert.equal(capturedUrl, "http://127.0.0.1:3210/api/chat");
    const form = capturedBody as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("profileId"), "p1");
    assert.equal(form.get("conversationId"), "s1");
    assert.equal(form.get("message"), "hi");
    assert.equal(form.get("thinkingLevel"), "medium");
    const files = form.getAll("files");
    assert.equal(files.length, 1);
    assert.equal((files[0] as File).name, "note.txt");
  } finally {
    globalThis.fetch = original;
  }
});

test("shared conversation turn streams a project response through the same Chat transport", async () => {
  const original = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    const body = [
      'event: token\ndata: {"delta":"hello"}',
      'event: status\ndata: {"text":"working"}',
      'event: done\ndata: {"response":"hello world","thinkingText":""}',
      ""
    ].join("\n\n");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof globalThis.fetch;
  const observed = { token: "", status: "", done: "" };
  try {
    await runDesktopConversationTurn({
      endpoint: "http://127.0.0.1:3210",
      profileId: "personal",
      sessionId: "session-1",
      projectId: "project-1",
      message: "hi",
      thinkingLevel: "medium"
    }, {
      onToken: (delta) => (observed.token += delta),
      onStatus: (status) => (observed.status = status),
      onDone: (result) => (observed.done = result.response)
    });
    assert.equal(requestBody.projectId, "project-1");
    assert.deepEqual(observed, { token: "hello", status: "working", done: "hello world" });
  } finally {
    globalThis.fetch = original;
  }
});

test("parseDesktopApproval builds a card from a host_bash_approval payload", () => {
  const prompt = parseDesktopApproval({
    requestId: "hba-1",
    title: "⚠️ 需要你的确认",
    body: "【操作】执行 Bash\n【命令】git status",
    options: [
      { id: "approve_once", label: "仅此一次", style: "primary" },
      { id: "approve_persistent", label: "永久允许此工具", style: "primary" },
      { id: "reject", label: "拒绝", style: "danger" }
    ],
    request: { command: "git", args: ["status"], reason: "inspect repo", displayName: "git" }
  });
  assert.equal(prompt?.requestId, "hba-1");
  assert.equal(prompt?.command, "git status");
  assert.equal(prompt?.reason, "inspect repo");
  assert.deepEqual(prompt?.options.map((option) => option.id), [
    "approve_once",
    "approve_persistent",
    "reject"
  ]);
});

test("parseDesktopApproval returns null without a request id", () => {
  assert.equal(parseDesktopApproval({ options: [] }), null);
});

test("hostBashApprovalSubcommand maps decisions to /hosttools subcommands", () => {
  assert.equal(hostBashApprovalSubcommand("approve_once"), "approve-once");
  assert.equal(hostBashApprovalSubcommand("approve_session"), "approve-session");
  assert.equal(hostBashApprovalSubcommand("approve_persistent"), "approve");
  assert.equal(hostBashApprovalSubcommand("reject"), "reject");
});

test("filterSessionsByTitle matches case-insensitively and returns all when empty", () => {
  const sessions = [{ title: "Build plan" }, { title: "Bug triage" }, { title: "Notes" }];
  assert.deepEqual(filterSessionsByTitle(sessions, "  ").map((s) => s.title), [
    "Build plan",
    "Bug triage",
    "Notes"
  ]);
  assert.deepEqual(filterSessionsByTitle(sessions, "bu").map((s) => s.title), [
    "Build plan",
    "Bug triage"
  ]);
});

test("findTranscriptMatches returns matching message ids in order, empty for blank query", () => {
  const messages = [
    { id: "m1", content: "Let's deploy the API" },
    { id: "m2", content: "no relevant text" },
    { id: "m3", content: "API rate limits" }
  ];
  assert.deepEqual(findTranscriptMatches(messages, "api"), ["m1", "m3"]);
  assert.deepEqual(findTranscriptMatches(messages, ""), []);
});

test("addToFollowUpQueue trims and ignores blank follow-ups", () => {
  assert.deepEqual(addToFollowUpQueue([], "  first  "), ["first"]);
  assert.deepEqual(addToFollowUpQueue(["first"], "second"), ["first", "second"]);
  assert.deepEqual(addToFollowUpQueue(["first"], "   "), ["first"]);
});

test("nextFollowUp pops the head of the queue and returns the rest", () => {
  assert.deepEqual(nextFollowUp(["a", "b", "c"]), { next: "a", rest: ["b", "c"] });
  assert.deepEqual(nextFollowUp([]), { next: null, rest: [] });
});

test("summarizeDesktopReadiness reports a usable config when a model and profile exist", () => {
  const readiness = summarizeDesktopReadiness(
    [{ id: "p1", name: "Default" }],
    { currentKey: "k1", options: [{ key: "k1", label: "GPT" }, { key: "k2", label: "Other" }] }
  );
  assert.deepEqual(readiness, {
    hasModel: true,
    modelLabel: "GPT",
    profileCount: 1,
    hasProfile: true
  });
});

test("summarizeDesktopReadiness flags missing model and profiles", () => {
  assert.deepEqual(summarizeDesktopReadiness([], { currentKey: "", options: [] }), {
    hasModel: false,
    modelLabel: "",
    profileCount: 0,
    hasProfile: false
  });
  assert.equal(summarizeDesktopReadiness([], null).hasModel, false);
});

test("classifyFirstLaunch splits new / usable / broken per plan §9.1", () => {
  const usable = summarizeDesktopReadiness(
    [{ id: "p1", name: "Personal" }],
    { currentKey: "gpt", options: [{ key: "gpt", label: "GPT" }] }
  );
  assert.equal(classifyFirstLaunch(usable), "usable");

  const fresh = summarizeDesktopReadiness([], { currentKey: "", options: [] });
  assert.equal(classifyFirstLaunch(fresh), "new");
  assert.equal(classifyFirstLaunch(summarizeDesktopReadiness([], null)), "new");

  // Profile exists but no model → broken.
  const brokenModel = summarizeDesktopReadiness(
    [{ id: "p1", name: "Personal" }],
    { currentKey: "", options: [] }
  );
  assert.equal(classifyFirstLaunch(brokenModel), "broken");

  // Model exists but no profile → broken.
  const brokenProfile = summarizeDesktopReadiness(
    [],
    { currentKey: "gpt", options: [{ key: "gpt", label: "GPT" }] }
  );
  assert.equal(classifyFirstLaunch(brokenProfile), "broken");
});

test("normalizeLocale resolves known locales and maps zh variants to zh-CN", () => {
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("zh-TW"), "zh-CN");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(normalizeLocale(""), "en");
});

test("normalizeTheme accepts known themes and falls back to system", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("system"), "system");
  assert.equal(normalizeTheme("solarized"), "system");
  assert.equal(normalizeTheme(null), "system");
});

test("buildDiagnosticsSummary lists sanitized runtime facts and falls back for missing values", () => {
  assert.equal(
    buildDiagnosticsSummary({
      serviceVersion: "2.2.4",
      ownership: "managed",
      endpoint: "http://127.0.0.1:3210",
      state: "ready"
    }),
    [
      "Molibot Desktop diagnostics",
      "service version: 2.2.4",
      "ownership: managed",
      "endpoint: http://127.0.0.1:3210",
      "state: ready"
    ].join("\n")
  );
  const fallback = buildDiagnosticsSummary({
    serviceVersion: null,
    ownership: null,
    endpoint: null,
    state: "disconnected"
  });
  assert.match(fallback, /service version: unknown/);
  assert.match(fallback, /ownership: unknown/);
  assert.match(fallback, /endpoint: n\/a/);
});

test("hasEnabledWebProfile is true only when a profile is enabled", () => {
  const off: DesktopWebProfile[] = [
    { id: "a", name: "A", enabled: false, agentId: "", agentName: "" }
  ];
  assert.equal(hasEnabledWebProfile(off), false);
  assert.equal(hasEnabledWebProfile([]), false);
  const on: DesktopWebProfile[] = [
    { id: "a", name: "A", enabled: false, agentId: "", agentName: "" },
    { id: "b", name: "B", enabled: true, agentId: "x", agentName: "X" }
  ];
  assert.equal(hasEnabledWebProfile(on), true);
});

test("sanitizeWebProfileName trims and falls back to the id when blank", () => {
  assert.equal(sanitizeWebProfileName("  Helper  ", "a"), "Helper");
  assert.equal(sanitizeWebProfileName("", "default"), "default");
  assert.equal(sanitizeWebProfileName("   ", "default"), "default");
});

test("formatTokenCount rounds and adds thousands separators, guarding non-finite input", () => {
  assert.equal(formatTokenCount(1234567), "1,234,567");
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(42.7), "43");
  assert.equal(formatTokenCount(Number.NaN), "0");
  assert.equal(formatTokenCount(-100), "0");
});

test("formatDurationMs renders sub-second, seconds, and minute durations compactly", () => {
  assert.equal(formatDurationMs(400), "<1s");
  assert.equal(formatDurationMs(12_000), "12s");
  assert.equal(formatDurationMs(83_000), "1m 23s");
  assert.equal(formatDurationMs(120_000), "2m");
  assert.equal(formatDurationMs(Number.NaN), "<1s");
  assert.equal(formatDurationMs(-500), "<1s");
});

test("groupExternalSessionsForView flattens groups in order and carries display fields", () => {
  const views = groupExternalSessionsForView(externalSummary());
  assert.deepEqual(views.map((v) => v.id), ["tg-1", "tg-2", "wx-1"]);
  assert.equal(views[0].channel, "telegram");
  assert.equal(views[0].chatType, "group");
  assert.equal(views[0].botInstanceName, "Sales Bot");
  assert.equal(views[0].threadTitle, "Engineering");
  assert.equal(views[2].channel, "weixin");
  assert.equal(views[2].chatType, "channel");
});

test("groupExternalSessionsForView returns an empty list when there are no groups", () => {
  assert.deepEqual(groupExternalSessionsForView({ groups: [], counts: { totalSessions: 0 } }), []);
});

test("groupExternalSessionsForView sorts each channel by updatedAt desc", () => {
  const views = groupExternalSessionsForView({
    groups: [{
      channel: "telegram",
      total: 2,
      sessions: [
        { id: "old", title: "Old", updatedAt: "2026-06-01T00:00:00.000Z", chatType: "private", senderName: "x", platform: "telegram" },
        { id: "recent", title: "Recent", updatedAt: "2026-07-01T00:00:00.000Z", chatType: "private", senderName: "x", platform: "telegram" }
      ]
    }],
    counts: { totalSessions: 2 }
  });
  assert.deepEqual(views.map((view) => view.id), ["recent", "old"]);
});

test("buildExternalChannelNav lists every configured Bot per channel with session counts", () => {
  const channels = {
    groups: [
      {
        channel: "telegram",
        total: 2,
        enabled: 2,
        instances: [
          { id: "tg-sales", name: "Sales Bot", enabled: true, agentId: "a", allowedChatCount: 0, allowedChatIds: [], sandboxEnabled: null, fields: {}, configuredSecrets: [] },
          { id: "tg-support", name: "Support Bot", enabled: true, agentId: "a", allowedChatCount: 0, allowedChatIds: [], sandboxEnabled: null, fields: {}, configuredSecrets: [] }
        ]
      }
    ],
    counts: { totalInstances: 2, enabledInstances: 2 }
  };
  const external = {
    groups: [
      {
        channel: "telegram",
        total: 3,
        sessions: [
          { id: "a", title: "A", updatedAt: "2026-06-28T03:00:00.000Z", chatType: "group" as const, senderName: "x", botInstanceId: "tg-sales", platform: "telegram" },
          { id: "b", title: "B", updatedAt: "2026-06-28T02:00:00.000Z", chatType: "group" as const, senderName: "y", botInstanceId: "tg-sales", platform: "telegram" },
          { id: "c", title: "C", updatedAt: "2026-06-28T01:00:00.000Z", chatType: "group" as const, senderName: "z", botInstanceId: "tg-support", platform: "telegram" }
        ]
      }
    ],
    counts: { totalSessions: 3 }
  };
  const nav = buildExternalChannelNav(channels, external);
  assert.equal(nav.length, 1);
  assert.equal(nav[0].channel, "telegram");
  assert.deepEqual(nav[0].bots.map((b) => [b.name, b.count, b.configured]), [["Sales Bot", 2, true], ["Support Bot", 1, true]]);
  assert.equal(nav[0].total, 3);
});

test("buildExternalChannelNav keeps configured Bots with zero sessions and appends unconfigured ids", () => {
  const channels = {
    groups: [
      {
        channel: "telegram",
        total: 1,
        enabled: 1,
        instances: [
          { id: "tg-idle", name: "Idle Bot", enabled: true, agentId: "a", allowedChatCount: 0, allowedChatIds: [], sandboxEnabled: null, fields: {}, configuredSecrets: [] }
        ]
      }
    ],
    counts: { totalInstances: 1, enabledInstances: 1 }
  };
  const external = {
    groups: [
      {
        channel: "telegram",
        total: 1,
        sessions: [{ id: "x", title: "X", updatedAt: "2026-06-28T00:00:00.000Z", chatType: "group" as const, senderName: "x", botInstanceId: "tg-ghost", platform: "telegram" }]
      }
    ],
    counts: { totalSessions: 1 }
  };
  const nav = buildExternalChannelNav(channels, external);
  assert.deepEqual(nav[0].bots.map((b) => [b.instanceId, b.count, b.configured]), [["tg-idle", 0, true], ["tg-ghost", 1, false]]);
});

test("buildExternalChannelNav buckets sessions with no recoverable Bot id under the unknown entry", () => {
  const external = {
    groups: [
      {
        channel: "weixin",
        total: 1,
        sessions: [{ id: "w", title: "W", updatedAt: "2026-06-28T00:00:00.000Z", chatType: "channel" as const, senderName: "", platform: "weixin" }]
      }
    ],
    counts: { totalSessions: 1 }
  };
  const nav = buildExternalChannelNav(null, external);
  assert.equal(nav.length, 1);
  assert.equal(nav[0].channel, "weixin");
  assert.deepEqual(nav[0].bots.map((b) => [b.key, b.instanceId, b.count, b.configured]), [["weixin:__unknown__", "", 1, false]]);
});

test("externalSessionsForBot filters a flat view list by channel and Bot id", () => {
  const views = groupExternalSessionsForView({
    groups: [
      {
        channel: "telegram",
        total: 2,
        sessions: [
          { id: "a", title: "A", updatedAt: "2026-06-28T03:00:00.000Z", chatType: "group", senderName: "x", botInstanceId: "tg-sales", platform: "telegram" },
          { id: "b", title: "B", updatedAt: "2026-06-28T02:00:00.000Z", chatType: "group", senderName: "y", botInstanceId: "tg-support", platform: "telegram" }
        ]
      }
    ],
    counts: { totalSessions: 2 }
  });
  assert.deepEqual(externalSessionsForBot(views, "telegram", "tg-sales").map((v) => v.id), ["a"]);
  assert.deepEqual(externalSessionsForBot(views, "telegram", "tg-support").map((v) => v.id), ["b"]);
  assert.deepEqual(externalSessionsForBot(views, "telegram", "").map((v) => v.id), []);
});

test("formatExternalSessionPreview joins bot instance, thread, and sender with a separator", () => {
  const [first] = groupExternalSessionsForView(externalSummary());
  assert.equal(formatExternalSessionPreview(first), "Sales Bot · Engineering · Alice");

  const views = groupExternalSessionsForView(externalSummary());
  const support = views.find((v) => v.id === "tg-2")!;
  assert.equal(formatExternalSessionPreview(support), "12345678…");

  const wechat = views.find((v) => v.id === "wx-1")!;
  assert.equal(formatExternalSessionPreview(wechat), "");
});

test("groupExternalTranscriptByRole counts user and assistant messages", () => {
  const messages = [
    { id: "m1", role: "user" as const, content: "a", createdAt: "t1" },
    { id: "m2", role: "assistant" as const, content: "b", createdAt: "t2" },
    { id: "m3", role: "user" as const, content: "c", createdAt: "t3" }
  ];
  assert.deepEqual(groupExternalTranscriptByRole(messages), { userCount: 2, assistantCount: 1 });
  assert.deepEqual(groupExternalTranscriptByRole([]), { userCount: 0, assistantCount: 0 });
});

test("missingRuntimeDependencies returns only non-installed dependencies", () => {
  const summary: DesktopRuntimeEnvSummary = {
    dependencies: [
      { id: "ffmpeg", name: "ffmpeg", purpose: "media", status: "installed", version: "7", source: "homebrew", estimatedSize: "~90 MB", installCommand: "brew install ffmpeg", installSource: "homebrew" },
      { id: "git", name: "git", purpose: "vcs", status: "missing", version: "", source: "system", estimatedSize: "~60 MB", installCommand: "brew install git", installSource: "homebrew" },
      { id: "python3", name: "python3", purpose: "skills", status: "unknown", version: "", source: "system", estimatedSize: "~120 MB", installCommand: "brew install python@3.12", installSource: "homebrew" }
    ],
    counts: { total: 3, installed: 1, missing: 1 }
  };
  const missing = missingRuntimeDependencies(summary);
  assert.deepEqual(missing.map((d) => d.id), ["git", "python3"]);
});

test("validateProviderDraft accepts a complete draft and rejects each missing field", () => {
  const valid = validateProviderDraft({
    name: "Acme",
    protocol: "openai-compatible",
    baseUrl: "https://api.acme.com/v1",
    model: "gpt-4o",
    apiKeyPresent: true
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, []);

  const empty = validateProviderDraft({
    name: "",
    protocol: "openai-compatible",
    baseUrl: "",
    model: "",
    apiKeyPresent: false
  });
  assert.equal(empty.valid, false);
  assert.deepEqual(empty.errors.map((e) => e.field), ["name", "baseUrl", "model", "apiKeyPresent"]);

  const badUrl = validateProviderDraft({
    name: "Acme",
    protocol: "anthropic",
    baseUrl: "api.acme.com",
    model: "claude",
    apiKeyPresent: true
  });
  assert.equal(badUrl.valid, false);
  assert.equal(badUrl.errors[0].field, "baseUrl");
});

test("ONBOARDING_STEPS is ordered provider → agent → personalization → channels → launch → diagnostics", () => {
  assert.deepEqual([...ONBOARDING_STEPS], ["provider", "agent", "personalization", "channels", "launch", "diagnostics"]);
});

test("summarizeOnboardingChannels projects ordered rows and counts connected", () => {
  const summary: DesktopChannelsSummary = {
    groups: [
      {
        channel: "telegram",
        total: 2,
        enabled: 1,
        instances: [
          { id: "t1", name: "Bot 1", enabled: true, agentId: "default", allowedChatCount: 3, allowedChatIds: ["1", "2", "3"], sandboxEnabled: null, fields: {}, configuredSecrets: [] },
          { id: "t2", name: "Bot 2", enabled: false, agentId: "default", allowedChatCount: 0, allowedChatIds: [], sandboxEnabled: null, fields: {}, configuredSecrets: [] }
        ]
      },
      {
        channel: "feishu",
        total: 1,
        enabled: 0,
        instances: [
          { id: "f1", name: "FS", enabled: false, agentId: "default", allowedChatCount: 1, allowedChatIds: ["chat-1"], sandboxEnabled: null, fields: {}, configuredSecrets: [] }
        ]
      }
    ],
    counts: { totalInstances: 3, enabledInstances: 1 }
  };
  const view = summarizeOnboardingChannels(summary);
  assert.deepEqual(view.rows, [
    { channel: "telegram", enabled: 1, total: 2 },
    { channel: "feishu", enabled: 0, total: 1 }
  ]);
  assert.equal(view.connectedCount, 1);
});

test("summarizeOnboardingChannels handles a null summary", () => {
  const view = summarizeOnboardingChannels(null);
  assert.deepEqual(view.rows, []);
  assert.equal(view.connectedCount, 0);
});

test("summarizeOnboardingDiagnostics reports service + dependency status with missing names", () => {
  const runtimeEnv: DesktopRuntimeEnvSummary = {
    dependencies: [
      { id: "ffmpeg", name: "FFmpeg", purpose: "media", status: "installed", version: "6", source: "homebrew", estimatedSize: "70 MB", installCommand: "brew install ffmpeg", installSource: "homebrew" },
      { id: "git", name: "Git", purpose: "vcs", status: "missing", version: "", source: "system", estimatedSize: "0 MB", installCommand: "brew install git", installSource: "homebrew" }
    ],
    counts: { total: 2, installed: 1, missing: 1 }
  };
  const view = summarizeOnboardingDiagnostics(runtimeEnv, true);
  assert.equal(view.serviceReady, true);
  assert.equal(view.depsInstalled, 1);
  assert.equal(view.depsTotal, 2);
  assert.deepEqual(view.missingDependencyNames, ["Git"]);
});

test("summarizeOnboardingDiagnostics handles a null runtime summary", () => {
  const view = summarizeOnboardingDiagnostics(null, false);
  assert.equal(view.serviceReady, false);
  assert.equal(view.depsInstalled, 0);
  assert.equal(view.depsTotal, 0);
  assert.deepEqual(view.missingDependencyNames, []);
});

test("advanceOnboardingStep moves forward and returns null at the end", () => {
  assert.equal(advanceOnboardingStep("provider"), "agent");
  assert.equal(advanceOnboardingStep("diagnostics"), null);
});

test("resolveOnboardingStartStep sends profile-only repair directly to the agent step", () => {
  assert.equal(
    resolveOnboardingStartStep({ hasModel: true, modelLabel: "Claude", profileCount: 0, hasProfile: false }),
    "agent"
  );
  assert.equal(
    resolveOnboardingStartStep({ hasModel: false, modelLabel: "", profileCount: 1, hasProfile: true }),
    "provider"
  );
  assert.equal(
    resolveOnboardingStartStep({ hasModel: false, modelLabel: "", profileCount: 0, hasProfile: false }),
    "provider"
  );
});

test("resolveOnboardingRepairTarget records the initially missing prerequisite", () => {
  assert.equal(
    resolveOnboardingRepairTarget({ hasModel: true, modelLabel: "Claude", profileCount: 0, hasProfile: false }),
    "profile"
  );
  assert.equal(
    resolveOnboardingRepairTarget({ hasModel: false, modelLabel: "", profileCount: 1, hasProfile: true }),
    "model"
  );
  assert.equal(
    resolveOnboardingRepairTarget({ hasModel: true, modelLabel: "Claude", profileCount: 1, hasProfile: true }),
    null
  );
});

test("resolveOnboardingAgentSelection prefers the active profile's enabled linked agent", () => {
  const profiles: DesktopWebProfile[] = [
    { id: "one", name: "One", enabled: true, agentId: "agent-1", agentName: "One", sandboxEnabled: false },
    { id: "two", name: "Two", enabled: false, agentId: "agent-2", agentName: "Two", sandboxEnabled: false }
  ];
  const agents: DesktopAgentItem[] = [
    { id: "agent-1", name: "Agent One", description: "", enabled: true, sandboxEnabled: null, modelOverrides: 0, modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" } },
    { id: "agent-2", name: "Agent Two", description: "", enabled: true, sandboxEnabled: null, modelOverrides: 0, modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" } }
  ];

  assert.deepEqual(resolveOnboardingAgentSelection(profiles, agents, "two"), {
    profileId: "two",
    agentId: "agent-2",
    canConfirm: true
  });
});

test("resolveOnboardingAgentSelection falls back to usable entries and reports incomplete data", () => {
  const profiles: DesktopWebProfile[] = [
    { id: "one", name: "One", enabled: false, agentId: "disabled", agentName: "", sandboxEnabled: false }
  ];
  const agents: DesktopAgentItem[] = [
    { id: "disabled", name: "Disabled", description: "", enabled: false, sandboxEnabled: null, modelOverrides: 0, modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" } },
    { id: "usable", name: "Usable", description: "", enabled: true, sandboxEnabled: null, modelOverrides: 0, modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" } }
  ];

  assert.deepEqual(resolveOnboardingAgentSelection(profiles, agents, "missing"), {
    profileId: "one",
    agentId: "usable",
    canConfirm: true
  });
  assert.deepEqual(resolveOnboardingAgentSelection([], agents, ""), {
    profileId: "",
    agentId: "usable",
    canConfirm: false
  });
});

test("buildOnboardingHealthCheck reports ready with model + profile lines, and not-ready when either is missing", () => {
  const labels = {
    modelReady: "Text model",
    modelMissing: "Not configured",
    profileReady: (count: number) => `${count} enabled`,
    profileMissing: "Not enabled"
  };
  const ready = buildOnboardingHealthCheck(
    { hasModel: true, modelLabel: "GPT-4o", profileCount: 2, hasProfile: true },
    labels
  );
  assert.equal(ready.ready, true);
  assert.equal(ready.modelStatus, "ready");
  assert.equal(ready.profileStatus, "ready");
  assert.deepEqual(ready.lines, ["Text model: GPT-4o", "2 enabled"]);

  const noModel = buildOnboardingHealthCheck(
    { hasModel: false, modelLabel: "", profileCount: 1, hasProfile: true },
    labels
  );
  assert.equal(noModel.ready, false);
  assert.equal(noModel.modelStatus, "missing");
  assert.deepEqual(noModel.lines, ["Text model: Not configured", "1 enabled"]);

  const noProfile = buildOnboardingHealthCheck(
    { hasModel: true, modelLabel: "Claude", profileCount: 0, hasProfile: false },
    labels
  );
  assert.equal(noProfile.ready, false);
  assert.equal(noProfile.profileStatus, "missing");
  assert.deepEqual(noProfile.lines, ["Text model: Claude", "Not enabled"]);
});

test("submitDesktopProvider calls POST /api/desktop/providers with mapped fields", async () => {
  const original = globalThis.fetch;
  let capturedUrl: unknown = null;
  let capturedInit: any = undefined;

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, providerId: "desktop-123" }), {
      headers: { "content-type": "application/json" }
    });
  }) as typeof globalThis.fetch;

  try {
    const draft = {
      name: "Custom API",
      protocol: "openai-compatible" as const,
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4o",
      apiKeyPresent: true
    };
    const res = await submitDesktopProvider("http://127.0.0.1:3000", draft, "sk-secret-key");
    expect(res).toEqual({ ok: true, providerId: "desktop-123" });
    expect(capturedUrl).toBe("http://127.0.0.1:3000/api/desktop/providers");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    
    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.name).toBe("Custom API");
    expect(parsedBody.protocol).toBe("openai-compatible");
    expect(parsedBody.baseUrl).toBe("https://api.example.com/v1");
    assert.match(parsedBody.id, /^desktop-\d+$/);
    expect(parsedBody.models.length).toBe(1);
    expect(parsedBody.models[0].id).toBe("gpt-4o");
    expect(parsedBody.models[0].tags).toEqual(["text"]);
    expect(parsedBody.defaultModel).toBe("gpt-4o");
    expect(parsedBody.apiKey).toBe("sk-secret-key");
  } finally {
    globalThis.fetch = original;
  }
});

test("testDesktopProvider calls POST /api/desktop/provider-test with providerId", async () => {
  const original = globalThis.fetch;
  let capturedUrl: unknown = null;
  let capturedInit: any = undefined;

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, message: "Connected successfully" }), {
      headers: { "content-type": "application/json" }
    });
  }) as typeof globalThis.fetch;

  try {
    const res = await testDesktopProvider("http://127.0.0.1:3000", "desktop-123");
    expect(res).toEqual({ ok: true, message: "Connected successfully" });
    expect(capturedUrl).toBe("http://127.0.0.1:3000/api/desktop/provider-test");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const parsedBody = JSON.parse(capturedInit?.body as string);
    expect(parsedBody.providerId).toBe("desktop-123");
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop provider management uses fine-grained methods without requesting a saved key", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes("provider-models")) {
      return new Response(JSON.stringify({ ok: true, models: ["m1", "m2"] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      summary: { providerMode: "custom", piProvider: "", piModel: "", defaultCustomProviderId: "p1", customProviders: [] }
    }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    await updateDesktopProvider("http://127.0.0.1:3000", {
      id: "p1", name: "P1", enabled: true, protocol: "openai-compatible", baseUrl: "https://example.com",
      models: [], defaultModel: "", path: "/v1/chat/completions", supportsThinking: null, thinkingFormat: null, reasoningEffortMap: {}
    });
    await updateDesktopProviderGlobals("http://127.0.0.1:3000", {
      providerMode: "custom", piProvider: "anthropic", piModel: "claude", defaultCustomProviderId: "p1"
    });
    await deleteDesktopProvider("http://127.0.0.1:3000", "p1");
    assert.deepEqual(await discoverDesktopProviderModels("http://127.0.0.1:3000", "p1"), ["m1", "m2"]);
    assert.deepEqual(calls.map((call) => call.method), ["PATCH", "PUT", "DELETE", "POST"]);
    assert.equal(JSON.stringify(calls).includes("apiKey"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop advanced model routing uses the narrow GET and PATCH endpoint", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const routing = {
    compactionModelKey: "",
    subagentHaikuModelKey: "",
    subagentSonnetModelKey: "",
    subagentOpusModelKey: "",
    subagentThinkingModelKey: "",
    modelFallback: { mode: "same-provider" as const, firstTokenTimeoutMs: 30000 },
    defaultThinkingLevel: "medium" as const,
    compaction: { enabled: true, thresholdPercent: 80, reserveTokens: 4096, keepRecentTokens: 8192, defaultContextWindow: 128000 },
    timezone: "Asia/Shanghai",
    textOptions: []
  };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true, routing }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    assert.equal((await loadDesktopModelRouting("http://127.0.0.1:3000")).timezone, "Asia/Shanghai");
    const { textOptions: _textOptions, ...update } = routing;
    assert.equal((await saveDesktopModelRouting("http://127.0.0.1:3000", update)).defaultThinkingLevel, "medium");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "PATCH"]);
    assert.equal(calls.every((call) => call.url.endsWith("/api/desktop/model-routing")), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop tool settings use narrow PATCH, test, and media-task endpoints", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes("media-tasks")) return new Response(JSON.stringify({ ok: true, tasks: [] }), { status: 200 });
    if (String(url).includes("/test")) return new Response(JSON.stringify({ ok: true, result: { success: true } }), { status: 200 });
    if (String(url).includes("tts-generate")) return new Response(JSON.stringify({ ok: true, summary: { enabled: true, defaultProvider: "macos", providers: [] } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, summary: { enabled: true, defaultEngine: "auto", defaultRoute: "auto", engineSelectionStrategy: "priority", maxResults: 5, timeoutMs: 5000, retryTimeoutMs: 2000, engines: [], counts: { totalEngines: 0, enabledEngines: 0, configuredEngines: 0 } } }), { status: 200 });
  }) as typeof globalThis.fetch;
  const search = { enabled: true, defaultRoute: "auto", defaultEngine: "auto", engineSelectionStrategy: "priority", maxResults: 5, timeoutMs: 5000, retryTimeoutMs: 2000, engines: [{ id: "tavily", enabled: true, baseUrl: "", apiKey: "fresh-key" }] };
  const media = { enabled: true, defaultEngine: "auto", engines: [{ id: "agnes", enabled: true, baseUrl: "", model: "agnes", apiKey: "fresh-key" }] };
  const tts = { enabled: true, defaultProvider: "macos", providers: [{ id: "macos", enabled: true, voice: "Samantha", format: "m4a", baseUrl: "", model: "" }] };
  try {
    await saveDesktopWebSearch("http://127.0.0.1:3000", search);
    await saveDesktopImageGenerate("http://127.0.0.1:3000", media);
    await saveDesktopVideoGenerate("http://127.0.0.1:3000", media);
    await saveDesktopTts("http://127.0.0.1:3000", tts);
    await testDesktopWebSearchSettings("http://127.0.0.1:3000", search, "query", "auto");
    await testDesktopImageGenerateSettings("http://127.0.0.1:3000", media, "prompt", "auto", "1024x1024");
    await testDesktopVideoGenerateSettings("http://127.0.0.1:3000", media, "prompt", "auto");
    await testDesktopTtsSettings("http://127.0.0.1:3000", tts, "hello", "macos");
    await loadDesktopMediaTasks("http://127.0.0.1:3000", "image");
    await deleteDesktopMediaTask("http://127.0.0.1:3000", "image", "opaque-task-id");
    assert.deepEqual(calls.slice(0, 4).map((call) => call.method), ["PATCH", "PATCH", "PATCH", "PATCH"]);
    assert.equal(calls.slice(4, 8).every((call) => call.method === "POST" && call.url.includes("/api/settings/")), true);
    assert.deepEqual(calls.slice(8).map((call) => call.method), ["GET", "DELETE"]);
    assert.equal(calls[9].url.includes("taskId=opaque-task-id"), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("desktopTtsAudioUrl exposes only the guarded test-audio route", () => {
  const url = desktopTtsAudioUrl("http://127.0.0.1:3000/", {
    ok: true,
    result: { details: { filePath: "/private/runtime/settings-tts-tests/test-audio/sample voice.m4a" } }
  });
  assert.equal(url, "http://127.0.0.1:3000/api/settings/tts-generate/audio?file=test-audio%2Fsample%20voice.m4a");
  assert.equal(desktopTtsAudioUrl("http://127.0.0.1:3000", { ok: true, result: { details: { filePath: "/private/outside.wav" } } }), "");
});

test("provider editor draft is detached from the credential-safe source item", () => {
  const source = {
    id: "p1", name: "Provider", enabled: true, isDefault: true, protocol: "openai-compatible" as const,
    baseUrl: "https://example.com", hasApiKey: true, modelCount: 1, defaultModel: "m1", path: "/v1/chat/completions",
    supportsThinking: null, thinkingFormat: null, reasoningEffortMap: {},
    models: [{ id: "m1", tags: ["text" as const], supportedRoles: ["system" as const], enabled: true, verification: {} }]
  };
  const draft = providerItemToUpdateRequest(source);
  draft.models[0].tags.push("vision");
  assert.deepEqual(source.models[0].tags, ["text"]);
  assert.equal(JSON.stringify(draft).includes("apiKey"), false);
});

test("desktop memory actions and rejections use the narrow memory endpoint", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(String(url).includes("view=rejections") ? { ok: true, items: [], counts: { total: 0, add: 0, update: 0 } } : { ok: true, items: [] }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    await runDesktopMemoryAction("http://127.0.0.1:3000", { action: "search", allScopes: true, query: "project", limit: 200 });
    await loadDesktopMemoryRejections("http://127.0.0.1:3000");
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
    assert.equal(calls[0].url, "http://127.0.0.1:3000/api/desktop/memory");
    assert.deepEqual(calls[0].body, { action: "search", allScopes: true, query: "project", limit: 200 });
    assert.equal(calls[1].url, "http://127.0.0.1:3000/api/desktop/memory?view=rejections");
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop task actions submit opaque ids to the narrow tasks endpoint", async () => {
  const original = globalThis.fetch;
  let captured: { url: string; method: string; body: unknown } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    return new Response(JSON.stringify({ ok: true, summary: { items: [], counts: { total: 0, byType: { "one-shot": 0, periodic: 0, immediate: 0 }, byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 }, byScope: { workspace: 0, chatScratch: 0 }, byChannel: {} } }, affected: ["opaque-id"], failed: [] }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    await runDesktopTaskAction("http://127.0.0.1:3000", { action: "trigger", ids: ["opaque-id"] });
    assert.deepEqual(captured, { url: "http://127.0.0.1:3000/api/desktop/tasks", method: "POST", body: { action: "trigger", ids: ["opaque-id"] } });
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop task history requests a server-paginated execution page", async () => {
  const original = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ ok: true, summary: { items: [], targets: [], counts: { total: 0, byType: { "one-shot": 0, periodic: 0, immediate: 0 }, byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 }, byScope: { workspace: 0, chatScratch: 0 }, byChannel: {} } }, affected: [], failed: [], history: { items: [], page: 2, pageSize: 10, total: 14 } }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const { loadDesktopTaskHistory } = await import("./api");
    const page = await loadDesktopTaskHistory("http://127.0.0.1:3000", "opaque-id", 2, 10);
    assert.deepEqual(body, { action: "history", id: "opaque-id", page: 2, pageSize: 10 });
    assert.equal(page.total, 14);
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop task loading tolerates an older runtime response without execution history", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    summary: {
      items: [
        { id: "once", type: "one-shot", status: "completed", scope: "workspace", channel: "telegram" },
        { id: "cron", type: "periodic", status: "pending", scope: "workspace", channel: "telegram" }
      ],
      counts: {
        total: 2,
        byType: { "one-shot": 1, periodic: 1, immediate: 0 },
        byStatus: { pending: 1, running: 0, completed: 1, skipped: 0, error: 0 },
        byScope: { workspace: 2, chatScratch: 0 },
        byChannel: { telegram: 2 }
      }
    }
  }), { status: 200 })) as typeof globalThis.fetch;
  try {
    const summary = await loadDesktopTasks("http://127.0.0.1:3000");
    assert.deepEqual(summary.items.map((item) => item.id), ["cron"]);
    assert.deepEqual(summary.items[0].executions, []);
    assert.equal(summary.counts.total, 1);
    assert.equal(summary.counts.byType.periodic, 1);
    assert.equal(summary.counts.byType["one-shot"], 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("desktop project API uses granular project routes and preserves delete-session choice", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/settings/projects") && init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true, project: { id: "wiki", name: "Wiki", rootPath: "/tmp/wiki", createdAt: "now", updatedAt: "now" } }));
    }
    if (url.includes("/sessions")) return new Response(JSON.stringify({ ok: true, sessions: [] }));
    if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }));
    return new Response(JSON.stringify({ ok: true, projects: [] }));
  }) as typeof globalThis.fetch;
  try {
    assert.deepEqual(await loadDesktopProjects("http://localhost:3000"), []);
    assert.equal((await createDesktopProject("http://localhost:3000", { name: "Wiki", createDirectory: true })).id, "wiki");
    assert.deepEqual(await loadDesktopProjectSessions("http://localhost:3000", "wiki"), []);
    await deleteDesktopProject("http://localhost:3000", "wiki", true);
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(calls[1].body, { name: "Wiki", createDirectory: true });
    assert.match(calls[3].url, /removeSessions=true$/);
  } finally {
    globalThis.fetch = original;
  }
});

// Helper for expect-style assertions in node:test
function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      assert.equal(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepEqual(actual, expected);
    }
  };
}
