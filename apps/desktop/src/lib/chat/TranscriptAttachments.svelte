<script lang="ts">
  import type { Translation } from "../i18n";
  import type { TranscriptAttachment, TranscriptAttachmentActions } from "./transcript";

  export let attachments: TranscriptAttachment[];
  export let copy: Translation;
  export let actions: TranscriptAttachmentActions | null;

  $: if (actions) {
    for (const attachment of attachments) {
      if (!attachment.local || !["image", "audio", "video"].includes(attachment.mediaType)) continue;
      const file = actions.filesByLocal.get(attachment.local);
      if (file && !actions.mediaUrls.has(attachment.local) && !actions.mediaLoading.has(attachment.local) && !actions.mediaFailed.has(attachment.local)) {
        actions.loadMedia(file);
      }
    }
  }
</script>

<div class="transcript-attachments">
  {#each attachments as attachment, index (`${attachment.local ?? attachment.original}-${index}`)}
    {@const file = attachment.local ? actions?.filesByLocal.get(attachment.local) : undefined}
    {@const mediaUrl = attachment.local ? actions?.mediaUrls.get(attachment.local) : undefined}
    {@const failed = Boolean(attachment.local && actions?.mediaFailed.has(attachment.local))}

    {#if file && actions && attachment.mediaType === "image"}
      <figure class="transcript-media transcript-image">
        {#if mediaUrl}
          <button type="button" aria-label={copy.preview} onclick={() => actions?.preview(file)}><img src={mediaUrl} alt={attachment.original} loading="lazy" /></button>
        {:else if failed}
          <button class="transcript-media-error" type="button" onclick={() => actions?.loadMedia(file)}>{copy.mediaLoadFailed}</button>
        {:else}
          <div class="transcript-media-loading"><i class="ph ph-circle-notch" aria-hidden="true"></i><span>{copy.mediaLoading}</span></div>
        {/if}
        <figcaption><span title={attachment.original}>{attachment.original}</span><button type="button" aria-label={copy.download} title={copy.download} onclick={() => actions?.download(file)}><i class="ph ph-download-simple"></i></button></figcaption>
      </figure>
    {:else if file && actions && attachment.mediaType === "audio"}
      <div class="transcript-media transcript-audio">
        <div class="transcript-media-heading"><i class="ph-fill ph-waveform" aria-hidden="true"></i><span title={attachment.original}>{attachment.original}</span><button type="button" aria-label={copy.download} title={copy.download} onclick={() => actions?.download(file)}><i class="ph ph-download-simple"></i></button></div>
        {#if mediaUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio controls preload="metadata" src={mediaUrl}></audio>
        {:else if failed}
          <button class="transcript-media-error" type="button" onclick={() => actions?.loadMedia(file)}>{copy.mediaLoadFailed}</button>
        {:else}
          <div class="transcript-media-loading"><i class="ph ph-circle-notch" aria-hidden="true"></i><span>{copy.mediaLoading}</span></div>
        {/if}
      </div>
    {:else if file && actions && attachment.mediaType === "video"}
      <figure class="transcript-media transcript-video">
        {#if mediaUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls preload="metadata" src={mediaUrl}></video>
        {:else if failed}
          <button class="transcript-media-error" type="button" onclick={() => actions?.loadMedia(file)}>{copy.mediaLoadFailed}</button>
        {:else}
          <div class="transcript-media-loading"><i class="ph ph-circle-notch" aria-hidden="true"></i><span>{copy.mediaLoading}</span></div>
        {/if}
        <figcaption><span title={attachment.original}>{attachment.original}</span><button type="button" aria-label={copy.download} title={copy.download} onclick={() => actions?.download(file)}><i class="ph ph-download-simple"></i></button></figcaption>
      </figure>
    {:else}
      <div class="attachment-chip" data-kind={attachment.mediaType}>
        <span class="attachment-icon" data-kind={attachment.mediaType} aria-hidden="true"></span>
        <span class="attachment-name" title={attachment.original}>{attachment.original}</span>
        {#if file && actions}<button type="button" onclick={() => actions?.download(file)}>{copy.download}</button>{/if}
      </div>
    {/if}
  {/each}
</div>
