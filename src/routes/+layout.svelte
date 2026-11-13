<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";

  // Desktop owns the "Answer style" setting; Web mirrors the same preference
  // so a session opened in the browser reads like the app. app.html sets the
  // attribute before first paint; this listener keeps other tabs in sync.
  const DOC_STYLE_STORAGE_KEY = "molibot-desktop-doc-style";

  onMount(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== DOC_STYLE_STORAGE_KEY) return;
      document.documentElement.dataset.docStyle =
        event.newValue === "notion" ? "notion" : "feishu";
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  });
</script>

<slot />
