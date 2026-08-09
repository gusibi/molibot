import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const listSvelteSources = (dir = new URL("./", import.meta.url)) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
  if (entry.isDirectory()) return listSvelteSources(url);
  return entry.name.endsWith(".svelte") ? [readFileSync(url, "utf8")] : [];
});
const view = read("./ChatView.svelte");
const app = read("./App.svelte");
const i18n = read("./lib/i18n.ts");
const styles = read("./styles.css");
const multiSelectControl = read("./lib/components/ui/MultiSelectControl.svelte");
const design = read("../../../DESIGN.md");
const tauriConfig = JSON.parse(read("../src-tauri/tauri.conf.json"));
const tauriCargo = read("../src-tauri/Cargo.toml");
const svelteStyleSources = listSvelteSources().flatMap((source) => [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map((match) => match[1]));
const allStyleSources = [styles, ...svelteStyleSources];
const infoPlist = read("../src-tauri/Info.plist");
const tauriCapabilities = JSON.parse(read("../src-tauri/capabilities/default.json"));

// The settings UI is split into per-domain runes stores + section components
// under lib/settings and lib/stores. Assertions target the file where the
// markup now lives.
const sections = {
  agents: read("./lib/settings/AgentsSection.svelte"),
  mcp: read("./lib/settings/McpSection.svelte"),
  openConnector: read("./lib/settings/OpenConnectorSection.svelte"),
  channels: read("./lib/settings/ChannelsSection.svelte"),
  profiles: read("./lib/settings/ProfilesSection.svelte"),
  tasks: read("./lib/settings/TasksSection.svelte"),
  skills: read("./lib/chat/InstalledSkillsPane.svelte"),
  memory: read("./lib/settings/MemorySection.svelte"),
  plugins: read("./lib/settings/PluginsSection.svelte"),
  providers: read("./lib/settings/ProvidersSection.svelte"),
  sandbox: read("./lib/settings/SandboxSection.svelte"),
  usage: read("./lib/settings/UsageSection.svelte"),
  trace: read("./lib/settings/TraceSection.svelte"),
  image: read("./lib/settings/ImageGenerateSection.svelte"),
  video: read("./lib/settings/VideoGenerateSection.svelte"),
  tts: read("./lib/settings/TtsGenerateSection.svelte")
};
const charts = read("./lib/settings/charts.ts");
const row = read("./lib/chat/ConversationRow.svelte");
const transcript = read("./lib/chat/ConversationTranscript.svelte");
const transcriptAttachments = read("./lib/chat/TranscriptAttachments.svelte");
const runActivity = read("./lib/chat/RunActivity.svelte");
const thinkingCard = read("./lib/chat/ThinkingCard.svelte");
const conversationLiveView = read("./lib/chat/ConversationLiveView.svelte");
const agentStudio = read("./lib/chat/AgentStudioPane.svelte");
const agentCityCanvas = read("./lib/chat/AgentCityCanvas.svelte");
const agentCityFallback = read("./lib/chat/AgentCityFallback.svelte");
const agentCityScene = read("./lib/chat/agentCityScene.ts");
const chatSidebar = read("./lib/chat/ChatSidebar.svelte");
const chatWorkspace = read("./lib/chat/ChatWorkspacePane.svelte");
const chatComposerShell = read("./lib/chat/ChatComposerShell.svelte");
const chatInputArea = read("./lib/chat/ChatInputArea.svelte");
const composerModelMenu = read("./lib/chat/ComposerModelMenu.svelte");
const slashSuggestionMenu = read("./lib/chat/SlashSuggestionMenu.svelte");

const projectSettingsDialog = read("./lib/projects/ProjectSettingsDialog.svelte");
const taskScheduleBuilder = read("./lib/settings/TaskScheduleBuilder.svelte");
const nativeTimeInput = read("./lib/components/ui/NativeTimeInput.svelte");
const selectControl = read("./lib/components/ui/SelectControl.svelte");
const projectDetail = read("./lib/projects/ProjectDetail.svelte");
const chatMessagesPane = read("./lib/chat/ChatMessagesPane.svelte");
const conversationPromptNavigator = read("./lib/chat/ConversationPromptNavigator.svelte");
const conversationNavigation = read("./lib/chat/conversationNavigation.ts");
const stickToBottom = read("./lib/chat/stickToBottom.ts");
const chatHeader = read("./lib/chat/ChatHeader.svelte");
const transcriptSearch = read("./lib/chat/TranscriptSearch.svelte");
const pageHeader = read("./lib/components/ui/PageHeader.svelte");
const overflowMenu = read("./lib/components/ui/OverflowMenu.svelte");
const settingGroup = read("./lib/components/ui/SettingGroup.svelte");
const recordingBar = read("./lib/chat/RecordingBar.svelte");
const projectChat = read("./lib/projects/ProjectChat.svelte");
const projectChatStoreSource = read("./lib/projects/projectChatStore.svelte.ts");
const projectFilePanel = read("./lib/artifacts/ArtifactPanel.svelte");
const taskStore = read("./lib/stores/tasks.svelte.ts");
const settingsSessionStore = read("./lib/stores/session.svelte.ts");
const skillsStoreSource = read("./lib/stores/skills.svelte.ts");
const providersStore = read("./lib/stores/providers.svelte.ts");
const conversationController = read("./lib/chat/conversationController.svelte.ts");
const chatSessionStore = read("./lib/chat/chatSessionStore.svelte.ts");
const transcriptHelpers = read("./lib/chat/transcript.ts");
const markdown = read("./lib/markdown.ts");
const markdownLinks = read("./lib/chat/markdownLinks.ts");
const queuedMessagesBar = read("./lib/chat/QueuedMessagesBar.svelte");
const logsSection = read("./lib/settings/LogsSection.svelte");
const activeRunsRoute = read("../../../src/routes/api/desktop/active-runs/+server.ts");
const streamStopRoute = read("../../../src/routes/api/stream/stop/+server.ts");
const commandSystem = read("./lib/native/commandSystem.ts");
const commandHost = read("./lib/native/commandHost.ts");
const windowState = read("./lib/native/windowState.ts");
const feedbackCoordinator = read("./lib/native/feedbackCoordinator.ts");
const hapticCoordinator = read("./lib/native/hapticCoordinator.ts");
const nativeAppMenu = read("../src-tauri/src/app_menu.rs");

test("message links open externally and session model hydration blocks mismatched sends", () => {
  // The behaviour lives in one shared handler now: the transcript and the
  // Artifact Panel's Markdown viewer must not each own a copy (pitfall #7).
  const markdownInteractions = read("./lib/markdownInteractions.ts");
  assert.match(transcript, /handleMarkdownBodyClick\(event, copy\)/);
  assert.match(markdownInteractions, /externalHttpUrlFromClick/);
  assert.match(markdownInteractions, /invoke\("open_external_url", \{ url \}\)/);
  assert.ok(
    markdownInteractions.indexOf("externalHttpUrlFromClick(event)") <
      markdownInteractions.indexOf("await copyCodeFromClick(event, copy)")
  );
  assert.match(markdownLinks, /url\.protocol === "http:" \|\| url\.protocol === "https:"/);
  assert.match(view, /modelReady = [^;]+&& !modelSelectionHydrating/);
  assert.match(view, /modelSelectionHydrating = true;[\s\S]*loadDesktopSessionModel/);
});

test("the composer's model pill reflects the Session, never a stale global default", () => {
  // Shipped bug (2026-07-30): a project Session whose every turn ran on DeepSeek
  // showed the global Gemini default in its composer. Two causes, both guarded
  // here.
  // 1. `view` is a fresh object on every projects-store tick, so an ungated
  //    `$: loadModelOptions(view.endpoint)` re-ran constantly and each run reset
  //    the selector to the global key, clobbering the hydrated session model.
  assert.match(projectChat, /\$: if \(view\.endpoint && view\.endpoint !== loadedModelEndpoint\)/);
  assert.doesNotMatch(projectChat, /\n\s*activeModelKey = state\.currentKey;/);
  // 2. With no explicit per-session pick, both chat surfaces follow the model
  //    that actually answered last instead of the current global default.
  for (const source of [view, projectChat]) {
    assert.match(source, /lastTranscriptModelKey/);
    assert.match(source, /transcriptModelKeys\.set\(sessionId, key\)/);
    // An explicit pick outranks it and is not undone by the next reply.
    assert.match(source, /transcriptModelKeys\.delete\(sessionId\)/);
    assert.match(source, /sessionModelOverrides\.get\(sessionId\) \?\?\s*transcriptModelKeys\.get\(sessionId\)/);
  }
});

test("editing rewrites the current Session and branching is a separate explicit action", () => {
  // Edit-and-resend stays destructive: it truncates the active Session in place.
  assert.match(view, /await truncateDesktopMessages\(connectedEndpoint, activeProfileId, activeSessionId, editingId\)/);
  assert.doesNotMatch(view, /forkDesktopSession\(\s*connectedEndpoint,\s*activeProfileId,\s*editingSession/);
  // The branch button forks, switches to the child, and primes its composer.
  assert.match(view, /async function forkFromUserMessage/);
  assert.match(view, /chatStore\.selectSession\(activeProfileId, child\.id\)/);
  assert.match(view, /Promise\.allSettled/);
  assert.match(view, /forkingMessageId/);
  assert.match(transcript, /messageActions\.onForkUser!\(message\)/);
  assert.match(transcript, /ph-git-branch/);
  assert.match(transcriptHelpers, /onForkUser\?: \(message: TranscriptMessage\) => void/);
  // Project chat mirrors the split: destructive edit, plus its own branch
  // button now that fork sources resolve for Project Sessions too.
  assert.match(projectChat, /await truncateDesktopMessages\(/);
  assert.match(projectChat, /async function forkFromUserMessage/);
  assert.match(projectChat, /onForkUser/);
  assert.match(projectChat, /selectProjectSession\(childSessionId/);
  assert.doesNotMatch(projectChat, /editingForkRequestId/);
  assert.match(row, /class:forked=\{Boolean\(item\.parentSessionId\)\}/);
  assert.match(row, /row-branch/);
});

test("native close behavior is a localized narrow preference using IosSwitch", () => {
  assert.match(app, /type CloseBehavior = "background" \| "quit"/);
  assert.match(app, /invoke<CloseBehavior>\("set_close_behavior", \{ closeBehavior \}\)/);
  assert.match(app, /title=\{text\.closeToMenuBar\}[\s\S]*<IosSwitch/);
  assert.match(app, /onCheckedChange=\{toggleCloseBehavior\}/);
  assert.match(app, /<IosSwitch[\s\S]*onCheckedChange=\{setLoginStart\}/);
  assert.match(styles, /\.ios-switch \{/);
  assert.doesNotMatch(app, /class="switch"/);
});

test("service logs expose structured filters, paginated records, and raw-line compatibility", () => {
  assert.match(logsSection, /invoke<ServiceLogPage>\("desktop_logs", \{ query \}\)/);
  assert.match(logsSection, /SelectControl/);
  assert.match(logsSection, /SearchField/);
  assert.match(logsSection, /log\.category/);
  assert.match(logsSection, /log\.event/);
  assert.match(logsSection, /log\.runId/);
  assert.match(logsSection, /nextLogsPage/);
  assert.match(logsSection, /logsRawLine/);
  assert.doesNotMatch(logsSection, /<style/);
});

test("service log rows open a readable JSON detail dialog and compact long Run IDs", () => {
  assert.match(logsSection, /import Dialog from "\.\.\/components\/ui\/Dialog\.svelte"/);
  assert.match(logsSection, /let selectedLog = \$state<ServiceLogRecord \| null>\(null\)/);
  assert.match(logsSection, /function compactRunId\(/);
  assert.match(logsSection, /compactRunId\(log\.runId\)/);
  assert.match(logsSection, /JSON\.stringify\(parsed, null, 2\)/);
  assert.match(logsSection, /navigator\.clipboard\.writeText/);
  assert.match(logsSection, /<Dialog[\s\S]*logsDetailTitle/);
  assert.match(logsSection, /class="service-log-row"[\s\S]*onclick=\{\(\) => openLogDetail\(log\)\}/);
  assert.doesNotMatch(logsSection, /<details class="service-log-raw"/);
});

test("reported Desktop settings pages use the shared macOS-style IosSwitch", () => {
  const affectedSettingsSections = [
    "SkillsSection",
    "ImageGenerateSection",
    "VideoGenerateSection",
    "TtsGenerateSection",
    "HostBashSection",
    "ProfilesSection",
    "WebSearchSection",
    "SandboxSection",
    "PluginsSection"
  ];

  for (const sectionName of affectedSettingsSections) {
    const source = read(`./lib/settings/${sectionName}.svelte`);
    assert.match(source, /import IosSwitch from "\.\.\/components\/ui\/IosSwitch\.svelte"/, `${sectionName} should import IosSwitch`);
    assert.match(source, /<IosSwitch/, `${sectionName} should render IosSwitch`);
    assert.doesNotMatch(source, /class="switch"/, `${sectionName} should not render the legacy switch button`);
  }
});

test("Desktop MCP settings distinguish configured enablement from live connection state", () => {
  assert.match(sections.mcp, /import IosSwitch from "\.\.\/components\/ui\/IosSwitch\.svelte"/);
  assert.match(sections.mcp, /server\.connectionState/);
  assert.match(sections.mcp, /toggleMcpServer\(server\.id, enabled\)/);
  assert.match(sections.mcp, /reconnectMcp\(server\.id\)/);
  assert.match(sections.mcp, /server\.lastError/);
  assert.match(sections.mcp, /\{#if server\.managed\}[^\n]*mcpManaged/);
  assert.match(sections.mcp, /\{#if !server\.managed\}<IosSwitch/);
  assert.match(sections.mcp, /\{#if !server\.managed\}[\s\S]*beginMcpEdit\(server\)[\s\S]*removeMcpServer\(server\.id\)/);
  assert.doesNotMatch(sections.mcp, /class="switch"/);
});

test("native feedback requests permission only on explicit enablement and observes terminal task transitions", () => {
  assert.match(feedbackCoordinator, /export class FeedbackCoordinator/);
  assert.match(feedbackCoordinator, /if \(!event\.terminal \|\| this\.preference\(\) !== "enabled"\)/);
  assert.match(feedbackCoordinator, /passivePermission: NotificationPermission = "default"/);
  assert.match(app, /requestFeedbackPermission\(feedbackAdapter\)/);
  assert.match(app, /invoke<NotificationPreference>\("set_notification_preference"/);
  assert.match(app, /<IosSwitch[\s\S]*ariaLabel=\{text\.nativeNotifications\}/);
  assert.match(app, /setTaskFeedbackPublisher\(\(event\) => publishFeedback\(event\)\)/);
  assert.match(app, /feedbackAdapter\.onAction/);
  assert.match(app, /invoke\("show_main_window"/);
  assert.match(app, /publishServiceTransition/);
  assert.match(app, /onCommandResult=\{publishCommandResult\}/);
  assert.match(view, /const result = await commandSystem\.execute\(id, commandContext\);/);
  assert.match(view, /onCommandResult\(result\)/);
  assert.match(feedbackCoordinator, /onAction\?\(listener/);
  assert.match(feedbackCoordinator, /onAction\(listener\)/);
  assert.match(taskStore, /function observeTasks\(/);
  assert.match(taskStore, /observeTasks\(summary, false\)/);
  assert.match(taskStore, /observeTasks\(summary, true\)/);
});

test("native haptics are opt-in system feedback only at committed gestures", () => {
  assert.match(hapticCoordinator, /export class HapticCoordinator/);
  assert.match(hapticCoordinator, /this\.committedGesture === gestureId/);
  assert.match(hapticCoordinator, /invoke\("perform_haptic_feedback"/);
  assert.match(app, /invoke<HapticPreference>\("set_haptic_preference"/);
  assert.match(app, /onHapticCommit=\{commitHaptic\}/);
  assert.match(view, /onCommitted\(\)[\s\S]*onHapticCommit\(sidebarGestureId\)/);
  assert.match(taskStore, /taskFeedbackPublisher/);
  assert.doesNotMatch(taskStore, /Haptic/);
});

test("ActivityScheduler owns polling and preserves only recording display clocks", () => {
  const tasksSection = read("./lib/settings/TasksSection.svelte");
  const traceSection = read("./lib/settings/TraceSection.svelte");
  const agentStudio = read("./lib/chat/AgentStudioPane.svelte");
  const tools = read("./lib/stores/tools.svelte.ts");

  assert.match(tasksSection, /new ActivityScheduler\(/);
  assert.match(traceSection, /new ActivityScheduler\(/);
  assert.match(agentStudio, /new ActivityScheduler\(/);
  assert.match(tools, /const mediaSchedulers = new Map/);
  assert.match(view, /backgroundActivityPolicy/);
  assert.match(view, /reconnectActivityPolicy/);
  assert.doesNotMatch(tasksSection, /setInterval\(/);
  assert.doesNotMatch(traceSection, /setInterval\(/);
  assert.doesNotMatch(agentStudio, /setInterval\(/);
  assert.doesNotMatch(tools, /setInterval\(/);
});

test("WindowState owns native lifecycle projection and chrome-only material tokens", () => {
  assert.match(windowState, /createTauriWindowState/);
  assert.match(windowState, /onFocusChanged/);
  assert.match(windowState, /onThemeChanged/);
  assert.match(windowState, /onScaleChanged/);
  assert.match(windowState, /prefers-reduced-transparency/);
  assert.match(windowState, /prefers-contrast: more/);
  assert.match(app, /void startWindowState\(\);/);
  assert.match(app, /root\.dataset\.windowActive/);
  assert.match(app, /windowStateAdapter\?\.dispose\(\);/);
  assert.match(app, /await windowStateAdapter\.setTheme\(theme === "system" \? null : theme\)/);
  assert.match(app, /windowStateAdapter\?\.setTheme\(value === "system" \? null : value\)/);
  assert.match(styles, /html\[data-window-active="false"\]/);
  assert.match(styles, /--chrome-sidebar-bg/);
  assert.match(styles, /--chrome-header-bg/);
  assert.match(styles, /--chrome-footbar-bg/);
  assert.match(styles, /--chrome-popover-bg/);
  assert.match(styles, /\.chat-header[^\n]*var\(--chrome-header-bg\)/);
  assert.match(styles, /\.settings-footbar[^\n]*var\(--chrome-footbar-bg\)/);
  assert.match(styles, /\.command-palette[^\n]*var\(--chrome-popover-bg\)/);
});

test("Settings and Chat expose one edge-to-edge native macOS sidebar material", () => {
  const lightTheme = styles.match(/^:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const explicitDark = styles.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const systemDark = styles.match(/:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  assert.match(design, /native macOS sidebar material/);
  assert.equal(tauriConfig.app.macOSPrivateApi, true);
  assert.match(tauriCargo, /tauri\s*=\s*\{[^\n]*features\s*=\s*\[[^\]]*"macos-private-api"/);
  for (const window of tauriConfig.app.windows) {
    assert.equal(window.transparent, true);
    assert.deepEqual(window.windowEffects, {
      effects: ["sidebar"],
      state: "followsWindowActiveState",
      radius: 0
    });
  }
  assert.match(styles, /html, body, #app \{[^}]*background:\s*transparent/s);
  const lightTint = lightTheme.match(/--sidebar-material-tint:\s*rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/);
  assert.ok(lightTint, "Light sidebar material must define an explicit RGBA tint");
  const [, red, green, blue, alphaPercent] = lightTint.map(Number);
  assert.deepEqual([red, green, blue], [253, 255, 255]);
  assert.equal(alphaPercent, 75, "Light keeps a visible native-material contribution under the calibrated veil");
  // The dark veil tracks the window base (#1e1e1e), not a separate sidebar shade:
  // nav and content are one plane per design.dark.md.
  assert.match(explicitDark, /--sidebar-material-tint:\s*rgb\(30 30 30 \/ 92%\)/);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)[\s\S]*:root\[data-theme="dark"\]\s*\{\s*--sidebar-material-tint:\s*transparent;\s*\}/);
  assert.match(systemDark, /--sidebar-material-tint:\s*transparent/);
  assert.match(styles, /\.chat-sidebar, \.settings-sidebar \{[\s\S]*margin: 0[\s\S]*border-radius: 0[\s\S]*background: var\(--sidebar-material-tint\)[\s\S]*backdrop-filter: none/);
  assert.match(styles, /html\[data-reduced-transparency="true"\][^}]*--sidebar-material-bg:\s*var\(--chrome-sidebar-bg\)/s);
  assert.match(styles, /left: var\(--sidebar-w, 260px\)/);
});

test("macOS semantic palette keeps dark workspace surfaces distinct from pure black", () => {
  const lightTheme = styles.match(/^:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const explicitDark = styles.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const systemDark = styles.match(/:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  assert.match(lightTheme, /--mac-window-background:\s*#f6f6f6/i);
  assert.match(lightTheme, /--mac-grouped-background:\s*#ececec/i);
  assert.match(lightTheme, /--mac-label:\s*rgb\(0 0 0 \/ 84\.7%\)/i);
  for (const themeRule of [explicitDark, systemDark]) {
    assert.match(themeRule, /--mac-window-background:\s*#1e1e1e/i);
    assert.match(themeRule, /--mac-grouped-background:\s*#282828/i);
    assert.match(themeRule, /--mac-elevated-background:\s*#2c2c2e/i);
    assert.match(themeRule, /--surface-secondary:\s*#343436/i);
    assert.match(themeRule, /--mac-separator:\s*rgb\(255 255 255 \/ 9\.8%\)/i);
  }
  const structuralTokens = ["panel-bg", "sidebar-bg", "content-bg", "header-bg", "card-bg", "surface-secondary", "window-bg"];
  for (const themeRule of [explicitDark, systemDark]) {
    for (const token of structuralTokens) {
      const value = themeRule.match(new RegExp(`--${token}:\\s*([^;]+)`))?.[1]?.trim() ?? "";
      assert.ok(value, `missing --${token}`);
      assert.doesNotMatch(value, /^#(?:000|000000|0a0a0a)$/i, `--${token} must not flatten the macOS dark hierarchy`);
    }
  }
  assert.match(design, /macOS semantic color roles/);
});

test("Chat keeps native sidebar material outside the opaque transcript canvas and hidden project actions do not steal title width", () => {
  assert.match(styles, /\.chat-layout\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.chat-content\s*\{[^}]*background:\s*var\(--header-bg\)/s);
  assert.match(styles, /\.conv-group-action,\s*\.conv-caret-button\s*\{[^}]*width:\s*0/s);
  assert.match(styles, /\.conv-group-head:hover \.conv-group-action,[\s\S]*\.conv-group-head:focus-within \.conv-caret-button\s*\{[^}]*width:\s*26px/s);
});

test("sidebars remove floating depth and keep a stable glass divider", () => {
  const sharedSidebarRule = styles.match(/\.chat-sidebar, \.settings-sidebar\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(sharedSidebarRule, /border:\s*0/);
  assert.match(sharedSidebarRule, /border-right:\s*0\.5px solid var\(--sidebar-material-border\)/);
  assert.match(sharedSidebarRule, /box-shadow:\s*none/);
  assert.doesNotMatch(styles, /--floating-sidebar-/);
  assert.doesNotMatch(styles, /\.chat-sidebar:hover,[\s\S]*\.settings-sidebar:focus-within\s*\{/);
  assert.doesNotMatch(styles, /\.sidebar-resizer::after/);
});

test("empty local Chat starts an editable draft instead of disabling the composer", () => {
  assert.match(view, /const target = lastItem \?\? webItems\[0\] \?\? null;[\s\S]*if \(target\)[\s\S]*else \{\s*chatStore\.newConversationDraft\(defaultBot\(\)\);\s*loadDraftIn\(\);\s*\}/);
  assert.match(view, /if \(remaining\[0\]\) openSession\(remaining\[0\]\);\s*else \{\s*chatStore\.newConversationDraft\(defaultBot\(\)\);\s*loadDraftIn\(\);\s*\}/);
});

test("sidebar resizing uses shared pointer manipulation and writes only on completion", () => {
  assert.match(view, /new DirectManipulation\(\{[\s\S]*mode: "continuous"/);
  assert.match(view, /setPointerCapture\(event\.pointerId\)/);
  assert.match(view, /sidebarManipulation\.begin\(event\.pointerId, event\.clientX, event\.timeStamp, sidebarWidth\)/);
  assert.match(view, /onpointercancel=\{cancelSidebarResize\}/);
  assert.match(view, /onlostpointercapture=\{cancelSidebarResize\}/);
  assert.match(view, /localStorage\.setItem\(SIDEBAR_WIDTH_KEY, String\(sidebarWidth\)\)/);
  assert.doesNotMatch(view, /addEventListener\("mousemove"/);
});

test("Memory Trace drawer shares direct manipulation for interruption and cancellation", () => {
  const memoryTraceDrawer = read("./lib/chat/MemoryTraceDrawer.svelte");

  assert.match(memoryTraceDrawer, /import \{ DirectManipulation \}/);
  assert.match(memoryTraceDrawer, /setPointerCapture\(event\.pointerId\)/);
  assert.match(memoryTraceDrawer, /onpointercancel=\{cancelDrawerDrag\}/);
  assert.match(memoryTraceDrawer, /onlostpointercapture=\{cancelDrawerDrag\}/);
  assert.match(memoryTraceDrawer, /onCommitted\(\)[\s\S]*onHapticCommit\(drawerGestureId\)/);
  assert.match(view, /<MemoryTraceDrawer[\s\S]*\{onHapticCommit\}/);
  assert.match(styles, /\.memory-trace-drag-handle \{/);
});

test("memory chip claims reference only for truly-used memories and the drawer separates referenced from provided", () => {
  const transcript = read("./lib/chat/ConversationTranscript.svelte");
  const memoryTraceDrawer = read("./lib/chat/MemoryTraceDrawer.svelte");

  // The chip must key on referencedCount/writeCount — never injectedCount —
  // so injected-but-unused memories no longer fake an association under every reply.
  assert.match(transcript, /message\.memoryTrace\.referencedCount \?\? 0\) > 0 \|\| message\.memoryTrace\.writeCount > 0/);
  assert.doesNotMatch(transcript, /memoryTrace\.injectedCount/);
  assert.match(transcript, /copy\.memoryTraceReferenced\.replace\("\{count\}", String\(message\.memoryTrace\.referencedCount\)\)/);

  // Drawer: referenced group on top (with provenance source tag), provided
  // group collapsed as secondary transparency info.
  assert.match(memoryTraceDrawer, /trace\?\.referencedItems \?\? \[\]/);
  assert.match(memoryTraceDrawer, /copy\.memoryTraceSourceCited : copy\.memoryTraceSourceToolRetrieved/);
  assert.match(memoryTraceDrawer, /details class="memory-trace-section memory-trace-provided"/);
  assert.match(memoryTraceDrawer, /copy\.memoryTraceInjectedHint/);
  assert.match(styles, /\.memory-trace-provided-hint \{/);
});

test("Project workflows use shared Dialog and AlertDialog primitives", () => {
  const projectList = read("./lib/projects/ProjectList.svelte");
  const projectTree = read("./lib/projects/ProjectTree.svelte");
  const projectChat = read("./lib/projects/ProjectChat.svelte");

  assert.match(projectList, /import Dialog from "\.\.\/components\/ui\/Dialog\.svelte"/);
  assert.match(projectList, /<Dialog[\s\S]*contentClass="project-dialog project-create-dialog"/);
  assert.match(projectTree, /import AlertDialog from "\.\.\/components\/ui\/AlertDialog\.svelte"/);
  assert.match(projectTree, /<Dialog[\s\S]*project-create-dialog/);
  assert.match(projectTree, /<Dialog[\s\S]*project-rename-title/);
  assert.match(projectTree, /<AlertDialog[\s\S]*project-delete-title/);
  assert.match(projectSettingsDialog, /<Dialog[\s\S]*project-settings-title/);
  assert.match(projectChat, /<Dialog[\s\S]*project-preview-title/);
  assert.doesNotMatch(projectTree, /project-dialog-backdrop/);
  assert.doesNotMatch(projectSettingsDialog, /project-settings-overlay/);
  assert.doesNotMatch(projectChat, /preview-overlay/);
});

test("native commands use one catalog and one host event route", () => {
  assert.match(commandSystem, /export class CommandSystem/);
  assert.match(commandSystem, /snapshot\(context: CommandContext\)/);
  assert.match(commandSystem, /async execute\(id: string, context: CommandContext\)/);
  assert.match(commandHost, /export class MemoryCommandHostAdapter/);
  assert.match(commandHost, /export class CallbackCommandHostAdapter/);
  assert.match(view, /commandSystem\.snapshot\(commandContext\)/);
  assert.match(view, /workspace: projectPaneActive \? "project" : workspacePane/);
  assert.match(view, /rankCommands\(commandSnapshot, commandQuery, commandUsage\)/);
  assert.match(view, /commandUsage = loadCommandUsage\(localStorage, commandSnapshot\)/);
  assert.match(view, /if \(result\.status === "executed"\)[\s\S]*recordCommandSuccess\(commandUsage, result\.id, commandSnapshot\)/);
  assert.match(view, /saveCommandUsage\(localStorage, commandUsage\)/);
  assert.match(view, /commandInputElement\?\.focus\(\)/);
  assert.match(view, /commandReturnFocus\?\.focus\(\)/);
  assert.match(view, /event\.key === "Enter"[\s\S]*runCommand\(command\.id\)/);
  assert.match(view, /disabled=\{!command\.enabled\}/);
  assert.match(commandSystem, /recommendedRank: number/);
  assert.match(view, /commandSystem\.execute\(id, commandContext\)/);
  assert.match(view, /void runSystemCommand\(event\.payload\)/);
  assert.match(view, /nativeCommandUnlisten\?\.\(\)/);
  assert.doesNotMatch(view, /runCommand\(\(\) => openWorkspacePane/);
  assert.match(nativeAppMenu, /pub const COMMAND_EVENT: &str = "native-command"/);
  assert.match(nativeAppMenu, /app\.on_menu_event\(/);
  assert.match(nativeAppMenu, /"app\.open-chat"/);
  assert.match(nativeAppMenu, /"service\.restart"/);
  assert.doesNotMatch(nativeAppMenu, /"open_web"/);
});


test("workspace navigation waits for bootstrap and can retry failed loads", () => {
  assert.match(view, /let connectionReady = false/);
  assert.match(view, /if \(!connectionReady && !loading && serviceState === "ready" && serviceEndpoint\)/);
  assert.match(view, /serviceReady=\{connectionReady\}/);
  assert.match(chatWorkspace, /onRetryService/);
  assert.match(sections.skills, /skillsStore\.error/);
  assert.match(sections.skills, /copy\.retryLoading/);
  assert.match(sections.tasks, /tasksStore\.error/);
  assert.match(sections.tasks, /session\.text\.retryLoading/);
  assert.match(skillsStoreSource, /error: ""/);
  assert.match(taskStore, /error: ""/);
});

test("installed Skills recomputes its card list when async store data arrives", () => {
  assert.match(sections.skills, /let normalizedQuery = \$derived\(query\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(sections.skills, /let filteredSkills = \$derived\(/);
  assert.doesNotMatch(sections.skills, /\$: filteredSkills/);
});

const formSectionKey = { agent: "agents", mcp: "mcp", channel: "channels", profile: "profiles", task: "tasks", memory: "memory" };

test("chat composer keeps keyboard guidance in the textarea placeholder", () => {
  assert.match(view, /placeholder=\{sending \? copy\.queueHint : copy\.enterHint\}/);
  assert.match(chatComposerShell, /<textarea[^>]*bind:value[^>]*\{placeholder\}[^>]*onkeydown=\{onKeydown\}/);
  assert.match(chatComposerShell, /<textarea[^>]*rows="2"/);
  assert.match(chatComposerShell, /scrollHeight/);
  assert.doesNotMatch(view, /class="composer-hint"/);
});

test("Chat Header search stays in normal flow and keeps its active result index valid", () => {
  assert.match(view, /<div class="header-actions">[\s\S]*<TranscriptSearch[\s\S]*<\/div>\s*<\/header>/);
  assert.match(transcriptSearch, /class:open class="search-bar"/);
  assert.match(transcriptSearch, /aria-live="polite"/);
  assert.match(transcriptSearch, /event\.key !== "Enter"/);
  assert.match(styles, /\.search-bar\s*\{[^}]*position:\s*relative/s);
  assert.doesNotMatch(styles, /\.search-bar\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(styles, /\.search-bar[^}]*transform:\s*scaleX/s);
  assert.match(view, /boundedSearchIndex = clampTranscriptSearchIndex\(searchIndex, searchMatchIds\.length\)/);
  assert.match(view, /if \(searchMatchIds\.length !== previousSearchMatchCount\)[\s\S]*searchIndex = clampTranscriptSearchIndex\(searchIndex, searchMatchIds\.length\)/);
  assert.match(view, /activeMatchId = searchMatchIds\[boundedSearchIndex\]/);
  assert.match(projectDetail, /import TranscriptSearch from "\.\.\/chat\/TranscriptSearch\.svelte"/);
  assert.match(projectDetail, /<TranscriptSearch[\s\S]*matchCount=\{searchMatchIds\.length\}/);
  assert.match(projectDetail, /if \(matchCount === previousSearchMatchCount\) return;[\s\S]*searchIndex = clampTranscriptSearchIndex\(searchIndex, matchCount\)/);
  assert.match(projectChat, /export let searchMatchIds: string\[\] = \[\]/);
  assert.match(projectChat, /<ChatMessagesPane[\s\S]*\{searchMatchIds\}[\s\S]*\{activeMatchId\}/);
});

test("issue 13 macOS product tokens and accessibility preferences are shared", () => {
  assert.match(styles, /font-family:\s*-apple-system, BlinkMacSystemFont/);
  assert.match(styles, /--font-ui:/);
  assert.match(styles, /--radius-control:\s*8px/);
  assert.match(styles, /--toolbar-height:\s*52px/);
  assert.match(styles, /--settings-content-width:\s*720px/);
  assert.match(styles, /--message-content-width:\s*720px/);
  assert.match(styles, /@media \(prefers-contrast: more\)/);
  assert.match(styles, /:root\[data-performance="low"\]/);
  assert.match(app, /lowPerformanceMode/);
  assert.match(styles, /button:active:not\(:disabled\)/);
});

test("issue 13 settings pages share a title and product description header", () => {
  assert.match(app, /function sectionDescription\(/);
  assert.match(pageHeader, /class="page-header-description"/);
  assert.match(app, /sectionDescription\(activeSection, text\)/);
  assert.match(app, /<PageHeader[^>]*description=\{sectionDescription\(activeSection, text\)\}/);
  assert.match(pageHeader, /class="toolbar-edge"/);
  assert.match(app, /settings-sidebar-footer-copy[\s\S]*serviceStateLabel/);
});

test("issue 13 target pages expose user-facing controls and secondary technical detail", () => {
  const models = read("./lib/settings/ModelsSection.svelte");
  assert.match(models, /routeDescription\(route, session\.text\)/);
  assert.match(models, /modelOptionCopy/);
  assert.match(models, /technicalId=\{state\.currentKey\}/);
  assert.match(sections.providers, /humanizeProviderName/);
  assert.match(sections.providers, /aria-pressed=\{providerSortActive\}/);
  assert.match(sections.providers, /class="provider-rail-list" role="listbox"/);
  // Technical identity stays secondary: the raw id is a muted <code> in the
  // header and protocol/path live behind the Advanced disclosure.
  assert.match(sections.providers, /<code>\{editor\.id\}<\/code>/);
  assert.match(sections.providers, /<details class="provider-advanced">/);
  assert.doesNotMatch(read("./lib/stores/providers.svelte.ts"), /window\.confirm/);
  assert.match(sections.trace, /formatLongDurationMs\(item\.durationMs, session\.locale\)/);
  assert.match(sections.trace, /<OverflowMenu label=\{session\.text\.more\}>/);
  assert.match(sections.trace, /class="trace-run-technical technical-detail"/);
  assert.match(sections.trace, /formatNaturalDateTime\(item\.startedAt, session\.locale\)/);
  assert.doesNotMatch(sections.trace, /secondary-button danger-action/);
});

test("issue 13 automation uses a fixed list-detail template with separated status semantics", () => {
  assert.match(sections.tasks, /taskScheduleStatusText/);
  assert.match(sections.tasks, /taskExecutionStatusText/);
  assert.match(sections.tasks, /taskLatestResultText/);
  assert.match(sections.tasks, /<OverflowMenu label=\{session\.text\.more\}>/);
  assert.match(sections.tasks, /formatNaturalSchedule\(task\.scheduleText, session\.locale\)/);
  assert.match(sections.tasks, /stopTaskRun\(selectedTask\.id/);
  assert.match(chatWorkspace, /<TasksSection presentation="workspace"/);
  assert.match(styles, /\.automation-workspace-layout\.detail-open\s*\{[^}]*grid-template-columns:\s*minmax\(280px, 320px\) minmax\(0, 1fr\)/s);
  // The detail pane overlays the list only when the workspace CONTAINER (not
  // the viewport — the sidebar eats ~220px) is too narrow for side-by-side.
  assert.match(styles, /\.automation-workspace\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(styles, /@container \(max-width: 880px\)[\s\S]*\.automation-task-detail\s*\{[^}]*position:\s*absolute/s);
});

test("issue 13 Chat renders an Agent message unit and a compact 720px composer", () => {
  assert.match(transcript, /class="assistant-identity"/);
  assert.match(transcript, /copy\.appName/);
  // All rows share one centered reading column matching the composer width.
  assert.match(styles, /\.message-row\s*\{[^}]*max-width:\s*var\(--message-content-width\)[^}]*margin:[^}]*auto/s);
  // The Agent avatar sits to the LEFT of the message, not stacked above it.
  assert.match(transcript, /class="assistant-avatar"/);
  assert.match(styles, /\.assistant-layout\s*\{[^}]*display:\s*flex/s);
  // The composer content column still caps at the 720px reading width, but the
  // wrap carries the same horizontal inset as .messages so it never sits flush
  // against the pane edges on narrower surfaces (e.g. project chat).
  // The gutter is a share of the CHAT COLUMN, not of the window: a `vw` gutter
  // kept its full 56px after the file panel narrowed the column and pushed the
  // composer's own controls past the pane edge.
  assert.match(styles, /\.composer-wrap\s*\{[^}]*max-width:\s*calc\(var\(--message-content-width\)[^}]*padding:[^}]*clamp\(20px, 5%, 56px\)/s);
  assert.match(styles, /\.messages \{[^}]*padding: 24px clamp\(20px, 5%, 56px\)/);
  assert.doesNotMatch(styles, /\.(messages|composer-wrap|chat-title-name) \{[^}]*\dvw/);
  assert.match(styles, /\.composer textarea\s*\{[^}]*min-height:\s*42px;[^}]*max-height:\s*180px/s);
  assert.match(transcript, /humanizeModelOption\(message\.model, message\.model\)\.label/);
  assert.match(view, /activeAgentName[\s\S]*copy\.agentStudioGlobalName/);
  assert.match(view, /<TranscriptSearch[\s\S]*open=\{searchOpen\}/);
  assert.match(styles, /\.composer\s*\{[^}]*flex-direction:\s*column/s);
});

test("Desktop Chat keeps structural sidebars separate from one unified workspace surface", () => {
  assert.match(styles, /\.chat-layout\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.chat-sidebar, \.settings-sidebar\s*\{[^}]*background:\s*var\(--sidebar-material-tint\)/s);
  assert.match(styles, /\.file-panel\s*\{[^}]*background:\s*var\(--sidebar-bg\)/s);
  assert.match(styles, /\.chat-content\s*\{[^}]*background:\s*var\(--header-bg\)/s);
  assert.match(styles, /\.chat-header\s*\{[^}]*background:\s*var\(--chrome-header-bg\)/s);
});

test("Desktop Settings uses a secondary canvas with quiet primary-surface cards", () => {
  assert.match(styles, /\.settings-layout\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.chat-sidebar, \.settings-sidebar\s*\{[^}]*background:\s*var\(--sidebar-material-tint\)/s);
  assert.match(styles, /\.settings-content\s*\{[^}]*background:\s*var\(--gray-100\)/s);
  assert.match(styles, /\.settings-card\s*\{[^}]*border:\s*1px solid var\(--hairline\)[^}]*background:\s*var\(--card-bg\)/s);
  assert.match(styles, /\.settings-card \.settings-row \+ \.settings-row\s*\{[^}]*border-top:\s*0\.5px solid var\(--gray-alpha-100\)/s);
});

test("shared composer provides keyboard slash suggestions and transcript invocation styling", () => {
  assert.match(chatInputArea, /ensureComposerSuggestions/);
  assert.match(chatInputArea, /ArrowDown/);
  assert.match(chatInputArea, /event\.isComposing/);
  assert.match(chatInputArea, /event\.key === "Tab"/);
  assert.match(slashSuggestionMenu, /role="listbox"/);
  assert.match(transcript, /classifyComposerInvocation/);
  assert.match(styles, /\.invocation-message\[data-kind="skill"\]/);
});

// Tab is a COMPLETION key, not a send key: it fills the token into the composer
// and leaves the caret there so the owner can edit before pressing Enter. Only
// Enter (or a click) may hand a whole-message invocation straight to `onSend`.
test("Tab completes a suggestion without sending; only Enter may auto-submit", () => {
  assert.match(chatInputArea, /selectSuggestion\(filteredSuggestions\[activeSuggestionIndex\], event\.key === "Enter"\)/);
  assert.match(chatInputArea, /function selectSuggestion\(suggestion: ComposerMenuItem \| undefined, allowSubmit = true\)/);
  assert.match(chatInputArea, /if \(allowSubmit && suggestion\.submitOnSelect && wholeMessage\) onSend\(\)/);
});

// A Project's own `/` commands are edited in Project settings and consumed by
// the shared composer catalog, so the save must refetch it (pitfall 13 — one
// WebView, and ChatInputArea's legacy `$:` cannot see the store change).
test("Project custom commands round-trip through settings into the / palette", () => {
  assert.match(projectSettingsDialog, /customCommands/);
  assert.match(projectSettingsDialog, /projectCommandAdd/);
  assert.match(projectSettingsDialog, /project-command-content/);
  const projectsStore = read("./lib/stores/projects.svelte.ts");
  assert.match(projectsStore, /invalidateComposerSuggestions\(\)/);
  const suggestions = read("./lib/chat/composerSuggestions.svelte.ts");
  // Invalidation must reload, not merely clear: nothing else re-triggers it.
  assert.match(suggestions, /if \(lastEndpoint\) void ensureComposerSuggestions\(lastEndpoint, lastProjectId\)/);
});

// A model id can be far longer than the composer pill, so the configured alias
// is preferred for display and the rest truncates. The pill must never become a
// size query container: `container-type: inline-size` sizes the box as if it had
// no contents, which zeroed this content-sized flex item and hid the model name
// completely behind `overflow: hidden` (issue #28).
test("composer model pill prefers the alias and truncates without size containment", () => {
  assert.match(view, /activeModelOption\?\.alias/);
  // Every model selector goes through the shared copy helper, so none of them
  // can leak a `[PI]` / `[Custom]` routing tag or ignore a configured alias.
  assert.match(composerModelMenu, /modelOptionCopy\(model\)/);
  assert.match(projectSettingsDialog, /modelOptionCopy\(model\)\.name/);
  assert.match(read("./lib/settings/ModelsSection.svelte"), /modelOptionCopy\(option\)\.name/);
  assert.match(read("./lib/settings/AgentsSection.svelte"), /modelOptionCopy\(option\)\.name/);
  assert.match(styles, /\.composer-model-label \{[^}]*text-overflow: ellipsis/s);
  assert.doesNotMatch(styles, /\.composer-model-label[^{]*\{[^}]*container-type/s);
  assert.doesNotMatch(styles, /composer-model-marquee/);
  // The full id stays reachable through the trigger tooltip and the option list.
  assert.match(composerModelMenu, /title=\{activeModelTitle \|\| modelLabel\}/);
  assert.match(composerModelMenu, /composer-model-option-id/);
});

// Everything the saved provider record holds must survive the editor-draft
// projection: the draft is rebuilt from it after every save, so a field omitted
// here disappears from the UI immediately and from storage on the next write
// (pitfall 11 — this is how the model alias was lost, issue #28).
test("provider editor draft keeps the model alias when reloading a saved provider", () => {
  const api = read("./lib/api.ts");
  const projection = api.slice(api.indexOf("export function providerItemToUpdateRequest"));
  assert.match(projection.slice(0, projection.indexOf("defaultModel:")), /alias: model\.alias/);
});

// The dialog content is a flex column with `overflow: hidden`. A <form> wrapper
// in between is a flex item whose automatic minimum size is its content, so it
// refuses to shrink and the body never scrolls — the tail of the settings (the
// custom-command editor) is simply clipped (issue #28).
test("project settings dialog hands the height budget to a scrollable body", () => {
  assert.match(projectSettingsDialog, /<form class="project-settings-form"/);
  assert.match(styles, /\.project-settings-form \{[^}]*min-height: 0/s);
  assert.match(styles, /\.project-settings-form \{[^}]*flex-direction: column/s);
  assert.match(styles, /\.project-settings-body \{[^}]*overflow-y: auto/s);
  assert.match(styles, /\.project-settings-body \{[^}]*min-height: 0/s);
  // A modal footer is a modal footer, not the settings page's sticky footbar.
  assert.doesNotMatch(projectSettingsDialog, /settings-footbar/);
  assert.match(styles, /\.project-settings-foot \{[^}]*flex: none/s);
  // Commands render as one grouped macOS list — a single card with hairline
  // separated rows — using the documented radii and control tokens, not ad-hoc
  // per-row boxes, 0.5px borders or invented sizes.
  assert.match(styles, /\.project-commands-list \{[^}]*border-radius: var\(--radius-control\)/s);
  assert.match(styles, /\.project-command-row \+ \.project-command-row \{ border-top/);
  assert.match(styles, /\.project-commands \.project-command-desc \{[^}]*height: 32px/s);
  assert.match(styles, /\.project-commands \.project-command-desc \{[^}]*border-radius: var\(--radius-small\)/s);
  // The three fields of a command must share one left and one right edge: the
  // row is a label/field grid whose third track is a reserved gutter for the
  // remove button, so that button can never shorten the name field and leave
  // the stack ragged (which is what read as "so many boxes, none aligned").
  assert.match(styles, /\.project-command-row \{[^}]*display: grid/s);
  assert.match(styles, /\.project-command-row \{[^}]*grid-template-columns: max-content minmax\(0, 1fr\) 28px/s);
  // Token-driven wells, not a third border inside an already-bordered group,
  // and a single focus ring instead of the doubled surface-then-accent halo.
  assert.match(styles, /\.project-commands-list \{[^}]*background: var\(--surface-secondary\)/s);
  for (const field of ["\\.project-command-slash", "\\.project-commands \\.project-command-desc", "\\.project-commands \\.project-command-content"]) {
    assert.match(styles, new RegExp(`${field} \\{[^}]*background: var\\(--control-bg\\)`, "s"));
  }
  for (const field of ["\\.project-commands \\.project-command-desc", "\\.project-commands \\.project-command-content"]) {
    assert.match(styles, new RegExp(`${field} \\{[^}]*border: 0`, "s"));
  }
  assert.doesNotMatch(styles, /\.project-command[^{]*:focus[^{]*\{[^}]*0 0 0 2px var\(--card-bg\), 0 0 0 4px var\(--accent\)/s);
  // The command name is nested inside the wrapper that owns the visible focus
  // ring. It also matches the generic `.settings-field input:focus-visible`
  // rule, so it needs an explicit reset or both elements draw an accent ring.
  assert.match(styles, /\.project-commands \.project-command-name:focus-visible \{[^}]*box-shadow: none/s);
  // Project settings follows the product-level AppKit hierarchy: focus stays
  // visible but uses semantic neutral control roles, never the generic blue
  // Geist ring that overpowers this dense modal.
  assert.match(styles, /\.project-settings-form \.settings-field > input:focus-visible,[^{]*\{[^}]*border-color: var\(--control-border-strong\)[^}]*color-mix\(in srgb, var\(--label-primary\) 8%, transparent\)/s);
  assert.match(styles, /\.project-settings-form button:focus-visible \{[^}]*var\(--control-border-strong\)/s);
  assert.match(styles, /\.project-command-slash:focus-within[^\{]*\{[^}]*var\(--control-border-strong\)[^}]*var\(--label-primary\)/s);
  assert.doesNotMatch(styles, /\.project-settings-form[^\{]*:focus-visible[^\{]*\{[^}]*(?:var\(--accent\)|#007aff|#006bff)/is);
  assert.doesNotMatch(styles, /\.project-command[^\{]*:focus(?:-visible|-within)[^\{]*\{[^}]*var\(--accent\)/is);
  // Every field is reachable by its own label, and an empty list says so rather
  // than collapsing to a lone "add" button.
  assert.match(projectSettingsDialog, /projectCommandNameLabel/);
  assert.match(projectSettingsDialog, /projectCommandDescriptionLabel/);
  assert.match(projectSettingsDialog, /projectCommandContentLabel/);
  assert.match(projectSettingsDialog, /projectCommandsEmpty/);
});

// The Project store drops any command without a body or with a name that slugs
// to nothing. Saving used to report success while the row disappeared on the
// next open, so the dialog must refuse the save and name the fix instead of
// filtering the row away in silence (issue #28).
test("Project settings refuses to save a half-filled command instead of dropping it", () => {
  assert.match(projectSettingsDialog, /function normalizeCommandName/);
  // Same slug rule as `sanitizeProjectCustomCommands` in the Project store.
  assert.match(projectSettingsDialog, /replace\(\/\[\^a-z0-9:_-\]\+\/g, "-"\)/);
  assert.match(projectSettingsDialog, /commandError = copy\.projectCommandInvalidName/);
  assert.match(projectSettingsDialog, /commandError = copy\.projectCommandEmptyContent/);
  // Only a row the owner never touched may be discarded.
  assert.match(projectSettingsDialog, /function isBlankCommand/);
  assert.doesNotMatch(projectSettingsDialog, /\.filter\(\(command\) => command\.name && command\.content\.trim\(\)\)/);
  assert.match(projectSettingsDialog, /class="project-commands-error" role="alert"/);
  for (const key of ["projectCommandEmptyContent", "projectCommandInvalidName"]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "g")) ?? []).length, 2, `${key} must exist in both locales`);
  }
});

// An @app selector is both a routing token and something the owner must be able
// to see and pick. The composer therefore needs a second trigger character that
// lists installed Mini Apps, and every surface that renders an invocation must
// know the third kind — otherwise a Mini App turn falls through to plain prose.
test("@ trigger lists Mini Apps and every invocation surface knows the miniapp kind", () => {
  const catalog = read("./lib/chat/composerSuggestionCatalog.ts");
  assert.match(chatInputArea, /mentionQuery/);
  // Both triggers fire on the token under the caret at ANY offset — not only as
  // the first character — but require a word boundary so "3/4" or an email
  // address never opens the menu.
  assert.match(chatInputArea, /textBeforeCaret/);
  assert.match(chatInputArea, /\(\?:\^\|\\s\)\(\\\/\[\^\\s\]\*\)\$/);
  assert.match(chatInputArea, /\(\?:\^\|\\s\)\(@\[\^\\s@\]\*\)\$/);
  // Selecting a suggestion replaces only the trigger token and only submits
  // when the invocation is the whole message.
  assert.match(chatInputArea, /activeTokenStart/);
  assert.match(chatInputArea, /wholeMessage/);
  // The caret position must come from the textarea itself, not be guessed.
  const composerShell = read("./lib/chat/ChatComposerShell.svelte");
  assert.match(composerShell, /onCaretMove/);
  assert.match(composerShell, /setSelectionRange/);
  // The highlight overlay pills every recognized token, not only a leading one.
  assert.match(composerShell, /segmentComposerValue/);
  assert.match(composerShell, /\{#each segments as segment\}/);
  assert.match(catalog, /segmentComposerInvocations/);
  // The `/` trigger must not offer Mini Apps, and `@` must not offer commands.
  assert.match(chatInputArea, /suggestionKinds/);
  assert.match(chatInputArea, /\["miniapp", "file"\]/);
  // Inside a Project, `@` also offers file references from the name search;
  // stale responses are generation-guarded (pitfall 3).
  assert.match(chatInputArea, /searchDesktopProjectFiles/);
  assert.match(chatInputArea, /fileSearchGeneration/);
  assert.match(slashSuggestionMenu, /FILES/);
  assert.match(styles, /\.slash-suggestion-icon\[data-kind="file"\]/);
  assert.match(catalog, /\^@\[a-z0-9\]/);
  assert.match(slashSuggestionMenu, /MINI APPS/);
  assert.match(transcript, /MINI APP/);
  assert.match(styles, /\.invocation-message\[data-kind="miniapp"\]/);
  assert.match(styles, /\.composer-token\[data-kind="miniapp"\]/);
  assert.match(styles, /\.slash-suggestion-icon\[data-kind="miniapp"\]/);
  // Pitfall 4: an undefined var() fails silently, so both invocation hues must
  // exist as real tokens in the light AND dark declarations.
  assert.equal(styles.match(/--miniapp-accent:/g)?.length, 3);
  assert.equal(styles.match(/--skill-accent:/g)?.length, 3);
  assert.doesNotMatch(styles, /--purple-700/);
  // Pitfall 12: the catalog now carries Mini Apps, so every catalog mutation
  // must invalidate the composer's cache or `@` keeps advertising a stale set.
  // One per catalog mutation: toggle, install, built-in install, update,
  // uninstall. An update can add or remove tools, so it invalidates exactly
  // like the others.
  const miniAppsStore = read("./lib/stores/miniapps.svelte.ts");
  assert.equal(miniAppsStore.match(/invalidateComposerSuggestions\(\)/g)?.length, 5);
});

test("composer bottom bar owns the agent mention and keeps selectors quiet", () => {
  // The @Agent picker lives in the bottom tool row next to attachments and the
  // model selector instead of occupying its own row above the textarea.
  assert.match(chatInputArea, /<slot name="mention" \/>/);
  assert.match(view, /slot="mention"/);
  // The model/thinking trigger and the mention pill rest without a background
  // or border; only hover (or open) paints one — like the neighbouring icons.
  assert.match(styles, /\.composer-model-trigger \{[^}]*border: 0;[^}]*background: transparent/s);
  assert.match(styles, /\.composer-model-trigger:hover[^{]*\{[^}]*background: var\(--fill\)/);
  const botMention = read("./lib/chat/BotMention.svelte");
  assert.match(botMention, /\.mention-token \{[^}]*background: transparent/s);
});

test("issue 8 chat polish stays wired across shared Chat and Project surfaces", () => {
  assert.match(view, /openWorkspacePaneState\(pane\)/);
  assert.match(view, /service-starting-spinner/);
  assert.match(view, /startup-recovery-actions/);
  assert.match(view, /aria-live="polite"/);
  assert.match(app, /startupPhase=\{startup\.phase\}/);
  assert.match(app, /startupError=\{startup\.error\}/);
  assert.match(app, /statusScheduler\?\.wake\("retry"\)/);
  assert.doesNotMatch(app, /setInterval\(\(\) => void refreshStatus\(\), 1000\)/);
  assert.match(transcript, /class="message-meta"/);
  assert.match(transcript, /message\.model/);
  assert.match(transcript, /split\(\/\\r\?\\n\/\)\.length > 20/);
  assert.match(transcript, /copy\.expandMessage/);
  assert.match(markdown, /highlightAuto/);
  assert.match(markdown, /data-copy-code/);
  assert.match(queuedMessagesBar, /class="queued-message-row"/);
  assert.match(projectChat, /event\.key === "Enter" && \(event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey\)/);
  assert.match(view, /event\.key === ","[\s\S]*openSettings\(\)/);
  assert.match(view, /event\.key\.toLowerCase\(\) === "k"[\s\S]*toggleCommandPalette/);
  assert.match(view, /class="command-palette"[\s\S]*commandResults as command, index/);
  assert.match(view, /command-palette-input/);
  assert.match(view, /role="listbox"/);
  assert.match(view, /rankCommands\(commandSnapshot, commandQuery, commandUsage\)/);
  assert.match(overflowMenu, /event\.key !== "ArrowDown" && event\.key !== "ArrowUp"/);
  assert.match(overflowMenu, /event\.key === "Escape"/);
  assert.match(logsSection, /desktop_logs/);
});

test("Project settings exposes inherited model and thinking defaults in a fixed footbar", () => {
  assert.match(projectSettingsDialog, /projectDefaultModel/);
  assert.match(projectSettingsDialog, /projectFollowGlobal/);
  assert.match(projectSettingsDialog, /class="project-settings-foot"/);
  // Project chat resolves each session's model per-session (override → project →
  // global) and feeds it to the pinned controller via the runtime store.
  assert.match(projectChat, /function resolveSessionModel/);
  assert.match(projectChat, /resolveModel: resolveSessionModel/);
});

test("microphone control starts recording and exposes a timer bar", () => {
  assert.match(view, /onToggleRecording=\{toggleRecording\}/);
  assert.match(chatInputArea, /onclick=\{onToggleRecording\}/);
  assert.match(chatInputArea, /<RecordingBar/);
  assert.match(recordingBar, /class="recording-bar"/);
  assert.match(recordingBar, /seconds % 60/);
  assert.match(infoPlist, /<key>NSMicrophoneUsageDescription<\/key>/);
});

test("assistant code blocks wrap without horizontal scrolling", () => {
  assert.match(styles, /\.markdown-body pre\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /\.markdown-body pre code\s*\{[^}]*white-space:\s*pre-wrap/s);
  assert.match(styles, /\.markdown-body pre code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.markdown-body table\s*\{[^}]*table-layout:\s*fixed/s);
});

test("sidebar channel groups are independently collapsible with balanced list density", () => {
  // Every channel has independent open state; the surrounding Conversations
  // and Projects groups are independently collapsible too.
  assert.match(view, /<ChatSidebar/);
  assert.match(view, /let expandedChannels: Record<DesktopConversationChannel, boolean>/);
  assert.match(view, /const open = !expandedChannels\[channel\]/);
  assert.match(view, /SIDEBAR_TREE_KEY/);
  const projectTree = read("./lib/projects/ProjectTree.svelte");
  assert.match(chatSidebar, /<ProjectTree/);
  assert.match(chatSidebar, /overflow-x: hidden/);
  assert.match(projectTree, /sidebar-section-head/);
  assert.doesNotMatch(projectTree, /project-tree-actions/);
  assert.match(projectTree, /opacity: 0; pointer-events: none/);
  assert.match(row, /\.row-title\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/s);
  assert.doesNotMatch(row, /\.row-title\s*\{[^}]*max-width:/s, "the title must grow with the resized sidebar");
  assert.match(row, /\.row-time\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(row, /right: 10px/);
  assert.doesNotMatch(view, /const firstBot = externalNav/);
  // Project and Chat share the same collapsible group rhythm and DESIGN's compact 32px Session row.
  assert.match(styles, /\.conv-group-head\s*\{[^}]*height:\s*34px/s);
  assert.match(design, /label-13:\s*[\s\S]*?fontSize:\s*13px[\s\S]*?lineHeight:\s*16px/);
  assert.match(design, /button-small:\s*[\s\S]*?height:\s*32px/);
  assert.match(row, /\.conversation-row\s*\{[^}]*min-height:\s*32px[^}]*padding:\s*4px 8px/s);
  // A session row's title is UI text (the `label` rank) and its timestamp is
  // supporting data (`meta`). They were both 12px, which is why a row read as
  // one flat band; ranking them is what the type scale is for.
  assert.match(row, /\.row-title\s*\{[^}]*font-size:\s*var\(--fs-label\)[^}]*line-height:\s*var\(--lh-label\)/s);
  assert.match(row, /\.row-time\s*\{[^}]*font-size:\s*var\(--fs-meta\)[^}]*line-height:\s*var\(--lh-meta\)/s);
});

test("conversation, project, and Mini App titles share a quiet material band only while stuck", () => {
  const projectTree = read("./lib/projects/ProjectTree.svelte");
  const sharedHeader = styles.slice(styles.indexOf(".sidebar-section-head {"), styles.indexOf(".brand-row {"));
  assert.match(sharedHeader, /\.sidebar-section-head \{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*min-height:\s*32px/s);
  // The stuck band stays inside the head's own rect (no bleeding gradient) and
  // rounds its corners to the row radius instead of a hard-edged strip.
  assert.match(sharedHeader, /\.sidebar-section-head::before \{[^}]*inset:\s*0;[^}]*border-radius:\s*var\(--rounded-sm\);[^}]*background:\s*color-mix\(in srgb, var\(--sidebar-bg\) 86%, transparent\);[^}]*backdrop-filter:\s*blur\(12px\)/s);
  assert.doesNotMatch(sharedHeader, /mask-image|linear-gradient|inset:\s*-/);
  assert.match(sharedHeader, /\.sidebar-section-head \{[^}]*background:\s*transparent/s);
  assert.match(sharedHeader, /\.sidebar-section-head::before \{[^}]*opacity:\s*0/s);
  assert.match(sharedHeader, /\.sidebar-section-head\.is-stuck::before \{ opacity:\s*1; \}/);
  assert.match(sharedHeader, /data-reduced-transparency="true"[^}]*\.sidebar-section-head::before[\s\S]*backdrop-filter:\s*none/);
  // The old gradient's private token must not linger once nothing reads it (pitfall 4).
  assert.doesNotMatch(styles, /--sidebar-section-glass/);
  for (const source of [chatSidebar, projectTree, miniAppSidebar]) {
    assert.match(source, /sidebar-section-head/);
    assert.match(source, /sidebar-section-toggle/);
    assert.match(source, /sidebar-section-caret/);
  }
  assert.match(chatSidebar, /use:trackStickySectionHeads/);
  assert.match(chatSidebar, /node\.scrollTop > 0[\s\S]*head\.classList\.toggle\("is-stuck", isStuck\)/);
  assert.match(chatSidebar, /<section class="sidebar-tree-section">[\s\S]*<ProjectTree/);
});

test("Agent Studio projects real activity into an accessible Three.js city", () => {
  const skillsPosition = chatSidebar.indexOf('activeWorkspacePane === "skills"');
  const agentsPosition = chatSidebar.indexOf('activeWorkspacePane === "agents"');
  assert.ok(skillsPosition >= 0 && agentsPosition > skillsPosition);
  assert.match(view, /onOpenAgents=\{\(\) => openWorkspacePane\("agents"\)\}/);
  assert.match(app, /requestedChatPane: "chat" \| "automations" \| "skills" \| "agents"/);
  assert.match(app, /searchParams\.get\("pane"\)/);
  assert.ok(app.indexOf('const runningInTauri = "__TAURI_INTERNALS__" in window') < app.indexOf('searchParams.get("pane")'));
  assert.match(chatWorkspace, /import\("\.\/AgentStudioPane\.svelte"\)/);
  assert.match(chatWorkspace, /<AgentStudioComponent/);
  assert.doesNotMatch(agentStudio, /<h2>\{copy\.agentStudio\}<\/h2>/);
  assert.match(styles, /\.agent-studio\s*\{[^}]*padding:\s*12px 0 40px/s);
  assert.match(agentStudio, /id: "default"/);
  assert.match(agentStudio, /loadDesktopAgents\(endpoint\)/);
  assert.match(agentStudio, /loadDesktopAgentActivity\(endpoint\)/);
  assert.match(agentStudio, /new ActivityScheduler\(agentActivityPolicy, refresh, documentActivityVisibility\)/);
  assert.doesNotMatch(agentStudio, /setInterval\(/);
  assert.match(agentStudio, /generation !== refreshGeneration/);
  assert.match(agentStudio, /SLOT_STORAGE_KEY = "molibot-agent-city-slots-v1"/);
  assert.match(agentStudio, /projectAgentCity/);
  assert.match(agentStudio, /<AgentCityCanvas/);
  assert.match(agentStudio, /onHover=\{handleHover\}/);
  assert.match(agentStudio, /let hoveredFloorKey: string \| null = null/);
  assert.match(agentStudio, /hoveredFloorKey \? cityFloors\.find/);
  assert.match(agentStudio, /\{#if hoveredFloor && hoveredFloor\.key !== selectedFloorKey\}/);
  assert.match(agentStudio, /class="agent-city-hover-card"/);
  assert.doesNotMatch(agentStudio, /agent-city-label-layer|agent-city-agent-label|agent-city-status-dot|agent-city-tooltip|agent-city-working-frame/);
  assert.match(agentStudio, /hoveredFloor\.activity\.taskPreview/);
  assert.match(agentStudio, /hoveredFloor\.subagents\.visible/);
  assert.match(agentStudio, /<AgentCityFallback/);
  assert.match(agentStudio, /projection\.hiddenAgentCount/);
  assert.match(agentStudio, /documentActivityVisibility/);
  assert.doesNotMatch(agentStudio, /visibilitychange/);
  assert.match(agentCityFallback, /agent-city-fallback-building/);
  assert.match(agentCityFallback, /floor\.activity\.botName/);
  assert.match(agentCityFallback, /floor\.activity\.channel/);
  assert.match(agentCityFallback, /floor\.activity\.startedAt/);
  assert.match(agentCityFallback, /floor\.activity\.taskPreview/);
  assert.match(agentCityFallback, /floor\.agent\.modelOverrides/);
  assert.match(agentCityFallback, /floor\.subagents\.visible/);
  assert.doesNotMatch(agentCityFallback, /agent-city-fallback-working-frame/);
  assert.match(agentCityFallback, /role="tooltip"/);
  assert.match(agentCityFallback, /aria-describedby/);
  assert.match(styles, /\.agent-city-hover-card\s*\{[^}]*pointer-events:\s*none/s);
  assert.doesNotMatch(styles, /agent-city-agent-label|agent-city-status-dot|agent-city-tooltip|agent-city-working-frame|agent-city-working-marquee/);
});

test("Agent City owns WebGL lifecycle, quality fallback, and GPU cleanup", () => {
  assert.match(agentCityCanvas, /supportsAgentCityWebGL2\(\)/);
  assert.match(agentCityCanvas, /new ResizeObserver/);
  assert.match(agentCityCanvas, /new IntersectionObserver/);
  assert.match(agentCityCanvas, /function updateHover\(event: PointerEvent\)/);
  assert.match(agentCityCanvas, /onpointermove=\{updateHover\}/);
  assert.match(agentCityCanvas, /onpointerleave=\{clearHover\}/);
  assert.match(agentCityCanvas, /clearHover\(\);/);
  assert.match(agentCityCanvas, /prefers-reduced-motion: reduce/);
  assert.match(agentCityCanvas, /controller\?\.setQuality\("low"\)/);
  assert.match(agentCityCanvas, /controller\?\.dispose\(\)/);
  assert.match(agentCityScene, /new THREE\.PerspectiveCamera/);
  assert.match(agentCityScene, /new THREE\.Raycaster\(\)/);
  assert.match(agentCityScene, /function attachFloorTarget/);
  assert.match(agentCityScene, /target\.userData\.floorKey = key/);
  assert.match(agentCityScene, /raycaster\.intersectObjects\(targets, false\)/);
  assert.match(agentCityScene, /hitTest\(clientX, clientY\)/);
  assert.match(agentCityScene, /new THREE\.LineSegments/);
  assert.match(agentCityScene, /new THREE\.LineDashedMaterial/);
  assert.match(agentCityScene, /marqueeLine\.computeLineDistances\(\)/);
  assert.match(agentCityScene, /function moveMarquee/);
  assert.match(agentCityScene, /moveMarquee\(perimeter, -\(\(time \* 0\.006/);
  assert.match(agentCityScene, /moveMarquee\(perimeter, 0\)/);
  assert.match(agentCityScene, /blending: THREE\.AdditiveBlending/);
  assert.match(agentCityScene, /depthWrite: false/);
  assert.match(agentCityScene, /toneMapped: false/);
  assert.match(agentCityScene, /if \(delta > 0\) frameSamples\.push\(delta\)/);
  assert.match(agentCityScene, /webglcontextlost/);
  assert.match(agentCityScene, /renderer\.renderLists\.dispose\(\)/);
  assert.match(agentCityScene, /renderer\.dispose\(\)/);
  assert.match(agentCityScene, /renderer\.forceContextLoss\(\)/);
  assert.match(agentCityScene, /controls\.dispose\(\)/);
  assert.doesNotMatch(agentCityScene, /TrackballControls|MapControls|ArcballControls/);
});

// The activity poll fires every 2.5s. Rebuilding the whole scene on each poll
// is what made the city feel static: it reset the camera and restarted every
// animation, so no interaction could survive longer than one poll.
test("Agent City syncs the activity poll incrementally instead of rebuilding the scene", () => {
  assert.match(agentCityScene, /function syncProjection/);
  assert.match(agentCityScene, /floorNodes = new Map<string, FloorNode>/);
  assert.match(agentCityScene, /agentCityFloorSignature/);
  assert.match(agentCityScene, /node\.signature !== signature/);
  assert.match(agentCityScene, /applyFloorState\(node, floor\)/);
  // update() must touch projection state only — never the camera.
  const update = agentCityScene.match(/update\(nextProjection\) \{[\s\S]*?\n {4}\},/);
  assert.ok(update, "controller.update was not found");
  assert.doesNotMatch(update[0], /camera\.position|controls\.target|applyOverview|rebuild\(\)/);
  assert.doesNotMatch(agentCityScene, /function rebuild\(/);
  // A user who has framed their own shot keeps it when the roster changes.
  assert.match(agentCityScene, /if \(!userAdjusted && projection\.sceneFloors !== lastSceneFloors\)/);
});

test("Agent City camera is orbitable, bounded, and resettable", () => {
  assert.match(agentCityScene, /new OrbitControls\(camera, options\.canvas\)/);
  assert.match(agentCityScene, /controls\.minDistance = AGENT_CITY_MIN_DISTANCE/);
  assert.match(agentCityScene, /controls\.maxDistance = AGENT_CITY_MAX_DISTANCE/);
  assert.match(agentCityScene, /controls\.maxPolarAngle/);
  // Panning must stay inside the city or the user ends up staring at fog.
  assert.match(agentCityScene, /function handleControlChange[\s\S]*clampCameraTarget/);
  assert.match(agentCityScene, /controls\.addEventListener\("change", handleControlChange\)/);
  assert.match(agentCityScene, /resetView\(\) \{/);
  assert.match(agentCityScene, /zoom\(direction\) \{/);
  assert.match(agentCityScene, /focusFloor\(key\) \{/);
  // Damping would fight a scripted fly-to and leave it short of its framing.
  assert.match(agentCityScene, /if \(tween\) \{[\s\S]*camera\.lookAt\(controls\.target\)/);
  assert.match(agentCityCanvas, /export function zoom/);
  assert.match(agentCityCanvas, /export function resetView/);
  assert.match(agentStudio, /cityCanvas\?\.zoom\("in"\)/);
  assert.match(agentStudio, /cityCanvas\?\.resetView\(\)/);
  assert.match(styles, /\.agent-city-controls\s*\{[^}]*pointer-events:\s*auto/s);
});

test("Agent City pugs are rigged and clip-driven, and clicking one greets back", () => {
  // Front paws are what make typing / phone-scrolling / waving readable; the
  // original model had only hind legs and a sine bob on position.y.
  assert.match(agentCityScene, /pawLeft: THREE\.Group/);
  assert.match(agentCityScene, /pawRight: THREE\.Group/);
  assert.match(agentCityScene, /function applyPugPose/);
  assert.match(agentCityScene, /clipsForStatus\(rig\.status\)/);
  assert.match(agentCityScene, /transitionClip\(previous, floor\.state\)/);
  assert.match(agentCityScene, /oneShot = \{ clip: "greet", startedAt: performance\.now\(\) \}/);
  assert.match(agentCityScene, /reducedMotion && !rig\.oneShot/);
  // Props are hidden when the camera is too far away for them to read.
  assert.match(agentCityScene, /const detailed = distance <= AGENT_CITY_DETAIL_DISTANCE/);
  // A click must not fire at the end of an orbit drag.
  assert.match(agentCityCanvas, /CLICK_SLOP_PX/);
  assert.match(agentCityCanvas, /function movedTooFar/);
  assert.match(agentCityCanvas, /controller\?\.greetAt/);
  assert.match(agentCityCanvas, /ondblclick=\{handleDoubleClick\}/);
  assert.match(agentStudio, /class="agent-city-detail"/);
  assert.match(agentStudio, /function handleWindowKeydown/);
});

test("Agent City can be searched, followed, and lights its windows at night", () => {
  // 10 buildings x 10 floors is unnavigable without a way to jump to a name.
  assert.match(agentStudio, /function searchFloors/);
  assert.match(agentStudio, /class="agent-city-search"/);
  assert.match(agentStudio, /function handleSearchKeydown/);
  assert.match(agentStudio, /event\.key === "ArrowDown"/);
  assert.match(agentStudio, /jumpToFloor\(match\.key\)/);
  assert.match(agentStudio, /cityCanvas\?\.focusFloor\(key\)/);
  assert.match(agentStudio, /agentCitySearchEmpty/);

  assert.match(agentStudio, /function toggleFollow/);
  assert.match(agentStudio, /cityCanvas\?\.setFollowWorking\(followWorking\)/);
  assert.match(agentCityCanvas, /export function setFollowWorking/);
  assert.match(agentCityScene, /setFollowWorking\(enabled\) \{/);
  assert.match(agentCityScene, /function syncFollowTarget/);
  // Re-framing every poll would fight a user panning while follow is on.
  assert.match(agentCityScene, /if \(!next \|\| next === followKey\) return;/);
  assert.match(agentCityScene, /selectFollowFloorKey\(projection, followKey\)/);

  assert.match(agentCityScene, /function createWindowPanes/);
  assert.match(agentCityScene, /function applyWindowGlow/);
  assert.match(agentCityScene, /applyWindowGlow\(node, floor\.state\)/);
  // Night glow is status-driven, so it must repaint on the poll, not rebuild.
  assert.doesNotMatch(agentCityScene, /windowMaterial: THREE\.MeshStandardMaterial \| null/);
  assert.match(agentCityScene, /node\.windowMaterial\.emissiveIntensity = node\.windowBase;/);
  assert.match(styles, /\.agent-city-search\s*\{/s);
});

// App.svelte REMOVES data-theme when the theme preference is "system" — the
// default — so a surface styled only under `:root[data-theme="dark"]` renders
// light on a dark canvas for most users, with nothing to notice at build time.
// Agent City floats its chrome over a WebGL canvas, which is exactly where that
// mismatch is most visible, so it must theme through the shared tokens instead.
test("Agent City chrome themes through tokens, not a data-theme-only override list", () => {
  // Comments are stripped first: prose in this file legitimately mentions
  // data-theme, and it would otherwise be read as part of the next selector.
  const source = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...source.matchAll(/([^{}]*\.agent-city[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(rules.length > 30, `expected the Agent City block, found ${rules.length} rules`);

  const themeScoped = rules
    .map(([, selector]) => selector.trim())
    .filter((selector) => selector.includes("data-theme"));
  assert.deepEqual(themeScoped, [], "Agent City must not carry per-theme override rules");

  // Pug artwork keeps its coat colours in both themes; everything else must
  // resolve through a token so Light / Dark / System all follow automatically.
  const violations = [];
  for (const [, selector, body] of rules) {
    if (/agent-city-fallback-pug/.test(selector)) continue;
    for (const declaration of body.split(";")) {
      const match = declaration.match(/^\s*(background|background-color|color|border-color)\s*:\s*(.+)$/s);
      if (!match) continue;
      const value = match[2];
      const literal =
        /#[0-9a-f]{3,8}\b/i.test(value) ||
        /\brgba?\(\s*255/.test(value) ||
        /\brgba?\(\s*0\s*,\s*0\s*,\s*0/.test(value);
      if (literal) violations.push(`${selector.trim()} { ${declaration.trim()} }`);
    }
  }
  assert.deepEqual(violations, []);

  // The one Agent City colour that cannot derive from a token: it has to match
  // the WebGL clear colour, so it must be mirrored into every theme context.
  const skyDeclarations = [...source.matchAll(/--agent-city-sky\s*:/g)];
  assert.equal(skyDeclarations.length, 3, "--agent-city-sky must be declared for light, dark and system-dark");
  const darkBlock = source.slice(source.indexOf(':root[data-theme="dark"] {'));
  assert.match(darkBlock.slice(0, 4000), /--agent-city-sky:\s*#101820/);
  const systemBlock = source.slice(source.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(systemBlock.slice(0, 4000), /--agent-city-sky:\s*#101820/);
});

test("sidebar conversation rows expose a rename/delete menu", () => {
  // Web conversation rows carry an ellipsis menu (rename + delete); external
  // channels are read-only mirrors and never surface it.
  assert.match(row, /class="row-menu-btn"/);
  assert.match(row, /class="row-menu"/);
  assert.match(row, /onRename\?\.\(/);
  assert.match(row, /onDelete\?\.\(/);
  assert.match(row, /!item\.readOnly && Boolean\(onRename\) && Boolean\(onDelete\)/);
  // The host wires the row actions to the desktop conversation API.
  assert.match(view, /renameDesktopConversation\(connectedEndpoint/);
  assert.match(view, /deleteDesktopConversation\(connectedEndpoint/);
});

test("chat primary navigation stays in the Chat workspace", () => {
  assert.match(view, /let workspacePane: ChatWorkspacePaneName = requestedWorkspacePane/);
  assert.match(view, /openWorkspacePane\("automations"\)/);
  assert.match(view, /openWorkspacePane\("skills"\)/);
  assert.doesNotMatch(view, /onclick=\{\(\) => openSettings\("tasks"\)\}/);
  assert.doesNotMatch(view, /onclick=\{\(\) => openSettings\("skills"\)\}/);
  // New chat must enter a profile-selectable draft. The first send creates the
  // Session through ChatSessionStore with that pinned profile.
  assert.match(view, /chatStore\.newConversationDraft\(defaultBot\(\)\)/);
  assert.doesNotMatch(view, /async function newConversation[\s\S]*?await createDesktopSession\(connectedEndpoint, defaultBot\(\)\)/);
});

test("chat header is single-line and service status lives on the sidebar logo", () => {
  const chatSidebar = read("./lib/chat/ChatSidebar.svelte");
  assert.match(view, /activeHeaderSourceInitial/);
  assert.match(view, /activeHeaderTitle/);
  assert.match(view, /class="chat-title-separator"[^>]*>\/<\/span>/);
  // The title takes the row's slack and ellipsizes inside the CHAT COLUMN. A
  // viewport-relative `max-width` let it run underneath the action buttons as
  // soon as the file panel narrowed the column.
  assert.match(styles, /\.chat-title-block \{[^}]*flex: 1 1 auto/);
  assert.match(styles, /\.chat-header \.header-actions \{ flex: 0 1 auto/);
  assert.match(styles, /\.chat-title-name \{[^}]*max-width: 100%[^}]*text-overflow: ellipsis/);
  assert.doesNotMatch(view, /activeHeaderAvatar|activeSessionTitle|activeExternalTitleWithSource/);
  assert.match(view, /openExternalTranscript\(item\.sessionId, item\.channel, item\.title, item\.botName\)/);
  assert.doesNotMatch(view, /activeExternalTitle\?\.replace/);
  assert.doesNotMatch(view, /class="chat-title-sub"[\s\S]*copy\.statusOnline/);
  assert.doesNotMatch(view, /aria-label=\{copy\.openSettings\} title=\{copy\.openSettings\}/);
  assert.match(view, /serviceState=\{serviceState\}/);
  assert.match(chatSidebar, /sidebar-footer-logo-wrap/);
  assert.match(chatSidebar, /data-state=\{serviceState\}/);
});

test("external transcripts merge source and read-only status into the footer", () => {
  assert.doesNotMatch(view, /copy\.externalSessionDivider/);
  assert.match(view, /copy\.externalSessionReadOnly\.replace\("\{channel\}", activeHeaderSourceLabel\)/);
  assert.match(i18n, /externalSessionReadOnly:\s*"来自 \{channel\} · 此会话在桌面端为只读。"/);
  assert.match(i18n, /externalSessionReadOnly:\s*"From \{channel\} · This conversation is read-only on Desktop."/);
});

test("chat shell does not stay click-blocked during startup or sidebar resize", () => {
  assert.doesNotMatch(view, /await selectDefaultSession\(generation\)/);
  assert.match(view, /loading = false;[\s\S]*void selectDefaultSession\(generation\)/);
  assert.match(view, /setPointerCapture\(event\.pointerId\)/);
  assert.match(view, /onpointercancel=\{cancelSidebarResize\}/);
  assert.match(view, /onlostpointercapture=\{cancelSidebarResize\}/);
  assert.match(view, /onDestroy\(\(\) => \{[\s\S]*stopSidebarResize\(\)/);
});

test("desktop top chrome exposes draggable Tauri regions without covering controls", () => {
  const chatSidebar = read("./lib/chat/ChatSidebar.svelte");
  const sidebarShell = read("./lib/chat/SidebarShell.svelte");
  const workspacePane = read("./lib/chat/ChatWorkspacePane.svelte");
  const windowDragMask = read("./lib/WindowDragMask.svelte");
  // `core:window:default` does NOT grant `start_dragging`, so without this explicit
  // permission every drag region is silently denied at the IPC layer and the title
  // bar looks inert no matter how the CSS layers are arranged.
  assert.ok(tauriCapabilities.permissions.includes("core:window:allow-start-dragging"));
  assert.match(view, /<WindowDragMask \/>/);
  assert.match(app, /<WindowDragMask \/>/);
  assert.match(windowDragMask, /getCurrentWindow\(\)\.startDragging\(\)/);
  assert.match(styles, /\.window-drag-mask\s*\{[^}]*position:\s*absolute;[^}]*height:\s*var\(--toolbar-height\);[^}]*z-index:\s*30;/s);
  assert.match(styles, /\.chat-layout > \.window-drag-mask\s*\{[^}]*height:\s*60px;/s);
  assert.match(styles, /\.chat-sidebar, \.settings-sidebar\s*\{[^}]*padding:\s*60px 12px 8px;/s);
  assert.match(chatSidebar, /class="sidebar-titlebar-drag" data-tauri-drag-region/);
  assert.match(sidebarShell, /class="sidebar-titlebar-drag" data-tauri-drag-region/);
  assert.match(styles, /\.sidebar-titlebar-drag\s*\{[^}]*position:\s*absolute;[^}]*height:\s*30px;/s);
  assert.match(view, /class="chat-source-tag" data-tauri-drag-region/);
  assert.match(chatHeader, /class="chat-source-tag" data-tauri-drag-region/);
  assert.match(workspacePane, /class="workspace-page-title" data-tauri-drag-region/);
  assert.match(styles, /\.header-actions\s*\{[^}]*z-index:\s*31;/s);
  // The stretched action row sits above the drag mask, so its empty space must
  // stay transparent to pointer events or the toolbar stops dragging the window.
  assert.match(styles, /\.header-actions\s*\{\s*pointer-events:\s*none;\s*\}/);
  assert.match(styles, /\.header-actions > \*\s*\{\s*pointer-events:\s*auto;\s*\}/);
  assert.doesNotMatch(view, /<button[\s\S]{0,160}data-tauri-drag-region/);
});

test("Chat window aligns native macOS traffic lights with the edge-to-edge sidebar", () => {
  const windows = Object.fromEntries(tauriConfig.app.windows.map((window) => [window.label, window]));
  assert.deepEqual(windows.chat.trafficLightPosition, { x: 18, y: 18 });
  // Settings render as an in-window overlay, so there is only one native window.
  assert.equal(windows.settings, undefined);
});

test("Settings Escape respects a nested shared Dialog before closing the overlay", () => {
  assert.match(app, /event\.defaultPrevented/);
  assert.match(app, /event\.composedPath\(\)[\s\S]*desktop-dialog-content/);
  assert.match(app, /if \(event\.key === "Escape"[\s\S]*!nestedDialog[\s\S]*closeSettings\(\)/);
});

test("per-session model persistence commits caches only after the server save succeeds", () => {
  assert.match(
    view,
    /await saveDesktopSessionModel\(connectedEndpoint, sessionId, value\);\s*sessionModelOverrides\.set\(sessionId, value\);[\s\S]{0,240}?hydratedModelSessions\.add\(sessionId\);/
  );
  assert.match(
    projectChat,
    /await saveDesktopSessionModel\(projectsStore\.endpoint, sessionId, value\);\s*sessionModelOverrides\.set\(sessionId, value\);[\s\S]{0,240}?hydratedModelSessions\.add\(sessionId\);/
  );
  assert.doesNotMatch(view, /saveDesktopSessionModel\([^\n]+\)\.catch\(\(\) => \{\}\)/);
  assert.match(chatSessionStore, /await deps\.onDraftSessionCreated\?\.\(profileId, created\.id\)/);
  assert.match(view, /await chatStore\.send\(text, files\);[\s\S]*catch \(cause\)[\s\S]*messageInput = text;[\s\S]*pendingFiles = files;/);
  assert.match(view, /if \(activeSessionId === sessionId\) activeModelKey = value/);
  assert.match(projectChat, /if \(projectsStore\.selectedSessionId === sessionId\) activeModelKey = value/);
});

test("external channel groups use icons that exist in the bundled icon font", () => {
  assert.match(view, /id: "telegram", icon: "telegram-logo"/);
  assert.match(view, /id: "feishu", icon: "bird"/);
  assert.match(view, /id: "qq", icon: "linux-logo"/);
  assert.match(view, /id: "weixin", icon: "wechat-logo"/);
  assert.doesNotMatch(view, /lark-logo|qq-logo/);
});

test("automation session detail renders a chat-style transcript", () => {
  assert.match(view, /import ConversationTranscript from "\.\/lib\/chat\/ConversationTranscript\.svelte"/);
  assert.match(sections.tasks, /import ConversationTranscript from "\.\.\/chat\/ConversationTranscript\.svelte"/);
  assert.match(view, /<ConversationTranscript/);
  assert.match(sections.tasks, /<ConversationTranscript/);
  assert.match(transcript, /class="message-row"/);
  assert.doesNotMatch(transcript, /class="message-avatar"/);
  assert.match(transcript, /class="message-stack"/);
  assert.match(transcript, /class="message-bubble markdown-body"/);
  assert.match(transcript, /renderMarkdown\(displayContent, copy\.copyCode\)/);
  assert.match(styles, /\.message-row\.assistant \.message-bubble \{[^}]*background: transparent/s);
  // The assistant turn has no bubble, so the user turn is the only card in the
  // transcript: keep it a full step above the background plus tier-1 elevation,
  // not a near-invisible 1px outline.
  assert.match(styles, /\.message-row\.mine \.message-bubble \{[^}]*background: var\(--gray-300\)[^}]*box-shadow: var\(--soft-shadow\)/s);
  assert.match(styles, /\[data-theme="dark"\] \.message-row\.mine \.message-bubble \{[^}]*background: var\(--gray-300\)/s);
  assert.match(styles, /\.run-activity \{[^}]*border: 0;[^}]*background: transparent/s);
  assert.doesNotMatch(sections.tasks, /class="message-(row|avatar|stack|bubble)/);
});

// The automation page had two parallel visual languages for one feature: a
// "command deck" card list and the list-detail workspace. Only the workspace was
// ever mounted, so the deck was dead markup drifting on its own token family.
test("automation management has exactly one surface and opens full history in a modal", () => {
  assert.doesNotMatch(sections.tasks, /automation-command-deck/);
  assert.doesNotMatch(sections.tasks, /class="automation-card"/);
  assert.doesNotMatch(styles, /\.automation-command-deck\s*\{/);
  assert.doesNotMatch(styles, /\.automation-card\s*\{/);
  assert.match(sections.tasks, /class="automation-workspace-layout"/);
  assert.match(sections.tasks, /<Dialog[\s\S]*contentClass="task-history-modal"/);
  assert.match(sections.tasks, /<AlertDialog[\s\S]*contentClass="task-delete-confirm-modal"/);
  assert.match(sections.tasks, /openTaskHistory\(selectedTask\.id\)/);
  assert.doesNotMatch(sections.tasks, /class="task-history-panel"/);
  assert.match(styles, /\.task-history-modal\s*\{[^}]*width:\s*min\(820px/s);
});

// Uppercase + caps tracking is an English-only idiom; applied to the Chinese
// labels these chips actually carry it only shrinks them.
test("automation status chips follow Geist tokens and stay legible in CJK", () => {
  assert.doesNotMatch(styles, /\.automation-status\s*\{[^}]*text-transform:\s*uppercase/s);
  assert.doesNotMatch(styles, /\.execution-state\s*\{[^}]*text-transform:\s*uppercase/s);
  assert.match(styles, /\.automation-status\s*\{[^}]*border-radius:\s*var\(--rounded-full\)/s);
  // Legacy pre-Geist radius family must not come back into these surfaces.
  assert.doesNotMatch(styles, /\.(?:automation|task-)[^{\n]*\{[^}]*var\(--radius-(?:small|full|panel)\)/s);
  assert.match(styles, /\.execution-state\.state-interrupted\b/);
});

test("automation workspace keeps each task in a bounded card while retaining task details", () => {
  const workspacePane = read("./lib/chat/ChatWorkspacePane.svelte");
  assert.match(workspacePane, /<TasksSection presentation="workspace"/);
  assert.match(sections.tasks, /presentation\?: "settings" \| "workspace"/);
  assert.match(sections.tasks, /class="automation-workspace-layout"/);
  assert.match(sections.tasks, /class="automation-task-row"/);
  assert.match(sections.tasks, /class="automation-task-detail"/);
  // Cards stretch to fill the full workspace row instead of capping at 480px.
  assert.match(styles, /\.automation-workspace-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%, 360px\), 1fr\)\)/s);
  assert.match(styles, /\.automation-task-row\s*\{[^}]*border:\s*1px solid var\(--separator\)[^}]*border-radius:\s*var\(--rounded-md\)[^}]*background:\s*var\(--card-bg\)/s);
});

test("automation workspace separates user and system tasks with accessible tabs", () => {
  assert.match(sections.tasks, /role="tablist"/);
  assert.match(sections.tasks, /session\.text\.tasksUserTab/);
  assert.match(sections.tasks, /session\.text\.tasksOneShotTab/);
  assert.match(sections.tasks, /markOneShotTasksRead/);
  assert.match(sections.tasks, /session\.text\.tasksSystemTab/);
  assert.match(sections.tasks, /item\.category === activeTaskView/);
  assert.match(styles, /\.automation-category-tabs\s*\{/s);
  assert.match(styles, /\.automation-category-tab\.active\s*\{/s);
});

// Pitfall 16 family, on the header instead of the panels: the segmented control
// is `inline-flex`, and an inline-level box IGNORES `margin: auto`. Giving the
// control itself the content-column width therefore did two wrong things at
// once — it stretched its single rounded fill across the full 1240px (a grey
// slab with three tabs huddled at its left end) and left it flush against the
// scroll edge while the task grid below stayed centred. Alignment belongs to a
// block-level bar; the control keeps `fit-content`.
test("automation header shares one content column and the segmented control hugs its tabs", () => {
  assert.match(sections.tasks, /class="automation-category-bar"/);
  assert.match(sections.tasks, /class:workspace=\{presentation === "workspace"\} class="automation-category-bar"/);

  const tabs = styles.match(/\.automation-category-tabs \{([^}]*)\}/)?.[1] ?? "";
  assert.match(tabs, /width:\s*fit-content/, "the control must hug its segments, never carry the column width");
  assert.doesNotMatch(tabs, /margin:\s*0 auto/, "an inline-level box cannot centre itself with auto margins");
  assert.doesNotMatch(styles, /\.automation-category-tabs\.workspace\s*\{/, "the width override moved to the bar");

  // One token, three blocks: tab bar, toolbar and grid must not drift apart.
  assert.match(styles, /--automation-col:\s*min\(1240px, calc\(100% - 48px\)\);/);
  assert.match(styles, /\.automation-category-bar\.workspace \{[^}]*width:\s*var\(--automation-col\)[^}]*margin:\s*0 auto/s);
  assert.match(styles, /\.automation-workspace \{[^}]*width:\s*var\(--automation-col\)/s);

  // Search, create and the run totals are one band: an uncapped `flex: 1`
  // search across the column is ~900px of empty field with the action stranded
  // at the far edge, and the totals then cost a third stacked header row.
  assert.match(styles, /\.automation-workspace-toolbar \.search-field \{[^}]*max-width:\s*320px/s);
  assert.match(styles, /\.automation-workspace-summary \{[^}]*margin:\s*0 0 0 auto/s);
  assert.match(sections.tasks, /class="automation-workspace-toolbar">[\s\S]{0,900}?class="automation-workspace-summary"[\s\S]{0,900}?<\/div>\s*<\/div>/);
  // Wrapped totals must fall back to the grid's left edge, not stay right.
  assert.match(styles, /@container \(max-width: 720px\) \{[^}]*\.automation-workspace-summary \{[^}]*margin-left:\s*0/s);
});

test("automation details are opt-in and execution state stays task-scoped", () => {
  assert.match(sections.tasks, /selectedTaskId \? filteredTaskItems\.find/);
  assert.match(sections.tasks, /class="automation-detail-close"/);
  assert.match(sections.tasks, /class:detail-open=\{Boolean\(selectedTask\)\}/);
  assert.match(sections.tasks, /session\.text\.tasksLatestResult/);
  assert.match(sections.tasks, /session\.text\.tasksLastRun\}<\/dt><dd>\{formatTaskTime/);
  assert.match(sections.tasks, /setTaskEnabled\(selectedTask\.id, !selectedTask\.enabled\)/);
  assert.match(sections.tasks, /isTaskRunning\(selectedTask\.id\)/);
  assert.match(taskStore, /runningTaskIds: new Set<string>\(\)/);
  assert.match(taskStore, /if \(action === "trigger"\) tasksStore\.runningTaskIds/);
  assert.match(styles, /\.automation-workspace-layout\.detail-open\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /@keyframes automation-spin/);
});

// A periodic event file's `status` is a scheduling lock — success rewrites it to
// "pending" and a crashed run leaves "running" with nobody to clear it. Reading
// it as liveness kept two real tasks spinning for hours after they had died.
test("task liveness comes from an active lease, never from the event file's lock", () => {
  assert.match(taskStore, /function hasLiveRun/);
  assert.match(taskStore, /task\.id === id && task\.active/);
  assert.doesNotMatch(taskStore, /task\.status === "running"/);
  // The headline state is the last run's outcome.
  assert.match(sections.tasks, /task\.active\) return session\.text\.taskStatusRunning/);
  assert.match(sections.tasks, /task\.lastRun \? executionStatusLabel\(task\.lastRun\.status\)/);
  assert.match(sections.tasks, /outcome-\$\{task\.lastRun\?\.status \?\? "none"\}/);
});

test("one-shot task rows expose the execution that triggered each reminder", () => {
  assert.match(sections.tasks, /task\.executions\[0\]/);
  assert.match(sections.tasks, /openTaskSession\(task\.id, task\.executions\[0\]\.id\)/);
  assert.match(sections.tasks, /session\.text\.tasksOpenSession/);
});

test("provider, settings, and diagnostics regressions stay fixed", () => {
  const providers = read("./lib/settings/ProvidersSection.svelte");
  assert.match(providers, /providersStore\.providers\.builtinProviders\.map/);
  assert.doesNotMatch(providers, /let list = providersStore\.providers\.customProviders[\s\S]{0,220}providerTab === "builtin" \? isBuiltin/);
  assert.doesNotMatch(app, /\{ id: "tasks", icon: "list-checks" \}/);
  assert.match(app, /text\.diagAppVersion/);
  assert.match(app, /appVersion/);
});

test("saving a provider refreshes Chat model options in the same window without restart", () => {
  assert.match(settingsSessionStore, /export const SETTINGS_CHANGED_EVENT/);
  assert.match(settingsSessionStore, /window\.dispatchEvent\(new Event\(SETTINGS_CHANGED_EVENT\)\)/);
  assert.doesNotMatch(view, /new BroadcastChannel\("molibot-settings-channel"\)/);
  assert.match(view, /window\.addEventListener\(SETTINGS_CHANGED_EVENT, requestSettingsRefresh\)/);
  assert.match(view, /let pendingSettingsRefresh = false/);
  assert.match(view, /if \(loading \|\| refreshingSettings\) \{[\s\S]{0,120}pendingSettingsRefresh = true;[\s\S]{0,120}return;/);
  assert.match(view, /if \(pendingSettingsRefresh\) \{[\s\S]{0,160}refreshModelsAndProfiles\(\)/);
  assert.match(view, /refreshEndpoint !== connectedEndpoint \|\| refreshGeneration !== connectionGeneration/);
});

test("direct one-shot delivery is persisted through the shared runtime for every channel", () => {
  const baseRuntime = read("../../../src/lib/server/channels/shared/baseRuntime.ts");
  for (const channel of ["web", "telegram", "feishu", "qq", "weixin"]) {
    const runtime = read(`../../../src/lib/server/channels/${channel}/runtime.ts`);
    assert.match(runtime, /persistDirectEventMessage\(/, `${channel} must persist direct event delivery`);
  }
  assert.match(baseRuntime, /appendContextMessage/);
  assert.match(baseRuntime, /resolveInboundSessionId/);
});

test("automation and skills shortcuts reflect the active workspace pane", () => {
  const chatSidebar = read("./lib/chat/ChatSidebar.svelte");
  assert.match(view, /activeWorkspacePane=\{workspacePane\}/);
  assert.match(chatSidebar, /class:active=\{activeWorkspacePane === "automations"\}/);
  assert.match(chatSidebar, /class:active=\{activeWorkspacePane === "skills"\}/);
  assert.match(chatSidebar, /\.nav-item\.active\s*\{[^}]*background:/s);
});

test("chat workspace design constraints cover skills, errors, focus, and reachable narrow widths", () => {
  assert.match(sections.skills, /class="installed-skills-search"/);
  assert.match(sections.skills, /class:expanded=\{expandedIds\.has\(skill\.id\)\}/);
  assert.match(styles, /\.installed-skill-card\s*\{[^}]*align-self:\s*start/s);
  assert.match(styles, /\.installed-skill-copy p\s*\{[^}]*-webkit-line-clamp:\s*3/s);
  assert.match(chatInputArea, /class="composer-error" role="alert"/);
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

test("thinking and tool activity stay opt-in", () => {
  assert.match(transcript, /<ThinkingCard text=\{message\.thinking\}/);
  assert.doesNotMatch(thinkingCard, /<details class="thinking-card"[^>]*\bopen>/);
  assert.match(conversationLiveView, /<details class="thinking-card">/);
  assert.doesNotMatch(conversationLiveView, /<details class="thinking-card" open>/);
  assert.doesNotMatch(runActivity, /<details class="run-activity" open=/);
});

// Completed reasoning text and tool summaries are the bulk of a transcript's
// bytes and DOM, and both cards are collapsed by default. Mounting their bodies
// up-front cost a chunk of every session switch for invisible markup, so both
// gate on their own `open` state; the streaming live view is exempt because its
// reasoning is written as it arrives.
test("collapsed transcript cards mount their body only once opened", () => {
  assert.match(thinkingCard, /bind:open=\{opened\}/);
  assert.match(thinkingCard, /\{#if opened\}<pre>\{text\}<\/pre>\{\/if\}/);
  assert.match(runActivity, /<details class="run-activity" bind:open=\{opened\}>/);
  assert.match(runActivity, /\{#if opened\}[\s\S]*\{#each activities/);
});

test("structured runner events do not leak into the live answer status", () => {
  const conversationTurn = read("./lib/chat/conversationTurn.ts");
  assert.match(conversationTurn, /if \(event === "status"\) \{/);
  assert.doesNotMatch(conversationTurn, /event === "status" \|\| event === "runner_event"/);
});

test("shared composer turns pasted clipboard images into attachments", () => {
  assert.match(chatComposerShell, /onpaste=\{handlePaste\}/);
  assert.match(chatComposerShell, /clipboardImageFiles\(event\.clipboardData\?\.items \?\? \[\]\)/);
  assert.match(chatInputArea, /\{onPasteFiles\}/);
  assert.match(view, /onPasteFiles=\{addPastedFiles\}/);
  assert.match(projectChat, /onPasteFiles=\{addPastedFiles\}/);
  assert.match(conversationController, /onUploadComplete: hasFiles \? \(\) => \(this\.activity = labels\.recognizingImage\)/);
  // Tokens must be buffered and flushed per animation frame, never written to
  // the reactive field directly (per-token writes rebuild the whole {@html}
  // bubble and make streaming look like a page refresh).
  assert.match(conversationController, /onToken: \(delta\) => \{\s*this\.activity = "";\s*this\.pendingStreamText \+= delta;\s*this\.scheduleStreamFlush\(\);/);
  assert.doesNotMatch(conversationController, /onToken:[^}]*this\.streamingText \+= delta/);
});

test("local Chat and Project Chat share the live conversation, composer, and turn controller", () => {
  // Both surfaces render the shared presentation and drive the shared turn
  // engine (ConversationController) rather than re-implementing send/stream.
  for (const source of [view, projectChat]) {
    assert.match(source, /ChatMessagesPane/);
    assert.match(source, /ChatInputArea/);
  }
  assert.match(chatMessagesPane, /<ConversationLiveView/);
  assert.match(chatInputArea, /<ChatComposerShell/);
  assert.match(chatInputArea, /thinkingLevelLabel/);
  assert.match(chatInputArea, /<ComposerModelMenu/);
  assert.doesNotMatch(chatInputArea, /<select/);
  assert.match(composerModelMenu, /\{#each thinkingLevelOptions as level/);
  assert.match(composerModelMenu, /\{#each modelOptions as model/);
  assert.match(composerModelMenu, /role="menuitemradio"/);
  assert.match(view, /chatStore\.draftStore\.setThinking\(chatStore\.currentDraftKey\(\), thinkingLevel\)/);
  assert.match(view, /onChangeThinking=\{changeThinking\}/);
  assert.match(projectChat, /onChangeThinking=\{changeThinking\}/);
  assert.match(view, /thinkingLevelLabel=\{thinkingLabel\}/);
  assert.match(projectChat, /thinkingLevelLabel=\{thinkingLabel\}/);
  assert.match(projectChat, /activeModelTitle=\{activeModelFullLabel\}/);
  assert.doesNotMatch(projectChat, /<BotMention/);
  assert.doesNotMatch(projectChat, /project-context-token|defaultWeb|Default Web/);
  // Both chat surfaces drive a per-session runtime store (each owns the pinned
  // controllers); neither reimplements the turn loop. Main chat uses
  // ChatSessionStore, project chat uses projectChatStore.
  assert.match(view, /ChatSessionStore/);
  assert.match(projectChat, /projectChatStore/);
  assert.match(projectChat, /projectChatStore\.send\(/);
  assert.match(projectChat, /projectChatStore\.state/);
  assert.match(projectChatStoreSource, /modelKey: \(_profileId, sessionId\) => this\.deps\?\.resolveModel\(sessionId\)/);
  // Only the controller talks to the turn runtime; the views never do.
  assert.match(conversationController, /runDesktopConversationTurn/);
  assert.doesNotMatch(view, /runDesktopConversationTurn/);
  assert.doesNotMatch(projectChat, /streamDesktopChat/);
  assert.doesNotMatch(projectChat, /runDesktopConversationTurn/);
  assert.match(conversationLiveView, /<ConversationTranscript/);
  assert.match(conversationLiveView, /<RunActivity/);
});

test("long conversations share one user-turn navigator and preserve reader scroll ownership", () => {
  assert.match(chatMessagesPane, /<ConversationPromptNavigator \{messages\} \{copy\} \{formatTime\}/);
  assert.match(view, /viewMode === "external"[\s\S]*<ConversationPromptNavigator messages=\{externalTranscript\.messages\}/);
  assert.match(conversationNavigation, /message\.role !== "user" \|\| !messageId/);
  assert.match(conversationNavigation, /export function activePromptIndex[\s\S]*while \(low <= high\)/);
  assert.match(conversationNavigation, /Math\.exp\(-\(distance \* distance\) \/ \(2 \* sigma \* sigma\)\)/);
  assert.match(conversationPromptNavigator, /new ResizeObserver[\s\S]*new MutationObserver/);
  assert.match(conversationPromptNavigator, /markerWidth\(item, focusedMessageId, activeMessageId, pointerY\)/);
  assert.match(conversationPromptNavigator, /requestAnimationFrame\(\(\) => \{[\s\S]*updateHoveredPrompt\(\)/);
  assert.match(conversationPromptNavigator, /item\.userPreviewText[\s\S]*item\.assistantPreviewText/);
  assert.match(conversationPromptNavigator, /suspendStickToBottom\(scrollElement\)[\s\S]*prefers-reduced-motion: reduce[\s\S]*scrollIntoView\(\{ behavior, block: "start" \}\)/);
  assert.match(stickToBottom, /molibot:suspend-scroll-follow/);
  assert.match(stickToBottom, /molibot:resume-scroll-follow/);
  assert.match(chatMessagesPane, /scrollFollowKey = `\$\{stickKey\}\\u0000\$\{userTurnCount\}`[\s\S]*afterUpdate[\s\S]*resumeStickToBottom\(messagesElement\)/);
  assert.match(chatMessagesPane, /use:stickToBottom=\{stickKey\}/);
  assert.doesNotMatch(stickToBottom, /message-row\.mine/);
  assert.match(stickToBottom, /firstLayoutFrame = requestAnimationFrame[\s\S]*secondLayoutFrame = requestAnimationFrame[\s\S]*if \(pinned\) toBottom\(\)/);
  assert.match(styles, /\.conversation-prompt-navigator[\s\S]*\.prompt-navigation-preview[\s\S]*prefers-reduced-motion/);
  assert.match(styles, /\.conversation-prompt-navigator\s*\{[^}]*left:\s*12px/s);
  assert.match(styles, /\.prompt-navigation-preview-user span\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /\.prompt-navigation-preview-assistant\s*\{[^}]*-webkit-line-clamp:\s*2/s);
});

test("settings uses the flat Geist layout", () => {
  assert.match(app, /class="settings-search"/);
  assert.match(pageHeader, /class="page-header settings-page-header"/);
  assert.match(app, /<PageHeader[\s\S]*class="settings-scroll"/);
  assert.match(styles, /\.settings-row\s*\{[^}]*min-height:\s*50px/s);
  // Ordinary Settings groups stay flat even when shell/overlays use material.
  assert.match(settingGroup, /class=\{`settings-card setting-group/);
  assert.match(styles, /\.settings-card\s*\{[^}]*box-shadow:\s*none/s);
  assert.match(styles, /\.settings-card\s*\{[^}]*background:\s*var\(--card-bg\)/s);
  assert.match(styles, /\.settings-card \+ \.settings-card\s*\{[^}]*margin-top:\s*16px/s);
  assert.match(styles, /\.settings-content \.settings-footbar\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*0/s);
  assert.match(sections.tts, /open=\{provider\.id === toolsStore\.ttsGenerateEdit\.defaultProvider\}/);
  assert.match(sections.image, /value: "1024x1024", label: "1024 × 1024"/);
  assert.match(sections.plugins, /memoryDailyMaterials\.enabled/);
  assert.match(sections.plugins, /memoryDailyMaterials\.projectId/);
  assert.match(sections.plugins, /memoryDailyMaterials\.promptPath/);
  assert.match(sections.plugins, /memoryReflectionNotificationTarget/);
  assert.match(sections.plugins, /reflectionNotificationTargets/);
  assert.equal(
    sections.plugins.match(/value=\{pluginsStore\.pluginsEdit\.memoryReflectionNotificationTarget\}/g)?.length,
    2,
    "the shared memory notification target must be editable from both memory and daily-material cards"
  );
  assert.match(sections.plugins, /disabled=\{!pluginsStore\.pluginsEdit\.memoryReflectionNotifications && !pluginsStore\.pluginsEdit\.memoryDailyMaterials\.notifications\}/);
});

test("settings form controls share the DESIGN input height and time fields use the native picker", () => {
  assert.match(design, /input:\s*[\s\S]*?height:\s*40px/);
  assert.match(styles, /\.settings-field input\s*\{[^}]*height:\s*40px[^}]*padding:\s*0 12px/s);
  assert.match(styles, /\.select-control-trigger\s*\{[^}]*height:\s*40px[^}]*padding:\s*0 11px 0 12px/s);
  assert.match(selectControl, /Select\.Root/);
  assert.match(selectControl, /Select\.Content/);
  assert.match(selectControl, /<Select\.Item[^>]*>[\s\S]*<span title=\{option\.label\}>\{option\.label\}<\/span>[\s\S]*<\/Select\.Item>/);
  assert.doesNotMatch(selectControl, /#snippet child/);
  assert.match(styles, /\.settings-row \.select-control\s*\{[^}]*flex:\s*0 1 320px;[^}]*width:\s*320px;[^}]*max-width:\s*58%/s);
  assert.match(styles, /\.setting-row-control:has\(> \.select-control\)\s*\{[^}]*flex:\s*0 1 320px;[^}]*width:\s*320px;[^}]*max-width:\s*58%/s);
  assert.doesNotMatch(listSvelteSources().join("\n"), /<select(?:\s|>)/);
  assert.equal(sections.plugins.match(/<NativeTimeInput/g)?.length, 2);
  assert.equal(taskScheduleBuilder.match(/<NativeTimeInput/g)?.length, 1);
  assert.match(nativeTimeInput, /<input type="time"[^>]*onpointerdown=\{openNativePicker\}/);
  assert.match(nativeTimeInput, /input\.showPicker\(\)/);
  assert.doesNotMatch(sections.plugins, /class="settings-row settings-field"/);
});

test("the folder picker is a native modal panel guarded by one shared in-flight flag", () => {
  const projectList = readFileSync(new URL("./lib/projects/ProjectList.svelte", import.meta.url), "utf8");
  const projectTree = readFileSync(new URL("./lib/projects/ProjectTree.svelte", import.meta.url), "utf8");
  const projectsStoreSource = readFileSync(new URL("./lib/stores/projects.svelte.ts", import.meta.url), "utf8");
  const tauriLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

  // Shelling out to osascript took seconds to show a dialog owned by another process, so the
  // webview stayed clickable and extra clicks stacked up extra pickers.
  const pickerFn = tauriLib.slice(tauriLib.indexOf("async fn pick_project_directory"));
  assert.doesNotMatch(pickerFn.slice(0, pickerFn.indexOf("\n}")), /osascript|choose folder/);
  assert.match(pickerFn, /\.set_parent\(&window\)[\s\S]*\.pick_folder\(/);
  assert.match(tauriLib, /tauri_plugin_dialog::init\(\)/);

  // One store-owned flag, because both project surfaces render their own create dialog.
  assert.match(projectsStoreSource, /pickingFolder: false/);
  assert.match(projectsStoreSource, /export async function pickProjectDirectory[\s\S]*if \(projectsStore\.pickingFolder[\s\S]*projectsStore\.pickingFolder = true/);
  assert.match(projectsStoreSource, /finally \{\s*projectsStore\.pickingFolder = false;/);
  for (const source of [projectList, projectTree]) {
    assert.match(source, /pickProjectDirectory,/);
    assert.doesNotMatch(source, /invoke<string \| null>\("pick_project_directory"\)/);
    assert.match(source, /projectUseExistingFolder[\s\S]*?/);
    assert.match(source, /disabled=\{projectsStore\.busy === "add" \|\| projectsStore\.pickingFolder\}[\s\S]*useExistingProjectFolder\(\)/);
  }
});

test("project creation asks for a name before offering managed or existing directories", () => {
  const projectList = readFileSync(new URL("./lib/projects/ProjectList.svelte", import.meta.url), "utf8");
  const projectTree = readFileSync(new URL("./lib/projects/ProjectTree.svelte", import.meta.url), "utf8");
  for (const source of [projectList, projectTree]) {
    assert.match(source, /selectedRootPath/);
    assert.match(source, /copy\.projectCreateAction/);
    assert.match(source, /(?:addProject|createProject)\(\{ name: name\.trim\(\), rootPath: selectedRootPath \}\)/);
  }
  assert.match(projectList, /project-create-dialog/);
  assert.match(projectList, /createDirectory:\s*true/);
  assert.match(projectList, /projectUseExistingFolder/);
  assert.doesNotMatch(projectList, /beginAdding[\s\S]{0,160}chooseProjectDirectory/);
  assert.doesNotMatch(projectList, /bind:value=\{rootPath\}/);
});

test("project sessions render under the active project reusing the chat sidebar chrome", () => {
  const projectTree = readFileSync(new URL("./lib/projects/ProjectTree.svelte", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("./lib/chat/ChatSidebar.svelte", import.meta.url), "utf8");
  const projectDetail = readFileSync(new URL("./lib/projects/ProjectDetail.svelte", import.meta.url), "utf8");
  const projectsStore = readFileSync(new URL("./lib/stores/projects.svelte.ts", import.meta.url), "utf8");
  // Project is a first-level sidebar tree, not a separate page, and shares
  // Chat's exact Session row component.
  assert.match(sidebar, /<ProjectTree/);
  assert.match(projectTree, /copy\.addProject/);
  assert.match(projectTree, /actionLabel=\{copy\.newChat\}/);
  assert.match(projectTree, /import ConversationRow from "\.\.\/chat\/ConversationRow\.svelte"/);
  assert.match(projectTree, /<ConversationRow/);
  assert.match(projectTree, /EXPANSION_KEY/);
  assert.doesNotMatch(projectDetail, /class="project-sessions"/);
  assert.match(projectsStore, /createAndSelectProjectSession/);
  assert.doesNotMatch(projectsStore, /else await createAndSelectProjectSession/);
});

test("project detail reuses the chat header chrome for a single visual language", () => {
  const projectDetail = readFileSync(new URL("./lib/projects/ProjectDetail.svelte", import.meta.url), "utf8");
  const app = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(app, /ProjectsView|mainView/);
  assert.match(projectDetail, /class="chat-content"/);
  assert.match(projectDetail, /<ChatHeader/);
  assert.match(projectDetail, /\$\{project\.name\} \/ \$\{session\?\.title/);
  assert.match(projectDetail, /sourceInitial="P"/);
  assert.doesNotMatch(projectDetail, /subtitle=\{project\.rootPath\}/);
  assert.match(projectDetail, /class="icon-button"[\s\S]*aria-label=\{copy\.search\}/);
  assert.match(projectDetail, /class="icon-button"[\s\S]*aria-label=\{copy\.files\}/);
  assert.doesNotMatch(projectDetail, /aria-label=\{copy\.delete\}/);
  assert.match(chatHeader, /class="chat-header"/);
  assert.match(chatHeader, /class="chat-source-tag"/);
  assert.match(chatHeader, /class="chat-title-separator"/);
});

test("project file panel exposes live files, Git changes, and session attachments", () => {
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  const desktopApi = read("./lib/api.ts");
  assert.match(view, /<ArtifactPanel/);
  assert.match(projectFilePanel, /tab = "files"/);
  assert.match(projectFilePanel, /tab = "changes"/);
  assert.match(projectFilePanel, /tab = "attachments"/);
  // Tree, Git and search now load through the shared store, not the component.
  assert.match(filesStore, /loadDesktopProjectTree/);
  assert.match(filesStore, /loadDesktopProjectGitStatus/);
  assert.match(desktopApi, /additions: number \| null/);
  assert.match(desktopApi, /deletions: number \| null/);
  assert.match(projectFilePanel, /class="project-change-stats"/);
  assert.match(projectFilePanel, /project-change-additions/);
  assert.match(projectFilePanel, /project-change-deletions/);
  // A Project session belongs to the personal profile, a plain conversation to
  // the bot that owns it; reading the wrong profile returns an empty list with
  // no error, which is indistinguishable from "this session has no files".
  assert.match(projectFilePanel, /listDesktopSessionFiles\(endpoint, profileId \|\| "personal", sessionId, projectId\)/);
  assert.match(projectFilePanel, /projectReadOnlyHint/);
  assert.match(styles, /\.project-file-tabs/);
  // A change row stays on ONE line. With `flex-wrap: wrap` the line broke on
  // the path button's hypothetical (content) size — which a long path already
  // exceeds — so `min-width: 0` / `flex-shrink` never applied and the hover
  // action dropped onto a second line. The action floats over the row's right
  // edge instead of occupying a flex slot; right-click carries the full set.
  assert.match(styles, /\.project-entry-list li\.project-entry \{[^}]*flex-wrap: nowrap/);
  assert.match(styles, /\.project-change-list \.project-entry-action \{[^}]*position: absolute/);
  assert.match(projectFilePanel, /oncontextmenu=\{\(event\) => openContextMenu\(event, entry\.path, "file"\)\}/);
  // Only the attachment list may still wrap: its inline preview is a
  // `flex: 0 0 100%` sibling that has to take its own row.
  assert.match(styles, /\.project-attachment-list li\.project-entry \{ flex-wrap: wrap; \}/);
  // File tree rows use the same floating actions, so a name and its size get
  // the full row width instead of sitting beside a permanently reserved gutter.
  assert.match(styles, /\.file-tree-action \{[^}]*position: absolute/);
  assert.match(styles, /\.file-tree-row:hover \.file-tree-button,\s*\.file-tree-row:focus-within \.file-tree-button \{ padding-right/);
  // Git diff uses the GitHub (Primer) palette, not the app's AppKit status
  // colors: diff red/green is a convention readers already know, and macOS
  // green/red mixed to 14% produced tints that matched no platform. Light is
  // Primer's solid pastels; dark is Primer's alpha-over-canvas values.
  assert.match(styles, /--diff-add-line: #e6ffec;[\s\S]*--diff-del-word: #fdb8c0;/);
  assert.match(styles, /--diff-add-line: rgba\(46,160,67,0\.15\)/);
  assert.match(styles, /\.project-diff-preview \.d2h-code-linenumber\.d2h-ins[\s\S]*var\(--diff-add-num\)/);
  assert.match(styles, /\.project-diff-preview \{[\s\S]*position: relative;/);
  assert.match(styles, /\.artifact-panel \.project-diff-preview \{[\s\S]*position: relative;/);
  // Both dark paths (explicit and system) must carry the palette.
  assert.equal(styles.match(/--diff-add-line: rgba\(46,160,67,0\.15\)/g).length, 2);
  assert.doesNotMatch(styles, /\.d2h-(ins|del|code-line ins|code-line del) \{ background: color-mix/);
  // diff2html is themed through ITS OWN `--d2h-*` variables. Overriding only
  // `.d2h-ins` / `.d2h-del` left the library's built-in light palette showing
  // through in every theme — blue `@@` row, mustard `d2h-change` fill, white
  // gutter, and the old green/red ins/del BORDERS. Both the light and dark
  // variable sets must be remapped, and both must point at the theme-aware
  // `--diff-*` tokens so the palette holds whichever colour-scheme class
  // diff2html emits (it defaults to `light`).
  for (const nameOfVar of ["ins-bg-color", "ins-border-color", "ins-highlight-bg-color", "del-bg-color", "del-border-color", "del-highlight-bg-color", "change-ins-color", "change-del-color", "info-bg-color"]) {
    assert.match(styles, new RegExp(`--d2h-${nameOfVar}: var\\(--(diff|surface|separator)`), `light --d2h-${nameOfVar} must be remapped`);
    assert.match(styles, new RegExp(`--d2h-dark-${nameOfVar}: var\\(--(diff|surface|separator)`), `dark --d2h-${nameOfVar} must be remapped`);
  }
  // Narrow windows drop the SIDEBAR, never the panel's place in the grid. An
  // overlaid panel needs a z-index; that z-index makes it a stacking context,
  // which traps its own head (z-index 31, deliberately above the drag mask)
  // under the mask at z-index 30 and kills its close/refresh buttons — while
  // the chat header's action row, still laid out full-width underneath, paints
  // through the panel head.
  assert.match(styles, /@media \(max-width: 1000px\)[\s\S]*?\.chat-layout\.with-files \.chat-sidebar,\s*\.chat-layout\.with-files \.sidebar-resizer \{ display: none/);
  assert.doesNotMatch(styles, /\.chat-layout\.with-files \.file-panel \{[^}]*position: fixed/);
  // Exactly one tier may own the narrow `with-files` split; a second full
  // re-declaration is what previously left an empty panel track behind an
  // out-of-flow panel.
  assert.equal(styles.match(/\.chat-layout\.with-files \.chat-sidebar/g)?.length, 1);
});

test("project file tree expands in place and keeps its expansion state", () => {
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  const treeNode = read("./lib/projects/FileTreeNode.svelte");
  // Expansion is keyed per directory path so a reload cannot collapse the tree,
  // and each level is fetched lazily and cached in `dirs`.
  assert.match(filesStore, /expanded = \$state<Record<string, boolean>>/);
  assert.match(filesStore, /dirs = \$state<Record<string, TreeLevel>>/);
  assert.match(filesStore, /toggleDir\(path: string\)/);
  assert.match(filesStore, /async revealPath\(path: string\)/);
  // The node renders itself recursively rather than replacing the whole list.
  assert.match(treeNode, /import FileTreeNode from "\.\/FileTreeNode\.svelte"/);
  assert.match(treeNode, /<FileTreeNode[\s\S]*dirPath=\{entry\.path\}/);
  assert.match(styles, /\.file-tree-level/);
});

test("project file panel opens several files as tabs with a highlighted viewer", () => {
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  const codeViewer = read("./lib/projects/CodeViewer.svelte");
  assert.match(filesStore, /tabs = \$state<ArtifactTab\[\]>/);
  assert.match(filesStore, /closeTab\(id: string\)/);
  // Opening a file appends a tab; it must never replace the ones already open.
  assert.match(filesStore, /this\.#commitTabs\(\[\.\.\.this\.tabs, tab\]\)/);
  assert.match(projectFilePanel, /<CodeViewer/);
  assert.match(codeViewer, /highlightLines/);
  assert.match(codeViewer, /code-line-number/);
  assert.match(codeViewer, /codeViewerWrap/);
  assert.match(codeViewer, /codeViewerFind/);
  assert.match(styles, /\.project-viewer-tab/);
  assert.match(styles, /\.code-viewer-scroll\.wrap \.code-line-text/);
});

test("the Artifact Panel action bar is the same set of file actions on every file tab", () => {
  // PRD §3.38: one action bar per file tab - reveal, open-with-system, copy
  // path, download, insert as @-reference - provided by the container, not
  // re-implemented per viewer. Mini App tabs carry no path actions.
  assert.match(projectFilePanel, /revealInFinder\(activeTab\.path, "reveal"\)/);
  assert.match(projectFilePanel, /revealInFinder\(activeTab\.path, "open"\)/);
  assert.match(projectFilePanel, /copyPath\(activeTab\.path\)/);
  assert.match(projectFilePanel, /downloadProjectFile\(activeTab\.path\)/);
  assert.match(projectFilePanel, /mentionInChat\(activeTab\.path\)/);
  assert.match(projectFilePanel, /artifactDownload/);
  // The registry, not an inline if/else, picks the viewer for a file tab.
  assert.match(projectFilePanel, /matchViewer/);
});

test("the HTML preview iframe is sandboxed without same-origin access", () => {
  // PRD §3.38 Slice 1a: `sandbox="allow-scripts"` and NO `allow-same-origin` -
  // the preview is a static render, not a Mini App, so it gets no share of the
  // Mini App API channel and no same-origin access to the app (pitfall #6).
  const htmlPreview = read("./lib/artifacts/HtmlPreview.svelte");
  assert.match(htmlPreview, /sandbox="allow-scripts"/);
  // No sandbox attribute on the preview may grant same-origin access.
  assert.doesNotMatch(htmlPreview, /sandbox="[^"]*allow-same-origin/);
  assert.match(htmlPreview, /referrerpolicy="no-referrer"/);
  // The panel builds the iframe URL through the fixed-origin builder, never a
  // loopback or file URL.
  assert.match(projectFilePanel, /artifactPreviewUrl/);
  const api = read("./lib/api.ts");
  assert.match(api, /molibot-artifact:\/\/artifact\//);
});

test("every path that drops an artifact tab releases its blob URL", () => {
  // PRD §3.38 test seam #5. A session attachment's bytes are held as an object
  // URL; whoever removes the tab is the last owner, so a removal path that
  // forgets to revoke leaks the whole file for the life of the WebView - with
  // nothing visible in any console.
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");

  // Exactly one place creates one.
  assert.equal(filesStore.match(/URL\.createObjectURL/g)?.length, 1);

  // Closing one tab, closing all, reconnecting and disposing all release.
  assert.match(filesStore, /closeTab\(id: string\): void \{[\s\S]*?URL\.revokeObjectURL\(removed\.blobUrl\)/);
  // `closeAllTabs` closes only the mode on screen, so it revokes that subset
  // rather than every tab - the other surface stays open and must keep its own.
  assert.match(filesStore, /closeAllTabs\(\): void \{[\s\S]*?for \(const tab of closing\) \{\s*if \(tab\.blobUrl\) URL\.revokeObjectURL\(tab\.blobUrl\)/);
  assert.match(filesStore, /connect\([\s\S]*?this\.#revokeBlobUrls\(\)/);
  assert.match(filesStore, /dispose\(\): void \{[\s\S]*?this\.#revokeBlobUrls\(\)/);

  // Eviction at the tab cap is a removal too, and it is the one that was missed:
  // three inline `slice` calls each dropped the oldest tab without revoking.
  // Every open path now commits through the single capping helper.
  assert.match(filesStore, /#commitTabs\(next: ArtifactTab\[\]\): void \{[\s\S]*?URL\.revokeObjectURL\(tab\.blobUrl\)/);
  assert.equal(filesStore.match(/this\.#commitTabs\(\[\.\.\.this\.tabs, tab\]\)/g)?.length, 3);
  // No open path may cap the list inline again: the cap is read only by its
  // declaration and by the helper that owns eviction.
  assert.doesNotMatch(filesStore, /this\.tabs = next\.length > MAX_OPEN_TABS/);
  const helper = filesStore.slice(
    filesStore.indexOf("Commits a new tab list"),
    filesStore.indexOf("// ── Tree ──")
  );
  assert.ok(helper.length > 0);
  assert.equal(
    filesStore.match(/MAX_OPEN_TABS/g).length,
    helper.match(/MAX_OPEN_TABS/g).length + 1,
    "MAX_OPEN_TABS is referenced outside its declaration and the eviction helper"
  );
});

test("a Session HTML preview goes through the artifact route, not a pathless blob", () => {
  // A blob URL has no path, so every relative css/img reference in the page
  // resolves to nothing and a multi-file page renders as a bare skeleton. The
  // blob remains only as the fallback for transcripts the route declines.
  assert.match(projectFilePanel, /sessionArtifactToken\(\{ profileId, sessionId, projectId: projectId \|\| undefined \}\)/);
  assert.match(projectFilePanel, /artifactPreviewUrl\("session", token, activeTab\.path, locale, theme\)/);
  assert.match(projectFilePanel, /viewer === "html" && \(htmlPreviewSrc \|\| activeTab\.blobUrl\)/);
  assert.match(projectFilePanel, /src=\{htmlPreviewSrc \|\| activeTab\.blobUrl\}/);
  // One shared codec: a client-side re-implementation is how the encoder and
  // the service's decoder drift into a silent 404 (pitfall #7).
  const api = read("./lib/api.ts");
  assert.match(api, /export \{ encodeSessionArtifactToken as sessionArtifactToken \} from "@molibot\/shared\/artifactToken"/);
  assert.doesNotMatch(api, /function sessionArtifactToken/);
});

test("a session tab's path means the same thing every file action reads it", () => {
  // Pitfall #6 corollary: `path` is the artifact's location inside its own root
  // in both scopes. A session tab left with an empty path silently disables the
  // preview route and every path-bearing action.
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  assert.match(filesStore, /scope: "session", path: file\.local \?\? ""/);
});

test("Session file tabs carry the same actions as Project tabs, minus the @ insertion", () => {
  const sessionBranch = projectFilePanel.slice(projectFilePanel.indexOf('{:else if scope === "session"}'));
  for (const action of ["projectCopyPath", "artifactDownload", "projectRevealInFinder", "projectOpenExternally"]) {
    assert.match(sessionBranch, new RegExp(action), `${action} missing from the Session action bar`);
  }
  // `@` insertion is deliberately absent: the shared Runtime validates a file
  // reference against a Project root (PRD §3.35), which an ordinary Session has
  // no equivalent of. A button here would insert a reference that fails closed.
  assert.doesNotMatch(sessionBranch, /mentionInChat/);
  // Reveal/open resolve the absolute path service-side; the panel only ever
  // sends the workspace-relative path.
  assert.match(projectFilePanel, /revealDesktopSessionFile\(\s*endpoint,\s*\{ profileId, sessionId, projectId: projectId \|\| undefined, path \}/);
});

test("every Slice 2/3 viewer is reachable from both artifact scopes", () => {
  // PRD §3.38: one registry, two entrances. A viewer wired into only the
  // Project branch is exactly the fork the panel exists to prevent (pitfall #7),
  // and it is invisible to any test that looks at one scope only.
  const projectBranch = projectFilePanel.slice(
    projectFilePanel.indexOf('activeTab.kind === "file" && activeTab.preview'),
    projectFilePanel.indexOf('{:else if scope === "session"}')
  );
  const sessionBranch = projectFilePanel.slice(projectFilePanel.indexOf('{:else if scope === "session"}'));
  assert.ok(projectBranch.length > 0 && sessionBranch.length > 0);
  for (const component of ["HtmlPreview", "CsvTable", "SpreadsheetTable", "DocxPreview", "PptxPreview", "MarkdownPreview", "JsonTree", "SvgViewer", "SystemOpenCard"]) {
    assert.match(projectBranch, new RegExp(`<${component}\\b`), `${component} missing from project scope`);
    assert.match(sessionBranch, new RegExp(`<${component}\\b`), `${component} missing from session scope`);
  }
});

test("no file is a dead end: the system card always offers a way out", () => {
  // Legacy PPT and unknown binaries still use the system card; DOCX, PPTX and
  // XLS/XLSX are handled by dedicated viewers first.
  const card = read("./lib/artifacts/SystemOpenCard.svelte");
  assert.match(card, /projectOpenExternally/);
  assert.match(card, /projectRevealInFinder/);
  assert.match(card, /artifactDownload/);
  // Reveal/open are optional because a Session attachment has no host path;
  // download is not optional and must never be gated behind a callback check.
  assert.match(card, /onReveal\?:/);
  assert.match(card, /onOpenExternally\?:/);
  assert.match(card, /onDownload: \(\) => void;/);
  assert.doesNotMatch(card, /\{#if onDownload\}/);
});

test("SpreadsheetTable keeps workbook parsing lazy, bounded, and read-only", () => {
  const component = read("./lib/artifacts/SpreadsheetTable.svelte");
  const parser = read("./lib/artifacts/spreadsheet.ts");
  assert.match(component, /import \{[\s\S]*parseSpreadsheet/);
  assert.match(parser, /await import\("xlsx"\)/);
  assert.match(parser, /SPREADSHEET_MAX_ROWS = 5_000/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /position: sticky/);
  assert.doesNotMatch(component, /contenteditable/);
});

test("DocxPreview keeps conversion lazy, sanitized, and read-only", () => {
  const component = read("./lib/artifacts/DocxPreview.svelte");
  const parser = read("./lib/artifacts/docx.ts");
  assert.match(component, /import MarkdownPreview/);
  assert.match(parser, /await import\("mammoth\/mammoth\.browser\.js"\)/);
  assert.match(parser, /convertToMarkdown/);
  assert.match(parser, /externalFileAccess: false/);
  assert.doesNotMatch(component, /\{@html/);
  assert.doesNotMatch(component, /contenteditable/);
});

test("PptxPreview keeps slide rendering lazy, bounded, and read-only", () => {
  const component = read("./lib/artifacts/PptxPreview.svelte");
  const parser = read("./lib/artifacts/pptx.ts");
  assert.match(component, /await import\("@silurus\/ooxml\/pptx"\)/);
  assert.match(component, /new PptxScrollViewer/);
  assert.match(component, /enableTextSelection: true/);
  assert.match(component, /enableHyperlinks: false/);
  assert.match(component, /maxZipEntryBytes: PPTX_MAX_BYTES/);
  assert.match(component, /resourceLimits:/);
  assert.match(component, /if \(loadFailure\)/);
  assert.match(component, /next\.destroy\(\)/);
  assert.match(parser, /PPTX_MAX_BYTES = 50 \* 1024 \* 1024/);
  assert.match(parser, /bytes\.slice\(\)\.buffer/);
  assert.doesNotMatch(component, /contenteditable/);
});

test("the source toggle is a registry fact and is offered in both scopes", () => {
  // Pitfall #7 corollary: which viewers have a rendered/source toggle belongs to
  // the registry, so the two scope toolbars cannot drift apart.
  const registry = read("./lib/artifacts/viewerRegistry.ts");
  assert.match(registry, /export function hasSourceToggle/);
  assert.match(projectFilePanel, /hasSourceToggle\(viewer\)/);
  // Both toolbars read the same derived flag and the same shared state.
  assert.equal(projectFilePanel.match(/sourceToggleAvailable && activeTab\.kind === "file"/g)?.length, 2);
  assert.match(projectFilePanel, /artifactShowSource/);
  // The toggle resets per tab; a sticky source view would carry into the next file.
  assert.match(projectFilePanel, /store\.activeTabId;[\s\S]*?showSource = false/);
});

test("the session loader decodes text for exactly the viewers that render it", () => {
  // The panel and the loader must dispatch on one shared rule, or a new viewer
  // renders an empty tab because nothing decoded its bytes.
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  const registry = read("./lib/artifacts/viewerRegistry.ts");
  assert.match(registry, /export function needsTextContent/);
  assert.match(filesStore, /viewer === "html" \|\| needsTextContent\(viewer\)/);
  // No hand-maintained exclusion list may stand in for the registry rule.
  assert.doesNotMatch(filesStore, /viewer !== "media" && viewer !== "system"/);
});

test("mermaid loads lazily and cannot execute diagram-authored script", () => {
  // PRD §3.38 Slice 3: a ~2 MB library must never enter the initial bundle, and
  // diagram text is agent-generated content.
  const preview = read("./lib/artifacts/MarkdownPreview.svelte");
  assert.match(preview, /await import\("mermaid"\)/);
  assert.doesNotMatch(preview, /^import mermaid from/m);
  assert.match(preview, /securityLevel: "strict"/);
  // The load is gated on the document actually containing a diagram.
  assert.match(preview, /if \(showSource \|\| !diagramsPresent\) return;/);
  // A late render must not replace a newer document's diagrams (pitfall #3).
  assert.match(preview, /if \(token === renderToken\) diagrams = next;/);
  // Every mermaid failure degrades to the diagram's source, never a blank tab.
  assert.match(preview, /artifactMermaidFailed/);
});

test("the Markdown viewer reuses the transcript renderer and its click behaviour", () => {
  // Pitfall #7: a second markdown pipeline is how one surface silently loses
  // syntax highlighting, sanitization or the copy-code button.
  const preview = read("./lib/artifacts/MarkdownPreview.svelte");
  assert.match(preview, /import \{ renderMarkdown \} from "\.\.\/markdown"/);
  assert.doesNotMatch(preview, /^\s*import .* from "marked"/m);
  assert.doesNotMatch(preview, /^\s*import .* from "dompurify"/mi);
  assert.match(preview, /use:markdownBody=\{copy\}/);
});

test("the JSON viewer is source-first and keeps opt-in trees bounded", () => {
  // Pitfall #8: a character-length ceiling under-counts CJK ~3x, so a document
  // well over the render budget would still try to build a tree.
  const jsonTree = read("./lib/artifacts/jsonTree.ts");
  assert.match(jsonTree, /new TextEncoder\(\)\.encode/);
  assert.match(jsonTree, /status: "too-large"/);
  assert.match(jsonTree, /JSON_TREE_MAX_ROWS/);
  assert.match(jsonTree, /status: "too-many-rows"/);
  assert.match(jsonTree, /status: "invalid"/);
  assert.match(jsonTree, /replaceAll\("\/", "~1"\)/);
  // Opening a file does not parse it; the user explicitly opts into the tree.
  const component = read("./lib/artifacts/JsonTree.svelte");
  assert.match(component, /import CodeViewer from "\.\.\/projects\/CodeViewer\.svelte"/);
  assert.match(component, /let treeMode = \$state\(false\)/);
  assert.match(component, /artifactJsonTree/);
  assert.match(component, /artifactJsonSource/);
  assert.match(component, /<CodeViewer/);
  assert.doesNotMatch(component, /const tree = \$derived\(buildJsonTree\(content\)\)/);
  assert.match(component, /artifactJsonTooLarge/);
  assert.match(component, /artifactJsonTooManyRows/);
  assert.match(component, /artifactJsonInvalid/);
});

test("the SVG viewer renders through an img element, never inlined markup", () => {
  // An `<img>` document cannot run scripts or fetch external resources; inlining
  // agent-generated SVG markup would.
  const svgViewer = read("./lib/artifacts/SvgViewer.svelte");
  assert.match(svgViewer, /<img class="svg-viewer-image"/);
  assert.doesNotMatch(svgViewer, /\{@html/);
});

test("CsvTable keys each block by index, never by cell value (issue #31 bug 1)", () => {
  // Svelte 5 throws `each_key_duplicate` in production (not only dev) on a
  // repeated key. A row like `yes,yes,yes,yes`, two identical rows, or a
  // repeated column name blanked the tab when keys were the cell/row/header
  // value. Index keys are safe: a CSV is a static list, so appending rows only
  // adds new indices and a reload updates each index in place.
  const csv = read("./lib/artifacts/CsvTable.svelte");
  assert.doesNotMatch(csv, /row\.join/);
  assert.doesNotMatch(csv, /as header \(header\)/);
  assert.doesNotMatch(csv, /as row \(row/);
  assert.doesNotMatch(csv, /as cell \(cell\)/);
  assert.match(csv, /as header, \w+ \(\w+\)/);
  assert.match(csv, /as row, \w+ \(\w+\)/);
  assert.match(csv, /as cell, \w+ \(\w+\)/);
  // The raw-NUL byte that made git treat the file as binary is gone.
  assert.equal(csv.includes("\0"), false);
});

test("source/raw views reuse CodeViewer for line numbers and consistency (issue #31 bug 4)", () => {
  // Markdown source, CSV raw and SVG source all used a bare <pre> with no line
  // numbers; they now go through the same CodeViewer as every other text file.
  for (const file of [
    "./lib/artifacts/MarkdownPreview.svelte",
    "./lib/artifacts/CsvTable.svelte",
    "./lib/artifacts/SvgViewer.svelte"
  ]) {
    const src = read(file);
    assert.match(src, /import CodeViewer from "\.\.\/projects\/CodeViewer\.svelte"/, `${file} must import CodeViewer`);
    assert.match(src, /<CodeViewer /, `${file} must render CodeViewer`);
  }
  assert.doesNotMatch(read("./lib/artifacts/CsvTable.svelte"), /class="csv-raw"/);
  assert.doesNotMatch(read("./lib/artifacts/MarkdownPreview.svelte"), /class="markdown-preview-raw"/);
  assert.doesNotMatch(read("./lib/artifacts/SvgViewer.svelte"), /class="svg-viewer-source"/);
  // MarkdownPreview and CsvTable now take a `name` prop for CodeViewer's path.
  assert.match(read("./lib/artifacts/MarkdownPreview.svelte"), /name: string/);
  assert.match(read("./lib/artifacts/CsvTable.svelte"), /name: string/);
  assert.match(projectFilePanel, /<MarkdownPreview[^>]*name=\{activeTab\.name\}/);
  assert.match(projectFilePanel, /<CsvTable[^>]*name=\{activeTab\.name\}/);
});

test("CSP img-src allows the loopback service so images stream (issue #31 bug 2)", () => {
  // media-src already allowed http://127.0.0.1:* but img-src did not, so
  // <img src={serviceUrl}> was CSP-blocked while <video>/<audio> worked - which
  // is why only images were reported broken. The raw file route serves images
  // over http://127.0.0.1:<port>; the CSP is fixed at build time so the port is
  // a wildcard. frame-src stays on the custom scheme (the test above) because
  // Mini Apps have one; images do not.
  const csp = tauriConfig.app.security.csp;
  assert.match(csp, /img-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  assert.match(csp, /img-src[^;]*http:\/\/localhost:\*/);
});

test("every new artifact copy key exists in both locales", () => {
  const keys = [
    "artifactShowSource",
    "artifactExpandAll",
    "artifactCollapseAll",
    "artifactJsonRoot",
    "artifactJsonInvalid",
    "artifactJsonTooLarge",
    "artifactMermaidFailed",
    "artifactSpreadsheetLoading",
    "artifactSpreadsheetFailed",
    "artifactSpreadsheetEmpty",
    "artifactSpreadsheetTruncated",
    "artifactSpreadsheetSheet",
    "artifactSpreadsheetColumn",
    "artifactSpreadsheetRows",
    "artifactDocxLoading",
    "artifactDocxFailed",
    "artifactDocxEmpty",
    "artifactDocxReadOnly",
    "artifactDocxWarnings",
    "artifactPptxLoading",
    "artifactPptxFailed",
    "artifactPptxEmpty",
    "artifactPptxReadOnly",
    "artifactPptxSlides",
    "artifactPptxWarnings",
    "artifactUnsupportedFormat"
  ];
  for (const key of keys) {
    assert.equal(i18n.match(new RegExp(`\\b${key}:`, "g"))?.length, 2, `${key} must exist in zh and en`);
  }
});

test("project file search covers names and contents and reveals the hit", () => {
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  const searchPanel = read("./lib/projects/FileSearchPanel.svelte");
  assert.match(filesStore, /searchDesktopProjectFiles/);
  assert.match(filesStore, /searchMode = \$state<SearchMode>/);
  // Every search carries its own generation and abort so a slow response cannot
  // replace the results of a newer query.
  assert.match(filesStore, /searchGeneration !== this\.#searchGeneration/);
  assert.match(filesStore, /#searchAbort/);
  assert.match(searchPanel, /store\.revealPath\(hit\.path\)/);
  assert.match(searchPanel, /openFile\(hit\.path, \{ revealLine: hit\.line \}\)/);
  assert.match(styles, /\.file-search-results/);
});

test("project files can be referenced into the chat composer", () => {
  const bridge = read("./lib/projects/composerBridge.ts");
  const projectChat = read("./lib/projects/ProjectChat.svelte");
  const searchPanel = read("./lib/projects/FileSearchPanel.svelte");
  const treeNode = read("./lib/projects/FileTreeNode.svelte");
  // The panel and the composer are siblings under ChatView, so the bridge must
  // be a plain store: ProjectChat is a legacy `$:` surface and cannot track
  // runes state owned by another module.
  assert.match(bridge, /writable<ComposerInsertion \| null>/);
  assert.match(projectChat, /\$: applyComposerInsertion\(\$composerInsertion\)/);
  // A monotonic id keeps a re-run of the reactive block from re-appending.
  assert.match(projectChat, /request\.id === appliedInsertionId/);
  assert.match(treeNode, /onMention\(entry\.path\)/);
  assert.match(searchPanel, /requestComposerInsertion\(group\.path, entry\.line\)/);
  assert.match(projectFilePanel, /requestComposerInsertion\(path, line\)/);
});

test("agent-written files are marked in the tree and scope the Changes tab", () => {
  const touches = read("./lib/projects/sessionFileTouches.ts");
  const chatStore = read("./lib/projects/projectChatStore.svelte.ts");
  const treeNode = read("./lib/projects/FileTreeNode.svelte");
  // Touches come from structured activity paths, never from parsing the label.
  assert.match(touches, /activity\.paths\?\.length/);
  assert.match(touches, /if \(activity\.mutates\) written\.add\(path\)/);
  // The running turn's activities count before they land in the transcript.
  assert.match(touches, /liveActivities/);
  assert.match(chatStore, /readonly sessionFiles = toStore<SessionFileTouches>/);
  assert.match(view, /touches=\{projectPaneActive \? \$sessionFileTouches : EMPTY_TOUCHES\}/);
  assert.match(treeNode, /class:touched=\{touchedPaths\.has\(entry\.path\)\}/);
  assert.doesNotMatch(treeNode, /file-tree-touched/);
  assert.match(projectFilePanel, /touches\.written\.has\(entry\.path\)/);
  assert.match(projectFilePanel, /changeScope === "session" \? sessionEntries : gitEntries/);
  assert.match(styles, /\.project-change-scope/);
  assert.match(styles, /\.file-tree-row\.touched \.file-tree-name \{ color: var\(--warning-text\)/);
  assert.match(styles, /\.file-tree-size \{[^}]*white-space: nowrap/);
});

test("project file panel follows file changes live and stays resizable", () => {
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  assert.match(filesStore, /watchDesktopProjectFiles/);
  assert.match(filesStore, /applyChanges\(batch: DesktopProjectChangeBatch\)/);
  // An overflow batch reloads wholesale instead of enumerating paths.
  assert.match(filesStore, /if \(batch\.overflow\)/);
  assert.match(view, /class="files-resizer"/);
  assert.match(view, /molibot-desktop-files-width/);
  assert.match(styles, /\.chat-layout\.with-files \{[^}]*grid-template-columns:[^}]*var\(--files-w/s);
  assert.match(styles, /\.files-resizer/);
  // Opening the file panel must never squeeze the transcript below its floor:
  // the grid gives the sidebar and the panel back their width first, and
  // ChatView clamps the STORED widths to the same budget so the absolutely
  // positioned drag handles stay on the real track edges.
  assert.match(styles, /\.chat-layout\.with-files \{[^}]*minmax\(var\(--chat-min-w\), 1fr\)[^}]*minmax\(var\(--files-min-w\)/s);
  assert.match(view, /\$: filesMaxWidth =[\s\S]*viewportWidth - sidebarWidth - CHAT_MIN[\s\S]*viewportWidth - CHAT_MIN_NARROW/);
  assert.match(view, /\$: effectiveFilesWidth = Math\.min\(filesWidth, filesMaxWidth\)/);
  assert.match(view, /--sidebar-w:\$\{effectiveSidebarWidth\}px; --files-w:\$\{effectiveFilesWidth\}px/);
  assert.match(view, /bind:innerWidth=\{viewportWidth\}/);
});

test("selectProjectSession discards stale transcript responses when switching sessions", () => {
  // Project and Session request generations prevent stale list/transcript
  // responses from taking ownership after the user changes selection.
  const projectsStore = readFileSync(new URL("./lib/stores/projects.svelte.ts", import.meta.url), "utf8");
  assert.match(projectsStore, /generation !== projectSelectionGeneration/);
  assert.match(projectsStore, /generation !== sessionSelectionGeneration/);
  assert.match(projectsStore, /projectsStore\.selectedProjectId !== projectId/);
});

test("selected project sessions keep the shared conversation visible in the detail pane", () => {
  assert.match(styles, /\.project-chat\s*\{[^}]*flex:\s*1;/s);
  assert.match(styles, /\.project-chat\s*\{[^}]*width:\s*100%;/s);
});

test("project sessions support rename and delete from the session list", () => {
  const projectList = readFileSync(new URL("./lib/projects/ProjectList.svelte", import.meta.url), "utf8");
  const projectsStore = readFileSync(new URL("./lib/stores/projects.svelte.ts", import.meta.url), "utf8");
  // The shared Chat ConversationRow owns rename and delete UI for both pages.
  assert.match(projectList, /<ConversationRow/);
  assert.match(projectList, /onRename=\{\(title\) => void renameProjectSession/);
  assert.match(projectList, /onDelete=\{\(\) => void removeProjectSession/);
  assert.doesNotMatch(projectList, /conversation-editor|conversation-popover|deleteAnchor/);
  // The store wires the new operations through the project-scoped session API.
  assert.match(projectsStore, /renameProjectSession/);
  assert.match(projectsStore, /removeProjectSession/);
  assert.match(projectsStore, /renameDesktopProjectSession/);
  assert.match(projectsStore, /deleteDesktopProjectSession/);
});

test("projects expose a guarded remove action without deleting the working directory", () => {
  const projectTree = readFileSync(new URL("./lib/projects/ProjectTree.svelte", import.meta.url), "utf8");
  const groupHeader = readFileSync(new URL("./lib/chat/GroupHeader.svelte", import.meta.url), "utf8");
  const projectsStore = readFileSync(new URL("./lib/stores/projects.svelte.ts", import.meta.url), "utf8");
  assert.match(groupHeader, /ph-dots-three/);
  assert.match(projectTree, /copy\.renameProject/);
  assert.match(projectTree, /renameProject\(renameProjectId, renameProjectName\)/);
  assert.doesNotMatch(groupHeader, /conv-group-remove|ph-trash/);
  assert.match(projectTree, /copy\.projectDeleteNotice/);
  assert.match(projectTree, /copy\.projectDeleteSessions/);
  assert.match(projectTree, /removeProject\(deleteProjectId, deleteProjectSessions\)/);
  assert.match(projectsStore, /deleteDesktopProject\(projectsStore\.endpoint, projectId, removeSessions\)/);
});

test("project session delete uses Chat's shared row menu", () => {
  const projectList = readFileSync(new URL("./lib/projects/ProjectList.svelte", import.meta.url), "utf8");
  assert.match(projectList, /<ConversationRow/);
  assert.doesNotMatch(projectList, /conversation-popover|deleteAnchor|requestDelete/);
});

test("ProjectsView loads project state from a single reactive trigger", () => {
  // The first-load race that left the auto-selected session's messages empty
  // came from onMount + the $: reactive both calling loadProjects. Only the $:
  // trigger remains, so the initial fetch no longer doubles up.
  const projectsView = readFileSync(new URL("./lib/projects/ProjectsView.svelte", import.meta.url), "utf8");
  assert.match(projectsView, /let loadedEndpoint = ""/);
  assert.match(projectsView, /\$: if \(endpoint && endpoint !== loadedEndpoint\)/);
  assert.doesNotMatch(projectsView, /onMount\s*\(/);
  assert.doesNotMatch(projectsView, /import\s*\{[^}]*onMount/);
});

test("usage and trace pages provide full observability dashboards", () => {
  assert.match(sections.usage, /untrack\(\(\) => \{[\s\S]*endpoint !== usageStore\.endpoint[\s\S]*loadUsage\(endpoint\)/);
  assert.match(sections.trace, /untrack\(\(\) => \{[\s\S]*endpoint !== traceStore\.endpoint[\s\S]*loadTrace\(endpoint\)/);
  assert.doesNotMatch(sections.usage, /session\.endpoint !== usageStore\.endpoint/);
  assert.doesNotMatch(sections.trace, /session\.endpoint !== traceStore\.endpoint/);
  assert.match(sections.usage, /class="observatory-filter-toolbar"/);
  assert.match(sections.usage, /class="observatory-filter-headline"/);
  assert.match(sections.usage, /class="observatory-filter-fields usage-filter-fields"/);
  assert.match(sections.usage, /class="icon-button observatory-refresh-button"/);
  assert.match(sections.usage, /class="tertiary-button observatory-reset-button"/);
  assert.doesNotMatch(sections.usage, /class="observatory-filter-head"/);
  assert.match(sections.usage, /usageStore\.query\.modelId/);
  assert.match(sections.usage, /usage\.rankings\[rankingView\]/);
  assert.match(sections.usage, /class="observatory-table"/);
  assert.match(sections.usage, /updateUsageQuery\(\{ page:/);
  assert.match(sections.usage, /class="trend-line trend-line-token" d=\{tokenLine\}/);
  assert.match(sections.usage, /class="donut-seg"/);
  assert.match(sections.usage, /class="window-bar-track"/);
  assert.match(sections.trace, /class="observatory-filter-toolbar"/);
  assert.match(sections.trace, /class="observatory-filter-headline"/);
  assert.match(sections.trace, /<details class="observatory-advanced-filters">/);
  assert.match(sections.trace, /class="observatory-filter-fields trace-advanced-filter-fields"/);
  assert.match(sections.trace, /advancedFilterCount/);
  assert.doesNotMatch(sections.trace, /class="observatory-filter-head"/);
  assert.match(sections.trace, /trace\.rankings\[rankingView\]/);
  assert.match(sections.trace, /trace\.facts\.items/);
  assert.match(sections.trace, /class="hbar-fill"[\s\S]*percentOf\(item\.value, activityMax\)/);
  assert.match(sections.trace, /each outcomeSegments as segment/);
  assert.match(charts, /function trendLinePath\(/);
  assert.match(charts, /function donutSegments\(/);
  assert.match(styles, /--chart-blue:/);
  assert.match(styles, /\.observatory-table\s*\{/);
  assert.match(styles, /\.observatory-mobile-list\s*\{/);
  assert.match(styles, /\.observatory-filter-card\s*\{[^}]*margin-bottom:\s*24px/);
  assert.match(styles, /\.observatory-filter-headline\s*\{[^}]*min-width:\s*0/);
  assert.match(styles, /\.observatory-field\s*>\s*:is\(\.select-control,\s*\.search-field\)\s*\{[^}]*width:\s*100%/);
  assert.match(styles, /\.observatory-field\s*>\s*\.search-field input\s*\{[^}]*border:\s*0/);
  assert.match(styles, /\.observatory-field\s*>\s*\.search-field input:focus-visible\s*\{[^}]*box-shadow:\s*none/);
  assert.match(styles, /\.observatory-advanced-filters\s*>\s*summary\s*\{[^}]*background:\s*transparent/);
});

test("Desktop Trace exposes live, stuck, and orphan run controls", () => {
  const traceSection = read("./lib/settings/TraceSection.svelte");
  assert.match(traceSection, /loadDesktopActiveRuns/);
  assert.match(traceSection, /stopDesktopActiveRun/);
  assert.match(traceSection, /traceRunStuck/);
  assert.match(traceSection, /traceClearOrphan/);
  assert.match(traceSection, /new ActivityScheduler\(/);
  assert.match(traceSection, /interactiveActivityPolicy/);
  assert.doesNotMatch(traceSection, /setInterval\(/);
  assert.doesNotMatch(traceSection, /onMount\(\(\) => \{\s*void refreshActiveRuns\(\)/);
  assert.match(activeRunsRoute, /snapshotAllRuntimeRuns\(\)/);
  assert.match(activeRunsRoute, /abortRuntimeRun/);
});

test("Desktop Trace delete uses the shared alert dialog before submitting", () => {
  const traceSection = read("./lib/settings/TraceSection.svelte");
  assert.match(traceSection, /let pendingActiveRun = \$state<DesktopActiveRunItem \| null>\(null\)/);
  assert.match(traceSection, /pendingActiveRun = item/);
  assert.match(traceSection, /<AlertDialog/);
  assert.match(sections.tasks, /DirectManipulation/);
  assert.match(sections.tasks, /onpointercancel=\{cancelDetailDrag\}/);
  assert.doesNotMatch(sections.tasks, /detailDragStartX/);
  assert.doesNotMatch(sections.tasks, /detailDragOffset > 96/);
  assert.match(traceSection, /busy=\{Boolean\(activeRunBusy\)\}/);
  assert.match(traceSection, /stopDesktopActiveRun\(session\.endpoint, selected\.runId\)/);
  assert.doesNotMatch(traceSection, /activeRunDialog/);
  assert.doesNotMatch(traceSection, /window\.confirm\(/);
});

test("Desktop Trace keeps the dashboard above active-run records", () => {
  const traceSection = read("./lib/settings/TraceSection.svelte");
  const dashboard = traceSection.indexOf('class="chart-kpi-grid"');
  const activeRuns = traceSection.indexOf('<p class="settings-group-title">{session.text.traceActiveRuns}</p>');
  assert.ok(dashboard >= 0 && activeRuns > dashboard);
});

test("Desktop Stop waits for server finalization and reloads preserved output", () => {
  assert.match(streamStopRoute, /await waitForWebRunnerIdle/);
  const stopRequest = conversationController.indexOf("const stopped = await stopDesktopChat");
  const detach = conversationController.indexOf("if (this.sending) this.abort?.abort()", stopRequest);
  const reload = conversationController.indexOf("await this.host.reload(sessionId)", detach);
  assert.ok(stopRequest >= 0 && detach > stopRequest && reload > detach);
  assert.doesNotMatch(conversationController, /this\.abort\?\.abort\(\);\s*try \{\s*const stopped = await stopDesktopChat/);
});

test("settings navigation keeps the current product taxonomy and entity editors open as dialogs", () => {
  assert.match(app, /id: "general", sections: \["general"\]/);
  assert.match(app, /id: "models", sections: \["models", "providers"\]/);
  assert.match(app, /id: "assistant", sections: \["agents", "skills", "memory"\]/);
  assert.match(app, /id: "tools", sections: \["mcp", "openConnector", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate", "hostBash"\]/);
  assert.match(app, /id: "channels", sections: \["profiles", "channels"\]/);
  assert.match(app, /id: "activity", sections: \["runHistory", "usage", "trace", "logs"\]/);
  assert.match(app, /id: "system", sections: \["runtimeEnv", "sandbox", "plugins", "diagnostics"\]/);
  for (const [formId, key] of Object.entries(formSectionKey)) {
    assert.match(sections[key], new RegExp(`id="desktop-${formId}-form"[^>]*aria-label=`));
    assert.match(styles, new RegExp(`#desktop-${formId}-form`));
  }
  assert.match(sections.agents, /class="entity-editor-head"/);
  assert.match(sections.agents, /class="entity-editor-foot"/);
  assert.match(styles, /\.entity-editor-foot\s*\{[^}]*bottom:\s*0/s);
  assert.match(app, /label: sectionLabel\(item\.id, text\)/);
  assert.match(app, /<PageHeader title=\{sectionLabel\(activeSection, text\)\}/);
  assert.match(app, /\{text\[preview\.labelKey\]\}/);
});

test("image and video task details use the shared Dialog primitive", () => {
  for (const section of [sections.image, sections.video]) {
    assert.match(section, /import Dialog from "\.\.\/components\/ui\/Dialog\.svelte"/);
    assert.match(section, /<Dialog[\s\S]*contentClass="modal-card"/);
    assert.match(section, /onOpenChange=\{\(next\) => \{ if \(!next\) closeMediaTaskDetail\(\); \}\}/);
    assert.doesNotMatch(section, /onMediaTaskOverlayKeydown/);
    assert.doesNotMatch(section, /<div class="modal-overlay" role="dialog"/);
  }
});

test("Memory Center keeps overview, topics, and all memories as separate product tabs", () => {
  assert.match(sections.memory, /type MemoryCenterTab = "overview" \| "topics" \| "all"/);
  assert.match(sections.memory, /data-memory-view="overview"/);
  assert.match(sections.memory, /data-memory-view="topics"/);
  assert.match(sections.memory, /data-memory-view="all"/);
  assert.match(sections.memory, /session\.text\.memoryUnderstandingTitle/);
  assert.match(sections.memory, /class="memory-topic-workspace"/);
  assert.match(sections.memory, /class="memory-all-view"/);
  assert.match(sections.memory, /import Dialog from "\.\.\/components\/ui\/Dialog\.svelte"/);
  assert.match(sections.memory, /import IosSwitch from "\.\.\/components\/ui\/IosSwitch\.svelte"/);
  assert.match(sections.memory, /<Dialog[\s\S]*labelledBy="memory-candidate-edit-title"/);
  assert.match(sections.memory, /<Dialog[\s\S]*labelledBy="memory-edit-title"/);
  assert.match(sections.memory, /<Dialog[\s\S]*labelledBy="memory-source-preview-title"/);
  assert.match(sections.memory, /<Dialog[\s\S]*labelledBy="memory-advanced-title"/);
  assert.match(sections.memory, /busy=\{Boolean\(memoryStore\.busyAction\)\}/);
  assert.doesNotMatch(sections.memory, /modal-overlay|aria-modal="true"|onWindowKeydown|class="switch"/);
  assert.doesNotMatch(sections.memory, /activeTab === "advanced"/);
});

test("AI provider configuration is an inline workbench, not a modal, and separates provider and model concepts", () => {
  // Provider identity, credentials, and models are edited in place next to the
  // rail; only model-level editing and model discovery stay in dialogs.
  assert.match(sections.providers, /class="provider-workbench"/);
  assert.match(sections.providers, /<aside class="provider-rail">/);
  assert.match(sections.providers, /<section class="provider-pane"/);
  assert.doesNotMatch(sections.providers, /contentClass="provider-modal-card"/);
  assert.doesNotMatch(sections.providers, /provider-modal-overlay/);
  assert.match(sections.providers, /<Dialog[\s\S]*labelledBy="provider-model-edit-title"/);
  assert.match(sections.providers, /<Dialog[\s\S]*labelledBy="provider-model-discovery-title"/);
  assert.match(sections.providers, /<AlertDialog[\s\S]*contentClass="confirm-dialog"/);
  assert.match(sections.providers, /session\.text\.providerSelfHostedTitle/);
  assert.match(sections.providers, /session\.text\.providerModelsSectionTitle/);
  assert.match(sections.providers, /class="provider-model-groups"/);
  assert.match(sections.providers, /class="provider-model-row"/);
  assert.match(sections.providers, /providerEdit\.defaultModel === previousId[\s\S]*defaultModel: draft\.id/);
  assert.doesNotMatch(sections.providers, /thinkingLevelMap|model\.supportsThinking|DESKTOP_THINKING_LEVELS/);
  // The pane save bar tracks the provider draft; the settings footbar stays
  // gated on the provider globals (mode/default) — two separate dirty flags.
  assert.match(sections.providers, /\{#if editorIsDirty \|\| editor\.isNew\}[\s\S]{0,200}class="provider-pane-foot"/);
  assert.match(sections.providers, /\{#if providersStore\.globalsDirty\}[\s\S]{0,200}class="settings-footbar"/);
  assert.match(styles, /\.provider-workbench\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.provider-workbench\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  // A long provider response must scroll inside the discovery dialog instead of
  // compressing every row to fit one screen.
  assert.match(styles, /\.provider-model-discovery-body\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.provider-model-discovery-body > \.provider-model-groups\s*\{[^}]*overflow-y:\s*auto;/s);
  // A model connection check belongs to the model dialog that initiated it.
  // Its success/failure sits immediately left of the test button; it must not
  // leak through the provider pane's generic action message behind the modal.
  assert.match(sections.providers, /let modelVerificationMessage = \$state\(""\)/);
  assert.match(sections.providers, /class="provider-modal-foot-leading"[\s\S]{0,500}modelVerificationMessage[\s\S]{0,500}verifyModelEditorConnection/);
  assert.match(styles, /\.provider-modal-foot-leading\s*\{[^}]*margin-right:\s*auto;/s);
  assert.match(sections.providers, /\{#if providersStore\.actionMessage && !modelEditorDraft\}[\s\S]{0,180}provider-pane-message/);
  const verifyProviderModelSource = providersStore.slice(
    providersStore.indexOf("export async function verifyProviderModel"),
    providersStore.indexOf("\nexport ", providersStore.indexOf("export async function verifyProviderModel") + 1)
  );
  assert.doesNotMatch(verifyProviderModelSource, /providersStore\.actionMessage|providersStore\.actionFailed/);
});

test("switching providers never silently drops an unsaved draft", () => {
  assert.match(providersStore, /export function providerEditDirty\(\)/);
  assert.match(providersStore, /export function markProviderEditPristine\(\)/);
  // Saving keeps the inline pane on the provider being edited instead of closing it.
  assert.match(providersStore, /reopenProviderEdit\(draft\.id, isBuiltin\)/);
  assert.match(sections.providers, /if \(editorIsDirty\) \{[\s\S]{0,120}pendingSwitchProviderId = id;/);
  assert.match(sections.providers, /labelledBy="provider-switch-title"/);
  assert.match(sections.providers, /session\.text\.providerSwitchUnsavedHint/);
});

test("built-in provider configuration reuses saved Web settings without polluting the custom tab", () => {
  assert.match(sections.providers, /beginBuiltinProviderEdit/);
  assert.match(sections.providers, /builtinProviderIds/);
  assert.match(sections.providers, /customProviders\s*\.filter\(\(provider\) => !builtinProviderIds\.has\(provider\.id\)\)/);
  assert.doesNotMatch(sections.providers, /return item\.kind === "builtin" \|\| item\.provider\.enabled/);
  // Built-in providers hide protocol/base-URL fields the built-in transport owns.
  assert.match(sections.providers, /\{#if !editor\.isBuiltin\}[\s\S]{0,400}session\.text\.providerBaseUrlLabel/);
  assert.match(sections.providers, /editor\.isBuiltin \? "Pi" : providerProtocolLabel\(editor\.protocol\)/);
  assert.match(styles, /\.provider-pane\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(styles, /\.provider-pane-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.settings-content \.settings-footbar\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*0;/s);
  assert.match(styles, /\.settings-content \.settings-scroll:has\(\.settings-footbar\)\s*\{[^}]*padding-bottom:/s);
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

test("Geist CSS references only defined variables and keyframes", () => {
  const css = allStyleSources.join("\n");
  const definedVariables = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const runtimeVariables = new Set([
    "--sidebar-w", "--detail-drag", "--kpi-accent", "--dot", "--c", "--badge-color",
    "--file-color", "--agent-city-height", "--size", "--conversation-row-overlay",
    "--bits-select-anchor-width", "--bits-select-content-transform-origin"
  ]);
  const undefinedVariables = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)]
    .map((match) => match[1])
    .filter((name) => !definedVariables.has(name) && !runtimeVariables.has(name));
  assert.deepEqual([...new Set(undefinedVariables)], []);

  const keyframes = new Set([...css.matchAll(/@keyframes\s+([a-z0-9_-]+)/gi)].map((match) => match[1]));
  const animationNames = [...css.matchAll(/(?:^|[;{])\s*animation(?:-name)?\s*:\s*([a-z0-9_-]+)/gim)]
    .map((match) => match[1])
    .filter((name) => name !== "none");
  assert.deepEqual([...new Set(animationNames.filter((name) => !keyframes.has(name)))], []);
});

test("desktop document language follows the active locale", () => {
  assert.match(app, /document\.documentElement\.lang\s*=\s*locale/);
});

test("Geist functional typography keeps an 11px floor outside Agent City artwork", () => {
  const violations = [];
  const artworkSelectors = [
    ".agent-city-landmark-label span", ".agent-city-agent-copy strong", ".agent-city-agent-copy small",
    ".agent-city-fallback-landmark span", ".agent-city-fallback-building header small",
    ".agent-city-fallback-floor strong", ".agent-city-fallback-floor small", ".agent-city-fallback-floor em",
    ".agent-city-fallback-vacant"
  ];
  for (const css of allStyleSources) {
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (artworkSelectors.some((allowed) => selector.split(",").some((part) => part.trim() === allowed))) continue;
      for (const size of rule[2].matchAll(/font-size\s*:\s*([0-9.]+)px/gi)) {
        if (Number(size[1]) < 11) violations.push(`${selector}: ${size[1]}px`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

// Pitfall 24. DESIGN.md §Typography defines a type scale, but styles.css never
// expressed it as tokens — so 583 hand-written `font-size: Npx` declarations
// drifted into 17 sizes and 21 line-heights, and the same semantic rank ended
// up at 11px in one rule and 13px in its neighbour (the Chat header's session
// title was 11px while its own subtitle was 12px). Chat and the sidebar now
// reference the tokens; a raw px font-size in those blocks is the regression.
test("Chat and sidebar typography goes through the type scale, never raw px", () => {
  const scale = {
    "--fs-body": "14px", "--lh-body": "22px",
    "--fs-label": "13px", "--lh-label": "18px",
    "--fs-meta": "11px", "--lh-meta": "16px",
    "--fs-title": "15px", "--lh-title": "20px",
    "--fs-heading": "16px", "--lh-heading": "22px",
    "--fs-page": "22px", "--lh-page": "28px",
    "--icon-xs": "12px", "--icon-sm": "14px", "--icon-md": "16px", "--icon-lg": "18px"
  };
  for (const [name, value] of Object.entries(scale)) {
    assert.match(styles, new RegExp(`${name}\\s*:\\s*${value}\\s*;`), `${name} must be declared as ${value}`);
  }

  // 12px carries no rank in Chat: it was doing both `label` and `meta` duty,
  // which is what made same-rank neighbours read as randomly sized. It survives
  // only as an icon size, in its own namespace.
  assert.equal(Object.entries(scale).filter(([name, value]) => name.startsWith("--fs-") && value === "12px").length, 0);

  // Anything that never set a size was inheriting the UA's 16px — a rank the
  // design does not contain. The Chat shell anchors the default on `label`.
  assert.match(styles, /\.chat-layout \{ font-size: var\(--fs-label\); line-height: var\(--lh-label\); \}/);

  const scopePrefixes = [
    "chat-title", "chat-source-tag", "chat-header", "chat-layout",
    "message-", "user-message-", "assistant-", "markdown-body", "transcript-",
    "attachment-", "composer", "slash-suggestion", "invocation-", "queued-",
    "pending-", "send-button", "recording-", "approval-", "run-activity",
    "thinking-card", "conversation-empty", "empty-state", "conv-group",
    "conv-caret", "conversation-row", "row-title", "row-time", "row-menu",
    "row-branch", "nav-item", "nav-count", "nav-section-label", "sidebar-",
    "brand-copy", "brand-mark", "new-chat", "channel-chip", "channel-accordion",
    "channel-state", "channel-configure", "channel-more", "icon-badge",
    "section-label", "eyebrow", "prompt-navigation", "mention-", "code-block",
    "secondary-button", "header-profile", "icon-button", "search-bar",
    // Automation carried the same drift the Chat surfaces did: the task card's
    // name was 13px over a 12px schedule over a 12px status, and the pane title
    // sat at 18px — a rank the scale does not contain.
    "automation", "one-shot", "task-", "execution-state", "row-outcome",
    "system-task", "workspace-page-title", "workspace-empty"
  ];
  const inScope = (selector) => [...selector.matchAll(/\.([a-z][\w-]*)/gi)]
    .some((match) => scopePrefixes.some((prefix) => match[1] === prefix || match[1].startsWith(prefix)));

  const violations = [];
  for (const css of allStyleSources) {
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (!inScope(selector)) continue;
      // `em` sizes are relative to the rank the token already set (markdown
      // headings, inline code), so they follow a theme change for free.
      for (const decl of rule[2].matchAll(/font-size\s*:\s*([0-9.]+px)/gi)) violations.push(`${selector} { font-size: ${decl[1]} }`);
      for (const decl of rule[2].matchAll(/font\s*:\s*(?:[0-9]{3}\s+)?([0-9.]+px)/gi)) violations.push(`${selector} { font: … ${decl[1]} }`);
    }
  }
  assert.deepEqual(violations, []);
});

// Pitfall 24, second half. The composer's command/skill pill is painted by an
// overlay that mirrors the textarea character for character, so ANY inset that
// advances the text drifts the tint off the glyphs and misplaces the caret and
// the CJK IME candidate window. The two axes have completely different budgets
// and the old `padding: 1px 5px; margin: 0 -5px` had them backwards: 1px
// vertical (where padding is free and 3px was available) and 5px horizontal
// (where only ~2px fits before the following glyph paints over the tint).
test("composer token pill sizes its two axes against their real budgets", () => {
  // Vertical fills the line box: 16.5px glyph box inside a 22px line.
  assert.match(styles, /--composer-token-bleed-y:\s*3px;/);
  // Horizontal must stay under the 3.8px inter-word space at the body rank.
  assert.match(styles, /--composer-token-bleed-x:\s*2px;/);

  const pill = styles.match(/\.composer-token \{([^}]*)\}/)?.[1];
  assert.ok(pill, ".composer-token rule must exist");
  // Horizontal padding and margin must cancel EXACTLY — same token, opposite
  // sign — or the mirror stops lining up with the textarea.
  assert.match(pill, /padding:\s*var\(--composer-token-bleed-y\) var\(--composer-token-bleed-x\);/);
  assert.match(pill, /margin:\s*0 calc\(-1 \* var\(--composer-token-bleed-x\)\);/);
  // A filled line box needs a capsule; 8px on a 19px box was the uncanny middle.
  assert.match(pill, /border-radius:\s*var\(--radius-full\);/);
  // Each line fragment must carry its own padding and radius when the token wraps.
  assert.match(pill, /box-decoration-break: clone/);
  assert.match(pill, /background:\s*var\(--composer-token-tint\)/);
  for (const kind of ["skill", "miniapp"]) {
    const variant = styles.match(new RegExp(`\\.composer-token\\[data-kind="${kind}"\\] \\{([^}]*)\\}`))?.[1];
    assert.ok(variant, `.composer-token[data-kind="${kind}"] must exist`);
    assert.match(variant, /--composer-token-tint:/);
    assert.doesNotMatch(variant, /(?<!-)\bbackground:/, `${kind} must retint through the custom property, not re-set background`);
  }
  // `overflow: hidden` would shave the bleed off the first token on a line.
  assert.match(styles, /\.composer-highlight \{[^}]*overflow: clip; overflow-clip-margin: var\(--composer-token-bleed-y\)/);

  // The overlay and the textarea must read the SAME tokens: they are twin text
  // metrics that happen to live in two rules, and one drifting breaks alignment.
  const highlight = styles.match(/\.composer-highlight \{([^}]*)\}/)?.[1] ?? "";
  const textarea = styles.match(/\.composer textarea \{([^}]*)\}/)?.[1] ?? "";
  for (const source of [highlight, textarea]) {
    assert.match(source, /font-size: var\(--fs-body\)/);
    assert.match(source, /line-height: var\(--lh-body\)/);
  }
});

// A `ph-*` class that Phosphor does not ship renders as an empty box with no
// error — the same silent failure mode as an undefined CSS token. Every icon
// name in the app is checked against the installed icon set.
test("every Phosphor icon name used in the UI exists in the installed icon set", () => {
  const iconCss = readFileSync(
    new URL("../node_modules/@phosphor-icons/.ignored_web/src/fill/style.css", import.meta.url),
    "utf8"
  );
  const available = new Set([...iconCss.matchAll(/\.(ph-[a-z0-9-]+):/g)].map((match) => match[1]));
  assert.ok(available.size > 1000, "Phosphor icon stylesheet was not read");

  const used = new Set();
  for (const source of listSvelteSources()) {
    for (const match of source.matchAll(/\bph-[a-z0-9-]+/g)) {
      const name = match[0];
      // `ph-fill` / `ph-duotone` etc. select a weight, not an icon.
      if (["ph-fill", "ph-bold", "ph-thin", "ph-light", "ph-duotone"].includes(name)) continue;
      // A trailing dash means the suffix is interpolated (`ph-caret-${…}`);
      // only the literal part is visible here, so it cannot be checked.
      if (name.endsWith("-")) continue;
      used.add(name);
    }
  }
  assert.ok(used.size > 50, "no icon usages were collected");
  assert.deepEqual([...used].filter((name) => !available.has(name)).sort(), []);
});

// Issue #24: a queue with no way out. Stop threw away everything the user had
// lined up AND reported the user's own cancellation as a red error, and a
// queued message could only wait — never join the run it was queued behind,
// even though the Runner layer has exposed `steer` to the chat channels all
// along. Guards the whole seam: transport → controller → composer.
test("queued messages can steer the running turn and survive Stop", () => {
  const controller = read("./lib/chat/conversationController.svelte.ts");
  const queuedBar = read("./lib/chat/QueuedMessagesBar.svelte");
  const steerRoute = read("../../../src/routes/api/stream/steer/+server.ts");
  const runtimeContext = read("../../../src/lib/server/web/runtimeContext.ts");

  // Steer reaches the shared Runner capability, not a re-implementation.
  assert.match(runtimeContext, /export function steerWebRunner/);
  assert.match(runtimeContext, /pool\.steer\(chatId, conversationId, text\)/);
  assert.match(steerRoute, /steerWebRunner/);
  assert.match(read("./lib/api.ts"), /export async function steerDesktopChat[\s\S]*\/api\/stream\/steer/);
  assert.match(controller, /async steerQueued\(index: number\)/);
  // The message leaves the queue only once the server has taken it.
  assert.match(controller, /const delivered = await steerDesktopChat[\s\S]*?if \(!delivered\) return false;/);
  for (const [surface, source] of [["chat", view], ["project", read("./lib/projects/ProjectChat.svelte")]]) {
    assert.match(source, /onSteerQueued=/, `${surface} composer must expose steering`);
  }
  assert.match(queuedBar, /onSteer/);

  // Stop ends the current turn only: it must not clear the queue, and the
  // cancellation it causes must not surface as a turn error.
  const stopBody = controller.slice(controller.indexOf("async stop()"), controller.indexOf("private async waitForTurnSettled"));
  assert.doesNotMatch(stopBody, /this\.queue = \[\]/);
  assert.match(stopBody, /this\.stopRequested = true/);
  assert.match(stopBody, /this\.drainQueue\(\)/);
  assert.match(controller, /if \(!this\.stopRequested && !isAbortCause\(cause, abort\.signal\)\)/);
});

test("OpenConnector is a first-class peer to MCP with a safe catalog and fixed save bar", () => {
  const connector = sections.openConnector;
  const connectorStore = read("./lib/stores/openConnector.svelte.ts");
  assert.match(app, /\{ id: "mcp"[\s\S]*\{ id: "openConnector"/);
  assert.match(app, /sections: \["mcp", "openConnector"/);
  assert.match(app, /activeSection === "openConnector"[\s\S]*<OpenConnectorSection/);
  assert.match(connector, /SearchField/);
  assert.match(connector, /SelectControl/);
  assert.match(connector, /MultiSelectControl/);
  assert.match(multiSelectControl, /<Select\.Root type="multiple"/);
  assert.match(multiSelectControl, /value\.includes\(option\.value\)/);
  assert.match(connector, /class="connector-grid"/);
  assert.match(connector, /class="connector-card-action"/);
  assert.match(connector, /class="connector-card-actions">[\s\S]*class="status-badge"[\s\S]*class="connector-card-action"/);
  assert.match(connector, /\{#if provider\.homepageUrl\}[\s\S]*class="connector-card-head connector-provider-link"[\s\S]*openUrl\(provider\.homepageUrl\)/);
  assert.match(connector, /openConnectorOpenHomepage\.replace\("\{name\}", provider\.displayName\)/);
  assert.match(connector, /ph-arrow-square-out/);
  assert.doesNotMatch(connector, /class="connector-description"/);
  assert.match(connector, /<details class="settings-card connector-config-panel">/);
  assert.doesNotMatch(connector, /<details class="settings-card connector-config-panel" open/);
  assert.doesNotMatch(connector, /class="connector-category-bar"/);
  assert.match(connector, /categoryFilters\.length > 0/);
  assert.match(connector, /provider\.categories\.some\(\(category\) => categoryFilters\.includes\(category\)\)/);
  assert.match(connector, /categoryCounts\.get\(category\)/);
  assert.match(connector, /type=\{tokenVisible \? "text" : "password"\}/);
  assert.match(connector, /revealOpenConnectorToken\(\)/);
  assert.match(connector, /class="settings-footbar"/);
  assert.match(connector, /invoke\("open_external_url", \{ url: parsed\.href \}\)/);
  assert.doesNotMatch(connector, /<style/);
  assert.match(connector, /type=\{tokenVisible \? "text" : "password"\}[^\n]*bind:value=\{openConnectorStore\.draft\.runtimeToken\}/);
  assert.match(connectorStore, /runtimeToken: ""/);
  assert.doesNotMatch(connectorStore, /summary\.config\.runtimeToken/);
  assert.doesNotMatch(connector, /window\.addEventListener\("focus"/);
  assert.match(connectorStore, /hydrate\(await loadDesktopOpenConnector\(endpoint\)\)/);
  assert.match(connectorStore, /hydrate\(await refreshDesktopOpenConnector\(session\.endpoint\)\)/);
  assert.match(connector, /onerror=\{\(event\) => event\.currentTarget\.remove\(\)\}/);
  assert.match(styles, /\.connector-catalog \{[^}]*width: var\(--settings-col\)/);
  assert.match(styles, /\.connector-filter-toolbar[\s\S]*gap: 12px/);
  assert.match(styles, /\.connector-filter-toolbar \{[^}]*grid-template-columns: minmax\(180px, 1fr\)[^}]*minmax\(128px, 160px\)[^}]*minmax\(148px, 180px\)/);
  assert.match(styles, /\.connector-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.connector-grid \{[^}]*gap: 10px/);
  assert.doesNotMatch(styles, /\.connector-grid \{[^}]*overflow: hidden/);
  assert.match(styles, /\.connector-card \{[^}]*min-height: 68px[^}]*border: 1px solid var\(--chrome-border\)[^}]*border-radius: 12px/);
  assert.match(styles, /\.connector-card-head \{[^}]*flex: 1/);
  assert.match(styles, /\.connector-card-actions \{[^}]*justify-content: flex-end[^}]*margin-left: auto/);
  assert.match(styles, /\.connector-provider-link:focus-visible \{[^}]*var\(--accent\)/);
  assert.match(styles, /\.connector-config-panel > summary \{[^}]*min-height: 56px/);
});

// ---------------------------------------------------------------- Mini Apps

const miniAppPanel = read("./lib/miniapps/MiniAppPanel.svelte");
const miniAppSidebar = read("./lib/miniapps/MiniAppsSidebarSection.svelte");
const modelsSection = read("./lib/settings/ModelsSection.svelte");
const miniAppManager = read("./lib/miniapps/MiniAppsManager.svelte");
const miniAppIcon = read("./lib/miniapps/MiniAppIcon.svelte");
const miniAppInstall = read("../../../src/lib/server/miniapps/install.ts");
const workspacePane = read("./lib/chat/ChatWorkspacePane.svelte");
const miniAppStore = read("./lib/stores/miniapps.svelte.ts");
const desktopApi = read("./lib/api.ts");
const miniAppProtocol = read("../src-tauri/src/miniapp_protocol.rs");

test("Mini App panels load from a fixed custom origin, never a loopback port range", () => {
  // The service port is chosen at runtime while the CSP is fixed at build time.
  // Widening frame-src to localhost would let the WebView frame anything
  // listening on the machine, so the panel gets its own isolated scheme instead.
  const csp = tauriConfig.app.security.csp;
  assert.match(csp, /frame-src[^;]*molibot-miniapp:/);
  assert.doesNotMatch(csp, /frame-src[^;]*127\.0\.0\.1/);
  assert.doesNotMatch(csp, /frame-src[^;]*localhost:\*/);
  assert.doesNotMatch(csp, /frame-src[^;]*\bhttp:\/\/localhost:\d/);

  assert.match(desktopApi, /molibot-miniapp:\/\/\$\{appId\}\/index\.html/);
  // The panel URL carries display hints only — never a token or a host path.
  assert.match(desktopApi, /new URLSearchParams\(\{ locale, theme \}\)/);
  assert.doesNotMatch(desktopApi, /miniAppPanelUrl[\s\S]{0,400}127\.0\.0\.1/);

  // The Mini App API is not reachable through the desktop HTTP capability;
  // it is only reachable through the custom-protocol transport.
  const httpPermission = tauriCapabilities.permissions.find(
    (permission) => permission && permission.identifier === "http:default"
  );
  assert.ok(httpPermission, "http:default capability should exist");
  assert.equal(
    httpPermission.allow.some((entry) => String(entry.url).includes("/miniapps/")),
    false,
    "Mini App routes must not be in the WebView's direct HTTP allowlist"
  );
});

test("built-in Mini Apps are an offer with install / update / uninstall in one place", () => {
  // A built-in that only exists as an installed row cannot be got back once
  // removed, so the manager gets its own source tab fed by the built-in
  // catalog rather than by the installed list.
  assert.match(miniAppManager, /type InstallTab = "builtin" \| "directory" \| "zip" \| "github"/);
  assert.match(miniAppManager, /installTab = \$state<InstallTab>\("builtin"\)/);
  assert.match(miniAppManager, /\{#each miniAppsStore\.builtin as app \(app\.id\)\}/);
  // The three lifecycle actions the owner asked for, all on the row.
  assert.match(miniAppManager, /installBuiltinMiniApp\(app\.id\)/);
  assert.match(miniAppManager, /updateMiniApp\(app\.id\)/);
  assert.match(miniAppManager, /confirmUninstall\(app, true\)/);
  // The trust warning is about running someone else's code; repeating it on a
  // build's own apps only teaches people to click past it.
  assert.match(miniAppManager, /\{#if installTab !== "builtin"\}\s*\n(?:\s*<!--[\s\S]*?-->\s*\n)?\s*<p class="miniapps-trust">/);

  // Both catalogs are assigned together: a lifecycle action changes what is
  // installed *and* what the built-in tab should say, so a route answer that
  // updated one list would leave the other a click behind.
  assert.match(miniAppStore, /builtin: \[\] as DesktopMiniAppBuiltinItem\[\]/);
  assert.match(miniAppStore, /function applyCatalogs\(catalogs: DesktopMiniAppCatalogs\): void \{[\s\S]*?miniAppsStore\.items = catalogs\.items;[\s\S]*?miniAppsStore\.builtin = catalogs\.builtin;/);
  assert.doesNotMatch(miniAppStore, /miniAppsStore\.items = (await |result\.items)/);
  // An older service that does not send `builtin` degrades to "nothing on
  // offer" instead of throwing inside the catalog load.
  assert.match(desktopApi, /builtin: payload\.builtin \?\? \[\]/);
});

test("the Mini App iframe keeps a fixed, minimal sandbox", () => {
  assert.match(miniAppPanel, /sandbox="allow-scripts allow-forms allow-same-origin"/);
  // Each of these would hand a Mini App a capability the isolation boundary is
  // meant to withhold; none may be added without a deliberate review.
  for (const capability of [
    "allow-popups",
    "allow-modals",
    "allow-top-navigation",
    "allow-downloads",
    "allow-pointer-lock",
    "allow-presentation",
    "allow-storage-access-by-user-activation"
  ]) {
    assert.doesNotMatch(miniAppPanel, new RegExp(capability), `${capability} must stay off the Mini App sandbox`);
  }
  assert.match(miniAppPanel, /referrerpolicy="no-referrer"/);
});

test("the Mini App panel is generic chrome with no per-app knowledge", () => {
  // A shared panel that special-cases one app stops being reusable; Todo is a
  // Mini App like any other.
  assert.doesNotMatch(miniAppPanel, /\btodo\b/i);
  assert.match(miniAppPanel, /miniAppsStore\.items\.find/);
  // Disabled and failed states are shown in place, not left as a blank iframe.
  assert.match(miniAppPanel, /miniAppDisabledPanel/);
  assert.match(miniAppPanel, /miniAppLoadFailed/);
});

test("Chat mounts one Artifact Panel hosting two separate surfaces", () => {
  // The old discriminated union (`files` | `miniapp`) is gone: one Artifact
  // Panel hosts both, so there is still exactly one inspector column, one
  // resizer and one width budget. The two surfaces inside it are separate
  // (see the tab-separation guard below) but the mount seam is single.
  assert.match(view, /type ChatInspector =[\s\S]*?kind: "artifact"[\s\S]*?scope: "project" \| "session"[\s\S]*?miniApp\?: string[\s\S]*?miniAppNonce\?: number[\s\S]*?\} \| null/);
  assert.match(view, /\$: filePanelOpen = inspector\?\.kind === "artifact"/);
  // ONE inspector, every scope. A second right-hand aside for the session file
  // list is what made the artifact list unreachable while a Mini App was open —
  // the host could only render one of the two, so switching the panel back to
  // Files landed on an empty surface. The panel owns the Session list now.
  assert.match(view, /\$: inspectorVisible = artifactPanelVisible;/);
  assert.doesNotMatch(view, /sessionFilesAsideVisible/);
  assert.doesNotMatch(view, /class="file-list"/);
  // Scope and identity come from the live pane, never from the open-time
  // `inspector.scope`, so the visibility test cannot disagree with the props.
  assert.match(view, /\$: artifactPanelVisible = filePanelOpen && serviceState === "ready" && \(projectPaneActive \|\| profiles\.length > 0\)/);
  assert.match(view, /profileId=\{projectPaneActive \? "" : inspectorProfileId\}/);
  // One grid class, one resizer, one max-width computation for both adapters —
  // a second panel must never introduce a fourth column.
  assert.match(view, /class:with-files=\{inspectorVisible\}/);
  assert.match(view, /\$: threeColumn = inspectorVisible && viewportWidth > NARROW_WIDTH/);
  assert.match(view, /\$: filesMaxWidth = !inspectorVisible/);
  assert.match(view, /\{#if inspectorVisible\}[\s\S]{0,400}class="files-resizer"/);
  // ChatView mounts exactly one Artifact Panel; MiniAppPanel and ProjectFilePanel
  // no longer appear as direct mounts (PRD test seam #4).
  assert.match(view, /<ArtifactPanel/);
  assert.doesNotMatch(view, /<MiniAppPanel\b/);
  assert.doesNotMatch(view, /<ProjectFilePanel\b/);
  // Opening a Mini App keeps any open files alive rather than replacing them.
  assert.match(view, /inspector = \{\s*kind: "artifact",\s*scope: projectPaneActive \? "project" : "session",\s*miniApp: appId,\s*miniAppNonce: \+\+miniAppSeq,\s*miniAppDeepLinkPath: deepLinkPath\s*\}/);
  assert.match(view, /inspector = inspector\?\.kind === "artifact" \? null : \{ kind: "artifact", scope: projectPaneActive \? "project" : "session" \}/);
});

test("a Mini App survives a session switch, and Session scope always has a Files surface", () => {
  // Two symptoms, one seam. (a) `connect()` cleared EVERY tab whenever the
  // panel's context changed, so selecting another conversation destroyed the
  // running app's iframe and dropped the panel back to files. A Mini App is a
  // workspace of its own, not an artifact of the conversation it was opened
  // beside, so its tabs (and the mode showing them) are carried over.
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  const connect = filesStore.slice(
    filesStore.indexOf("connect(endpoint: string"),
    filesStore.indexOf("dispose(): void")
  );
  assert.ok(connect.length > 0, "connect() must exist");
  assert.doesNotMatch(connect, /this\.tabs = \[\];/);
  assert.match(connect, /filter\(\(tab\) => tab\.kind === "miniapp"\)/);
  assert.match(connect, /this\.tabs = keptMiniApps;/);
  assert.match(connect, /this\.mode = this\.activeMiniAppTabId && this\.mode === "miniapps" \? "miniapps" : "files"/);

  // (b) With the app kept, switching the panel back to Files in a conversation
  // must land on the session's artifacts — not the empty state that used to be
  // the whole Session surface whenever no file tab happened to be open.
  assert.doesNotMatch(projectFilePanel, /artifactEmpty/);
  assert.match(projectFilePanel, /class="project-browser artifact-session-browser"/);
  assert.match(projectFilePanel, /filterDesktopFiles\(attachments, sessionFilter\)/);
  assert.match(projectFilePanel, /store\.openSessionFile\(file\)/);
  // Closing the last file tab falls back to that list; it must not close the
  // panel out from under a Mini App the user still has open.
  assert.doesNotMatch(projectFilePanel, /store\.tabs\.length === 0\) onClose\(\)/);
  // The browser, handle and viewer are children of the file surface wrapper, so
  // the collapse rules must be written against it — a `>` combinator on the
  // panel body stopped matching when that wrapper was added and the collapse
  // button silently did nothing.
  assert.match(styles, /\.project-panel-body\.browser-collapsed \.artifact-file-surface > \.project-browser/);
});

test("files and Mini Apps are separate surfaces, never one mixed tab strip", () => {
  // Reported after using the co-hosted build: one strip listing `AGENTS.md`
  // beside a running expense tracker made "read a file" and "leave my app" the
  // same gesture. Each side now owns its tab strip and its own selection.
  const filesStore = read("./lib/artifacts/artifactTabsStore.svelte.ts");
  assert.match(filesStore, /mode = \$state<"files" \| "miniapps">/);
  assert.match(filesStore, /get fileTabs\(\): ArtifactTab\[\][\s\S]*?tab\.kind !== "miniapp"/);
  assert.match(filesStore, /get miniAppTabs\(\): ArtifactTab\[\][\s\S]*?tab\.kind === "miniapp"/);
  // Two selections, so switching modes returns to where you were.
  assert.match(filesStore, /activeFileTabId = \$state\(""\)/);
  assert.match(filesStore, /activeMiniAppTabId = \$state\(""\)/);

  // No strip in the panel may iterate the mixed list.
  assert.doesNotMatch(projectFilePanel, /\{#each store\.tabs as /);
  assert.match(projectFilePanel, /\{#each fileTabs as openTab /);
  assert.match(projectFilePanel, /\{#each miniAppTabs as appTab /);
  // The switch drives the mode without disturbing either selection.
  assert.match(projectFilePanel, /store\.setMode\("files"\)/);
  assert.match(projectFilePanel, /store\.setMode\("miniapps"\)/);
  assert.match(projectFilePanel, /artifactModeFiles/);
  assert.match(projectFilePanel, /artifactModeMiniApps/);

  // The switch lives INSIDE the single head, not on a band of its own: the
  // panel is ~380px wide, so vertical space is the scarce axis and a row of its
  // own pushed the content down while repeating the app name the tab strip
  // already shows. One head serves both surfaces.
  const head = projectFilePanel.slice(
    projectFilePanel.indexOf('<div class="file-panel-head">'),
    projectFilePanel.indexOf('class="file-panel-close"')
  );
  assert.ok(head.length > 0, "the mode switch must be inside the panel head");
  assert.equal(projectFilePanel.match(/class="file-panel-head"/g)?.length, 1);

  // It is a quiet menu, not a segmented control: switching surfaces is rare
  // next to the reading done inside one, so the trigger names the current
  // surface and adds a caret rather than restating both choices permanently.
  assert.match(head, /<OverflowMenu variant="inline" label=\{copy\.artifactModeSwitch\}>/);
  assert.match(head, /class="artifact-mode-trigger" slot="trigger"/);
  assert.match(head, /ph-caret-down artifact-mode-caret/);
  assert.doesNotMatch(head, /role="tablist"/);
  // Reused, not re-implemented: OverflowMenu owns dismiss / Escape / arrow keys,
  // and a bespoke popover here would be a fork of all three (pitfall #7).
  assert.match(projectFilePanel, /import OverflowMenu from "\.\.\/components\/ui\/OverflowMenu\.svelte"/);
  const overflowMenu = read("./lib/components/ui/OverflowMenu.svelte");
  assert.match(overflowMenu, /<slot name="trigger">/);
  assert.match(overflowMenu, /overflow-menu-\$\{variant\}/);
  // The trigger shrinks label-first so the head's action buttons keep their
  // natural width (pitfall #16a), and it must not become a full-width band.
  assert.match(styles, /\.file-panel-head > \.overflow-menu-inline \{[^}]*flex: 0 1 auto/s);
  assert.doesNotMatch(styles, /\.artifact-mode-switch/);

  // Head actions stay pinned to the right edge in BOTH head states. The plain
  // title does it with `flex: 1`; the menu trigger is content-sized, so without
  // `margin-right: auto` nothing absorbs the slack and the buttons bunch up
  // against the trigger on the left.
  assert.match(styles, /\.file-panel-head > \.overflow-menu-inline \{[^}]*margin-right: auto/s);
  assert.match(styles, /\.file-panel-head > strong \{[^}]*flex: 1/s);
  // Direct child, not descendant: a descendant selector also captured the mode
  // menu's own `<strong>` label, overriding its type rank and growing it inside
  // the trigger.
  assert.doesNotMatch(styles, /\.file-panel-head strong \{/);

  // Closing the last tab of one kind must not jump to the other kind's tab.
  assert.match(filesStore, /const siblings = isMiniApp \? this\.miniAppTabs : this\.fileTabs/);
  // A file flood must not evict a Mini App the user still has open: the cap is
  // applied per kind, not across the merged list.
  assert.match(filesStore, /for \(const kind of \["file", "miniapp"\] as const\)/);
});

test("an open Mini App survives a trip to the file surface", () => {
  // The bug this fixes: `{#if miniAppActive}` and the file branch were siblings,
  // so clicking a file destroyed every MiniAppPanel and its iframe - the app
  // reloaded to its start screen and any in-progress input was gone. Hiding
  // with `display: none` keeps the iframe's document alive; removing the node
  // does not, so this must never go back to an `{#if}`.
  assert.match(projectFilePanel, /class="project-viewer artifact-miniapp-viewer"\s*\n\s*class:is-hidden=\{!miniAppActive\}/);
  assert.match(projectFilePanel, /class="artifact-file-surface" class:is-hidden=\{miniAppActive\}/);
  // Every open app is mounted at once; only the selected one is visible.
  assert.match(
    projectFilePanel,
    /\{#each miniAppTabs as appTab \(appTab\.id\)\}\s*\n\s*<div class="artifact-miniapp-slot" class:is-hidden=\{appTab\.id !== store\.activeMiniAppTabId\}>\s*\n\s*<MiniAppPanel/
  );
  // Exactly one MiniAppPanel mount remains in the panel: a second one would be
  // a per-scope copy that reintroduces the destroy-on-switch behaviour.
  assert.equal(projectFilePanel.match(/<MiniAppPanel\b/g)?.length, 1);
  // `display: none` is the mechanism, so the rule must exist for all three slots.
  assert.match(styles, /\.artifact-file-surface\.is-hidden,\s*\n\.artifact-miniapp-viewer\.is-hidden,\s*\n\.artifact-miniapp-slot\.is-hidden \{\s*\n\s*display: none;/);
});

test("the Mini App panel obeys the shared panel layout rules", () => {
  // Column-relative sizing only: a `vw` here keeps its full-window value after
  // the panel narrows the content column.
  const panelBlock = styles.slice(styles.indexOf(".miniapp-panel {"), styles.indexOf(".miniapps-list"));
  assert.doesNotMatch(panelBlock, /\d+vw/);
  assert.doesNotMatch(panelBlock, /position:\s*fixed/);
  assert.match(panelBlock, /\.miniapp-panel \{[^}]*min-width: 0/s);
  assert.match(panelBlock, /\.miniapp-frame \{[^}]*flex: 1 1 auto/s);
  // Both surfaces now share `.file-panel-head`, so that is the one head that
  // must clear the window-drag mask (pitfall #18): under the z-index 30 mask its
  // close/refresh buttons go dead with nothing in the console. The old
  // `.miniapp-panel-head` rule this used to assert is gone with its markup - a
  // guard pointed at a dead rule protects nothing.
  assert.doesNotMatch(styles, /\.miniapp-panel-head/);
  assert.match(styles, /\.file-panel-head \{[^}]*z-index: 31/s);
});

test("Mini Apps are reachable as a primary destination and a recent-first app section", () => {
  // The manager is a first-class sidebar destination, not something buried at
  // the bottom of a Settings page.
  assert.match(chatSidebar, /class="nav-item"[\s\S]{0,200}onclick=\{onOpenMiniApps\}/);
  assert.match(chatSidebar, /copy\.miniAppsNav/);
  assert.match(chatSidebar, /ph-app-store-logo/);
  assert.match(workspacePane, /pane === "miniapps"[\s\S]{0,120}<MiniAppsManager/);

  // The tree section keeps the Mini Apps label, while ordering a bounded list
  // by recent use and retaining a way to reach the complete manager.
  assert.match(chatSidebar, /<MiniAppsSidebarSection/);
  assert.match(miniAppSidebar, /copy\.miniAppsRecent/);
  assert.match(i18n, /miniAppsRecent: "小程序"/);
  assert.match(miniAppSidebar, /recentMiniApps\(\)/);
  assert.match(miniAppSidebar, /onSeeAll/);
  assert.match(miniAppStore, /const RECENT_LIMIT = 10/);
  // Recency is recorded on open, so the list reflects real use.
  assert.match(view, /markMiniAppUsed\(appId\)/);

  // Only enabled, loaded apps are offered for opening.
  assert.match(miniAppStore, /item\.enabled && item\.status === "active" && !item\.error/);
});

test("browsing and installing Mini Apps has exactly one home: the sidebar destination", () => {
  // A second management surface in Settings could only drift from this one, so
  // the manager is mounted from the workspace pane and nowhere else.
  assert.match(workspacePane, /<MiniAppsManager/);
  for (const [name, source] of Object.entries(sections)) {
    assert.doesNotMatch(source, /<MiniAppsManager/, `Settings › ${name} must not mount the Mini App manager`);
  }
  assert.doesNotMatch(modelsSection, /<MiniAppsManager/);
});

test("Mini App AI settings are edited in exactly one place, and the app page only links there", () => {
  const aiSettings = read("./lib/miniapps/MiniAppsAiSettings.svelte");
  // The real controls live in Settings › Models and nowhere else: two surfaces
  // editing one global model choice is how they end up disagreeing. They belong
  // to Models because a Mini App capability is a model route like every other
  // one on that page — not a plugin.
  assert.match(modelsSection, /<MiniAppsAiSettings \/>/);
  assert.doesNotMatch(sections.plugins, /MiniAppsAiSettings|MiniAppsSettingsGroup/);
  // ...and it is rendered with that page's own primitives, so it does not read
  // as a transplant from another screen.
  assert.match(aiSettings, /<SettingGroup title=\{session\.text\.miniAppAiTitle\} description=\{session\.text\.miniAppAiHint\}>/);
  assert.equal(aiSettings.match(/<SettingRow /g)?.length, 2);
  assert.doesNotMatch(aiSettings, /class="settings-card/);
  assert.match(aiSettings, /saveDesktopMiniAppAiSettings/);
  assert.match(aiSettings, /miniAppAiTextModel/);
  assert.match(aiSettings, /miniAppAiTranscriptionModel/);
  assert.match(aiSettings, /miniAppAiUsageTitle/);

  // Each control commits immediately through its own route, so it must never be
  // reachable by a surrounding save: the Models page has no <form>, and its
  // footbar buttons commit the advanced routing draft explicitly.
  assert.doesNotMatch(modelsSection.replace(/<!--[\s\S]*?-->/g, ""), /<form\b/);
  // Mounted inside a SettingGroup card, the two trailing blocks match the
  // 16px inset SettingRow already carries.
  assert.match(styles, /\.miniapps-ai-note \{[^}]*margin: 12px 16px 0/s);
  assert.match(styles, /\.miniapps-ai-usage \{[^}]*padding: 12px 16px 16px/s);
  assert.doesNotMatch(styles, /\.miniapps-card\b/);

  // The manager keeps no copy of the controls, the loader, or the saver.
  assert.doesNotMatch(miniAppManager, /saveDesktopMiniAppAiSettings|loadDesktopMiniAppAi/);
  assert.doesNotMatch(miniAppManager, /miniAppAiTextModel|miniAppAiTranscriptionModel|miniAppAiUsage/);
  assert.doesNotMatch(miniAppManager, /<SelectControl/);

  // It renders a signpost only when a caller injects a way to get there, so the
  // component needs no "am I inside Settings?" branch (pitfall #7)...
  assert.match(miniAppManager, /\{#if onOpenAiSettings\}/);
  assert.match(miniAppManager, /class="miniapps-ai-link"[\s\S]{0,200}onclick=\{onOpenAiSettings\}/);
  // The sidebar destination injects one, wired to Settings › Models — the
  // screen that actually holds the controls.
  assert.match(workspacePane, /onOpenAiSettings=\{onOpenMiniAppAiSettings\}/);
  assert.match(view, /onOpenMiniAppAiSettings=\{\(\) => openSettings\("models"\)\}/);

  // The signpost is a row, not a card: it holds no state and must not read as
  // something editable in place.
  assert.match(styles, /\.miniapps-ai-link \{[^}]*cursor: pointer/s);
  assert.match(styles, /\.miniapps-ai-link:focus-visible \{[^}]*var\(--accent\)/s);
  assert.match(styles, /\.miniapps-ai-link-text strong \{[^}]*font-size: var\(--fs-label\)/s);
});

test("Mini App icons are inlined so no CSP or path leak is needed", () => {
  // A URL-based icon would need `img-src molibot-miniapp:` in the app CSP and a
  // resolvable asset path in the Desktop contract; a data URI keeps both closed.
  // The Mini App tab's head lives in the Artifact Panel now, so the icon-bearing
  // surfaces are the manager, the sidebar, and the Artifact Panel (not the frame).
  for (const source of [miniAppManager, miniAppSidebar, projectFilePanel]) {
    assert.match(source, /<MiniAppIcon/);
    assert.match(source, /iconDataUri/);
  }
  const csp = tauriConfig.app.security.csp;
  assert.doesNotMatch(csp, /img-src[^;]*molibot-miniapp/);
  // Every icon-bearing surface shares one neutral fallback rather than drifting
  // back to the generic four-cell grid.
  assert.match(miniAppIcon, /\{:else\}[\s\S]{0,120}ph-app-window/);
  assert.doesNotMatch(miniAppIcon, /ph-squares-four/);
});

test("the Mini App manager follows the bounded data-page layout", () => {
  assert.match(styles, /\.workspace-scroll\[data-workspace-pane="miniapps"\] > \.miniapps-manager \{[^}]*var\(--data-content-width\)[^}]*margin: 0 auto/s);
  assert.match(styles, /\.miniapps-settings-row \{[^}]*grid-template-columns: 40px minmax\(0, 1fr\) auto/s);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.miniapps-settings-row \{[^}]*grid-template-columns: 40px minmax\(0, 1fr\)/s);
});

test("Mini App toggle and uninstall use fine-grained routes, not the Plugins editor PUT", () => {
  assert.match(desktopApi, /"\/api\/desktop\/miniapps", \{\s*method: "PATCH"/s);
  assert.match(desktopApi, /"\/api\/desktop\/miniapps", \{\s*method: "DELETE"/s);
  assert.match(miniAppManager, /toggleMiniApp\(app\.id, checked\)/);
  // Toggles must use IosSwitch, never the generic Switch.
  assert.match(miniAppManager, /<IosSwitch/);
  assert.doesNotMatch(miniAppManager, /<Switch[\s/>]/);
});

test("a built-in update is offered only when one exists, and never confirms away data", () => {
  // The button appears exactly when the host says a newer bundled copy exists;
  // it is not a permanent "reinstall" control.
  assert.match(miniAppManager, /\{#if app\.updateAvailable\}[\s\S]{0,400}updateMiniApp\(app\.id\)/);
  assert.match(miniAppManager, /miniAppUpdateAvailable[\s\S]{0,80}app\.availableVersion/);
  // Its own route, like every other per-app action — never the Plugins PUT.
  assert.match(desktopApi, /"\/api\/desktop\/miniapps\/update", \{\s*method: "POST"/s);
  // An update replaces code only, so it must not ask about deleting data the
  // way uninstall does; a confirm here would teach the owner to fear the button.
  assert.doesNotMatch(miniAppStore, /updateMiniApp[\s\S]{0,400}confirm/);
  assert.doesNotMatch(miniAppStore, /updateMiniApp[\s\S]{0,400}deleteData/);
  // A successful update is already active; no stale restart contract may leak
  // back into the store.
  assert.doesNotMatch(miniAppStore, /restartRequired/);
  // One lifecycle action per row at a time.
  assert.match(miniAppStore, /export async function updateMiniApp[\s\S]{0,200}if \(!endpoint \|\| miniAppsStore\.busyId\) return;/);
});

test("installing states the trust consequence before it happens, and names the source", () => {
  // App server code runs in-process with no sandbox, so the owner is told what
  // installing means *before* the install, and a remote source is confirmed.
  assert.match(miniAppManager, /function confirmInstall[\s\S]{0,200}window\.confirm/);
  assert.match(miniAppManager, /miniAppInstallTrustWarning/);
  for (const installer of ["installFromDirectory", "installFromZip", "installFromGithub"]) {
    const body = miniAppManager.slice(miniAppManager.indexOf(`async function ${installer}`));
    assert.match(body.slice(0, 600), /confirmInstall\(/, `${installer} must confirm first`);
  }
  assert.match(i18n, /miniAppInstallTrustWarning: "[^"]*没有沙箱/);
  assert.match(i18n, /miniAppInstallTrustWarning: "[^"]*no sandbox/);

  // Provenance is recorded and shown, so an owner can see what they are running.
  assert.match(miniAppManager, /function sourceLabel/);
  assert.match(miniAppManager, /class="miniapps-provenance"/);

  // Install success means the runtime is active in this service process.
  assert.doesNotMatch(miniAppManager, /miniAppRestartRequired/);
  assert.doesNotMatch(miniAppStore, /restartRequired/);
});

test("the installer contains archive extraction, not just path checks", () => {
  // These are the failure modes that turn "install from a zip" into arbitrary
  // file write outside the install root.
  assert.match(miniAppInstall, /isSafeRelativePath\(rawName\)/);
  assert.match(miniAppInstall, /symlink/i);
  assert.match(miniAppInstall, /MAX_UNPACKED_BYTES/);
  assert.match(miniAppInstall, /MAX_ENTRIES/);
  // The repo and ref are pattern-checked before any URL is built.
  assert.match(miniAppInstall, /GITHUB_REPO_PATTERN\.test\(repo\)/);
  assert.match(miniAppInstall, /GITHUB_REF_PATTERN\.test\(ref\)/);
  // The manifest must validate in staging, before anything reaches the code root.
  assert.match(miniAppInstall, /readMiniAppManifest\(namedStaging, manifestId\)/);
});

test("deleting a Mini App's data is opt-in and separately confirmed", () => {
  assert.match(miniAppManager, /miniAppUninstallKeepData/);
  assert.match(miniAppManager, /miniAppUninstallDeleteData/);
  // Two different confirmation strings: the destructive one must say the data
  // cannot be recovered rather than reusing the milder wording.
  assert.match(miniAppManager, /deleteData\s*\?\s*session\.text\.miniAppDeleteDataConfirm/s);
  assert.match(i18n, /miniAppDeleteDataConfirm: "[^"]*不可恢复/);
  assert.match(i18n, /miniAppDeleteDataConfirm: "[^"]*cannot be undone/);
});

test("the Mini App transport pins its upstream and marks every forwarded request", () => {
  // The proxy header is what makes the loopback API unreachable from an
  // ordinary web page: a cross-origin caller would need a CORS preflight, and
  // the Mini App routes grant no CORS.
  assert.match(miniAppProtocol, /const PROXY_HEADER: &str = "x-molibot-miniapp-proxy"/);
  assert.match(miniAppProtocol, /builder = builder\.header\(PROXY_HEADER, PROXY_VALUE\)/);
  assert.match(miniAppProtocol, /redirect\(reqwest::redirect::Policy::none\(\)\)/);
  // Cookies and credentials are never forwarded.
  assert.doesNotMatch(miniAppProtocol, /FORWARDED_REQUEST_HEADERS[^;]*"cookie"/s);
  assert.doesNotMatch(miniAppProtocol, /FORWARDED_REQUEST_HEADERS[^;]*"authorization"/s);
  assert.match(tauriCargo, /reqwest = \{ version = "0\.12", default-features = false \}/);
});

test("Mini App copy exists in both locales", () => {
  const keys = [
    "miniAppsSection",
    "miniAppsEmpty",
    "miniAppsSettingsTitle",
    "miniAppOpen",
    "miniAppUninstallKeepData",
    "miniAppUninstallDeleteData",
    "miniAppDisabledPanel",
    "miniAppLoadFailed",
    "miniAppManageHint",
    "miniAppsNav",
    "miniAppsRecent",
    "miniAppsSeeAll",
    "miniAppInstallDirectory",
    "miniAppInstallZip",
    "miniAppInstallGithub",
    "miniAppInstallTrustWarning"
  ];
  for (const key of keys) {
    const occurrences = [...i18n.matchAll(new RegExp(`\\b${key}:`, "g"))].length;
    assert.equal(occurrences, 2, `${key} must be defined in both zh-CN and en`);
  }
});

test("an interrupted turn keeps its answer and shows why it stopped as a separate note", () => {
  const transcript = read("./lib/chat/ConversationTranscript.svelte");

  // The error is status, never the bubble body. A run killed by the tool-failure
  // budget used to render nothing but "Request aborted" because the projection
  // let the error string overwrite the answer the same turn had produced.
  assert.match(transcript, /assistantError = message\.role === "assistant"/);
  assert.match(transcript, /message\.errorMessage\.trim\(\) !== displayContent\.trim\(\)/);
  assert.match(transcript, /class="assistant-error-note"/);
  assert.match(transcript, /copy\.assistantErrorLabel/);

  // "aborted" is its own status: a stopped turn is not a failed one, and it must
  // not fall through to the unlabelled default the way it used to.
  assert.match(transcript, /message\.stopReason === "aborted"/);
  assert.match(transcript, /copy\.assistantStatusAborted/);
  assert.match(styles, /\.assistant-error-note \{/);
  assert.match(styles, /\.assistant-status\.aborted \{/);
});

// ------------------------------------------- Mini App platform §2.2-§2.5

test("the panel routes every bridge action through injected callbacks, source-checked first", () => {
  // The `event.source` comparison is the primary check: it binds a message to
  // the iframe this panel owns, which is what makes the appId trustworthy.
  const handler = miniAppPanel.match(/function onMessage\(event: MessageEvent\): void \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(handler, "MiniAppPanel must keep a message handler");
  const sourceCheck = handler.indexOf("event.source !== frame.contentWindow");
  const parseCall = handler.indexOf("parseMiniAppBridgeMessage");
  assert.ok(sourceCheck > -1, "the source comparison must be present");
  assert.ok(sourceCheck < parseCall, "the source comparison must run before parsing");

  // Every v2 action is routed, and each one leaves through a prop rather than
  // an import: the panel must stay usable outside a Chat host (pitfall #7).
  for (const action of ["composer.insert", "composer.attach", "chat.openSession"]) {
    assert.match(handler, new RegExp(`case "${action}":`), `${action} must be routed`);
  }
  assert.match(handler, /onComposerInsert\(/);
  assert.match(handler, /onComposerAttach\(/);
  assert.match(handler, /onOpenSession\(/);
  // A labelled default, never a silent fallthrough (pitfall #26a).
  assert.match(handler, /default: \{[\s\S]*?console\.warn\("\[miniapp-bridge\]/);
  // No composer/conversation module may be imported here.
  assert.doesNotMatch(miniAppPanel, /from "\.\.\/projects\/composerBridge"/);
  assert.doesNotMatch(miniAppPanel, /from "\.\.\/chat\//);
});

test("a Mini App deep link is resolved in-process, never navigated to", () => {
  // The link is parsed into an intent and routed; it never becomes an href, a
  // window.open, or an iframe src.
  assert.match(view, /function openMiniAppDeepLink\(link: string\): void \{[\s\S]*?parseMiniAppDeepLink\(link\)[\s\S]*?openMiniAppInspector\(parsed\.appId, parsed\.path\)/);
  const card = read("./lib/miniapps/MiniAppResultCard.svelte");
  assert.doesNotMatch(card, /<a\b/, "a card link must be a button, not an anchor the WebView can follow");
  assert.doesNotMatch(card, /window\.open|location\.href/);
  assert.match(card, /onclick=\{\(\) => onOpenLink\(link\)\}/);

  // The locator rides as a query hint beside locale/theme; it is never joined
  // into the asset path the transport resolves.
  assert.match(desktopApi, /if \(deepLinkPath\) params\.set\("path", deepLinkPath\)/);
  assert.doesNotMatch(desktopApi, /molibot-miniapp:\/\/\$\{appId\}\/\$\{deepLinkPath\}/);
});

test("a result card is display-only and cannot write anything", () => {
  // Roadmap §2.3's constraint expressed structurally: the single affordance is
  // the deep link out to the App's own panel.
  const card = read("./lib/miniapps/MiniAppResultCard.svelte");
  assert.doesNotMatch(card, /<input\b|<textarea\b|<form\b/);
  assert.doesNotMatch(card, /fetch\(|invoke\(|requestJson/);
  // Index-keyed: a static host-truncated list may legitimately repeat a label
  // or a value, and a value key would throw `each_key_duplicate` (pitfall #31a).
  assert.match(card, /\{#each card\.fields as field, index \(index\)\}/);
  // Domain-agnostic: no app's vocabulary in a surface every app shares.
  assert.doesNotMatch(card, /\btodo\b|\bfavorite|\bamount\b|\bexpense/i);
});

test("an app badge is host-owned, quiet, and cleared by opening the app", () => {
  // §2.5 is deliberately small: a count or a dot on the sidebar row. No system
  // notification and no interrupting popup.
  assert.match(miniAppSidebar, /\{#if app\.badge\}/);
  assert.match(miniAppSidebar, /app\.badge\.kind === "count" \? app\.badge\.count : ""/);
  assert.doesNotMatch(miniAppSidebar, /Notification\(|requestPermission|alert\(/);
  // The count must not be what gets ellipsised when the row is tight.
  assert.match(styles, /\.miniapps-badge \{[^}]*flex: 0 0 auto/s);
  assert.match(styles, /\.miniapps-badge \{[^}]*font-size: var\(--fs-meta\)[^}]*line-height: var\(--lh-meta\)/s);

  // Opening the panel is what retires the badge, and the server's answer is
  // applied rather than the count being cleared locally.
  assert.match(view, /function openMiniAppInspector\(appId: string, deepLinkPath = ""\): void \{[\s\S]*?void clearMiniAppBadge\(appId\)/);
  assert.match(miniAppStore, /export async function clearMiniAppBadge/);
  assert.match(miniAppStore, /applyCatalogs\(await clearDesktopMiniAppBadge\(endpoint, appId\)\)/);
  assert.doesNotMatch(miniAppStore, /\.badge = null/, "the store must not guess the cleared state locally");
});

test("a bridge attachment is fetched by app id and never trusts a client-side limit", () => {
  // The panel supplies an app-relative locator; the host resolves it against
  // that app's own data directory (pitfall #6: a UI marker is not a path).
  assert.match(desktopApi, /export async function fetchDesktopMiniAppAttachment/);
  assert.match(desktopApi, /"\/api\/desktop\/miniapps\/attach"/);
  const bridge = read("./lib/projects/composerBridge.ts");
  assert.match(bridge, /export interface MiniAppComposerAttachment \{[\s\S]*?appId: string;[\s\S]*?path: string;/);

  // The claim happens before the await, so a second store tick during the
  // fetch cannot start the same attachment twice (pitfall #3).
  const handler = view.match(/async function applyMiniAppComposerAttachment\([\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(handler, "ChatView must handle composer.attach");
  assert.ok(
    handler.indexOf("appliedMiniAppAttachmentId = request.id") < handler.indexOf("await fetchDesktopMiniAppAttachment"),
    "the request id must be claimed before the await"
  );
  // Failure is always visible; "the button did nothing" is the worst outcome.
  assert.match(handler, /catch \(cause\) \{[\s\S]*?miniAppComposerAttachFailed/);
  // Editing history and read-only conversations are refused, as for insert.
  assert.match(handler, /miniAppComposerReadOnly/);
  assert.match(handler, /miniAppComposerEditing/);
});

test("Mini App message actions are always a labelled menu, never loose glyphs", () => {
  // An unlabelled app icon sitting next to copy/edit/fork is unreadable, and a
  // row that grows an icon per installed app eventually collides with the
  // timestamp. One `⋯` menu with icon + label per entry solves both.
  assert.doesNotMatch(transcript, /textContributions\.length <= 2/);
  // Both roles render the menu: a message worth saving is worth saving whoever
  // wrote it, and two action rows for one concept is a fork.
  assert.equal(transcript.match(/<OverflowMenu label=\{copy\.miniAppMessageActionsMenu\}/g)?.length, 2);
  // Every entry carries a real label beside its icon.
  assert.match(transcript, /role="menuitem"[\s\S]{0,400}<span>\{action\.label\}<\/span>/);
  // The trigger reports the outcome, because the menu has closed by the time
  // the call settles.
  assert.match(transcript, /busy \? "ph-circle-notch message-action-spin" : done \? "ph-check" : "ph-dots-three"/);
  // A pending entry cannot be fired twice.
  assert.match(transcript, /role="menuitem" disabled=\{pending\}/);
});

test("right-click with a selection offers the same actions on either role", () => {
  // The interesting case is highlighting part of an assistant reply and saving
  // only that; a role guard here made the common case dead.
  assert.doesNotMatch(transcript, /if \(message\.role !== "user"\) return;/);
  // Both bubbles open it.
  assert.equal(transcript.match(/oncontextmenu=\{\(event\) => openSelectionMenu\(event, message\)\}/g)?.length, 2);
  // Only the selection travels, not the whole message.
  assert.match(transcript, /onRunContribution\?\.\(action, selectionMenu\.message, selectionMenu\.selection\)/);
  // No selection, or no app offering a text action, falls through to the
  // browser menu rather than swallowing the event.
  assert.match(
    transcript,
    /const selection = selectedTextInMessage\(event\);\s*\n\s*if \(!selection \|\| !messageActions\?\.contributions\?\.some\([\s\S]{0,120}\) return;\s*\n\s*event\.preventDefault\(\)/
  );
});

test("the Mini App action toast is one shared component and is always dismissible", () => {
  const toast = read("./lib/miniapps/MiniAppActionToast.svelte");
  const projectChat = read("./lib/projects/ProjectChat.svelte");
  // One component, not a copy per chat surface (pitfall #7).
  assert.match(view, /<MiniAppActionToast/);
  assert.match(projectChat, /<MiniAppActionToast/);
  for (const source of [view, projectChat]) {
    assert.doesNotMatch(source, /<div class="chat-action-toast"/);
  }
  // The close button always exists, whether or not a card is present.
  assert.match(toast, /class="chat-action-toast-close"[\s\S]{0,200}onclick=\{onDismiss\}/);
  assert.match(toast, /aria-label=\{dismissLabel\}/);

  // A card is read, so it waits for the owner; a bare sentence self-clears.
  for (const source of [view, projectChat]) {
    assert.match(source, /if \(!miniAppActionCard\) \{\s*\n\s*miniAppActionFeedbackTimer = setTimeout\(/);
    // Dismissing clears the pending timer too, or it would fire onto a toast
    // that is already gone and wipe a newer one.
    assert.match(source, /function dismissMiniAppFeedback\(\)[\s\S]{0,320}clearTimeout\(miniAppActionFeedbackTimer\)/);
  }

  // Text owns the slack so the close control is never the thing truncated.
  assert.match(styles, /\.chat-action-toast-text \{[^}]*flex: 1 1 auto/s);
  assert.match(styles, /\.chat-action-toast-close \{[^}]*flex: 0 0 auto/s);
  assert.match(styles, /\.chat-action-toast-close:focus-visible \{[^}]*var\(--accent\)/s);
  // Type comes from the scale, not a hand-set px (pitfall #24).
  assert.match(styles, /\.chat-action-toast \{[^}]*font-size: var\(--fs-label\)[^}]*line-height: var\(--lh-label\)/s);
});
