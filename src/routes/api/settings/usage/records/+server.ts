import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const timezone = settings.timezone;

  const range = url.searchParams.get("range") || "today";
  const modelId = url.searchParams.get("modelId") || "all";
  const botId = url.searchParams.get("botId") || "all";
  const channel = url.searchParams.get("channel") || "all";
  
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 20);

  const allRecords = runtime.usageTracker.list();
  
  const localDateKey = (date: Date, tz: string) => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  };

  const shiftDateKey = (dateKey: string, delta: number) => {
    const [y, m, d] = dateKey.split("-").map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + delta));
    return shifted.toISOString().slice(0, 10);
  };

  const resolveWindow = (r: string, tz: string) => {
    const today = localDateKey(new Date(), tz);
    if (r === "yesterday") {
      const yesterday = shiftDateKey(today, -1);
      return { startDate: yesterday, endDate: yesterday };
    }
    if (r === "last7Days") return { startDate: shiftDateKey(today, -6), endDate: today };
    if (r === "last30Days") return { startDate: shiftDateKey(today, -29), endDate: today };
    return { startDate: today, endDate: today };
  };

  const window = resolveWindow(range, timezone);

  const filtered = allRecords.filter((record) => {
    const day = localDateKey(new Date(record.ts), timezone);
    if (day < window.startDate || day > window.endDate) return false;
    
    if (modelId !== "all") {
      const recModelId = `${record.provider}::${record.model}`;
      if (recModelId !== modelId) return false;
    }
    if (botId !== "all" && record.botId !== botId) return false;
    if (channel !== "all" && record.channel !== channel) return false;
    return true;
  });

  filtered.sort((a, b) => b.ts.localeCompare(a.ts));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return json({ ok: true, data, total });
};
