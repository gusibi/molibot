export const TELEGRAM_SHARED_COMMANDS = [
  "stop",
  "steer",
  "followup",
  "follow_up",
  "queue",
  "hosttools",
  "host-tools",
  "project",
  "projects",
  "new",
  "clear",
  "sessions",
  "delete_sessions",
  "help",
  "start",
  "skills",
  "compact",
  "login",
  "logout",
  "models",
  "status",
  "state",
  "thinking"
] as const;

// Curated command menu shown in Telegram's "/" picker. All commands in
// TELEGRAM_SHARED_COMMANDS still work; this only controls which essential ones
// the UI surfaces so the menu stays clean. Advanced commands are documented in
// the grouped /help output instead.
export const TELEGRAM_MENU_COMMANDS: ReadonlyArray<{
  command: string;
  en: string;
  zh: string;
}> = [
  { command: "new", en: "Start a new session", zh: "创建新会话" },
  { command: "clear", en: "Clear current session context", zh: "清除当前会话上下文" },
  { command: "stop", en: "Stop the running task", zh: "停止当前任务" },
  { command: "sessions", en: "List or switch sessions", zh: "查看/切换会话" },
  { command: "status", en: "Show bot/session/runtime status", zh: "查看运行状态" },
  { command: "models", en: "Show or switch model", zh: "查看/切换模型" },
  { command: "skills", en: "List loaded skills", zh: "查看已加载技能" },
  { command: "project", en: "Select or exit Project mode", zh: "选择/退出 Project 模式" },
  { command: "help", en: "Show all available commands", zh: "查看全部命令" }
] as const;
