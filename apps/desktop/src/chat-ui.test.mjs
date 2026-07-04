import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const view = read("./ChatView.svelte");
const app = read("./App.svelte");
const styles = read("./styles.css");
const infoPlist = read("../src-tauri/Info.plist");

// The settings UI is split into per-domain runes stores + section components
// under lib/settings and lib/stores. Assertions target the file where the
// markup now lives.
const sections = {
  agents: read("./lib/settings/AgentsSection.svelte"),
  mcp: read("./lib/settings/McpSection.svelte"),
  channels: read("./lib/settings/ChannelsSection.svelte"),
  profiles: read("./lib/settings/ProfilesSection.svelte"),
  tasks: read("./lib/settings/TasksSection.svelte"),
  skills: read("./lib/chat/InstalledSkillsPane.svelte"),
  memory: read("./lib/settings/MemorySection.svelte"),
  providers: read("./lib/settings/ProvidersSection.svelte"),
  sandbox: read("./lib/settings/SandboxSection.svelte"),
  usage: read("./lib/settings/UsageSection.svelte"),
  trace: read("./lib/settings/TraceSection.svelte"),
  image: read("./lib/settings/ImageGenerateSection.svelte"),
  tts: read("./lib/settings/TtsGenerateSection.svelte")
};
const charts = read("./lib/settings/charts.ts");
const transcript = read("./lib/chat/ConversationTranscript.svelte");
const transcriptAttachments = read("./lib/chat/TranscriptAttachments.svelte");
const runActivity = read("./lib/chat/RunActivity.svelte");
const transcriptHelpers = read("./lib/chat/transcript.ts");

const formSectionKey = { agent: "agents", mcp: "mcp", channel: "channels", profile: "profiles", task: "tasks", memory: "memory" };

test("chat composer keeps keyboard guidance in the textarea placeholder", () => {
  assert.match(view, /placeholder=\{sending \? copy\.queueHint : copy\.enterHint\}/);
  assert.doesNotMatch(view, /class="composer-hint"/);
});

test("microphone control starts recording and exposes a timer bar", () => {
  assert.match(view, /onclick=\{toggleRecording\}/);
  assert.match(view, /class="recording-bar"/);
  assert.match(view, /formatDuration\(recordingSeconds\)/);
  assert.match(infoPlist, /<key>NSMicrophoneUsageDescription<\/key>/);
});

test("assistant code blocks wrap without horizontal scrolling", () => {
  assert.match(styles, /\.markdown-body pre\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /\.markdown-body pre code\s*\{[^}]*white-space:\s*pre-wrap/s);
  assert.match(styles, /\.markdown-body pre code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.markdown-body table\s*\{[^}]*table-layout:\s*fixed/s);
});

test("session groups start collapsed and use balanced list density", () => {
  assert.match(view, /activeBotKey = "";[\s\S]*switchViewMode\("external"\)/);
  assert.doesNotMatch(view, /const firstBot = externalNav/);
  assert.match(view, /if \(bot\.key === activeBotKey\) \{[\s\S]*activeBotKey = "";/);
  assert.match(styles, /\.conv-group-head\s*\{[^}]*height:\s*34px/s);
  assert.match(styles, /\.conversation-select\s*\{[^}]*min-height:\s*40px/s);
});

test("chat primary navigation stays in the Chat workspace", () => {
  assert.match(view, /let workspacePane: ChatWorkspacePaneName = "chat"/);
  assert.match(view, /onclick=\{\(\) => openWorkspacePane\("automations"\)\}/);
  assert.match(view, /onclick=\{\(\) => openWorkspacePane\("skills"\)\}/);
  assert.doesNotMatch(view, /onclick=\{\(\) => openSettings\("tasks"\)\}/);
  assert.doesNotMatch(view, /onclick=\{\(\) => openSettings\("skills"\)\}/);
  assert.match(view, /activeBotKey = activeProfileId/);
  assert.match(view, /data-session-id=\{session\.id\}/);
});

test("automation session detail renders a chat-style transcript", () => {
  assert.match(view, /import ConversationTranscript from "\.\/lib\/chat\/ConversationTranscript\.svelte"/);
  assert.match(sections.tasks, /import ConversationTranscript from "\.\.\/chat\/ConversationTranscript\.svelte"/);
  assert.match(view, /<ConversationTranscript/);
  assert.match(sections.tasks, /<ConversationTranscript/);
  assert.match(transcript, /class="message-row"/);
  assert.match(transcript, /class="message-avatar"/);
  assert.match(transcript, /class="message-stack"/);
  assert.match(transcript, /class="message-bubble markdown-body"/);
  assert.match(transcript, /renderMarkdown\(displayContent\)/);
  assert.doesNotMatch(sections.tasks, /class="message-(row|avatar|stack|bubble)/);
});

test("automation management uses a command deck and opens full history in a modal", () => {
  assert.match(sections.tasks, /class="automation-command-deck"/);
  assert.match(sections.tasks, /class="automation-card" data-status=/);
  assert.match(sections.tasks, /class="modal-card task-history-modal"/);
  assert.match(sections.tasks, /openTaskHistory\(task\.id\)/);
  assert.doesNotMatch(sections.tasks, /class="task-history-panel"/);
  assert.match(styles, /\.task-history-modal\s*\{[^}]*width:\s*min\(820px/s);
});

test("chat workspace design constraints cover skills, errors, focus, and reachable narrow widths", () => {
  assert.match(sections.skills, /class="installed-skills-search"/);
  assert.match(sections.skills, /class:expanded=\{expandedIds\.has\(skill\.id\)\}/);
  assert.match(styles, /\.installed-skill-card\s*\{[^}]*align-self:\s*start/s);
  assert.match(styles, /\.installed-skill-copy p\s*\{[^}]*-webkit-line-clamp:\s*3/s);
  assert.match(view, /class="composer-error" role="alert"/);
  assert.doesNotMatch(view, /messageMediaFailed = failed;\s*error = cause instanceof Error/s);
  assert.match(styles, /button:focus-visible,[\s\S]*box-shadow:\s*0 0 0 2px var\(--card-bg\), 0 0 0 4px var\(--accent\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.chat-layout \{ grid-template-columns: 180px minmax\(0, 1fr\); \}/);
  assert.doesNotMatch(styles, /@media \(max-width: 820px\)[\s\S]{0,80}--sidebar-w:/);
});

test("shared transcript renders media inline and delegates tool activity", () => {
  assert.match(transcriptAttachments, /transcript-image/);
  assert.match(transcriptAttachments, /transcript-audio/);
  assert.match(transcriptAttachments, /transcript-video/);
  assert.match(transcriptAttachments, /<audio[\s\S]*controls/);
  assert.match(transcriptAttachments, /<video[\s\S]*controls/);
  assert.match(transcript, /<RunActivity/);
  assert.match(transcript, /transcriptDisplayContent\(message, copy\.chatAssistantError\)/);
  assert.match(transcriptHelpers, /\["\(attachment\)", "\(empty response\)"\]/);
  assert.match(transcriptHelpers, /content === "Sorry, something went wrong\."/);
  assert.match(runActivity, /hasError \? copy\.runFailed : copy\.runCompleted/);
});

test("settings uses the flat Geist layout", () => {
  assert.match(app, /class="settings-search"/);
  assert.match(app, /class="page-header settings-page-header"[\s\S]*class="settings-scroll"/);
  assert.match(styles, /\.settings-row\s*\{[^}]*min-height:\s*50px/s);
  // Geist cards are flat: solid surface + subtle shadow, no glass blur.
  assert.doesNotMatch(styles, /backdrop-filter/);
  assert.match(styles, /\.settings-card\s*\{[^}]*background:\s*var\(--card-bg\)/s);
  assert.match(styles, /\.settings-card \+ \.settings-card\s*\{[^}]*margin-top:\s*16px/s);
  assert.match(styles, /\.settings-footbar\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/s);
  assert.match(sections.tts, /open=\{provider\.id === toolsStore\.ttsGenerateEdit\.defaultProvider\}/);
  assert.match(sections.image, /<option value="1024x1024">1024 × 1024<\/option>/);
});

test("usage and trace pages render chart dashboards instead of plain rows", () => {
  // Usage: KPI tiles, the daily token trend area chart, distribution donut, window bars.
  assert.match(sections.usage, /class="chart-kpi-grid"/);
  assert.match(sections.usage, /class="trend-svg"[\s\S]*d=\{usageTokenArea\}/);
  assert.match(sections.usage, /class="trend-line trend-line-token" d=\{usageTokenLine\}/);
  assert.match(sections.usage, /class="donut-seg"[\s\S]*stroke-dasharray="\{seg\.len\}/);
  assert.match(sections.usage, /class="window-bar-track"/);
  // Trace: activity bars, the tool-outcome donut, coverage tiles, duration bars.
  assert.match(sections.trace, /class="hbar-fill"[\s\S]*percentOf\(item\.value, traceActivityMax\)/);
  assert.match(sections.trace, /each traceOutcomeSegments as seg/);
  assert.match(sections.trace, /class="coverage-grid"/);
  // Chart geometry + palette are present.
  assert.match(charts, /function trendLinePath\(/);
  assert.match(charts, /function donutSegments\(/);
  assert.match(styles, /--chart-blue:/);
  assert.match(styles, /\.donut-seg\s*\{/);
});

test("settings navigation matches the web taxonomy and entity editors open as dialogs", () => {
  assert.match(app, /id: "general", sections: \["general"\]/);
  assert.match(app, /id: "ai", sections: \["models", "providers", "usage", "trace", "mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"\]/);
  assert.match(app, /id: "channels", sections: \["profiles", "channels"\]/);
  assert.match(app, /id: "data", sections: \["agents", "memory", "skills", "runHistory", "tasks", "hostBash"\]/);
  assert.match(app, /id: "system", sections: \["runtimeEnv", "sandbox", "plugins", "diagnostics"\]/);
  for (const [formId, key] of Object.entries(formSectionKey)) {
    assert.match(sections[key], new RegExp(`id="desktop-${formId}-form"[^>]*aria-label=`));
    assert.match(styles, new RegExp(`#desktop-${formId}-form`));
  }
  assert.match(sections.agents, /class="entity-editor-head"/);
  assert.match(sections.agents, /class="entity-editor-foot"/);
  assert.match(styles, /\.entity-editor-foot\s*\{[^}]*bottom:\s*0/s);
  assert.match(app, /label: sectionLabel\(item\.id, text\)/);
  assert.match(app, /<h2>\{sectionLabel\(activeSection, text\)\}<\/h2>/);
  assert.match(app, /\{text\[preview\.labelKey\]\}/);
});

test("AI provider editing uses a dedicated modal and separates provider and model concepts", () => {
  assert.match(sections.providers, /class="modal-overlay provider-modal-overlay"/);
  assert.match(sections.providers, /class="modal-card provider-modal-card"/);
  assert.match(sections.providers, /session\.text\.providerSelfHostedTitle/);
  assert.match(sections.providers, /session\.text\.providerCustomModelsTitle/);
  assert.match(styles, /\.modal-card\.provider-modal-card\s*\{[^}]*width:\s*min\(920px,\s*100%\)/s);
  // The save footbar belongs to the provider globals (mode/default) and is gated
  // by its own dirty flag — a separate concern from the provider edit modal.
  assert.match(sections.providers, /\{#if providersStore\.globalsDirty\}[\s\S]{0,200}class="settings-footbar"/);
});

test("Sandbox settings expose presets, full policy editing, diagnostics, and a fixed save footer", () => {
  assert.match(sections.sandbox, /id="desktop-sandbox-form"/);
  assert.match(sections.sandbox, /id: "observe"/);
  assert.match(sections.sandbox, /id: "build"/);
  assert.match(sections.sandbox, /id: "strict"/);
  assert.match(sections.sandbox, /onclick=\{\(\) => applySandboxPreset\(preset\.id as DesktopSandboxPreset\)\}/);
  assert.match(sections.sandbox, /session\.text\.sandboxEnvAllow/);
  assert.match(sections.sandbox, /session\.text\.sandboxNetworkAllow/);
  assert.match(sections.sandbox, /session\.text\.sandboxFilesystemAllowWrite/);
  assert.match(sections.sandbox, /form="desktop-sandbox-form"/);
  assert.match(styles, /\.sandbox-presets\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
});
