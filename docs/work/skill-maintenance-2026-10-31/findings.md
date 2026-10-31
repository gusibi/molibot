# Findings

- Existing manager supports per-skill consolidation and location removal. Discovered identities group by real directory.
- Full tree hashes exist; catalogue intentionally avoids hashing every skill. Maintenance scan must be explicit.
- Backups use timestamp names and are excluded from ordinary discovery. Existing operations store can provide action receipts.

- Maintenance is a separate shared service with opaque entry IDs. Groups separate global, project and Agent scopes; Agent-specific canonical destinations are absent, so those groups remain read-only for consolidation.
- Tree comparison includes support files and executable bits. Text previews are bounded; binary content is not rendered.
- Planned filesystem moves are journaled in the existing operation store; interrupted reversible work rolls back from backups.
- Alias paths can reach the same filesystem slot. Consolidation deduplicates by real parent plus entry name before creating links.

## Parent-root alias follow-up

- Read-only inspection found that Claude Code's complete skills root is already a symlink to the shared skills root. The two agents-sdk paths are the same physical entry; there is no second copy to remove.
- Existing same_root rejection misrepresented this completed sharing state. Prior regressions covered per-Skill links and independent copies, but not a linked platform root.
- Shared-parent aliases must be compared by real parent plus basename, without following the final entry link. Removing such a source would remove the canonical entry itself.
- The running desktop owns the local production backend on port 3040. Read-only live preflight still returns same_root; the process has cached the earlier build. Do not restart the unrelated shell service or kill the desktop-owned child without approval.
