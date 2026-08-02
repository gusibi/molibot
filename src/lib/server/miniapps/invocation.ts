import type { MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";

export interface MiniAppInvocation {
  app: MiniAppCatalogEntry;
  /** The user request after its transient @app selector is removed. */
  text: string;
  /**
   * The selector exactly as the user typed it, including the `@`. The model
   * never sees it — routing already consumed it — but the persisted transcript
   * does, because the owner typed it and expects to see it in the session.
   */
  selector: string;
}

/**
 * An @selector is a per-turn routing hint, not model-facing content. Only a
 * leading selector counts so ordinary prose and e-mail addresses stay intact.
 */
export function resolveMiniAppInvocation(
  text: string,
  apps: readonly MiniAppCatalogEntry[]
): MiniAppInvocation | null {
  const match = /^@([^\s@]+)(?:\s+|$)([\s\S]*)$/.exec(text.trim());
  if (!match) return null;
  const selector = match[1].toLocaleLowerCase();
  const app = apps.find((candidate) =>
    candidate.enabled
      && candidate.status === "active"
      && (candidate.id.toLocaleLowerCase() === selector || candidate.name.toLocaleLowerCase() === selector)
  );
  return app ? { app, text: match[2].trim(), selector: `@${match[1]}` } : null;
}

/** Human-readable and channel-safe: it deliberately reveals no host paths. */
export function formatMiniAppList(apps: readonly MiniAppCatalogEntry[], chinese = false): string {
  const visible = apps.filter((app) => app.status !== "uninstalling");
  if (visible.length === 0) return chinese ? "当前没有已安装的小程序。" : "No Mini Apps are installed.";
  const heading = chinese ? `已安装的小程序（${visible.length}）` : `Installed Mini Apps (${visible.length})`;
  return [heading, ...visible.map((app) => {
    const state = app.enabled && app.status === "active"
      ? (chinese ? "已启用" : "enabled")
      : app.status === "error"
        ? (chinese ? "错误" : "error")
        : (chinese ? "已停用" : "disabled");
    const tools = app.toolNames.length > 0 ? app.toolNames.map((tool) => `@${app.id} ${tool}`).join(", ") : (chinese ? "无工具" : "no tools");
    return `- **${app.name}** (@${app.id}) · ${state}\n  ${app.description || ""}${app.description ? "\n  " : ""}${chinese ? "工具" : "Tools"}: ${tools}`;
  })].join("\n");
}
