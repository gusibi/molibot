import type { DesktopMiniAppItem, DesktopMiniAppResourceLocator, DesktopMiniAppResultCard } from "@molibot/desktop-contract";
import type { TranscriptContributionAction } from "../chat/transcript";
import type { TranscriptMessage } from "../chat/transcript";
import { invokeDesktopMiniAppAction } from "../api";

/** Projects only currently invocable text actions into the shared transcript UI. */
export function catalogMessageActions(
  items: readonly DesktopMiniAppItem[],
  locale: string
): TranscriptContributionAction[] {
  const chinese = locale.toLowerCase().startsWith("zh");
  return items.flatMap((app) => {
    if (!app.enabled || app.status !== "active" || app.error) return [];
    return app.messageActions.map((action) => ({
        id: `${app.id}:${action.tool}`,
        appId: app.id,
        tool: action.tool,
        label: chinese ? action.label.zh : action.label.en,
        icon: action.icon,
        accepts: [...action.accepts]
      }));
  });
}

export async function invokeTranscriptMessageAction(
  endpoint: string,
  action: TranscriptContributionAction,
  message: TranscriptMessage,
  options: { selection?: string; sessionTitle?: string; resource?: DesktopMiniAppResourceLocator } = {}
): Promise<{ text: string; card: DesktopMiniAppResultCard | null }> {
  const result = await invokeDesktopMiniAppAction(endpoint, {
    appId: action.appId,
    tool: action.tool,
    capture: {
      text: message.content,
      ...(options.selection ? { selection: options.selection } : {}),
      role: message.role === "user" ? "user" : "assistant",
      ...(options.sessionTitle ? { source: { sessionTitle: options.sessionTitle } } : {})
    },
    ...(options.resource ? { resources: [options.resource] } : {})
  });
  // The App's text stays the primary feedback; the card is an extra, so a
  // result with no card is an ordinary success rather than a degraded one.
  return {
    text: result.content.map((item) => item.text.trim()).filter(Boolean).join("\n") || action.label,
    card: result.card ?? null
  };
}
