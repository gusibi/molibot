import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./ChatView.svelte", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const infoPlist = readFileSync(new URL("../src-tauri/Info.plist", import.meta.url), "utf8");

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
  assert.match(styles, /\.conversation-select\s*\{[^}]*min-height:\s*36px/s);
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
  assert.match(app, /open=\{provider\.id === ttsGenerateEdit\.defaultProvider\}/);
  assert.match(app, /<option value="1024x1024">1024 × 1024<\/option>/);
});

test("usage and trace pages render chart dashboards instead of plain rows", () => {
  // Usage: KPI tiles, the daily token trend area chart, distribution donut, window bars.
  assert.match(app, /class="chart-kpi-grid"/);
  assert.match(app, /class="trend-svg"[\s\S]*d=\{usageTokenArea\}/);
  assert.match(app, /class="trend-line trend-line-token" d=\{usageTokenLine\}/);
  assert.match(app, /class="donut-seg"[\s\S]*stroke-dasharray="\{seg\.len\}/);
  assert.match(app, /class="window-bar-track"/);
  // Trace: activity bars, the tool-outcome donut, coverage tiles, duration bars.
  assert.match(app, /class="hbar-fill"[\s\S]*percentOf\(item\.value, traceActivityMax\)/);
  assert.match(app, /each traceOutcomeSegments as seg/);
  assert.match(app, /class="coverage-grid"/);
  // Chart geometry + palette are present.
  assert.match(app, /function trendLinePath\(/);
  assert.match(app, /function donutSegments\(/);
  assert.match(styles, /--chart-blue:/);
  assert.match(styles, /\.donut-seg\s*\{/);
});

test("settings navigation matches the web taxonomy and entity editors open as dialogs", () => {
  assert.match(app, /id: "general", sections: \["general"\]/);
  assert.match(app, /id: "ai", sections: \["models", "providers", "usage", "trace", "mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"\]/);
  assert.match(app, /id: "channels", sections: \["profiles", "channels"\]/);
  assert.match(app, /id: "data", sections: \["agents", "memory", "skills", "runHistory", "tasks", "hostBash"\]/);
  assert.match(app, /id: "system", sections: \["runtimeEnv", "sandbox", "plugins", "diagnostics"\]/);
  for (const formId of ["agent", "mcp", "channel", "profile", "task", "memory"]) {
    assert.match(app, new RegExp(`id="desktop-${formId}-form"[^>]*aria-label=`));
    assert.match(styles, new RegExp(`#desktop-${formId}-form`));
  }
  assert.match(app, /class="entity-editor-head"/);
  assert.match(app, /class="entity-editor-foot"/);
  assert.match(styles, /\.entity-editor-foot\s*\{[^}]*bottom:\s*0/s);
  assert.match(app, /label: sectionLabel\(item\.id, text\)/);
  assert.match(app, /<h2>\{sectionLabel\(activeSection, text\)\}<\/h2>/);
  assert.match(app, /\{text\[preview\.labelKey\]\}/);
});

test("AI provider editing uses a dedicated modal and separates provider and model concepts", () => {
  assert.match(app, /class="modal-overlay provider-modal-overlay"/);
  assert.match(app, /class="modal-card provider-modal-card"/);
  assert.match(app, /text\.providerSelfHostedTitle/);
  assert.match(app, /text\.providerCustomModelsTitle/);
  assert.match(styles, /\.modal-card\.provider-modal-card\s*\{[^}]*width:\s*min\(920px,\s*100%\)/s);
  assert.doesNotMatch(app, /activeSection === "providers" && providerEdit[\s\S]{0,500}class="settings-footbar"/);
});

test("Sandbox settings expose presets, full policy editing, diagnostics, and a fixed save footer", () => {
  assert.match(app, /id="desktop-sandbox-form"/);
  assert.match(app, /id: "observe"/);
  assert.match(app, /id: "build"/);
  assert.match(app, /id: "strict"/);
  assert.match(app, /onclick=\{\(\) => applySandboxPreset\(preset\.id as DesktopSandboxPreset\)\}/);
  assert.match(app, /text\.sandboxEnvAllow/);
  assert.match(app, /text\.sandboxNetworkAllow/);
  assert.match(app, /text\.sandboxFilesystemAllowWrite/);
  assert.match(app, /form="desktop-sandbox-form"/);
  assert.match(styles, /\.sandbox-presets\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
});
