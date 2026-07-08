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
