export type PromptChannel = "telegram";

export function buildPromptChannelSections(channel: PromptChannel): string[] {
  switch (channel) {
    case "telegram":
      return [];
    default:
      return [];
  }
}
