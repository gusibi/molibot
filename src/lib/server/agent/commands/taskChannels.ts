export type TaskChannel = "web" | "telegram" | "feishu" | "qq" | "weixin";

export interface TaskChannelRoot {
  channel: TaskChannel;
  dir: string;
}

export const TASK_CHANNEL_ROOTS: TaskChannelRoot[] = [
  { channel: "web", dir: "moli-w" },
  { channel: "telegram", dir: "moli-t" },
  { channel: "feishu", dir: "moli-f" },
  { channel: "qq", dir: "moli-q" },
  { channel: "weixin", dir: "moli-wx" },
];

export const SYSTEM_TASK_CHANNEL = "system" as const;
export const SYSTEM_TASK_OWNER_ID = "owner";
export const SYSTEM_TASK_BOTS_DIR = "system/bots";
