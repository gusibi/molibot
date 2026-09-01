<script lang="ts">
  import Download from "reicon-svelte/icons/Download";
  import FolderOpen from "reicon-svelte/icons/FolderOpen";
  import SquareArrowUp from "reicon-svelte/icons/SquareArrowUp";
  import { fileIconKind, fileIconStyle, formatSize } from "../projects/fileIcons";
  import { FILE_KIND_ICONS } from "../projects/fileKindIcons";
  import type { Translation } from "../i18n";

  /**
   * Terminal card for files with no inline renderer (PRD §3.38 Slice 3):
   * legacy PPT/unknown binaries and text too large to decode.
   *
   * Unsupported formats deliberately get no embedded preview when no safe,
   * maintained viewer exists, so the product answer is the system app. DOCX is
   * handled by DocxPreview before this card. The rule this card enforces is that
   * no file is a dead end: every unsupported type still offers a way out.
   *
   * `onReveal` / `onOpenExternally` are omitted in Session scope, where an
   * attachment has no stable host path to reveal; download always applies.
   */
  let {
    name,
    sizeBytes = 0,
    reason,
    copy,
    onDownload,
    onReveal,
    onOpenExternally
  }: {
    name: string;
    sizeBytes?: number;
    /** Why there is no inline view: binary, oversized, or an unsupported format. */
    reason: string;
    copy: Translation;
    onDownload: () => void;
    onReveal?: () => void;
    onOpenExternally?: () => void;
  } = $props();

  let CardIcon = $derived(FILE_KIND_ICONS[fileIconKind(name, "file")]);
</script>

<div class="system-open-card">
  <CardIcon
    class="system-open-icon"
    size={28}
    style={fileIconStyle(name, "file")}
    aria-hidden="true"
  />
  <strong class="system-open-name" title={name}>{name}</strong>
  <span class="system-open-meta">{reason}{sizeBytes > 0 ? ` · ${formatSize(sizeBytes)}` : ""}</span>
  <div class="system-open-actions">
    {#if onOpenExternally}
      <button type="button" class="system-open-primary" onclick={onOpenExternally}>
        <SquareArrowUp size={14} aria-hidden="true" /><span>{copy.projectOpenExternally}</span>
      </button>
    {/if}
    {#if onReveal}
      <button type="button" onclick={onReveal}>
        <FolderOpen size={14} aria-hidden="true" /><span>{copy.projectRevealInFinder}</span>
      </button>
    {/if}
    <button type="button" onclick={onDownload}>
      <Download size={14} aria-hidden="true" /><span>{copy.artifactDownload}</span>
    </button>
  </div>
</div>

<style>
  .system-open-card {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px 16px;
    text-align: center;
  }
  .system-open-card > :global(svg) {
    color: var(--label-tertiary);
  }
  .system-open-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--label-primary);
    font-size: var(--fs-label);
    line-height: var(--lh-label);
    font-weight: 600;
  }
  .system-open-meta {
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
  }
  .system-open-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 6px;
  }
  .system-open-actions button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--chrome-border);
    border-radius: var(--radius-small);
    background: transparent;
    color: var(--label-secondary);
    padding: 4px 10px;
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    cursor: pointer;
  }
  .system-open-actions button:hover {
    color: var(--label-primary);
    background: var(--fill);
  }
  .system-open-actions .system-open-primary {
    border-color: var(--accent);
    color: var(--accent);
  }
  .system-open-actions .system-open-primary:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
</style>
