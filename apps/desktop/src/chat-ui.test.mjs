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
  plugins: read("./lib/settings/PluginsSection.svelte"),
  providers: read("./lib/settings/ProvidersSection.svelte"),
  sandbox: read("./lib/settings/SandboxSection.svelte"),
  usage: read("./lib/settings/UsageSection.svelte"),
  trace: read("./lib/settings/TraceSection.svelte"),
  image: read("./lib/settings/ImageGenerateSection.svelte"),
  tts: read("./lib/settings/TtsGenerateSection.svelte")
};
const charts = read("./lib/settings/charts.ts");
const row = read("./lib/chat/ConversationRow.svelte");
const transcript = read("./lib/chat/ConversationTranscript.svelte");
const transcriptAttachments = read("./lib/chat/TranscriptAttachments.svelte");
const runActivity = read("./lib/chat/RunActivity.svelte");
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
const chatMessagesPane = read("./lib/chat/ChatMessagesPane.svelte");
const chatHeader = read("./lib/chat/ChatHeader.svelte");
const pageHeader = read("./lib/components/ui/PageHeader.svelte");
const overflowMenu = read("./lib/components/ui/OverflowMenu.svelte");
const settingGroup = read("./lib/components/ui/SettingGroup.svelte");
const recordingBar = read("./lib/chat/RecordingBar.svelte");
const projectChat = read("./lib/projects/ProjectChat.svelte");
const projectChatStoreSource = read("./lib/projects/projectChatStore.svelte.ts");
const projectFilePanel = read("./lib/projects/ProjectFilePanel.svelte");
const taskStore = read("./lib/stores/tasks.svelte.ts");
const skillsStoreSource = read("./lib/stores/skills.svelte.ts");
const conversationController = read("./lib/chat/conversationController.svelte.ts");
const transcriptHelpers = read("./lib/chat/transcript.ts");
const markdown = read("./lib/markdown.ts");
const queuedMessagesBar = read("./lib/chat/QueuedMessagesBar.svelte");
const logsSection = read("./lib/settings/LogsSection.svelte");
const activeRunsRoute = read("../../../src/routes/api/desktop/active-runs/+server.ts");
const streamStopRoute = read("../../../src/routes/api/stream/stop/+server.ts");

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
  assert.match(sections.providers, /class="provider-browser-list" role="listbox"/);
  assert.match(sections.providers, /class="provider-technical-details technical-detail"/);
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
  assert.match(styles, /\.automation-workspace-layout\.detail-open\s*\{[^}]*grid-template-columns:\s*320px minmax\(420px, 1fr\)/s);
  assert.match(styles, /@media \(max-width: 1099px\)[\s\S]*\.automation-task-detail\s*\{[^}]*position:\s*absolute/s);
});

test("issue 13 Chat renders an Agent message unit and a compact 720px composer", () => {
  assert.match(transcript, /class="assistant-identity"/);
  assert.match(transcript, /copy\.appName/);
  // All rows share one centered reading column matching the composer width.
  assert.match(styles, /\.message-row\s*\{[^}]*max-width:\s*var\(--message-content-width\)[^}]*margin:[^}]*auto/s);
  // The Agent avatar sits to the LEFT of the message, not stacked above it.
  assert.match(transcript, /class="assistant-avatar"/);
  assert.match(styles, /\.assistant-layout\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /\.composer-wrap\s*\{[^}]*max-width:\s*var\(--message-content-width\)/s);
  assert.match(styles, /\.composer textarea\s*\{[^}]*min-height:\s*42px;[^}]*max-height:\s*180px/s);
  assert.match(transcript, /humanizeModelOption\(message\.model, message\.model\)\.label/);
  assert.match(view, /activeAgentName[\s\S]*copy\.agentStudioGlobalName/);
  assert.match(view, /class:open=\{searchOpen\} class="search-bar"/);
  assert.match(styles, /\.composer\s*\{[^}]*flex-direction:\s*column/s);
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
  assert.match(view, /class="command-palette"[\s\S]*copy\.newChat/);
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
  // Project and Chat share the same collapsible group rhythm and 40px Session row.
  assert.match(styles, /\.conv-group-head\s*\{[^}]*height:\s*34px/s);
  assert.match(row, /\.conversation-row\s*\{[^}]*min-height:\s*40px/s);
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
  assert.match(agentStudio, /setInterval\(\(\) => void refresh\(\), 2500\)/);
  assert.match(agentStudio, /generation !== refreshGeneration/);
  assert.match(agentStudio, /SLOT_STORAGE_KEY = "molibot-agent-city-slots-v1"/);
  assert.match(agentStudio, /projectAgentCity/);
  assert.match(agentStudio, /<AgentCityCanvas/);
  assert.match(agentStudio, /<AgentCityFallback/);
  assert.match(agentStudio, /class="agent-city-agent-label"/);
  assert.match(agentStudio, /role="tooltip"/);
  assert.match(agentStudio, /floor\.activity\.taskPreview/);
  assert.match(agentStudio, /floor\.subagents\.visible/);
  assert.match(agentStudio, /projection\.hiddenAgentCount/);
  assert.match(agentStudio, /visibilitychange/);
  assert.match(agentCityFallback, /agent-city-fallback-building/);
  assert.match(agentCityFallback, /floor\.activity\.botName/);
  assert.match(agentCityFallback, /floor\.activity\.channel/);
  assert.match(agentCityFallback, /floor\.activity\.startedAt/);
  assert.match(agentCityFallback, /floor\.activity\.taskPreview/);
  assert.match(agentCityFallback, /floor\.agent\.modelOverrides/);
  assert.match(agentCityFallback, /floor\.subagents\.visible/);
  assert.match(agentCityFallback, /role="tooltip"/);
  assert.match(agentCityFallback, /aria-describedby/);
});

test("Agent City owns WebGL lifecycle, quality fallback, and GPU cleanup", () => {
  assert.match(agentCityCanvas, /supportsAgentCityWebGL2\(\)/);
  assert.match(agentCityCanvas, /new ResizeObserver/);
  assert.match(agentCityCanvas, /new IntersectionObserver/);
  assert.match(agentCityCanvas, /function stopAnchorUpdates/);
  assert.match(agentCityCanvas, /!controller \|\| !visible \|\| document\.hidden/);
  assert.match(agentCityCanvas, /prefers-reduced-motion: reduce/);
  assert.match(agentCityCanvas, /controller\?\.setQuality\("low"\)/);
  assert.match(agentCityCanvas, /controller\?\.dispose\(\)/);
  assert.match(agentCityScene, /new THREE\.OrthographicCamera/);
  assert.match(agentCityScene, /setQuality\(quality: Exclude<AgentCityQuality, "fallback">\)/);
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
  // New chat persists (or reuses) its Session before selecting it.
  assert.match(view, /await createDesktopSession\(connectedEndpoint, defaultBot\(\)\)/);
  assert.match(view, /chatStore\.selectSession\(/);
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
  assert.match(view, /window\.addEventListener\("blur", stopSidebarResize\)/);
  assert.match(view, /document\.addEventListener\("mouseleave", stopSidebarResize\)/);
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
  assert.match(styles, /\.message-row\.mine \.message-bubble \{[^}]*background: var\(--gray-100\)/s);
  assert.match(styles, /\.run-activity \{[^}]*border: 0;[^}]*background: transparent/s);
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

test("automation workspace keeps each task in a bounded card while retaining task details", () => {
  const workspacePane = read("./lib/chat/ChatWorkspacePane.svelte");
  assert.match(workspacePane, /<TasksSection presentation="workspace"/);
  assert.match(sections.tasks, /presentation\?: "settings" \| "workspace"/);
  assert.match(sections.tasks, /class="automation-workspace-layout"/);
  assert.match(sections.tasks, /class="automation-task-row"/);
  assert.match(sections.tasks, /class="automation-task-detail"/);
  assert.match(styles, /\.automation-workspace-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\([^;]+480px\)\)/s);
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
  assert.match(transcript, /<details class="thinking-card">/);
  assert.doesNotMatch(transcript, /<details class="thinking-card" open>/);
  assert.match(conversationLiveView, /<details class="thinking-card">/);
  assert.doesNotMatch(conversationLiveView, /<details class="thinking-card" open>/);
  assert.doesNotMatch(runActivity, /<details class="run-activity" open=/);
});

test("structured runner events do not leak into the live answer status", () => {
  const conversationTurn = read("./lib/chat/conversationTurn.ts");
  assert.match(conversationTurn, /if \(event === "status"\) \{/);
  assert.doesNotMatch(conversationTurn, /event === "status" \|\| event === "runner_event"/);
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
  assert.match(styles, /\.settings-footbar\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/s);
  assert.match(sections.tts, /open=\{provider\.id === toolsStore\.ttsGenerateEdit\.defaultProvider\}/);
  assert.match(sections.image, /<option value="1024x1024">1024 × 1024<\/option>/);
  assert.match(sections.plugins, /memoryDailyMaterials\.enabled/);
  assert.match(sections.plugins, /memoryDailyMaterials\.projectId/);
  assert.match(sections.plugins, /memoryDailyMaterials\.promptPath/);
  assert.match(sections.plugins, /memoryReflectionNotificationTarget/);
  assert.match(sections.plugins, /reflectionNotificationTargets/);
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
  assert.match(view, /<ProjectFilePanel/);
  assert.match(projectFilePanel, /selectTab\("files"\)/);
  assert.match(projectFilePanel, /selectTab\("changes"\)/);
  assert.match(projectFilePanel, /selectTab\("attachments"\)/);
  assert.match(projectFilePanel, /loadDesktopProjectTree/);
  assert.match(projectFilePanel, /loadDesktopProjectGitStatus/);
  assert.match(projectFilePanel, /listDesktopSessionFiles\(endpoint, "personal", sessionId, projectId\)/);
  assert.match(projectFilePanel, /projectReadOnlyHint/);
  assert.match(styles, /\.project-file-tabs/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.chat-layout\.with-files \.file-panel/);
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
  assert.match(sections.usage, /class="observatory-filter-grid usage-filter-grid"/);
  assert.match(sections.usage, /usageStore\.query\.modelId/);
  assert.match(sections.usage, /usage\.rankings\[rankingView\]/);
  assert.match(sections.usage, /class="observatory-table"/);
  assert.match(sections.usage, /updateUsageQuery\(\{ page:/);
  assert.match(sections.usage, /class="trend-line trend-line-token" d=\{tokenLine\}/);
  assert.match(sections.usage, /class="donut-seg"/);
  assert.match(sections.usage, /class="window-bar-track"/);
  assert.match(sections.trace, /class="observatory-filter-grid trace-filter-grid"/);
  assert.match(sections.trace, /trace\.rankings\[rankingView\]/);
  assert.match(sections.trace, /trace\.facts\.items/);
  assert.match(sections.trace, /class="hbar-fill"[\s\S]*percentOf\(item\.value, activityMax\)/);
  assert.match(sections.trace, /each outcomeSegments as segment/);
  assert.match(charts, /function trendLinePath\(/);
  assert.match(charts, /function donutSegments\(/);
  assert.match(styles, /--chart-blue:/);
  assert.match(styles, /\.observatory-table\s*\{/);
  assert.match(styles, /\.observatory-mobile-list\s*\{/);
});

test("Desktop Trace exposes live, stuck, and orphan run controls", () => {
  const traceSection = read("./lib/settings/TraceSection.svelte");
  assert.match(traceSection, /loadDesktopActiveRuns/);
  assert.match(traceSection, /stopDesktopActiveRun/);
  assert.match(traceSection, /traceRunStuck/);
  assert.match(traceSection, /traceClearOrphan/);
  assert.match(traceSection, /setInterval\(\(\) => void refreshActiveRuns\(\), 3000\)/);
  assert.doesNotMatch(traceSection, /onMount\(\(\) => \{\s*void refreshActiveRuns\(\)/);
  assert.match(activeRunsRoute, /snapshotAllRuntimeRuns\(\)/);
  assert.match(activeRunsRoute, /abortRuntimeRun/);
});

test("Desktop Trace delete opens an in-app confirmation before submitting", () => {
  const traceSection = read("./lib/settings/TraceSection.svelte");
  assert.match(traceSection, /let pendingActiveRun = \$state<DesktopActiveRunItem \| null>\(null\)/);
  assert.match(traceSection, /pendingActiveRun = item/);
  assert.match(traceSection, /role="dialog"/);
  assert.match(traceSection, /activeRunDialog\?\.focus\(\)/);
  assert.match(traceSection, /stopDesktopActiveRun\(session\.endpoint, selected\.runId\)/);
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

test("Memory Center keeps overview, topics, and all memories as separate product tabs", () => {
  assert.match(sections.memory, /type MemoryCenterTab = "overview" \| "topics" \| "all"/);
  assert.match(sections.memory, /data-memory-view="overview"/);
  assert.match(sections.memory, /data-memory-view="topics"/);
  assert.match(sections.memory, /data-memory-view="all"/);
  assert.match(sections.memory, /session\.text\.memoryUnderstandingTitle/);
  assert.match(sections.memory, /class="memory-topic-workspace"/);
  assert.match(sections.memory, /class="memory-all-view"/);
  assert.doesNotMatch(sections.memory, /activeTab === "advanced"/);
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
