/**
 * Mini App result cards — the declarative shape an app may return beside a
 * tool result so the host can render a small summary instead of a bare line of
 * text ("已收藏：…", "纪要已生成").
 *
 * ## Why declarative rather than an iframe
 *
 * The roadmap sketched this as "复用既有 iframe/CSP 边界". A card is rendered
 * once per tool result inside a transcript, so an iframe per card would mean an
 * unbounded number of live documents in a scrolling list, and — more decisive —
 * an iframe can do anything, which directly contradicts the same paragraph's
 * own constraint that a card is 展示 only and every interaction must jump to
 * the App panel. A fixed declarative shape enforces that constraint by
 * construction: there is nothing in this type that can perform a write, run
 * script, or navigate anywhere except a deep link back into the app itself.
 *
 * The host owns this shape. It is domain-agnostic on purpose (pitfall #19
 * corollary): no field here names anything app-specific, so one app's vocabulary
 * can never leak into the surface every other app shares.
 */

import { isMiniAppDeepLinkFor } from "./miniappDeepLink.js";

export const MINIAPP_CARD_MAX_TITLE_LENGTH = 120;
export const MINIAPP_CARD_MAX_SUBTITLE_LENGTH = 200;
export const MINIAPP_CARD_MAX_FIELDS = 6;
export const MINIAPP_CARD_MAX_FIELD_LABEL_LENGTH = 40;
export const MINIAPP_CARD_MAX_FIELD_VALUE_LENGTH = 200;

export interface MiniAppCardField {
  label: string;
  value: string;
}

export interface MiniAppResultCard {
  title: string;
  subtitle?: string;
  fields: MiniAppCardField[];
  /** Phosphor icon name without the `ph-` prefix. */
  icon?: string;
  /**
   * A `molibot://miniapp/<appId>/<path>` link back into the *same* app.
   *
   * Restricted to the declaring app so a card can never become a way to steer
   * the owner into a different app's surface.
   */
  link?: string;
}

const ICON_PATTERN = /^[a-z0-9-]+$/;
/** C0 controls plus DEL. Newlines included: a card row is a single line. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Control characters would let a card break the row it renders into; they are
  // never meaningful in a label or a value.
  return value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Normalizes whatever an app returned into a card the host is willing to
 * render, or null when there is nothing renderable.
 *
 * Lossy by design: an over-long title is truncated and a seventh field is
 * dropped rather than failing the whole tool call. The tool already did its
 * work by the time a card exists, so refusing to render is the only sensible
 * failure — never turning a successful side effect into an error (pitfall #26d
 * is about validating *before* a side effect; this is after one).
 */
export function sanitizeMiniAppResultCard(value: unknown, appId: string): MiniAppResultCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const title = cleanText(raw.title, MINIAPP_CARD_MAX_TITLE_LENGTH);
  // A card with no title has no anchor to render around.
  if (!title) return null;

  const card: MiniAppResultCard = { title, fields: [] };

  const subtitle = cleanText(raw.subtitle, MINIAPP_CARD_MAX_SUBTITLE_LENGTH);
  if (subtitle) card.subtitle = subtitle;

  if (Array.isArray(raw.fields)) {
    for (const entry of raw.fields) {
      if (card.fields.length >= MINIAPP_CARD_MAX_FIELDS) break;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const field = entry as Record<string, unknown>;
      const label = cleanText(field.label, MINIAPP_CARD_MAX_FIELD_LABEL_LENGTH);
      const fieldValue = cleanText(field.value, MINIAPP_CARD_MAX_FIELD_VALUE_LENGTH);
      // A field with neither side is noise; one side alone can still be useful.
      if (!label && !fieldValue) continue;
      card.fields.push({ label, value: fieldValue });
    }
  }

  const icon = cleanText(raw.icon, 40);
  if (icon && ICON_PATTERN.test(icon)) card.icon = icon;

  // Silently dropped when it addresses another app: the card still renders, it
  // just loses a link it was not entitled to.
  if (isMiniAppDeepLinkFor(raw.link, appId)) card.link = raw.link as string;

  return card;
}
