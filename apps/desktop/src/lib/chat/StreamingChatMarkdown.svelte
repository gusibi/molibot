<script lang="ts">
  import type { Translation } from "../i18n";
  import { markdownBody } from "../markdownInteractions";
  import { createStreamingRenderer } from "./streamingMarkdown";

  export let source: string;
  export let copy: Translation;
  const renderer = createStreamingRenderer();
  $: blocks = renderer.derive(source, { copyCode: copy.copyCode, wrapLinesLabel: copy.wrapLines });
</script>

<div class="message-bubble markdown-body" use:markdownBody={copy}>
  {#each blocks as block, index (index)}
    <div class="md-stream-block">{@html block.html}</div>
  {/each}
</div>
