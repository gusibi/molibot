<script lang="ts">
  export let files: File[] = [];
  export let audioUrls = new Map<File, string>();
  export let removeLabel: string;
  export let disabled = false;
  export let inferKind: (file: File) => "image" | "audio" | "video" | "file";
  export let onRemove: (index: number) => void;
</script>

{#if files.length > 0}
  <div class="pending-files">
    {#each files as file, index (index)}
      <span class="pending-chip" data-kind={inferKind(file)}>
        <span class="pending-name" title={file.name}>{file.name}</span>
        {#if audioUrls.get(file)}
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio class="pending-audio" controls src={audioUrls.get(file)}></audio>
        {/if}
        <button type="button" aria-label={removeLabel} {disabled} onclick={() => onRemove(index)}>×</button>
      </span>
    {/each}
  </div>
{/if}
