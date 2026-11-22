import type { AgentCityFloor } from "./agentCityProjection";
import type { AgentCityHudCoords } from "./agentCityScene";

export interface HudNodeLayout {
  key: string;
  x: number;
  y: number;
  zIndex: number;
  compact: boolean;
  dimmed: boolean;
}

export interface HoverCardPosition {
  x: number;
  y: number;
  placement: "above" | "below";
}

const NODE_WIDTH_ESTIMATE = 128;
const NODE_HEIGHT_ESTIMATE = 30;
const COMPACT_WIDTH_ESTIMATE = 52;
const COMPACT_HEIGHT_ESTIMATE = 22;
const VIEWPORT_PADDING_X = 14;
const VIEWPORT_PADDING_TOP = 54;
const VIEWPORT_PADDING_BOTTOM = 44;

function priorityOf(
  floor: AgentCityFloor,
  selectedKey: string | null,
  hoveredKey: string | null
): number {
  if (floor.key === selectedKey) return 500;
  if (floor.key === hoveredKey) return 450;
  if (floor.state === "error") return 400;
  if (floor.state === "working") return 350;
  if (floor.state === "completed") return 260;
  if (floor.kind === "global") return 200;
  return 100;
}

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return Math.abs(ax - bx) < (aw + bw) * 0.5 && Math.abs(ay - by) < (ah + bh) * 0.5;
}

/**
 * Computes screen-space positions for 3D Agent HUD badges so labels follow
 * camera zoom/orbit accurately while avoiding unreadable pile-ups.
 */
export function layoutHudNodes(
  floors: AgentCityFloor[],
  hudCoords: AgentCityHudCoords,
  selectedKey: string | null,
  hoveredKey: string | null
): Record<string, HudNodeLayout> {
  const candidates = floors
    .map((floor) => {
      const anchor = hudCoords.anchors[floor.key];
      if (!anchor || !anchor.visible) return null;
      return {
        floor,
        anchor,
        priority: priorityOf(floor, selectedKey, hoveredKey),
        depth: anchor.depth ?? 0.5
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      // Closer to camera (smaller NDC z) wins when priorities match.
      return left.depth - right.depth;
    });

  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const result: Record<string, HudNodeLayout> = {};

  for (let index = 0; index < candidates.length; index += 1) {
    const { floor, anchor, priority } = candidates[index];
    const isImportant = priority >= 260;
    const baseX = anchor.x;
    const baseY = anchor.y;

    let finalX = baseX;
    let finalY = baseY;
    let compact = false;
    let dimmed = false;

    const fullHit = (x: number, y: number): boolean =>
      placed.some((box) => overlaps(x, y, NODE_WIDTH_ESTIMATE, NODE_HEIGHT_ESTIMATE, box.x, box.y, box.w, box.h));

    if (fullHit(finalX, finalY)) {
      // Try gentle vertical nudges first so the badge stays anchored above its pod.
      const offsets: ReadonlyArray<readonly [number, number]> = [
        [0, -28],
        [0, 26],
        [-36, -24],
        [36, -24]
      ];
      let resolved = false;
      for (const [dx, dy] of offsets) {
        if (!fullHit(baseX + dx, baseY + dy)) {
          finalX = baseX + dx;
          finalY = baseY + dy;
          resolved = true;
          break;
        }
      }
      if (!resolved && !isImportant) {
        compact = true;
        dimmed = true;
      }
    }

    const w = compact ? COMPACT_WIDTH_ESTIMATE : NODE_WIDTH_ESTIMATE;
    const h = compact ? COMPACT_HEIGHT_ESTIMATE : NODE_HEIGHT_ESTIMATE;
    placed.push({ x: finalX, y: finalY, w, h });

    const zIndex =
      floor.key === hoveredKey
        ? 40
        : floor.key === selectedKey
          ? 35
          : priority >= 350
            ? 30
            : Math.max(1, 20 - index);

    result[floor.key] = {
      key: floor.key,
      x: Math.round(finalX * 10) / 10,
      y: Math.round(finalY * 10) / 10,
      zIndex,
      compact,
      dimmed
    };
  }

  return result;
}

/**
 * Clamps the hover preview card inside the 3D stage bounds so it never clips
 * past the shell edge or covers the top control bar.
 */
export function clampHoverCardPosition(
  anchor: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  cardWidth = 264,
  cardHeight = 148
): HoverCardPosition {
  const halfWidth = cardWidth / 2;
  const minX = Math.min(viewportWidth / 2, halfWidth + VIEWPORT_PADDING_X);
  const maxX = Math.max(minX, viewportWidth - halfWidth - VIEWPORT_PADDING_X);
  const x = Math.min(maxX, Math.max(minX, anchor.x));

  const fitsAbove = anchor.y - cardHeight - 18 >= VIEWPORT_PADDING_TOP;
  if (fitsAbove) {
    return {
      x: Math.round(x),
      y: Math.round(Math.min(viewportHeight - VIEWPORT_PADDING_BOTTOM, anchor.y - 14)),
      placement: "above"
    };
  }

  const belowY = Math.max(VIEWPORT_PADDING_TOP, Math.min(viewportHeight - cardHeight - VIEWPORT_PADDING_BOTTOM, anchor.y + 18));
  return {
    x: Math.round(x),
    y: Math.round(belowY),
    placement: "below"
  };
}
