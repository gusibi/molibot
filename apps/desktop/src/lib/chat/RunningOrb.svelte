<script lang="ts">
  /**
   * A running-state "thinking orb": a fibonacci-distributed set of dots on a
   * rotating 3D sphere, projected with CSS `perspective` so the dots scale and
   * travel through depth like the reference point-cloud orb. Pure CSS/DOM — no
   * canvas or WebGL — so a sidebar can host several without extra contexts, and
   * it degrades to a still orb under `prefers-reduced-motion` / `data-performance="low"`.
   */
  let {
    size = 16,
    dot = 1.7,
    points = 30,
    speed = 3.4
  }: {
    size?: number;
    dot?: number;
    points?: number;
    speed?: number;
  } = $props();

  const radius = $derived(Math.max(0, (size - dot) / 2));

  // Even coverage of a unit sphere (golden-angle spiral), scattered back out to
  // the pixel radius. Depth ordering is handled by the 3D transform context.
  const offsets = $derived.by(() => {
    const out: string[] = [];
    const step = 2 / points;
    const increment = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < points; i++) {
      const y = i * step - 1 + step / 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * increment;
      const x = Math.cos(phi) * ring * radius;
      const yy = y * radius;
      const z = Math.sin(phi) * ring * radius;
      out.push(`translate3d(${x.toFixed(2)}px, ${yy.toFixed(2)}px, ${z.toFixed(2)}px)`);
    }
    return out;
  });
</script>

<span
  class="running-orb"
  style={`--orb-size:${size}px; --orb-dot:${dot}px; --orb-speed:${speed}s;`}
  aria-hidden="true"
>
  <span class="running-orb-field">
    <span class="running-orb-sphere">
      {#each offsets as transform, index (index)}<i style={`transform:${transform}`}></i>{/each}
    </span>
  </span>
</span>

<style>
  .running-orb {
    position: relative;
    display: inline-block;
    width: var(--orb-size);
    height: var(--orb-size);
  }
  .running-orb-field {
    position: absolute;
    inset: 0;
    perspective: 60px;
  }
  .running-orb-sphere {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    /* A representative pose so the orb still reads as a round sphere when the
       animation is disabled (prefers-reduced-motion / low performance); the
       keyframes take over the property while it runs. */
    transform: rotateX(-14deg) rotateY(26deg);
    animation: running-orb-spin var(--orb-speed) linear infinite;
  }
  .running-orb-sphere i {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--orb-dot);
    height: var(--orb-dot);
    margin-left: calc(var(--orb-dot) / -2);
    margin-top: calc(var(--orb-dot) / -2);
    border-radius: 9999px;
    background: currentColor;
  }
  @keyframes running-orb-spin {
    from {
      transform: rotateX(-14deg) rotateY(0deg);
    }
    to {
      transform: rotateX(-14deg) rotateY(360deg);
    }
  }
</style>
