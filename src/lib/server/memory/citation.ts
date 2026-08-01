/**
 * Memory citation protocol.
 *
 * Injected memories carry short ids (M1, M2, …). The model is asked to append
 * one final `[[mem:M1,M3]]` line listing only the memories that actually
 * informed the reply. The marker is model-facing bookkeeping and must never
 * reach a user-visible surface: `stripMemoryCitations` cleans persisted text,
 * and `createMemoryCitationStreamFilter` holds back a potential marker tail so
 * live streaming never flashes it either.
 */

export const MEMORY_CITATION_INSTRUCTION =
  "If any memory above actually informed this reply, append one final line exactly like [[mem:M1,M3]] listing only those ids; omit the line when none did. The marker is stripped before display.";

const CITATION_PATTERN = /\[\[mem:([^\]]*)\]\]/gi;
const MARKER_PREFIX = "[[mem:";

export function formatMemoryShortId(index: number): string {
  return `M${index}`;
}

function parseShortIds(inner: string): string[] {
  return inner
    .split(/[,\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => /^M\d+$/.test(part));
}

export function stripMemoryCitations(text: string): { text: string; shortIds: string[] } {
  const shortIds: string[] = [];
  const stripped = text.replace(CITATION_PATTERN, (_match, inner: string) => {
    for (const id of parseShortIds(inner)) {
      if (!shortIds.includes(id)) shortIds.push(id);
    }
    return "";
  });
  // Removing a trailing marker usually leaves a dangling blank line.
  return { text: stripped.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trimEnd(), shortIds };
}

/**
 * Streaming variant: `push` returns the part of the delta that is safe to
 * forward; anything that could still turn into a `[[mem:…]]` marker is held
 * back until it is confirmed (then swallowed and recorded) or disproven (then
 * released). `flush` releases whatever is held at end of message.
 */
export function createMemoryCitationStreamFilter(): {
  push(delta: string): string;
  flush(): string;
  citedShortIds(): string[];
} {
  let held = "";
  const cited: string[] = [];

  function isMarkerPrefix(candidate: string): boolean {
    if (candidate.length >= MARKER_PREFIX.length) {
      return candidate.slice(0, MARKER_PREFIX.length).toLowerCase() === MARKER_PREFIX;
    }
    return MARKER_PREFIX.startsWith(candidate.toLowerCase());
  }

  function drain(buffer: string, atEnd: boolean): string {
    let output = "";
    let rest = buffer;
    while (rest.length > 0) {
      const start = rest.indexOf("[");
      if (start === -1) {
        output += rest;
        rest = "";
        break;
      }
      output += rest.slice(0, start);
      const candidate = rest.slice(start);
      if (!isMarkerPrefix(candidate)) {
        output += "[";
        rest = candidate.slice(1);
        continue;
      }
      const close = candidate.indexOf("]]");
      if (close === -1) {
        if (atEnd) {
          // Incomplete marker at end of message: not a real citation, release it.
          output += candidate;
          rest = "";
        } else {
          rest = candidate;
        }
        break;
      }
      const marker = candidate.slice(0, close + 2);
      const match = /^\[\[mem:([^\]]*)\]\]$/i.exec(marker);
      if (match) {
        for (const id of parseShortIds(match[1])) {
          if (!cited.includes(id)) cited.push(id);
        }
      } else {
        output += marker;
      }
      rest = candidate.slice(close + 2);
    }
    if (!atEnd) {
      held = rest;
      return output;
    }
    held = "";
    return output + rest;
  }

  return {
    push(delta: string): string {
      return drain(held + delta, false);
    },
    flush(): string {
      return drain(held, true);
    },
    citedShortIds(): string[] {
      return [...cited];
    }
  };
}
