<script lang="ts">
  import { DUOTONE_ICON_BODIES, type DuotoneIconName } from "./bodies.generated";

  /** Decorative duotone showcase icon; see DESIGN.md "Foundations" for the weight rules. */
  export let name: DuotoneIconName;
  /** @type {string | number} */
  export let size = 24;
  /** @type {string | undefined} */
  export let color = undefined;

  let className = "";
  export { className as class };

  let customStyle = "";
  export { customStyle as style };

  $: body = DUOTONE_ICON_BODIES[name];
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  class="reicon duotone {className}"
  style={color != null ? `color: ${color}; ${customStyle}` : customStyle}
  aria-hidden="true"
  focusable="false"
  {...$$restProps}
>
  {@html body}
</svg>
