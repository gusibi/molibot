// Model routing settings — state + orchestration.
//
// `modelStates` is also consumed by the agents editor (per-agent model
// overrides), so that section imports this store directly.
import {
  loadDesktopModelRouting,
  loadDesktopModels,
  saveDesktopModelRouting,
  switchDesktopModel,
  type DesktopModelRoute
} from "../api";
import type { DesktopModelRoutingSettings, DesktopModelRoutingUpdateRequest, DesktopModelState } from "@molibot/desktop-contract";
import { session, setError, notifySettingsChanged } from "./session.svelte";

export const MODEL_ROUTES: DesktopModelRoute[] = ["text", "vision", "stt", "subagent"];

export const modelsStore = $state({
  modelStates: {} as Partial<Record<DesktopModelRoute, DesktopModelState>>,
  loading: false,
  switchingRoute: null as DesktopModelRoute | null,
  loadedEndpoint: "",
  /**
   * Last load failure. Kept separate from `loadedEndpoint` so a failed load
   * cannot re-arm the section's `$effect` guard and spin into a reload loop.
   */
  loadError: "",
  routing: null as DesktopModelRoutingSettings | null,
  routingDirty: false,
  routingSaving: false,
  routingMessage: "",
  routingPristine: ""
});

export function routeLabel(route: DesktopModelRoute, copy: typeof session.text): string {
  if (route === "text") return copy.routeText;
  if (route === "vision") return copy.routeVision;
  if (route === "stt") return copy.routeStt;
  if (route === "tts") return copy.routeTts;
  return copy.routeSubagent;
}

export function routeDescription(route: DesktopModelRoute, copy: typeof session.text): string {
  if (route === "text") return copy.routeTextHint;
  if (route === "vision") return copy.routeVisionHint;
  if (route === "stt") return copy.routeSttHint;
  return copy.routeSubagentHint;
}

async function runLoadModels(endpoint: string): Promise<void> {
  modelsStore.loadedEndpoint = endpoint;
  modelsStore.loading = true;
  session.error = "";
  try {
    const [states, routing] = await Promise.all([
      Promise.all(MODEL_ROUTES.map((route) => loadDesktopModels(endpoint, route))),
      loadDesktopModelRouting(endpoint)
    ]);
    const next: Partial<Record<DesktopModelRoute, DesktopModelState>> = {};
    MODEL_ROUTES.forEach((route, index) => (next[route] = states[index]));
    modelsStore.modelStates = next;
    modelsStore.routing = routing;
    modelsStore.routingPristine = JSON.stringify(routing);
    modelsStore.routingDirty = false;
    modelsStore.loadError = "";
  } catch (cause) {
    modelsStore.loadError = cause instanceof Error ? cause.message : String(cause);
    setError(cause);
  } finally {
    modelsStore.loading = false;
  }
}

let inflightLoad: Promise<void> | null = null;

/**
 * Shared by the section `$effect`, the providers-changed listener and manual
 * retries: plain callers reuse the in-flight request instead of racing over
 * the single `loading` flag, while `force` queues behind it.
 */
export function loadModels(endpoint: string, options: { force?: boolean } = {}): Promise<void> {
  const previous = inflightLoad;
  if (previous && !options.force) return previous;
  // runLoadModels never rejects, so chaining onto it needs no catch.
  const run = previous ? previous.then(() => runLoadModels(endpoint)) : runLoadModels(endpoint);
  inflightLoad = run;
  void run.finally(() => {
    if (inflightLoad === run) inflightLoad = null;
  });
  return run;
}

export function retryLoadModels(): void {
  if (!session.endpoint) return;
  void loadModels(session.endpoint, { force: true });
}

export async function changeModel(route: DesktopModelRoute, value: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || modelsStore.switchingRoute) return;
  const previous = modelsStore.modelStates[route];
  modelsStore.switchingRoute = route;
  if (previous) modelsStore.modelStates = { ...modelsStore.modelStates, [route]: { ...previous, currentKey: value } };
  session.error = "";
  try {
    modelsStore.modelStates = { ...modelsStore.modelStates, [route]: await switchDesktopModel(endpoint, value, route) };
  } catch (cause) {
    if (previous) modelsStore.modelStates = { ...modelsStore.modelStates, [route]: previous };
    setError(cause);
  } finally {
    modelsStore.switchingRoute = null;
  }
}

export function updateAdvancedModelRouting(updater: (draft: DesktopModelRoutingSettings) => DesktopModelRoutingSettings): void {
  if (!modelsStore.routing) return;
  modelsStore.routing = updater(modelsStore.routing);
  modelsStore.routingDirty = true;
  modelsStore.routingMessage = "";
}

function textModelContextWindow(): number {
  const fallback = modelsStore.routing?.compaction.defaultContextWindow ?? 0;
  const textState = modelsStore.modelStates.text;
  if (!textState) return fallback;
  const current = textState.options.find((option) => option.key === textState.currentKey);
  return current?.contextWindow ?? fallback;
}

export function compactionTriggerPreview(): { window: number; trigger: number; reason: string; fromModel: boolean } {
  const window = textModelContextWindow();
  const pct = modelsStore.routing?.compaction.thresholdPercent ?? 75;
  const reserve = modelsStore.routing?.compaction.reserveTokens ?? 8192;
  const pctLimit = Math.floor(window * pct / 100);
  const resLimit = window - reserve;
  const trigger = Math.min(pctLimit, resLimit);
  return {
    window,
    trigger,
    reason: pctLimit <= resLimit ? session.text.modelCompactionReasonThreshold : session.text.modelCompactionReasonReserve,
    fromModel: window !== (modelsStore.routing?.compaction.defaultContextWindow ?? 0)
  };
}

export function discardModelRouting(): void {
  if (!modelsStore.routingPristine) return;
  modelsStore.routing = JSON.parse(modelsStore.routingPristine);
  modelsStore.routingDirty = false;
}

export async function saveAdvancedModelRouting(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !modelsStore.routing || modelsStore.routingSaving) return;
  modelsStore.routingSaving = true;
  modelsStore.routingMessage = "";
  session.error = "";
  try {
    const { textOptions: _textOptions, ...request } = modelsStore.routing;
    modelsStore.routing = await saveDesktopModelRouting(endpoint, request satisfies DesktopModelRoutingUpdateRequest);
    modelsStore.routingPristine = JSON.stringify(modelsStore.routing);
    modelsStore.routingDirty = false;
    modelsStore.routingMessage = session.text.modelRoutingSaved;
    notifySettingsChanged();
  } catch (cause) {
    setError(cause);
  } finally {
    modelsStore.routingSaving = false;
  }
}
