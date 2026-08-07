<script lang="ts">
  import type { Translation } from "../i18n";
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import FileContextMenu from "../projects/FileContextMenu.svelte";
  import type { TranscriptAttachment, TranscriptAttachmentActions, TranscriptMessage } from "./transcript";

  export let attachments: TranscriptAttachment[];
  export let copy: Translation;
  export let actions: TranscriptAttachmentActions | null;
  export let message: TranscriptMessage;
  let menu: { x: number; y: number; file: DesktopSessionFile } | null = null;

  function openActionMenu(event: MouseEvent, file: DesktopSessionFile): void {
    const kind = file.mediaType === "image" ? "image" : "file";
    if (!actions?.contributions?.some((action) => action.accepts.includes(kind))) return;
    event.preventDefault();
    menu = { x: event.clientX, y: event.clientY, file };
  }

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
      <figure class="transcript-media transcript-image" oncontextmenu={(event) => openActionMenu(event, file)}>
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="transcript-media transcript-audio" oncontextmenu={(event) => openActionMenu(event, file)}>
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
      <figure class="transcript-media transcript-video" oncontextmenu={(event) => openActionMenu(event, file)}>
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="attachment-chip" data-kind={attachment.mediaType} oncontextmenu={file ? (event) => openActionMenu(event, file) : undefined}>
        <span class="attachment-icon" data-kind={attachment.mediaType} aria-hidden="true"></span>
        <span class="attachment-name" title={attachment.original}>{attachment.original}</span>
        {#if file && actions}<button type="button" onclick={() => actions?.download(file)}>{copy.download}</button>{/if}
      </div>
    {/if}
  {/each}
</div>

{#if menu && actions?.contributions}
  <FileContextMenu
    x={menu.x}
    y={menu.y}
    items={actions.contributions
      .filter((action) => action.accepts.includes(menu!.file.mediaType === "image" ? "image" : "file"))
      .map((action) => ({ id: action.id, label: action.label, icon: `ph-${action.icon || "paper-plane-tilt"}` }))}
    onSelect={(id) => {
      const action = actions?.contributions?.find((candidate) => candidate.id === id);
      if (action && menu) actions?.onRunContribution?.(action, message, menu.file);
    }}
    onClose={() => (menu = null)}
  />
{/if}
