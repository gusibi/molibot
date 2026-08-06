<script lang="ts">
  /**
   * Sandboxed HTML preview for agent-generated pages (PRD §3.38 Slice 1a).
   *
   * Loads from the fixed `molibot-artifact://` origin the Tauri transport
   * forwards to the runtime, so relative css/js/img references resolve inside
   * the validated Project root without ever handing the WebView a `file://` or
   * loopback URL (pitfall #6).
   *
   * `sandbox="allow-scripts"` deliberately omits `allow-same-origin`: the preview
   * is a static render, not a Mini App, so it gets no same-origin access and no
   * share of the Mini App API channel. `refreshKey` bumps to reload the iframe
   * after the agent rewrites the file.
   */
  let { src, refreshKey = 0 }: { src: string; refreshKey?: number } = $props();
</script>

{#key `${src}:${refreshKey}`}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <iframe
    class="artifact-html-frame"
    title="HTML preview"
    {src}
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
  ></iframe>
{/key}

<style>
  .artifact-html-frame {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    border: 0;
    background: var(--card-bg);
  }
</style>
