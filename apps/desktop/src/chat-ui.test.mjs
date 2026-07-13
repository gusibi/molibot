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
const chatSidebar = read("./lib/chat/ChatSidebar.svelte");
const chatWorkspace = read("./lib/chat/ChatWorkspacePane.svelte");
const chatComposerShell = read("./lib/chat/ChatComposerShell.svelte");
const chatInputArea = read("./lib/chat/ChatInputArea.svelte");
const slashSuggestionMenu = read("./lib/chat/SlashSuggestionMenu.svelte");
const projectSettingsDialog = read("./lib/projects/ProjectSettingsDialog.svelte");
const chatMessagesPane = read("./lib/chat/ChatMessagesPane.svelte");
const chatHeader = read("./lib/chat/ChatHeader.svelte");
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
  assert.match(projectChat, /event\.key === "Enter" && event\.shiftKey/);
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
  assert.match(row, /max-width: min\(30ch, 100%\)/);
  assert.match(row, /right: 12px/);
  assert.match(row, /right: 10px/);
  assert.doesNotMatch(view, /const firstBot = externalNav/);
  // Project and Chat share the same collapsible group rhythm and 40px Session row.
  assert.match(styles, /\.conv-group-head\s*\{[^}]*height:\s*34px/s);
  assert.match(row, /\.conversation-row\s*\{[^}]*min-height:\s*40px/s);
});

test("Agent Studio sits below Skills and nests animated Subagents under their parent Agent", () => {
  const skillsPosition = chatSidebar.indexOf('activeWorkspacePane === "skills"');
  const agentsPosition = chatSidebar.indexOf('activeWorkspacePane === "agents"');
  assert.ok(skillsPosition >= 0 && agentsPosition > skillsPosition);
  assert.match(view, /onOpenAgents=\{\(\) => openWorkspacePane\("agents"\)\}/);
  assert.match(chatWorkspace, /<AgentStudioPane/);
  assert.match(agentStudio, /id: "default"/);
  assert.match(agentStudio, /agents\.some\(\(agent\) => agent\.id === "default"\) \? agents : \[globalAgent, \.\.\.agents\]/);
  assert.match(agentStudio, /loadDesktopAgents\(serviceEndpoint\)/);
  assert.match(agentStudio, /loadDesktopAgentActivity\(serviceEndpoint\)/);
  assert.match(agentStudio, /setInterval\(\(\) => void refresh\(\), 2500\)/);
  assert.match(agentStudio, /class="pug pug--typing"/);
  assert.match(agentStudio, /class="pug pug--phone"/);
  assert.match(agentStudio, /class="pug-phone"/);
  assert.match(agentStudio, /class="agent-link"/);
  assert.match(agentStudio, /activity\.subagents\.slice\(0, 3\)/);
  assert.match(agentStudio, /class="subagent-pug"/);
  assert.match(agentStudio, /class="agent-bot-badge"/);
  assert.match(agentStudio, /class="agent-work-tooltip"/);
  assert.match(agentStudio, /activity\.taskPreview/);
  assert.match(agentStudio, /copy\.agentStudioActivityStatus/);
  assert.match(styles, /\.agent-desk--active-context:hover[^}]*z-index:\s*40/s);
  assert.match(agentStudio, /ph-file-text[\s\S]*ph-file-text[\s\S]*ph-file-text/);
  assert.match(agentStudio, /copy\.agentStudioOwner/);
  assert.match(agentStudio, /visibilitychange/);
  assert.match(styles, /@keyframes pug-type/);
  assert.match(styles, /@keyframes pug-phone-glow/);
  assert.match(styles, /prefers-reduced-motion:[\s\S]*\.pug--typing/);
  assert.match(styles, /\.agent-desks\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(styles, /\.agent-desk\s*\{[^}]*min-height:\s*190px/s);
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
  assert.match(view, /loading = false;\s*void selectDefaultSession\(generation\)/);
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
  assert.match(styles, /\.window-drag-mask\s*\{[^}]*position:\s*absolute;[^}]*height:\s*52px;[^}]*z-index:\s*30;/s);
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

test("automation workspace uses a dense list with a selected task detail pane", () => {
  const workspacePane = read("./lib/chat/ChatWorkspacePane.svelte");
  assert.match(workspacePane, /<TasksSection presentation="workspace" \/>/);
  assert.match(sections.tasks, /presentation\?: "settings" \| "workspace"/);
  assert.match(sections.tasks, /class="automation-workspace-layout"/);
  assert.match(sections.tasks, /class="automation-task-row"/);
  assert.match(sections.tasks, /class="automation-task-detail"/);
  assert.match(styles, /\.automation-workspace-layout\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.automation-task-row\.active\s*\{[^}]*background: var\(--fill\)/s);
});

test("automation workspace separates user and system tasks with accessible tabs", () => {
  assert.match(sections.tasks, /role="tablist"/);
  assert.match(sections.tasks, /session\.text\.tasksUserTab/);
  assert.match(sections.tasks, /session\.text\.tasksSystemTab/);
  assert.match(sections.tasks, /item\.category === activeTaskCategory/);
  assert.match(styles, /\.automation-category-tabs\s*\{/s);
  assert.match(styles, /\.automation-category-tab\.active\s*\{/s);
});

test("automation details are opt-in and execution state stays task-scoped", () => {
  assert.match(sections.tasks, /selectedTaskId \? filteredTaskItems\.find/);
  assert.match(sections.tasks, /onclick=\{\(\) => \(selectedTaskId = ""\)\}/);
  assert.match(sections.tasks, /class:detail-open=\{Boolean\(selectedTask\)\}/);
  assert.match(sections.tasks, /session\.text\.tasksRunCount\} \{task\.runCount\}/);
  assert.match(sections.tasks, /session\.text\.tasksLastTriggered\} \{formatTaskTime/);
  assert.match(sections.tasks, /setTaskEnabled\(selectedTask\.id, !selectedTask\.enabled\)/);
  assert.match(sections.tasks, /isTaskRunning\(selectedTask\.id\)/);
  assert.match(taskStore, /runningTaskIds: new Set<string>\(\)/);
  assert.match(taskStore, /if \(action === "trigger"\) tasksStore\.runningTaskIds/);
  assert.match(styles, /\.automation-workspace-layout\.detail-open\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /@keyframes automation-spin/);
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

test("thinking starts expanded while tool activity stays opt-in", () => {
  assert.match(transcript, /<details class="thinking-card" open>/);
  assert.match(conversationLiveView, /<details class="thinking-card" open>/);
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
  assert.match(app, /class="page-header settings-page-header"[\s\S]*class="settings-scroll"/);
  assert.match(styles, /\.settings-row\s*\{[^}]*min-height:\s*50px/s);
  // Geist cards are flat: solid surface + subtle shadow, no glass blur.
  assert.doesNotMatch(styles, /backdrop-filter/);
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

test("Desktop Trace exposes live, stuck, and orphan run controls", () => {
  const traceSection = read("./lib/settings/TraceSection.svelte");
  assert.match(traceSection, /loadDesktopActiveRuns/);
  assert.match(traceSection, /stopDesktopActiveRun/);
  assert.match(traceSection, /traceRunStuck/);
  assert.match(traceSection, /traceClearOrphan/);
  assert.match(traceSection, /setInterval\(\(\) => void refreshActiveRuns\(\), 3000\)/);
});

test("settings navigation matches the web taxonomy and entity editors open as dialogs", () => {
  assert.match(app, /id: "general", sections: \["general"\]/);
  assert.match(app, /id: "ai", sections: \["models", "providers", "usage", "trace", "mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"\]/);
  assert.match(app, /id: "channels", sections: \["profiles", "channels"\]/);
  assert.match(app, /id: "data", sections: \["agents", "memory", "skills", "runHistory", "logs", "tasks", "hostBash"\]/);
  assert.match(app, /id: "system", sections: \["runtimeEnv", "sandbox", "plugins", "diagnostics"\]/);
  for (const [formId, key] of Object.entries(formSectionKey)) {
    assert.match(sections[key], new RegExp(`id="desktop-${formId}-form"[^>]*aria-label=`));
    assert.match(styles, new RegExp(`#desktop-${formId}-form`));
  }
  assert.match(sections.agents, /class="entity-editor-head"/);
  assert.match(sections.agents, /class="entity-editor-foot"/);
  assert.match(styles, /\.entity-editor-foot\s*\{[^}]*bottom:\s*0/s);
  assert.match(app, /label: sectionLabel\(item\.id, text\)/);
  assert.match(app, /<h2[^>]*>\{sectionLabel\(activeSection, text\)\}<\/h2>/);
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
