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

test("settings keeps the native-density liquid-glass layout", () => {
  assert.match(app, /class="settings-search"/);
  assert.match(app, /class="page-header settings-page-header"[\s\S]*class="settings-scroll"/);
  assert.match(styles, /\.settings-row\s*\{[^}]*min-height:\s*46px/s);
  assert.match(styles, /\.settings-card\s*\{[^}]*backdrop-filter:\s*blur\(24px\) saturate\(170%\)/s);
  assert.match(styles, /\.settings-footbar\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/s);
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
