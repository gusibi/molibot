<script lang="ts">
  import { tablist } from "../a11y/tablist";
  import ImageGenerateSection from "./ImageGenerateSection.svelte";
  import ImageRecognitionSection from "./ImageRecognitionSection.svelte";
  import { session } from "../stores/session.svelte";

  let activeTab = $state<"generation" | "recognition">("generation");
</script>

<div class="image-settings-tabs segmented" role="tablist" aria-label={session.text.imageGenerate} use:tablist>
  <button type="button" role="tab" id="image-generation-tab" class="segmented-item" class:active={activeTab === "generation"} aria-selected={activeTab === "generation"} aria-controls="image-generation-panel" onclick={() => activeTab = "generation"}>{session.text.imageGenerationTab}</button>
  <button type="button" role="tab" id="image-recognition-tab" class="segmented-item" class:active={activeTab === "recognition"} aria-selected={activeTab === "recognition"} aria-controls="image-recognition-panel" onclick={() => activeTab = "recognition"}>{session.text.imageRecognitionTab}</button>
</div>

{#if activeTab === "generation"}
  <div id="image-generation-panel" role="tabpanel" aria-labelledby="image-generation-tab"><ImageGenerateSection /></div>
{:else}
  <div id="image-recognition-panel" role="tabpanel" aria-labelledby="image-recognition-tab"><ImageRecognitionSection /></div>
{/if}
