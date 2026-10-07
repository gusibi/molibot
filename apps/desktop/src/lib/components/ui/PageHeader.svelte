<script lang="ts">
  export let title: string;
  export let description = "";
  export let dataPage = false;
  export let scrolled = false;
</script>

<header class:data-page={dataPage} class:is-scrolled={scrolled} class="page-header settings-page-header" data-tauri-drag-region>
  <div data-tauri-drag-region>
    <h2 data-tauri-drag-region>{title}</h2>
    {#if description}<p class="page-header-description">{description}</p>{/if}
  </div>
  <div class="page-header-actions"><slot name="actions" /></div>
  <span class="toolbar-edge" aria-hidden="true"></span>
</header>
