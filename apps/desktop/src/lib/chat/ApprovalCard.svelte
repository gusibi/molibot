<script lang="ts">
  export let title: string;
  export let commandLabel: string;
  export let reasonLabel: string;
  export let command: string;
  export let reason = "";
  export let options: Array<{ id: string; label: string }> = [];
  export let disabled = false;
  export let dangerOptionId = "reject";
  export let onResolve: (id: string) => void;
</script>

<div class="approval-card" role="alertdialog" aria-label={title}>
  <strong class="approval-title">⚠️ {title}</strong>
  <div class="approval-field">
    <span>{commandLabel}</span>
    <code>{command}</code>
  </div>
  {#if reason}
    <div class="approval-field">
      <span>{reasonLabel}</span>
      <p>{reason}</p>
    </div>
  {/if}
  <div class="approval-actions">
    {#each options as option (option.id)}
      <button
        type="button"
        class:danger-action={option.id === dangerOptionId}
        {disabled}
        onclick={() => onResolve(option.id)}
      >{option.label}</button>
    {/each}
  </div>
</div>
