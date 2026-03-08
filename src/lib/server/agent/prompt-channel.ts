export type PromptChannel = "telegram" | "feishu" | "qq" | "web";

export function buildPromptChannelSections(channel: PromptChannel): string[] {
  switch (channel) {
    case "telegram":
      return [];
    default:
      return [];
  }
}
