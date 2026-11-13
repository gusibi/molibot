<script lang="ts">
  import type { Translation } from "../i18n";
  import type { DesktopSkillMaintenanceScan, DesktopSkillMaintenancePlan, DesktopSkillMaintenanceRequest, DesktopSkillMaintenanceComparison, DesktopSkillMaintenanceGroup, DesktopSkillMaintenanceResult } from "@molibot/desktop-contract";
  import { runSkillManagerAction } from "../api";
  import { loadSkillManager } from "../stores/skills.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import Reorder from "reicon-svelte/icons/Reorder";
  import X from "reicon-svelte/icons/X";

  let { copy, endpoint }: { copy: Translation; endpoint: string } = $props();
  let open = $state(false);
  let scan = $state<DesktopSkillMaintenanceScan | null>(null);
  let tab = $state<"duplicates" | "backups" | "links">("duplicates");
  let busy = $state(false);
  let error = $state("");
  let notice = $state("");
  let selected = $state<string[]>([]);
  let sources = $state<Record<string, string>>({});
  let comparison = $state<DesktopSkillMaintenanceComparison | null>(null);
  let plan = $state<DesktopSkillMaintenancePlan | null>(null);
  const duplicates = $derived(scan?.groups.filter((group) => group.relation === "identical" || group.relation === "different") ?? []);
  const selection = $derived(selected.map((id) => ({ groupId: id, sourceId: sources[id] })));
  const conflictLabels = $derived({ invalid_selection: copy.skillMaintenanceInvalidSelection, unsafe: copy.skillMaintenanceReadOnly,
    invalid_name: copy.skillMaintenanceInvalidName, unknown_destination: copy.skillMaintenanceUnknownDestination,
    backup_readonly: copy.skillMaintenanceBackupUnavailable, backup_referenced: copy.skillMaintenanceReferenced,
    incomplete_scan: copy.skillMaintenanceIncompleteScan, invalid_backup: copy.skillMaintenanceInvalidBackup,
    link_readonly: copy.skillMaintenanceLinkUnavailable, overlap: copy.skillMaintenanceOverlap, nested: copy.skillMaintenanceOverlap });
  const actionLabels = $derived({ canonical: copy.skillMaintenanceCanonical, link: copy.skillMaintenanceLink, restore: copy.skillMaintenanceRestore, delete: copy.skillMaintenanceDelete, unlink: copy.skillMaintenanceUnlink });

  async function refresh(): Promise<void> {
    busy = true;
    error = "";
    comparison = null;
    selected = [];
    plan = null;
    try {
      const payload = await runSkillManagerAction<{ scan: DesktopSkillMaintenanceScan }>(endpoint, { action: "maintenance-scan" });
      if (!payload.scan) throw new Error(copy.skillMaintenanceFailed);
      scan = payload.scan;
      sources = Object.fromEntries(scan.groups.map((group) => [group.id,
        group.entries.find((entry) => entry.path === group.destination && !entry.isLink)?.id
        ?? group.entries.find((entry) => !entry.isLink)?.id ?? group.entries[0].id]));
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  async function show(): Promise<void> {
    open = true;
    notice = "";
    await refresh();
  }

  async function compare(group: DesktopSkillMaintenanceGroup, otherId: string): Promise<void> {
    busy = true; error = ""; comparison = null;
    try {
      const payload = await runSkillManagerAction<{ comparison: DesktopSkillMaintenanceComparison }>(endpoint, {
        action: "maintenance-compare", request: { leftId: sources[group.id], rightId: otherId }
      });
      comparison = payload.comparison ?? null;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  async function review(request: DesktopSkillMaintenanceRequest): Promise<void> {
    busy = true; error = ""; notice = "";
    try {
      const payload = await runSkillManagerAction<{ plan: DesktopSkillMaintenancePlan }>(endpoint, { action: "maintenance-preflight", request });
      plan = payload.plan ?? null;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  /** Deletion is the one destructive action whose reference check may be
   *  incomplete; the owner accepts that uncertainty for this single backup. */
  async function acknowledgeDelete(): Promise<void> {
    if (!plan || plan.request.kind !== "delete-backup" || busy) return;
    await review({ ...plan.request, acknowledgeScan: true });
  }

  async function apply(): Promise<void> {
    if (!plan?.executable || busy) return;
    busy = true; error = "";
    try {
      const payload = await runSkillManagerAction<{ result: DesktopSkillMaintenanceResult }>(endpoint, {
        action: "maintenance-apply", request: { operation: plan.request, token: plan.token }
      });
      const result = payload.result;
      if (!result?.ok) {
        error = `${result?.status === "stale" ? copy.skillMaintenanceStale : copy.skillMaintenanceFailed} ${result?.error ?? ""}`;
        plan = null;
        return;
      }
      plan = null;
      await refresh();
      await loadSkillManager(endpoint);
      notice = copy.skillMaintenanceDone;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  function choose(groupId: string, sourceId: string): void {
    sources = { ...sources, [groupId]: sourceId };
    comparison = null;
  }

  const applyLabel = $derived(
    plan?.request.kind === "delete-backup" ? copy.skillMaintenanceDelete
      : plan?.request.kind === "restore" ? copy.skillMaintenanceRestore
        : plan?.request.kind === "remove-link" ? copy.skillMaintenanceRemoveLink
          : copy.skillMaintenanceApplyConsolidate
  );
  const scanAcknowledged = $derived(plan?.request.kind === "delete-backup" && plan.request.acknowledgeScan === true);
  const warningLabels = $derived<Record<DesktopSkillMaintenanceScan["warnings"][number]["code"], string>>({
    unreadable: copy.skillMaintenanceUnreadable,
    truncated: copy.skillMaintenanceTruncated,
    "invalid-backup": copy.skillMaintenanceInvalidBackupName
  });
  const scanGaps = $derived((scan?.warnings ?? []).filter((warning) => warning.code !== "invalid-backup"));
</script>

<Button variant="icon" title={copy.skillMaintenanceTitle} disabled={!endpoint} onclick={() => void show()}><Reorder size={17} aria-hidden="true" /></Button>
<Dialog {open} {busy} contentClass="skill-maintenance-dialog" labelledBy="skill-maintenance-title" onOpenChange={(next) => { open = next; }}>
  <div class="skills-sheet">
    <header class="skills-sheet-head">
      <div><h2 id="skill-maintenance-title">{copy.skillMaintenanceTitle}</h2></div>
      <Button variant="icon" title={copy.skillClose} disabled={busy} onclick={() => (open = false)}><X size={15} aria-hidden="true" /></Button>
    </header>
    <div class="skills-sheet-body">
      <div class="skill-maintenance-tools">
        <div class="segmented" role="group" aria-label={copy.skillMaintenanceTitle}>
          {#each [{ id: "duplicates", label: copy.skillMaintenanceDuplicates, count: duplicates.length }, { id: "backups", label: copy.skillMaintenanceBackups, count: scan?.backups.length ?? 0 }, { id: "links", label: copy.skillMaintenanceLinks, count: (scan?.brokenLinks.length ?? 0) + (scan?.groups.reduce((total, group) => total + group.entries.length, 0) ?? 0) }] as item}
            <Button class={`segmented-item${tab === item.id ? " active" : ""}`} aria-pressed={tab === item.id} disabled={busy} onclick={() => { tab = item.id as typeof tab; comparison = null; }}>{item.label} ({item.count})</Button>
          {/each}
        </div>
        <Button disabled={busy} onclick={() => void refresh()}>{copy.skillMaintenanceScan}</Button>
      </div>
      {#if busy}<p role="status">{copy.skillMaintenanceScanning}</p>{/if}
      {#if error}<p class="skills-sheet-error" role="alert">{error}</p>{/if}
      {#if notice}<p class="skills-preflight-ok" role="status">{notice}</p>{/if}
      {#if scan?.warnings.length}
        <details class="skill-maintenance-issues">
          <summary>{copy.skillMaintenanceWarnings} ({scan.warnings.length})</summary>
          {@render warningList()}
        </details>
      {/if}
      {#if scan && tab === "duplicates"}
        <div class="skill-maintenance-tools">
          <Button disabled={busy} onclick={() => { selected = duplicates.filter((group) => group.relation === "identical" && group.writable).slice(0, 100).map((group) => group.id); }}>{copy.skillMaintenanceSelectIdentical}</Button>
          <Button disabled={busy || !selected.length} onclick={() => (selected = [])}>{copy.skillMaintenanceClear}</Button>
        </div>
        {#if !duplicates.length}<p class="skills-detail-muted">{copy.skillMaintenanceNoDuplicates}</p>{/if}
        {#each duplicates as group (group.id)}
          <section class="skills-preflight" aria-label={group.name}>
            <div class="skills-preflight-head">
              <strong>{group.name}</strong><span>{group.relation === "identical" ? copy.skillMaintenanceIdentical : copy.skillMaintenanceDifferent} · {group.scope === "global" ? copy.skillScopeGlobal : group.scope.startsWith("project:") ? copy.skillScopeProject : copy.skillScopeAgent}</span>
              <Button aria-pressed={selected.includes(group.id)} disabled={busy || !group.writable || (!selected.includes(group.id) && selected.length >= 100)} onclick={() => { selected = selected.includes(group.id) ? selected.filter((id) => id !== group.id) : [...selected, group.id]; }}>{copy.skillMaintenanceSelect}</Button>
            </div>
            {#if !group.writable}<p class="skills-sheet-error">{copy.skillMaintenanceReadOnly}</p>{/if}
            <SelectControl value={sources[group.id]} ariaLabel={`${copy.skillMaintenanceKeep}: ${group.name}`} options={group.entries.map((entry) => ({ value: entry.id, label: entry.path }))} disabled={busy || !group.writable} onChange={(id) => choose(group.id, id)} />
            <ul class="skill-maintenance-entries">
              {#each group.entries as entry (entry.id)}
                <li><div><code translate="no">{entry.path}</code><span>{entry.platforms.join(", ")} · {entry.isLink ? copy.skillLocationLink : copy.skillLocationCopy}</span></div>
                  {#if entry.id !== sources[group.id]}<Button disabled={busy} onclick={() => void compare(group, entry.id)}>{copy.skillMaintenanceCompare}</Button>{/if}
                </li>
              {/each}
            </ul>
            <p class="skills-preflight-description"><code translate="no">{group.destination}</code></p>
          </section>
        {/each}
        {#if comparison}
          <section class="skills-preflight" aria-label={copy.skillMaintenanceCompareTitle}>
            <h3>{copy.skillMaintenanceCompareTitle}</h3>
            <div class="skill-maintenance-comparison"><code translate="no">{comparison.left.path}</code><code translate="no">{comparison.right.path}</code></div>
            {#if !comparison.files.length}<p>{copy.skillMaintenanceNoChanges}</p>{/if}
            {#each comparison.files as file (file.path)}
              <details open={comparison.files.length === 1}>
                <summary><code translate="no">{file.path}</code> · {file.status === "added" ? copy.skillMaintenanceAdded : file.status === "removed" ? copy.skillMaintenanceRemoved : copy.skillMaintenanceChanged}</summary>
                {#if file.preview === "text"}
                  <div class="skill-maintenance-comparison"><pre aria-label={comparison.left.path}>{file.left ?? "∅"}</pre><pre aria-label={comparison.right.path}>{file.right ?? "∅"}</pre></div>
                {:else}<p>{file.preview === "binary" ? copy.skillMaintenanceBinary : file.preview === "too-large" ? copy.skillMaintenanceTooLarge : copy.skillMaintenanceMetadata}</p>{/if}
              </details>
            {/each}
          </section>
        {/if}
      {:else if scan && tab === "backups"}
        {#if !scan.backups.length}<p class="skills-detail-muted">{copy.skillMaintenanceNoBackups}</p>{/if}
        {#each scan.backups as backup (backup.id)}
          <section class="skills-preflight" aria-label={backup.path}>
            <code translate="no">{backup.path}</code>
            <p class="skills-preflight-description">{copy.skillMaintenanceCreated}: {new Date(backup.createdAt).toLocaleString()} · {backup.bytes.toLocaleString()} B</p>
            {#if backup.references.length}
              <p class="skills-sheet-error">{copy.skillMaintenanceReferenced}</p>
              <ul class="skill-maintenance-paths">{#each backup.references as reference}<li><code translate="no">{reference}</code></li>{/each}</ul>
            {/if}
            <div class="skill-maintenance-tools">
              <Button disabled={busy || !backup.writable} onclick={() => void review({ kind: "restore", id: backup.id })}>{copy.skillMaintenanceRestore}</Button>
              <Button danger disabled={busy || !backup.writable || backup.references.length > 0} onclick={() => void review({ kind: "delete-backup", id: backup.id })}>{copy.skillMaintenanceDelete}</Button>
            </div>
          </section>
        {/each}
      {:else if scan && tab === "links"}
        {#if !scan.brokenLinks.length}<p class="skills-detail-muted">{copy.skillMaintenanceNoBroken}</p>{/if}
        {#each scan.brokenLinks as link (link.id)}
          <section class="skills-preflight" aria-label={link.path}>
            <strong>{copy.skillLocationBroken}</strong><code translate="no">{link.path}</code><code translate="no">→ {link.target}</code><span>{link.platforms.join(", ")}</span>
            <Button danger disabled={busy || !link.writable} onclick={() => void review({ kind: "remove-link", id: link.id })}>{copy.skillMaintenanceRemoveLink}</Button>
          </section>
        {/each}
        {#each scan.groups as group (group.id)}
          <section class="skills-preflight" aria-label={group.name}>
            <div class="skills-preflight-head"><strong>{group.name}</strong><span>{group.relation === "linked" ? copy.skillMaintenanceLinked : group.relation === "identical" ? copy.skillMaintenanceIdentical : group.relation === "different" ? copy.skillMaintenanceDifferent : copy.skillMaintenanceSingle} · {group.scope === "global" ? copy.skillScopeGlobal : group.scope.startsWith("project:") ? copy.skillScopeProject : copy.skillScopeAgent}</span></div>
            <ul class="skill-maintenance-entries" aria-label={copy.skillMaintenanceReferences}>
              {#each group.entries as entry (entry.id)}
                <li><div><code translate="no">{entry.path}</code><span>{entry.platforms.join(", ")} · {entry.isLink ? copy.skillLocationLink : copy.skillLocationCopy}</span><code translate="no">→ {entry.realPath}</code></div></li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
    <footer class="skills-sheet-foot">
      <Button disabled={busy} onclick={() => (open = false)}>{copy.skillClose}</Button>
      {#if tab === "duplicates"}<Button variant="primary" disabled={busy || !selection.length} onclick={() => void review({ kind: "consolidate", selections: selection })}>{copy.skillMaintenanceReview} ({selection.length})</Button>{/if}
    </footer>
  </div>
</Dialog>
<AlertDialog open={plan !== null} {busy} contentClass="skills-install-dialog" labelledBy="skill-maintenance-plan-title" onOpenChange={(next) => { if (!next) plan = null; }}>
  <div class="skills-sheet">
    <header class="skills-sheet-head"><h2 id="skill-maintenance-plan-title">{copy.skillMaintenancePlan}</h2></header>
    <div class="skills-sheet-body">
      {#if plan?.request.kind === "delete-backup"}<p class="skills-sheet-error">{copy.skillMaintenanceDeleteWarning}</p>{/if}
      {#if plan?.request.kind === "restore"}<p>{copy.skillMaintenanceRestoreHint}</p>{/if}
      {#each plan?.changes ?? [] as change}
        <div class="skills-preflight"><strong>{actionLabels[change.action]}</strong><code translate="no">{change.path}</code>{#if change.target}<code translate="no">→ {change.target}</code>{/if}
          {#if change.backupPath}<span>{copy.skillMaintenanceBackupPath}</span><code translate="no">{change.backupPath}</code>{/if}
        </div>
      {/each}
      {#each plan?.conflicts ?? [] as conflict}
        {#if conflict.code === "incomplete_scan"}
          <div class="skill-maintenance-incomplete">
            <p>{copy.skillMaintenanceIncompleteScan}</p>
            {#if scanGaps.length}
              <ul class="skill-maintenance-warning-list">
                {#each scanGaps as warning (warning.path)}
                  <li title={warning.message}>
                    <span>{warningLabels[warning.code]}</span>
                    <code translate="no">{warning.path}</code>
                  </li>
                {/each}
              </ul>
            {/if}
            <Button variant="secondary" disabled={busy} onclick={() => void acknowledgeDelete()}>{copy.skillMaintenanceAcknowledgeScan}</Button>
          </div>
        {:else}
          <p class="skills-sheet-error" role="alert">{conflictLabels[conflict.code]} {conflict.path}</p>
        {/if}
      {/each}
      {#if scanAcknowledged && plan?.executable}
        <p class="skills-preflight-note">{copy.skillMaintenanceAcknowledgedScan}</p>
      {/if}
    </div>
    <footer class="skills-sheet-foot"><Button disabled={busy} onclick={() => (plan = null)}>{copy.skillCancel}</Button><Button variant="primary" danger={plan?.request.kind === "delete-backup"} disabled={busy || !plan?.executable} onclick={() => void apply()}>{applyLabel}</Button></footer>
  </div>
</AlertDialog>

{#snippet warningList()}
  <ul class="skill-maintenance-warning-list">
    {#each scan?.warnings ?? [] as warning (warning.path)}
      <li title={warning.message}>
        <span>{warningLabels[warning.code]}</span>
        <code translate="no">{warning.path}</code>
      </li>
    {/each}
  </ul>
{/snippet}
