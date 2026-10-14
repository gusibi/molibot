import type { TranscriptAttachmentActions, TranscriptMessage } from "./transcript";

/**
 * Starts the shared loader for recorded image attachments and returns their Blob URL.
 * An unavailable attachment returns empty text; unrelated references retain their URL.
 */
export function chatImageResolver(message: TranscriptMessage, actions: TranscriptAttachmentActions | null): (href: string) => string | undefined {
  const images = message.attachments?.filter(attachment => attachment.mediaType === "image" && attachment.local) ?? [];
  const activities = [...(message.activities ?? []), ...(message.steps?.flatMap(step => step.kind === "activity" ? [step.activity] : []) ?? [])];
  return href => {
    const direct = images.filter(image => image.local === href);
    if (!direct.length && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return undefined;
    const output = activities.find(activity => {
      const file = activity.fileOutput;
      return activity.state === "success" && file?.rootKind === "scratch"
        && (href === file.path || href.endsWith(`/scratch/${file.path}`));
    })?.fileOutput;
    const matches = direct.length ? direct : output
      ? images.filter(image => image.original === output.path.split("/").at(-1))
      : [];
    if (!matches.length) return undefined;
    if (matches.length !== 1 || !actions) return "";
    const local = matches[0].local!;
    const url = actions.mediaUrls.get(local);
    const file = actions.filesByLocal.get(local);
    if (!url && file && !actions.mediaLoading.has(local) && !actions.mediaFailed.has(local)) actions.loadMedia(file);
    return url ?? "";
  };
}
