import type { TranscriptAttachment, TranscriptAttachmentActions, TranscriptMessage } from "./transcript";

const MEDIA_ATTACHMENT_TYPES = new Set(["image", "audio", "video"]);
const MARKDOWN_IMAGE_HREF_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

function relativeFileName(href: string): string | null {
  const clean = href.split(/[?#]/)[0]?.trim().replaceAll("\\", "/") ?? "";
  if (!clean || clean.startsWith("/")) return null;
  const normalized = clean.replace(/^(?:\.\/)+/, "");
  return normalized.split("/").filter(Boolean).pop() ?? null;
}

function resolveAttachmentForHref(message: TranscriptMessage, href: string): TranscriptAttachment | undefined {
  const images = message.attachments?.filter(attachment => attachment.mediaType === "image" && attachment.local) ?? [];
  const direct = images.filter(image => image.local === href);
  if (!direct.length && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return undefined;
  const activities = [...(message.activities ?? []), ...(message.steps?.flatMap(step => step.kind === "activity" ? [step.activity] : []) ?? [])];
  const output = activities.find(activity => {
    const file = activity.fileOutput;
    return activity.state === "success" && (file?.rootKind === "scratch" || file?.rootKind === "project")
      && (href === file.path || href.endsWith(`/scratch/${file.path}`) || href.endsWith(`/${file.path}`));
  })?.fileOutput;
  const relName = relativeFileName(href);
  const matches = direct.length ? direct : output
    ? images.filter(image => image.original === output.path.split("/").at(-1))
    : relName
      ? images.filter(image => image.original === relName)
      : [];
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Starts the shared loader for recorded image attachments and returns their Blob URL.
 * An unavailable attachment returns empty text; unrelated references retain their URL.
 */
export function chatImageResolver(message: TranscriptMessage, actions: TranscriptAttachmentActions | null): (href: string) => string | undefined {
  const images = message.attachments?.filter(attachment => attachment.mediaType === "image" && attachment.local) ?? [];
  return href => {
    const direct = images.filter(image => image.local === href);
    if (!direct.length && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return undefined;
    const matched = resolveAttachmentForHref(message, href);
    if (!matched) {
      // Ambiguous same-name attachments must not guess a file or leak disk paths.
      const relName = relativeFileName(href);
      if (relName && images.filter(image => image.original === relName).length > 1) return "";
      const activities = [...(message.activities ?? []), ...(message.steps?.flatMap(step => step.kind === "activity" ? [step.activity] : []) ?? [])];
      const output = activities.find(activity => {
        const file = activity.fileOutput;
        return activity.state === "success" && (file?.rootKind === "scratch" || file?.rootKind === "project")
          && (href === file.path || href.endsWith(`/scratch/${file.path}`) || href.endsWith(`/${file.path}`));
      })?.fileOutput;
      if (output && images.filter(image => image.original === output.path.split("/").at(-1)).length > 1) return "";
      return undefined;
    }
    if (!actions) return "";
    const local = matched.local!;
    const url = actions.mediaUrls.get(local);
    const file = actions.filesByLocal.get(local);
    if (!url && file && !actions.mediaLoading.has(local) && !actions.mediaFailed.has(local)) actions.loadMedia(file);
    return url ?? "";
  };
}

/**
 * Returns image, audio, and video attachments that were not already inlined via
 * `![...](href)` in the assistant's Markdown response, so generated/attached
 * media renders directly as visual cards instead of collapsing into file rows.
 */
export function unreferencedMediaAttachments(message: TranscriptMessage, markdownSource: string): TranscriptAttachment[] {
  const media = message.attachments?.filter(att => MEDIA_ATTACHMENT_TYPES.has(att.mediaType)) ?? [];
  if (!media.length) return [];
  const inlinedLocals = new Set<string>();
  for (const match of markdownSource.matchAll(MARKDOWN_IMAGE_HREF_RE)) {
    const href = match[1]?.trim();
    if (!href) continue;
    const resolved = resolveAttachmentForHref(message, href);
    if (resolved?.local) inlinedLocals.add(resolved.local);
  }
  return media.filter(att => att.mediaType !== "image" || !att.local || !inlinedLocals.has(att.local));
}
