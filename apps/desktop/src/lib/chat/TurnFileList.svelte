<script lang="ts">
  import type { Translation } from "../i18n";
  import type { TurnFileItem } from "./turnFiles";

  export let files: TurnFileItem[];
  export let copy: Translation;
  export let onOpen: (file: TurnFileItem) => void;
</script>

<ul class="turn-file-list">
  {#each files as file (file.key)}
    <li>
      <button type="button" class="turn-file-row" title={file.name} onclick={() => onOpen(file)}>
        <span class:created={file.action === "created"} class="turn-file-action">
          {file.action === "created" ? copy.turnFileCreated : copy.turnFileModified}
        </span>
        <i class="ph ph-file" aria-hidden="true"></i>
        <span class="turn-file-name">{file.name}</span>
        <i class="ph ph-caret-right turn-file-caret" aria-hidden="true"></i>
      </button>
    </li>
  {/each}
</ul>
