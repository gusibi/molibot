<script lang="ts">
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import PlanCard from "./PlanCard.svelte";
  import { sessionPlanInspector } from "./sessionPlanUi";
  export let copy: Translation;
  export let onClose: () => void;
</script>

<aside class="session-plan-inspector" aria-label={copy.planOpenProgress}>
  <header class="file-panel-head">
    <strong>{copy.planOpenProgress}</strong>
    <button type="button" class="secondary-button" aria-label={copy.closePanel} onclick={onClose}><X size={16} /></button>
  </header>
  {#if $sessionPlanInspector}
    <PlanCard plan={$sessionPlanInspector.plan} {copy} inInspector onResolve={(decision) => { if (decision === "complete") $sessionPlanInspector?.complete(); }} />
  {/if}
</aside>
