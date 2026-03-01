export type PromptChannel = "telegram" | "feishu";

export function buildPromptChannelSections(channel: PromptChannel): string[] {
  switch (channel) {
    case "telegram":
      return [];
    default:
      return [];
  }
}
