<script lang="ts">
  /**
   * Border beam: a glow that rides the border of a running affordance.
   *
   * A conic gradient on the ring's `::before` rotates inside a mask that keeps
   * only the outer 1.5px, so the travelling glow can never cover the element's
   * content and the host needs no `overflow: hidden`. The host must be a
   * positioned box (relative/absolute) with a `border-radius` for the ring to
   * inherit. Colour is the theme accent, not a fixed rainbow, so it stays
   * legible on every theme family in both appearances.
   */
</script>

<span class="beam-ring" aria-hidden="true"></span>

<style>
  .beam-ring {
    position: absolute;
    inset: 0;
    padding: 2px;
    border-radius: inherit;
    pointer-events: none;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
  }
  .beam-ring::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 260%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%) rotate(0turn);
    background: conic-gradient(
      from 0turn,
      transparent 0turn 0.48turn,
      color-mix(in srgb, var(--accent) 35%, transparent) 0.62turn,
      var(--accent) 0.78turn,
      color-mix(in srgb, var(--accent) 26%, white) 0.85turn,
      transparent 0.96turn 1turn
    );
    animation: beam-spin 2.8s linear infinite;
  }
  @keyframes beam-spin {
    to {
      transform: translate(-50%, -50%) rotate(1turn);
    }
  }
</style>
