<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { AgentCityProjection } from "./agentCityProjection";
  import {
    createAgentCityScene,
    selectAgentCityQuality,
    supportsAgentCityWebGL2,
    type AgentCityHover,
    type AgentCityQuality,
    type AgentCitySceneController,
    type AgentCityTheme
  } from "./agentCityScene";

  export let projection: AgentCityProjection;
  export let theme: AgentCityTheme;
  export let onQuality: (quality: AgentCityQuality) => void;
  export let onFallback: () => void;
  export let onHover: (hover: AgentCityHover | null) => void;

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let controller: AgentCitySceneController | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let reducedMotion = false;
  let quality: AgentCityQuality = "fallback";
  let mounted = false;
  let visible = true;
  let hoveredKey: string | null = null;

  function updateHover(event: PointerEvent): void {
    const hover = controller?.hitTest(event.clientX, event.clientY) ?? null;
    if (hover?.key === hoveredKey) {
      if (hover) onHover(hover);
      return;
    }
    hoveredKey = hover?.key ?? null;
    onHover(hover);
  }

  function clearHover(): void {
    if (!hoveredKey) return;
    hoveredKey = null;
    onHover(null);
  }

  function handleVisibility(): void {
    controller?.setVisible(visible && !document.hidden);
  }

  function initialize(): void {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    quality = selectAgentCityQuality({
      webgl2: supportsAgentCityWebGL2(),
      deviceMemory: memory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio || 1
    });
    onQuality(quality);
    if (quality === "fallback") {
      onFallback();
      return;
    }

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = motionQuery.matches;
    controller = createAgentCityScene({
      canvas,
      projection,
      theme,
      reducedMotion,
      quality,
      onPerformanceFallback: () => {
        if (quality === "full") {
          quality = "low";
          onQuality("low");
          controller?.setQuality("low");
        } else {
          onFallback();
        }
      },
      onContextLost: onFallback
    });

    const handleMotion = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches;
      controller?.setReducedMotion(reducedMotion);
    };
    motionQuery.addEventListener("change", handleMotion);

    resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      controller?.resize(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(container);
    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      handleVisibility();
    }, { threshold: 0.02 });
    intersectionObserver.observe(container);
    document.addEventListener("visibilitychange", handleVisibility);

    cleanupMotion = () => motionQuery.removeEventListener("change", handleMotion);
  }

  let cleanupMotion = (): void => {};

  onMount(() => {
    mounted = true;
    initialize();
  });

  $: if (mounted && controller) {
    controller.update(projection);
    clearHover();
  }
  $: if (mounted && controller) {
    controller.setTheme(theme);
    clearHover();
  }

  onDestroy(() => {
    mounted = false;
    cleanupMotion();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", handleVisibility);
    clearHover();
    controller?.dispose();
    controller = null;
  });
</script>

<div class="agent-city-canvas" bind:this={container} aria-hidden="true">
  <canvas bind:this={canvas} onpointermove={updateHover} onpointerleave={clearHover}></canvas>
</div>
