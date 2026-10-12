import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpOAuthState } from "@earendil-works/pi-mcp/oauth";

/** Synchronous variant of Pi's state store; the file read/write is synchronous on one thread. */
export interface SyncMcpOAuthStateStore {
  load(): McpOAuthState | undefined;
  save(state: McpOAuthState): void;
}

/**
 * The identity one OAuth credential record belongs to.
 *
 * `serverId` plus URL plus authorization server keep two configurations of the
 * same remote URL on separate accounts: changing the URL, the auth mode or the
 * authorization server must not reuse a token minted for another target.
 */
export interface McpOAuthScope {
  serverId: string;
  url: string;
  authServerMetadataUrl: string;
}

export function mcpOAuthScopeKey(scope: McpOAuthScope): string {
  return JSON.stringify([scope.serverId, scope.url, scope.authServerMetadataUrl]);
}

/**
 * Protected, per-scope OAuth state for MCP servers.
 *
 * The file sits beside `auth.json` in the owner's data directory (mode 0600).
 * Reads, mutations and rewrites are synchronous on the single Node thread, so
 * overlapping token/verifier saves cannot lose each other's records.
 */
export class McpOAuthStore {
  constructor(private readonly filePath: string) {}

  private readAll(): Record<string, McpOAuthState> {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, McpOAuthState> : {};
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, McpOAuthState>): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
    try { chmodSync(this.filePath, 0o600); } catch { /* some filesystems reject POSIX modes */ }
  }

  /** A Pi state store restricted to one scope; other servers' records are invisible. */
  forScope(scope: McpOAuthScope): SyncMcpOAuthStateStore {
    const key = mcpOAuthScopeKey(scope);
    return {
      load: () => this.readAll()[key],
      save: (state) => {
        const all = this.readAll();
        all[key] = state;
        this.writeAll(all);
      }
    };
  }

  has(scope: McpOAuthScope): boolean {
    return mcpOAuthScopeKey(scope) in this.readAll();
  }

  /** Wipe one scope (logout, or a URL/auth-server change that invalidates it). */
  remove(scope: McpOAuthScope): void {
    const all = this.readAll();
    const key = mcpOAuthScopeKey(scope);
    if (!(key in all)) return;
    delete all[key];
    this.writeAll(all);
  }

  /** Wipe every scope belonging to one server id, leaving same-URL siblings intact. */
  removeServer(serverId: string): void {
    const all = this.readAll();
    let changed = false;
    for (const key of Object.keys(all)) {
      try {
        if (JSON.parse(key)[0] === serverId) { delete all[key]; changed = true; }
      } catch {
        // A malformed key cannot be attributed to a server; leave it untouched.
      }
    }
    if (changed) this.writeAll(all);
  }
}

/** Owner-scoped OAuth store file, next to the provider credential file. */
export function mcpOAuthStorePath(dataDir: string): string {
  return join(dataDir, "mcp-oauth.json");
}
