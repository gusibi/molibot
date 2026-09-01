<script lang="ts">
  import { getProviderLogoSvg } from "./providerLogos";

  export let id: string = "";
  export let name: string = "";
  export let size: "sm" | "lg" | "xl" = "sm";

  function providerHue(providerId: string): number {
    let hash = 0;
    for (let index = 0; index < providerId.length; index += 1) {
      hash = (hash * 31 + providerId.charCodeAt(index)) % 360;
    }
    return hash;
  }

  function providerInitial(providerName: string, providerId: string): string {
    const source = (providerName || providerId).trim().replace(/^\[[^\]]+\]\s*/, "");
    const first = source[0] ?? "?";
    return /[a-z0-9]/i.test(first) ? first.toUpperCase() : first;
  }

  $: logoSvg = getProviderLogoSvg(id, name);
  $: initial = providerInitial(name, id);
  $: hue = providerHue(id);
  $: sizeClass = size === "xl" ? "xlarge" : size === "lg" ? "large" : "";
</script>

<span
  class="provider-avatar {sizeClass}"
  class:has-logo={!!logoSvg}
  style="--provider-hue: {hue};"
  aria-hidden="true"
>
  {#if logoSvg}
    <span class="provider-logo-svg">{@html logoSvg}</span>
  {:else}
    {initial}
  {/if}
</span>
