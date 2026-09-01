<script lang="ts">
  import Download from "reicon-svelte/icons/Download";
  import Loader from "reicon-svelte/icons/Loader";
  import Soundwave from "reicon-svelte/icons/Soundwave";
  import { contributionIcon } from "./activityIcons";
  import type { Translation } from "../i18n";
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import FileContextMenu from "../projects/FileContextMenu.svelte";
  import { openImageLightbox, type LightboxItem } from "../imageLightbox";
  import { galleryColumns, groupTranscriptAttachments } from "./attachmentGroups";
  import type { TranscriptAttachment, TranscriptAttachmentActions, TranscriptMessage } from "./transcript";

  export let attachments: TranscriptAttachment[];
  export let copy: Translation;
  export let actions: TranscriptAttachmentActions | null;
  export let message: TranscriptMessage;
  let menu: { x: number; y: number; file: DesktopSessionFile } | null = null;

  /** One attachment with everything the template needs already looked up. */
  type ResolvedAttachment = {
    attachment: TranscriptAttachment;
    file: DesktopSessionFile | undefined;
    mediaUrl: string | undefined;
    failed: boolean;
  };
  type ResolvedGroup =
    | { kind: "gallery"; key: string; items: ResolvedAttachment[] }
    | { kind: "single"; key: string; item: ResolvedAttachment };

  function resolveOne(
    attachment: TranscriptAttachment,
    source: TranscriptAttachmentActions | null
  ): ResolvedAttachment {
    const local = attachment.local;
    return {
      attachment,
      file: local ? source?.filesByLocal.get(local) : undefined,
      mediaUrl: local ? source?.mediaUrls.get(local) : undefined,
      failed: Boolean(local && source?.mediaFailed.has(local))
    };
  }

  /**
   * Resolves every attachment against `actions` up front.
   *
   * `actions` is passed in rather than read off the component, and the `$:`
   * below names it explicitly, because that is the only thing that makes it a
   * tracked dependency: the `{#each}` iterates groups derived from
   * `attachments` alone, so a bare `fileOf(attachment)` helper called from a
   * `{@const}` reads `actions` somewhere the compiler cannot see it. The file
   * and blob-URL maps are populated *after* first render — attachments arrive
   * before their bytes — so a missed invalidation is not a subtle staleness
   * bug: every image stays on its "not loaded yet" chip forever. Same family as
   * the `{#each fn()}` trap in CLAUDE.md pitfall #2.
   */
  function resolveGroups(
    source: TranscriptAttachmentActions | null,
    list: TranscriptAttachment[]
  ): ResolvedGroup[] {
    return groupTranscriptAttachments(list).map((group) =>
      group.kind === "gallery"
        ? {
            kind: "gallery" as const,
            key: `g${group.startIndex}`,
            items: group.items.map((item) => resolveOne(item, source))
          }
        : {
            kind: "single" as const,
            key: `s${group.index}`,
            item: resolveOne(group.item, source)
          }
    );
  }

  $: groups = resolveGroups(actions, attachments);

  function openActionMenu(event: MouseEvent, file: DesktopSessionFile): void {
    const kind = file.mediaType === "image" ? "image" : "file";
    if (!actions?.contributions?.some((action) => action.accepts.includes(kind))) return;
    event.preventDefault();
    menu = { x: event.clientX, y: event.clientY, file };
  }

  /** Keyboard route (Enter/Space) to the same menu, anchored to the focused card. */
  function openActionMenuFromKeyboard(event: KeyboardEvent, file: DesktopSessionFile): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    const kind = file.mediaType === "image" ? "image" : "file";
    if (!actions?.contributions?.some((action) => action.accepts.includes(kind))) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, file };
  }

  /**
   * Opens the clicked image as a gallery over its whole run.
   *
   * Only images that have finished loading go in: a placeholder has no `src`,
   * and including it would give the viewer a blank slide the arrows still page
   * onto. The clicked image's position is recomputed against the filtered list
   * so the viewer opens on the picture that was actually clicked.
   */
  function openGallery(items: ResolvedAttachment[], clicked: ResolvedAttachment): void {
    const loaded = items.filter((item) => item.mediaUrl);
    const lightboxItems: LightboxItem[] = loaded.map((item) => ({
      src: item.mediaUrl as string,
      alt: item.attachment.original,
      onDownload: item.file && actions ? () => actions?.download(item.file!) : undefined
    }));
    openImageLightbox(lightboxItems, Math.max(0, loaded.indexOf(clicked)), copy);
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
  {#each groups as group (group.key)}
    {#if group.kind === "gallery"}
      <!--
        One image keeps the full-width card it always had; two sit side by side;
        three or more use a three-column grid so the block's height stops
        growing with the number of results.
      -->
      <div class="transcript-gallery" data-columns={galleryColumns(group.items.length)}>
        {#each group.items as entry, offset (`${entry.attachment.local ?? entry.attachment.original}-${offset}`)}
          {#if entry.file && actions}
            {@const file = entry.file}
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role, a11y_no_noninteractive_tabindex -->
            <figure
              class="transcript-media transcript-image"
              tabindex="0"
              role="button"
              aria-label={`${entry.attachment.original} · ${copy.conversationMenu}`}
              oncontextmenu={(event) => openActionMenu(event, file)}
              onkeydown={(event) => openActionMenuFromKeyboard(event, file)}
            >
              {#if entry.mediaUrl}
                <button
                  type="button"
                  class="transcript-image-open"
                  aria-label={copy.preview}
                  title={entry.attachment.original}
                  onclick={() => openGallery(group.items, entry)}
                ><img src={entry.mediaUrl} alt={entry.attachment.original} loading="lazy" decoding="async" /></button>
              {:else if entry.failed}
                <button class="transcript-media-error" type="button" onclick={() => actions?.loadMedia(file)}>{copy.mediaLoadFailed}</button>
              {:else}
                <div class="transcript-media-loading"><Loader size={16} aria-hidden="true" /><span>{copy.mediaLoading}</span></div>
              {/if}
              <!--
                The caption is the file name plus a download button, which does
                not survive being squeezed into a third of the column. In a grid
                the name moves to the image's `title` and download moves into the
                viewer, so a thumbnail stays a thumbnail.
              -->
              {#if group.items.length === 1}
                <figcaption><span title={entry.attachment.original}>{entry.attachment.original}</span><button type="button" aria-label={copy.download} title={copy.download} onclick={() => actions?.download(file)}><Download size={14} aria-hidden="true" /></button></figcaption>
              {/if}
            </figure>
          {:else}
            <!--
              No file record for this attachment. Deliberately the named chip and
              not a spinner: the record may simply never arrive (an older
              transcript, a file that was cleaned up), and a spinner would
              promise progress that never comes. The name is the useful part.
            -->
            <div class="attachment-chip" data-kind={entry.attachment.mediaType}>
              <span class="attachment-icon" data-kind={entry.attachment.mediaType} aria-hidden="true"></span>
              <span class="attachment-name" title={entry.attachment.original}>{entry.attachment.original}</span>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      {@const entry = group.item}
      {@const attachment = entry.attachment}
      {@const file = entry.file}

      {#if file && actions && attachment.mediaType === "audio"}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="transcript-media transcript-audio"
          tabindex="0"
          role="button"
          aria-label={`${attachment.original} · ${copy.conversationMenu}`}
          oncontextmenu={(event) => openActionMenu(event, file)}
          onkeydown={(event) => openActionMenuFromKeyboard(event, file)}
        >
          <div class="transcript-media-heading"><Soundwave weight="Filled" size={18} aria-hidden="true" /><span title={attachment.original}>{attachment.original}</span><button type="button" aria-label={copy.download} title={copy.download} onclick={() => actions?.download(file)}><Download size={14} aria-hidden="true" /></button></div>
          {#if entry.mediaUrl}
            <!-- svelte-ignore a11y_media_has_caption -->
            <audio controls preload="metadata" src={entry.mediaUrl}></audio>
          {:else if entry.failed}
            <button class="transcript-media-error" type="button" onclick={() => actions?.loadMedia(file)}>{copy.mediaLoadFailed}</button>
          {:else}
            <div class="transcript-media-loading"><Loader size={16} aria-hidden="true" /><span>{copy.mediaLoading}</span></div>
          {/if}
        </div>
      {:else if file && actions && attachment.mediaType === "video"}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role, a11y_no_noninteractive_tabindex -->
        <figure
          class="transcript-media transcript-video"
          tabindex="0"
          role="button"
          aria-label={`${attachment.original} · ${copy.conversationMenu}`}
          oncontextmenu={(event) => openActionMenu(event, file)}
          onkeydown={(event) => openActionMenuFromKeyboard(event, file)}
        >
          {#if entry.mediaUrl}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video controls preload="metadata" src={entry.mediaUrl}></video>
          {:else if entry.failed}
            <button class="transcript-media-error" type="button" onclick={() => actions?.loadMedia(file)}>{copy.mediaLoadFailed}</button>
          {:else}
            <div class="transcript-media-loading"><Loader size={16} aria-hidden="true" /><span>{copy.mediaLoading}</span></div>
          {/if}
          <figcaption><span title={attachment.original}>{attachment.original}</span><button type="button" aria-label={copy.download} title={copy.download} onclick={() => actions?.download(file)}><Download size={14} aria-hidden="true" /></button></figcaption>
        </figure>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
        <div
          class="attachment-chip"
          data-kind={attachment.mediaType}
          tabindex={file ? 0 : undefined}
          role={file ? "button" : undefined}
          aria-label={file ? `${attachment.original} · ${copy.conversationMenu}` : undefined}
          oncontextmenu={file ? (event) => openActionMenu(event, file) : undefined}
          onkeydown={file ? (event) => openActionMenuFromKeyboard(event, file) : undefined}
        >
          <span class="attachment-icon" data-kind={attachment.mediaType} aria-hidden="true"></span>
          <span class="attachment-name" title={attachment.original}>{attachment.original}</span>
          {#if file && actions}<button type="button" onclick={() => actions?.download(file)}>{copy.download}</button>{/if}
        </div>
      {/if}
    {/if}
  {/each}
</div>

{#if menu && actions?.contributions}
  <FileContextMenu
    x={menu.x}
    y={menu.y}
    items={actions.contributions
      .filter((action) => action.accepts.includes(menu!.file.mediaType === "image" ? "image" : "file"))
      .map((action) => ({ id: action.id, label: action.label, icon: contributionIcon(action.icon) }))}
    onSelect={(id) => {
      const action = actions?.contributions?.find((candidate) => candidate.id === id);
      if (action && menu) actions?.onRunContribution?.(action, message, menu.file);
    }}
    onClose={() => (menu = null)}
  />
{/if}
