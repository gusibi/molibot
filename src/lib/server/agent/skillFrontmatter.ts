function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function foldYamlBlock(lines: string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs.join("\n\n").trim();
}

function preserveYamlBlock(lines: string[]): string {
  return lines.join("\n").trim();
}

function parseBlockScalar(
  lines: string[],
  start: number,
  style: "folded" | "literal",
): { value: string; nextIndex: number } {
  const block: string[] = [];
  let index = start;
  for (; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (candidate.trim() === "") {
      block.push("");
      continue;
    }
    if (!/^\s+/.test(candidate)) {
      break;
    }
    block.push(candidate.replace(/^\s+/, ""));
  }
  return {
    value: style === "literal" ? preserveYamlBlock(block) : foldYamlBlock(block),
    nextIndex: index,
  };
}

export function parseSkillFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return null;

  const data: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const field = rawLine.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!field) continue;
    const key = field[1]?.trim();
    const rawValue = field[2] ?? "";
    if (!key) continue;

    if (/^[>|][+-]?\d*$/.test(rawValue.trim())) {
      const style = rawValue.trim().startsWith("|") ? "literal" : "folded";
      const parsed = parseBlockScalar(lines, index + 1, style);
      data[key] = parsed.value;
      index = parsed.nextIndex - 1;
      continue;
    }

    data[key] = stripQuotes(rawValue);
  }

  return data;
}
