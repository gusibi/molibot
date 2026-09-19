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
    type AgentCityTheme,
    type AgentCityViewState
  } from "./agentCityScene";
  import type { AgentCityVisualTheme } from "./agentCityTheme";

  export let projection: AgentCityProjection;
  export let theme: AgentCityTheme;
  export let sky: string;
  export let visualTheme: AgentCityVisualTheme;
  export let onQuality: (quality: AgentCityQuality) => void;
  export let onFallback: () => void;
  export let onHover: (hover: AgentCityHover | null) => void;
  export let selectedKey: string | null = null;
  export let onSelect: (key: string | null) => void = () => {};
  export let onFocus: (key: string) => void = () => {};
  export let onView: (view: AgentCityViewState) => void = () => {};

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
  let lastPointer: { x: number; y: number } | null = null;
  let pressOrigin: { x: number; y: number } | null = null;

  /** Distinguishes a click from the tail of an orbit/pan drag. */
  const CLICK_SLOP_PX = 4;

  export function zoom(direction: "in" | "out"): void {
    controller?.zoom(direction);
  }

  export function resetView(): void {
    controller?.resetView();
  }

  export function focusFloor(key: string): void {
    controller?.focusFloor(key);
  }

  export function setFollowWorking(enabled: boolean): void {
    controller?.setFollowWorking(enabled);
  }

  export function clearFocus(): void {
    controller?.clearFocus();
  }

  function hoverAt(clientX: number, clientY: number): void {
    const hover = controller?.hitTest(clientX, clientY) ?? null;
    if (hover?.key === hoveredKey) {
      if (hover) onHover(hover);
      return;
    }
    hoveredKey = hover?.key ?? null;
    onHover(hover);
  }

  function updateHover(event: PointerEvent): void {
    lastPointer = { x: event.clientX, y: event.clientY };
    hoverAt(event.clientX, event.clientY);
  }

  /**
   * After a poll or theme flip the scene rebuilds room targets, so the hover is
   * re-validated by ray-casting the last pointer position. Blanking it here
   * would blink the card every 2.5s while the pointer still rests on a room.
   */
  function refreshHover(): void {
    if (!lastPointer) return;
    hoverAt(lastPointer.x, lastPointer.y);
  }

  function clearHover(): void {
    lastPointer = null;
    if (!hoveredKey) return;
    hoveredKey = null;
    onHover(null);
  }

  function handlePointerDown(event: PointerEvent): void {
    pressOrigin = { x: event.clientX, y: event.clientY };
  }

  function movedTooFar(event: PointerEvent): boolean {
    if (!pressOrigin) return true;
    return Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > CLICK_SLOP_PX;
  }

  function handleClick(event: MouseEvent): void {
    if (movedTooFar(event as unknown as PointerEvent)) {
      pressOrigin = null;
      return;
    }
    pressOrigin = null;
    const hit = controller?.greetAt(event.clientX, event.clientY) ?? null;
    onSelect(hit?.key ?? null);
  }

  function handleDoubleClick(event: MouseEvent): void {
    const hit = controller?.hitTest(event.clientX, event.clientY) ?? null;
    if (!hit) return;
    controller?.focusFloor(hit.key);
    onFocus(hit.key);
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
      sky,
      visualTheme,
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
      onContextLost: onFallback,
      onViewChange: (view) => onView(view)
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
    refreshHover();
  }
  $: if (mounted && controller) {
    controller.setTheme(theme);
    refreshHover();
  }
  $: if (mounted && controller) {
    controller.setSky(sky);
  }
  $: if (mounted && controller) {
    controller.setVisualTheme(visualTheme);
  }
  $: if (mounted && controller) {
    controller.setSelectedFloor(selectedKey);
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

<div class="agent-city-canvas" bind:this={container}>
  <!-- Scene contents are mirrored for assistive tech by the pane's sr-only list. -->
  <canvas
    bind:this={canvas}
    aria-hidden="true"
    onpointerdown={handlePointerDown}
    onpointermove={updateHover}
    onpointerleave={clearHover}
    onclick={handleClick}
    ondblclick={handleDoubleClick}
    oncontextmenu={(event) => event.preventDefault()}
  ></canvas>
</div>
