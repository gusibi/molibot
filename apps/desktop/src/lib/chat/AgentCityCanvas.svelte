<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { AgentCityProjection } from "./agentCityProjection";
  import {
    createAgentCityScene,
    selectAgentCityQuality,
    supportsAgentCityWebGL2,
    type AgentCityAnchor,
    type AgentCityQuality,
    type AgentCitySceneController,
    type AgentCityTheme
  } from "./agentCityScene";

  export let projection: AgentCityProjection;
  export let theme: AgentCityTheme;
  export let onAnchors: (anchors: Record<string, AgentCityAnchor>) => void;
  export let onQuality: (quality: AgentCityQuality) => void;
  export let onFallback: () => void;

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let controller: AgentCitySceneController | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let anchorFrame = 0;
  let reducedMotion = false;
  let quality: AgentCityQuality = "fallback";
  let mounted = false;
  let visible = true;

  function stopAnchorUpdates(): void {
    if (!anchorFrame) return;
    cancelAnimationFrame(anchorFrame);
    anchorFrame = 0;
  }

  function updateAnchors(): void {
    anchorFrame = 0;
    if (!controller || !visible || document.hidden) return;
    onAnchors(controller.getAnchors());
    anchorFrame = requestAnimationFrame(updateAnchors);
  }

  function startAnchorUpdates(): void {
    if (anchorFrame || !controller || !visible || document.hidden) return;
    anchorFrame = requestAnimationFrame(updateAnchors);
  }

  function handleVisibility(): void {
    const sceneVisible = visible && !document.hidden;
    controller?.setVisible(sceneVisible);
    if (sceneVisible) startAnchorUpdates();
    else stopAnchorUpdates();
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
    startAnchorUpdates();

    cleanupMotion = () => motionQuery.removeEventListener("change", handleMotion);
  }

  let cleanupMotion = (): void => {};

  onMount(() => {
    mounted = true;
    initialize();
  });

  $: if (mounted && controller) controller.update(projection);
  $: if (mounted && controller) controller.setTheme(theme);

  onDestroy(() => {
    mounted = false;
    stopAnchorUpdates();
    cleanupMotion();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", handleVisibility);
    controller?.dispose();
    controller = null;
  });
</script>

<div class="agent-city-canvas" bind:this={container} aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
</div>
