<script lang="ts">
  import type { ComposerMenuItem } from "./composerSuggestionCatalog";
  import type { Translation } from "../i18n";

  export let suggestions: ComposerMenuItem[] = [];
  export let activeIndex = 0;
  export let onSelect: (suggestion: ComposerMenuItem) => void;
  export let copy: Translation;
</script>

<div class="slash-suggestions" role="listbox" aria-label={copy.slashMenuLabel}>
  {#each ["command", "skill", "miniapp", "file"] as kind}
    {@const items = suggestions.filter((item) => item.kind === kind)}
    {#if items.length}
      <div class="slash-suggestion-group" role="group" aria-label={kind === "command" ? copy.slashGroupCommand : kind === "skill" ? copy.slashGroupSkill : kind === "miniapp" ? copy.slashGroupMiniapp : copy.slashGroupFile}>
        <div class="slash-suggestion-heading">{kind === "command" ? copy.slashGroupCommand : kind === "skill" ? copy.slashGroupSkill : kind === "miniapp" ? copy.slashGroupMiniapp : copy.slashGroupFile}</div>
        {#each items as item (item.id)}
          {@const index = suggestions.indexOf(item)}
          <button
            class:active={index === activeIndex}
            class="slash-suggestion"
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => onSelect(item)}
          >
            <span class="slash-suggestion-icon" data-kind={item.kind}><i class={`ph ${item.kind === "command" ? "ph-terminal-window" : item.kind === "skill" ? "ph-sparkle" : item.kind === "miniapp" ? "ph-squares-four" : "ph-file"}`} aria-hidden="true"></i></span>
            <span class="slash-suggestion-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
            {#if item.argumentHint}<code>{item.argumentHint}</code>{:else if item.scope}<span class="slash-suggestion-scope">{item.scope}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  {/each}
</div>
