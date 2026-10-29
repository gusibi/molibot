import { redactBody, redactUrl } from "./redact.js";

export function safeDiagnosticText(value: unknown): string {
  return redactBody(String(value ?? ""), 2000)
    .replace(/https?:\/\/[^\s]+/g, (url) => redactUrl(url))
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer <redacted>");
}

/** Error causes and AggregateError children are not enumerable in JSON serialization. */
export function describeNetworkError(error: unknown): Record<string, unknown> {
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): Record<string, unknown> {
    if (!value || typeof value !== "object") return { message: safeDiagnosticText(value) };
    if (seen.has(value) || depth >= 5) return { truncated: true };
    seen.add(value);
    const entry = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of ["name", "message", "stack", "code", "errno", "syscall", "address", "port"]) {
      if (typeof entry[key] === "string") result[key] = safeDiagnosticText(entry[key]);
      else if (typeof entry[key] === "number") result[key] = entry[key];
    }
    if (entry.cause !== undefined) result.cause = visit(entry.cause, depth + 1);
    if (Array.isArray(entry.errors)) result.errors = entry.errors.slice(0, 8).map((child) => visit(child, depth + 1));
    return result;
  }
  return visit(error, 0);
}

export function networkRuntimeInfo(): Record<string, unknown> {
  return {
    diagnosticVersion: 1,
    pid: process.pid,
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    platform: process.platform,
    arch: process.arch,
    proxyEnvironmentPresent: ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
      .filter((key) => Boolean(process.env[key])),
  };
}
