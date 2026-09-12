<script lang="ts">
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import { FILE_KIND_ICONS } from "../projects/fileKindIcons";
  import { fileIconKind, fileIconStyle } from "../projects/fileIcons";
  import type { Translation } from "../i18n";
  import type { TurnFileItem } from "./turnFiles";

  export let files: TurnFileItem[];
  export let copy: Translation;
  export let onOpen: (file: TurnFileItem) => void;
</script>

<ul class="turn-file-list">
  {#each files as file (file.key)}
    {@const FileIcon = FILE_KIND_ICONS[fileIconKind(file.name, "file")]}
    <li>
      <button type="button" class="turn-file-row" title={file.name} onclick={() => onOpen(file)}>
        <span class:created={file.action === "created"} class="turn-file-action">
          {file.action === "created" ? copy.turnFileCreated : copy.turnFileModified}
        </span>
        <FileIcon size={14} style={fileIconStyle(file.name, "file")} aria-hidden="true" />
        <span class="turn-file-name">{file.name}</span>
        <CaretRight class="turn-file-caret" size={14} aria-hidden="true" />
      </button>
    </li>
  {/each}
</ul>
