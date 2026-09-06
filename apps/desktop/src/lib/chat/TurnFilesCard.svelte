<script lang="ts">
  import Files from "reicon-svelte/icons/Files";
  import SquareArrowUp from "reicon-svelte/icons/SquareArrowUp";
  import type { Translation } from "../i18n";
  import TurnFileList from "./TurnFileList.svelte";
  import type { TurnFileItem } from "./turnFiles";

  export let files: TurnFileItem[];
  export let copy: Translation;
  export let onOpen: (files: TurnFileItem[], selectedKey?: string) => void;
</script>

<section class="turn-files-card" aria-label={copy.turnFilesTitle}>
  {#if files.length > 1}
    <button type="button" class="turn-files-head" onclick={() => onOpen(files)}>
      <span><Files size={14} aria-hidden="true" />{copy.turnFilesTitle}</span>
      <span class="turn-files-count">{copy.turnFilesCount.replace("{count}", String(files.length))}</span>
      <span class="turn-files-review">{copy.turnFilesReview}<SquareArrowUp size={12} aria-hidden="true" /></span>
    </button>
  {/if}
  <TurnFileList {files} {copy} onOpen={(file) => onOpen(files, file.key)} />
</section>
