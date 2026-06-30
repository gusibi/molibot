import type { ApprovedHostBashEntry } from "$lib/server/hostBash/types";
import type {
  DesktopHostBashSummary,
  DesktopHostBashWhitelistItem
} from "$lib/shared/desktop";

/**
 * Maps an approved-host-bash whitelist entry into a credential-safe Desktop
 * view. The `command` (and any args implied by the original prompt) is dropped
 * — the Desktop whitelist list shows the tool id, display name, reason, mode,
 * enabled state, approved-at, and a permission summary, never the shell
 * command itself.
 */
export function buildDesktopHostBashWhitelistItem(entry: ApprovedHostBashEntry): DesktopHostBashWhitelistItem {
  return {
    id: entry.id,
    toolId: entry.toolId,
    displayName: entry.displayName,
    reason: entry.reason,
    approvalMode: entry.approvalMode,
    enabled: entry.enabled,
    approvedAt: entry.approvedAt,
    permissions: {
      envAllowlist: entry.permissions.envAllowlist.length,
      filesystem: entry.permissions.filesystem,
      network: entry.permissions.network
    }
  };
}

export function buildDesktopHostBashSummary(input: {
  pending: unknown[];
  whitelist: ApprovedHostBashEntry[];
  history: unknown[];
}): DesktopHostBashSummary {
  const whitelist = input.whitelist.map(buildDesktopHostBashWhitelistItem);
  return {
    counts: {
      pending: input.pending.length,
      whitelist: whitelist.length,
      whitelistEnabled: whitelist.filter((item) => item.enabled).length,
      history: input.history.length
    },
    whitelist
  };
}
