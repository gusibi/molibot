<script lang="ts" module>
  /**
   * Stable avatar color for a Bot (plan §3.5). The same botId always maps to the
   * same color — across restarts, and unaffected by renames — so we never reach
   * for runtime-random color. The hash is deterministic over the id string.
   */
  export const BOT_AVATAR_PALETTE = [
    "#006bff", "#a000f8", "#f22782", "#ffae00",
    "#28a948", "#00ac96", "#8500d1", "#e4106e"
  ];

  export function botAvatarColor(botId: string): string {
    const id = String(botId ?? "");
    let h = 0;
    for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
    return BOT_AVATAR_PALETTE[Math.abs(h) % BOT_AVATAR_PALETTE.length];
  }

  /**
   * First display character of a Bot name (plan §3.5): the first grapheme, with
   * an ASCII letter upper-cased. CJK / emoji / other scripts pass through
   * unchanged. Returns "" for an empty name so the caller shows the generic icon.
   */
  export function botAvatarInitial(name: string): string {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) return "";
    const chars = Array.from(trimmed);
    const first = chars[0];
    return /[a-z]/.test(first) ? first.toUpperCase() : first;
  }
</script>

<script lang="ts">
  let {
    botId,
    name = "",
    size = 28,
    readOnly = false
  }: { botId: string; name?: string; size?: number; readOnly?: boolean } = $props();

  let initial = $derived(botAvatarInitial(name));
  let color = $derived(botAvatarColor(botId || name));
</script>

<span
  class="bot-avatar"
  class:readonly={readOnly}
  style={`--c:${color};--size:${size}px`}
  aria-hidden="true"
>
  {#if initial}
    {initial}
  {:else}
    <i class="ph-fill ph-robot"></i>
  {/if}
</span>

<style>
  .bot-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: 8px;
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
    font-size: calc(var(--size) * 0.45);
    font-weight: 600;
    line-height: 1;
    flex: 0 0 auto;
    overflow: hidden;
    letter-spacing: 0;
  }
  .bot-avatar.readonly {
    background: color-mix(in srgb, var(--c) 12%, var(--fill, transparent));
    opacity: 0.92;
  }
  .bot-avatar i {
    font-size: calc(var(--size) * 0.55);
  }
</style>
