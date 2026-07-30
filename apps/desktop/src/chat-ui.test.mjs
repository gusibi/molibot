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
const styles = read("./styles.css");
const design = read("../../../DESIGN.md");
const tauriConfig = JSON.parse(read("../src-tauri/tauri.conf.json"));
const tauriCargo = read("../src-tauri/Cargo.toml");
const svelteStyleSources = listSvelteSources().flatMap((source) => [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map((match) => match[1]));
const allStyleSources = [styles, ...svelteStyleSources];
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
const slashSuggestionMenu = read("./lib/chat/SlashSuggestionMenu.svelte");

const projectSettingsDialog = read("./lib/projects/ProjectSettingsDialog.svelte");
const taskScheduleBuilder = read("./lib/settings/TaskScheduleBuilder.svelte");
const nativeTimeInput = read("./lib/components/ui/NativeTimeInput.svelte");
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
const projectFilePanel = read("./lib/projects/ProjectFilePanel.svelte");
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
  assert.match(transcript, /externalHttpUrlFromClick/);
  assert.match(transcript, /invoke\("open_external_url", \{ url \}\)/);
  assert.ok(transcript.indexOf("externalHttpUrlFromClick(event)") < transcript.indexOf("await copyCode(event)"));
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
  assert.match(models, /humanizeModelOption/);
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
  assert.match(styles, /\.automation-workspace-layout\.detail-open\s*\{[^}]*grid-template-columns:\s*minmax\(250px, 320px\) minmax\(0, 1fr\)/s);
  // The detail pane overlays the list only when the workspace CONTAINER (not
  // the viewport — the sidebar eats ~220px) is too narrow for side-by-side.
  assert.match(styles, /\.automation-workspace\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(styles, /@container \(max-width: 679px\)[\s\S]*\.automation-task-detail\s*\{[^}]*position:\s*absolute/s);
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
  assert.match(styles, /\.composer-wrap\s*\{[^}]*max-width:\s*calc\(var\(--message-content-width\)[^}]*padding:[^}]*clamp\(20px, 5vw, 56px\)/s);
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
  assert.match(projectSettingsDialog, /class="settings-footbar"/);
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
  assert.match(projectTree, /project-tree-head/);
  assert.doesNotMatch(projectTree, /project-tree-actions/);
  assert.match(projectTree, /opacity: 0; pointer-events: none/);
  assert.match(row, /\.row-title\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/s);
  assert.doesNotMatch(row, /\.row-title\s*\{[^}]*max-width:/s, "the title must grow with the resized sidebar");
  assert.match(row, /\.row-time\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(row, /right: 10px/);
  assert.doesNotMatch(view, /const firstBot = externalNav/);
  // Project and Chat share the same collapsible group rhythm and DESIGN's compact 32px Session row.
  assert.match(styles, /\.conv-group-head\s*\{[^}]*height:\s*34px/s);
  assert.match(design, /label-12:\s*[\s\S]*?fontSize:\s*12px[\s\S]*?lineHeight:\s*16px/);
  assert.match(design, /button-small:\s*[\s\S]*?height:\s*32px/);
  assert.match(row, /\.conversation-row\s*\{[^}]*min-height:\s*32px[^}]*padding:\s*4px 8px/s);
  assert.match(row, /\.row-title\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*16px/s);
  assert.match(row, /\.row-time\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*16px/s);
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
  assert.match(agentStudio, /\{#if hoveredFloor\}/);
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
  assert.match(agentCityScene, /new THREE\.OrthographicCamera/);
  assert.match(agentCityScene, /new THREE\.Raycaster\(\)/);
  assert.match(agentCityScene, /function addFloorTarget/);
  assert.match(agentCityScene, /target\.userData\.floorKey = floor\.key/);
  assert.match(agentCityScene, /raycaster\.intersectObjects\(floorTargets, false\)/);
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
  assert.doesNotMatch(agentCityScene, /OrbitControls|TrackballControls|MapControls/);
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
  assert.match(view, /activeHeaderAvatar/);
  assert.match(view, /openExternalTranscript\(item\.sessionId, item\.channel, item\.title, item\.botName\)/);
  assert.doesNotMatch(view, /activeExternalTitle\?\.replace/);
  assert.doesNotMatch(view, /class="chat-title-sub"[\s\S]*copy\.statusOnline/);
  assert.doesNotMatch(view, /aria-label=\{copy\.openSettings\} title=\{copy\.openSettings\}/);
  assert.match(view, /serviceState=\{serviceState\}/);
  assert.match(chatSidebar, /sidebar-footer-logo-wrap/);
  assert.match(chatSidebar, /data-state=\{serviceState\}/);
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
  assert.match(view, /<WindowDragMask \/>/);
  assert.match(app, /<WindowDragMask \/>/);
  assert.match(windowDragMask, /getCurrentWindow\(\)\.startDragging\(\)/);
  assert.match(styles, /\.window-drag-mask\s*\{[^}]*position:\s*absolute;[^}]*height:\s*var\(--toolbar-height\);[^}]*z-index:\s*30;/s);
  assert.match(chatSidebar, /class="sidebar-titlebar-drag" data-tauri-drag-region/);
  assert.match(sidebarShell, /class="sidebar-titlebar-drag" data-tauri-drag-region/);
  assert.match(styles, /\.sidebar-titlebar-drag\s*\{[^}]*position:\s*absolute;[^}]*height:\s*30px;/s);
  assert.match(view, /class="chat-header-avatar" data-tauri-drag-region/);
  assert.match(chatHeader, /class="chat-header-avatar" data-tauri-drag-region/);
  assert.match(workspacePane, /class="workspace-page-title" data-tauri-drag-region/);
  assert.match(styles, /\.header-actions\s*\{[^}]*z-index:\s*31;/s);
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

test("automation management uses a command deck and opens full history in a modal", () => {
  assert.match(sections.tasks, /class="automation-command-deck"/);
  assert.match(sections.tasks, /class="automation-card" data-status=/);
  assert.match(sections.tasks, /<Dialog[\s\S]*contentClass="task-history-modal"/);
  assert.match(sections.tasks, /<AlertDialog[\s\S]*contentClass="task-delete-confirm-modal"/);
  assert.match(sections.tasks, /openTaskHistory\(task\.id\)/);
  assert.doesNotMatch(sections.tasks, /class="task-history-panel"/);
  assert.match(styles, /\.task-history-modal\s*\{[^}]*width:\s*min\(820px/s);
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

test("automation details are opt-in and execution state stays task-scoped", () => {
  assert.match(sections.tasks, /selectedTaskId \? filteredTaskItems\.find/);
  assert.match(sections.tasks, /class="automation-detail-close"/);
  assert.match(sections.tasks, /class:detail-open=\{Boolean\(selectedTask\)\}/);
  assert.match(sections.tasks, /session\.text\.tasksLatestResult/);
  assert.match(sections.tasks, /session\.text\.tasksLastTriggered\} \{formatTaskTime/);
  assert.match(sections.tasks, /setTaskEnabled\(selectedTask\.id, !selectedTask\.enabled\)/);
  assert.match(sections.tasks, /isTaskRunning\(selectedTask\.id\)/);
  assert.match(taskStore, /runningTaskIds: new Set<string>\(\)/);
  assert.match(taskStore, /if \(action === "trigger"\) tasksStore\.runningTaskIds/);
  assert.match(styles, /\.automation-workspace-layout\.detail-open\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /@keyframes automation-spin/);
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
  assert.match(chatInputArea, /thinkingLevelOptions/);
  assert.match(chatInputArea, /\{#each thinkingLevelOptions as level/);
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
  assert.match(sections.image, /<option value="1024x1024">1024 × 1024<\/option>/);
  assert.match(sections.plugins, /memoryDailyMaterials\.enabled/);
  assert.match(sections.plugins, /memoryDailyMaterials\.projectId/);
  assert.match(sections.plugins, /memoryDailyMaterials\.promptPath/);
  assert.match(sections.plugins, /memoryReflectionNotificationTarget/);
  assert.match(sections.plugins, /reflectionNotificationTargets/);
  assert.equal(
    sections.plugins.match(/bind:value=\{pluginsStore\.pluginsEdit\.memoryReflectionNotificationTarget\}/g)?.length,
    2,
    "the shared memory notification target must be editable from both memory and daily-material cards"
  );
  assert.match(sections.plugins, /disabled=\{!pluginsStore\.pluginsEdit\.memoryReflectionNotifications && !pluginsStore\.pluginsEdit\.memoryDailyMaterials\.notifications\}/);
});

test("settings form controls share the DESIGN input height and time fields use the native picker", () => {
  assert.match(design, /input:\s*[\s\S]*?height:\s*40px/);
  assert.match(styles, /\.settings-field input\s*\{[^}]*height:\s*40px[^}]*padding:\s*0 12px/s);
  assert.match(styles, /\.settings-field select\s*\{[^}]*height:\s*40px[^}]*padding:\s*0 30px 0 12px/s);
  assert.equal(sections.plugins.match(/<NativeTimeInput/g)?.length, 2);
  assert.equal(taskScheduleBuilder.match(/<NativeTimeInput/g)?.length, 1);
  assert.match(nativeTimeInput, /<input type="time"[^>]*onpointerdown=\{openNativePicker\}/);
  assert.match(nativeTimeInput, /input\.showPicker\(\)/);
  assert.doesNotMatch(sections.plugins, /class="settings-row settings-field"/);
});

test("project creation asks for a name before offering managed or existing directories", () => {
  const projectList = readFileSync(new URL("./lib/projects/ProjectList.svelte", import.meta.url), "utf8");
  const projectTree = readFileSync(new URL("./lib/projects/ProjectTree.svelte", import.meta.url), "utf8");
  for (const source of [projectList, projectTree]) {
    assert.match(source, /selectedRootPath/);
    assert.match(source, /copy\.projectCreateAction/);
    assert.match(source, /(?:addProject|createProject)\(\{ name: name\.trim\(\), rootPath: selectedRootPath \}\)/);
  }
  assert.match(projectList, /pick_project_directory/);
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
  assert.match(projectDetail, /showAvatar=\{false\}/);
  assert.doesNotMatch(projectDetail, /subtitle=\{project\.rootPath\}/);
  assert.match(projectDetail, /class="icon-button"[\s\S]*aria-label=\{copy\.search\}/);
  assert.match(projectDetail, /class="icon-button"[\s\S]*aria-label=\{copy\.files\}/);
  assert.doesNotMatch(projectDetail, /aria-label=\{copy\.delete\}/);
  assert.match(chatHeader, /class="chat-header"/);
  assert.match(chatHeader, /class="chat-header-avatar"/);
});

test("project file panel exposes live files, Git changes, and session attachments", () => {
  const filesStore = read("./lib/projects/projectFilesStore.svelte.ts");
  assert.match(view, /<ProjectFilePanel/);
  assert.match(projectFilePanel, /tab = "files"/);
  assert.match(projectFilePanel, /tab = "changes"/);
  assert.match(projectFilePanel, /tab = "attachments"/);
  // Tree, Git and search now load through the shared store, not the component.
  assert.match(filesStore, /loadDesktopProjectTree/);
  assert.match(filesStore, /loadDesktopProjectGitStatus/);
  assert.match(projectFilePanel, /listDesktopSessionFiles\(endpoint, "personal", sessionId, projectId\)/);
  assert.match(projectFilePanel, /projectReadOnlyHint/);
  assert.match(styles, /\.project-file-tabs/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.chat-layout\.with-files \.file-panel/);
});

test("project file tree expands in place and keeps its expansion state", () => {
  const filesStore = read("./lib/projects/projectFilesStore.svelte.ts");
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
  const filesStore = read("./lib/projects/projectFilesStore.svelte.ts");
  const codeViewer = read("./lib/projects/CodeViewer.svelte");
  assert.match(filesStore, /tabs = \$state<OpenTab\[\]>/);
  assert.match(filesStore, /closeTab\(id: string\)/);
  // Opening a file appends a tab; it must never replace the ones already open.
  assert.match(filesStore, /const next = \[\.\.\.this\.tabs, tab\]/);
  assert.match(projectFilePanel, /<CodeViewer/);
  assert.match(codeViewer, /highlightLines/);
  assert.match(codeViewer, /code-line-number/);
  assert.match(codeViewer, /codeViewerWrap/);
  assert.match(codeViewer, /codeViewerFind/);
  assert.match(styles, /\.project-viewer-tab/);
  assert.match(styles, /\.code-viewer-scroll\.wrap \.code-line-text/);
});

test("project file search covers names and contents and reveals the hit", () => {
  const filesStore = read("./lib/projects/projectFilesStore.svelte.ts");
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
  assert.match(view, /touches=\{\$sessionFileTouches\}/);
  assert.match(treeNode, /class:touched=\{touchedPaths\.has\(entry\.path\)\}/);
  assert.match(projectFilePanel, /touches\.written\.has\(entry\.path\)/);
  assert.match(projectFilePanel, /changeScope === "session" \? sessionEntries : gitEntries/);
  assert.match(styles, /\.project-change-scope/);
  assert.match(styles, /\.file-tree-row\.touched/);
});

test("project file panel follows file changes live and stays resizable", () => {
  const filesStore = read("./lib/projects/projectFilesStore.svelte.ts");
  assert.match(filesStore, /watchDesktopProjectFiles/);
  assert.match(filesStore, /applyChanges\(batch: DesktopProjectChangeBatch\)/);
  // An overflow batch reloads wholesale instead of enumerating paths.
  assert.match(filesStore, /if \(batch\.overflow\)/);
  assert.match(view, /class="files-resizer"/);
  assert.match(view, /molibot-desktop-files-width/);
  assert.match(styles, /\.chat-layout\.with-files \{ grid-template-columns:[^}]*var\(--files-w/);
  assert.match(styles, /\.files-resizer/);
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
  assert.match(app, /id: "tools", sections: \["mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate", "hostBash"\]/);
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
    "--file-color", "--agent-city-height", "--size", "--conversation-row-overlay"
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
