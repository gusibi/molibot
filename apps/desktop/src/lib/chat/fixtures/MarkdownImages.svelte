<script lang="ts">
  import { onDestroy } from "svelte";
  import ConversationTranscript from "../ConversationTranscript.svelte";
  import { translator } from "../../i18n";
  import type { TranscriptAttachmentActions, TranscriptMessage } from "../transcript";
  export let loadBytes: () => Promise<Blob>;
  export let locale: "zh-CN" | "en" = "en";
  const local = "chat/attachments/cover.png";
  const file = { id: "cover", local, original: "cover.png", mediaType: "image" as const, size: 68, origin: "generated" as const, createdAt: "" };
  const messages: TranscriptMessage[] = [{ role: "assistant", content: "Generated cover\n\n![Cover](/workspace/runtime/chat/scratch/2026/10/14/cover.png)", attachments: [{ local, original: "cover.png", mediaType: "image" }], activities: [{ key: "generate", kind: "tool", tool: "image", label: "Image", state: "success", fileOutput: { rootKind: "scratch", path: "2026/10/14/cover.png", action: "created" } }] }];
  let urls = new Map<string, string>();
  let loading = new Set<string>();
  let failures = new Set<string>();
  let requests = 0;
  let disposed = false;
  async function load(): Promise<void> {
    if (loading.has(local) || urls.has(local)) return;
    requests += 1;
    loading = new Set([local]);
    try {
      const url = URL.createObjectURL(await loadBytes());
      if (disposed) { URL.revokeObjectURL(url); return; }
      urls = new Map([[local, url]]);
    } catch {
      failures = new Set([local]);
    } finally { loading = new Set(); }
  }
  onDestroy(() => { disposed = true; for (const url of urls.values()) URL.revokeObjectURL(url); });
  $: actions = { filesByLocal: new Map([[local, file]]), mediaUrls: urls, mediaLoading: loading, mediaFailed: failures, loadMedia: load, canPreview: () => true, preview: () => {}, download: () => {} } satisfies TranscriptAttachmentActions;
</script>
<div data-testid="image-fixture">
  <ConversationTranscript {messages} copy={translator(locale)} formatTime={() => ""} attachmentActions={actions} onOpenTurnFiles={() => {}} />
  <output aria-label="Image requests">{requests}</output>
</div>
