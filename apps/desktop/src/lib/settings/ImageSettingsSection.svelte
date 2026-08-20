<script lang="ts">
  import ImageGenerateSection from "./ImageGenerateSection.svelte";
  import ImageRecognitionSection from "./ImageRecognitionSection.svelte";
  import { session } from "../stores/session.svelte";

  let activeTab = $state<"generation" | "recognition">("generation");
</script>

<div class="image-settings-tabs segmented" role="tablist" aria-label={session.text.imageGenerate}>
  <button type="button" role="tab" class="segmented-item" class:active={activeTab === "generation"} aria-selected={activeTab === "generation"} aria-controls="image-generation-panel" onclick={() => activeTab = "generation"}>{session.text.imageGenerationTab}</button>
  <button type="button" role="tab" class="segmented-item" class:active={activeTab === "recognition"} aria-selected={activeTab === "recognition"} aria-controls="image-recognition-panel" onclick={() => activeTab = "recognition"}>{session.text.imageRecognitionTab}</button>
</div>

{#if activeTab === "generation"}
  <div id="image-generation-panel" role="tabpanel"><ImageGenerateSection /></div>
{:else}
  <div id="image-recognition-panel" role="tabpanel"><ImageRecognitionSection /></div>
{/if}
