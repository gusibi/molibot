export type PromptChannel = "telegram" | "feishu" | "web";

export function buildPromptChannelSections(channel: PromptChannel): string[] {
  switch (channel) {
    case "telegram":
      return [];
    default:
      return [];
  }
}
