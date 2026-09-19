export type InteractionSurface =
  | "menu"
  | "models"
  | "sessions"
  | "projects"
  | "thinking"
  | "skills"
  | "queue"
  | "status";

export type InteractionActionStyle = "default" | "primary" | "danger";

export type InteractionAction =
  | { type: "menu.open" }
  | { type: "models.open"; page?: number }
  | { type: "model.select"; key: string }
  | { type: "model.reset" }
  | { type: "sessions.open"; page?: number }
  | { type: "session.new" }
  | { type: "session.switch"; id: string }
  | { type: "session.delete"; id: string }
  | { type: "session.delete.confirm"; id: string }
  | { type: "projects.open"; page?: number }
  | { type: "project.select"; id: string }
  | { type: "project.exit" }
  | { type: "thinking.open" }
  | { type: "thinking.select"; level: string | null }
  | { type: "skills.open"; page?: number }
  | { type: "skill.open"; name: string }
  | { type: "skill.run"; name: string }
  | { type: "queue.open"; page?: number }
  | { type: "queue.cancel"; id: number }
  | { type: "queue.retry"; id: number }
  | { type: "queue.clear" }
  | { type: "queue.clear.confirm"; ids: number[] }
  | { type: "queue.front" }
  | { type: "queued.stop"; queueId: number }
  | { type: "queued.steer"; queueId: number }
  | { type: "status.open" }
  | { type: "run.stop" }
  | { type: "run.stop.confirm"; runId: string; queueIds: number[] }
  | { type: "run.steer"; runId: string }
  | { type: "run.followup"; runId: string }
  | { type: "input.cancel"; requestId: string };

export interface InteractionContext<TTarget> {
  chatId: string;
  scopeId: string;
  actorId: string;
  target: TTarget;
}

export interface InteractionStateBinding {
  sessionId: string;
  projectId: string | null;
  runId: string | null;
}

export interface InteractionButton {
  label: string;
  token?: string;
  style?: InteractionActionStyle;
  disabledReason?: string;
}

export interface InteractionRow {
  id?: string;
  label: string;
  detail?: string;
  selected?: boolean;
  actions?: InteractionButton[];
}

export interface InteractionSection {
  title?: string;
  body?: string;
  rows?: InteractionRow[];
  actions?: InteractionButton[];
}

export interface InteractionView {
  surface: InteractionSurface | "confirm" | "input" | "result";
  title: string;
  body?: string;
  sections?: InteractionSection[];
  actions?: InteractionButton[];
  note?: string;
}

export type InteractionInputKind = "run.steer" | "run.followup" | "queue.front" | "skill.run";

export interface InteractionInputPrompt {
  requestId: string;
  kind: InteractionInputKind;
  title: string;
  body: string;
  cancelToken: string;
  expiresAt: number;
}

export type InteractionOutcome =
  | { kind: "view"; view: InteractionView }
  | { kind: "input"; input: InteractionInputPrompt }
  | { kind: "notice"; message: string; view?: InteractionView };

export interface InteractionInputConsumeResult {
  handled: boolean;
  message?: string;
  agentText?: string;
  /** True when the bound input prompt must be retired/updated and cannot accept another reply. */
  terminal?: boolean;
}

export interface InteractionModelItem {
  key: string;
  label: string;
  selected: boolean;
}

export interface InteractionModelState {
  route: "text";
  activeKey: string;
  source: "agent" | "global";
  agentId: string;
  canReset: boolean;
  items: InteractionModelItem[];
}

export interface InteractionSessionItem {
  id: string;
  title: string;
  selected: boolean;
  deletable: boolean;
}

export interface InteractionSessionState {
  mode: "chat" | "project";
  projectId: string | null;
  projectName: string | null;
  activeId: string | null;
  items: InteractionSessionItem[];
}

export interface InteractionProjectItem {
  id: string;
  name: string;
  selected: boolean;
}

export interface InteractionThinkingState {
  sessionId: string;
  override: string | null;
  requested: string;
  effective: string;
  supported: string[];
}

export interface InteractionSkillItem {
  name: string;
  description: string;
  scope: string;
  aliases: string[];
}

export interface InteractionQueueItem {
  id: number;
  status: string;
  preview: string;
  createdAt: string;
}

export interface InteractionStatusState {
  sessionId: string;
  projectId: string | null;
  projectName: string | null;
  modelKey: string;
  thinkingEffective: string;
  queueSize: number;
  running: boolean;
  runId: string | null;
}
