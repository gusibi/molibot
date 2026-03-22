export type PromptChannel = "telegram" | "feishu" | "qq" | "weixin" | "web";

export function buildPromptChannelSections(channel: PromptChannel): string[] {
  switch (channel) {
    case "telegram":
      return [];
    default:
      return [];
  }
}
