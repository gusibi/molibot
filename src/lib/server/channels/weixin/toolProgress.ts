function normalizeText(text: string): string {
  return String(text ?? "").replace(/\r\n?/g, "\n").trim();
}

export function isTransientRunnerProgress(text: string): boolean {
  return /^_→ .+_$/.test(normalizeText(text));
}

export function isToolProgressBatchText(text: string): boolean {
  const lines = normalizeText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => isTransientRunnerProgress(line));
}

export function formatWeixinToolProgressText(text: string): string {
  const lines = normalizeText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const labels = lines.map((line) => line.replace(/^_→\s*/, "").replace(/_$/, "").trim()).filter(Boolean);
  if (labels.length === 0) return normalizeText(text);
  if (labels.length === 1) return `工具调用：${labels[0]}`;
  return ["工具调用：", ...labels.map((label) => `- ${label}`)].join("\n");
}

export function isWeixinToolProgressDeliveryText(text: string): boolean {
  const normalized = normalizeText(text);
  return isToolProgressBatchText(normalized) || normalized === "工具调用：" || normalized.startsWith("工具调用：\n") || /^工具调用：\S/.test(normalized);
}

export function createToolProgressBatcher(
  send: (text: string) => Promise<void>,
  batchSize = 5
): {
  handle(text: string): Promise<void>;
  flush(): Promise<void>;
} {
  let seen = 0;
  let pending: string[] = [];

  return {
    async handle(text: string): Promise<void> {
      seen += 1;
      if (seen === 1) {
        await send(text);
        return;
      }
      pending.push(text);
      if (pending.length >= batchSize) {
        const batch = formatWeixinToolProgressText(pending.join("\n"));
        pending = [];
        await send(batch);
      }
    },
    async flush(): Promise<void> {
      if (!pending.length) return;
      const batch = formatWeixinToolProgressText(pending.join("\n"));
      pending = [];
      await send(batch);
    }
  };
}
