import type {
  DesktopImageRecognitionEngine,
  DesktopImageRecognitionSummary,
  DesktopImageRecognitionUpdateRequest,
  DesktopSettingsTestResponse
} from "@molibot/desktop-contract";
import {
  loadDesktopImageRecognition,
  saveDesktopImageRecognition,
  testDesktopImageRecognitionSettings
} from "../api";
import { session, setError } from "./session.svelte";

export const imageRecognitionStore = $state({
  summary: null as DesktopImageRecognitionSummary | null,
  draft: null as DesktopImageRecognitionUpdateRequest | null,
  endpoint: "",
  loading: false,
  saving: false,
  dirty: false,
  message: "",
  testBusy: false,
  testResult: null as DesktopSettingsTestResponse | null,
  testPrompt: "Describe the image accurately, including visible text and important details.",
  testEngine: "auto"
});

function draftFromSummary(summary: DesktopImageRecognitionSummary): DesktopImageRecognitionUpdateRequest {
  return {
    enabled: summary.enabled,
    defaultEngine: summary.defaultEngine,
    engines: summary.engines.map((engine) => ({ ...engine }))
  };
}

export async function loadImageRecognition(endpoint: string): Promise<void> {
  imageRecognitionStore.endpoint = endpoint;
  imageRecognitionStore.loading = true;
  session.error = "";
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const summary = await Promise.race([
      loadDesktopImageRecognition(endpoint),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Image recognition settings request timed out.")), 6_000);
      })
    ]);
    imageRecognitionStore.summary = summary;
    imageRecognitionStore.draft = draftFromSummary(summary);
    imageRecognitionStore.testEngine = summary.defaultEngine;
    imageRecognitionStore.dirty = false;
    imageRecognitionStore.message = "";
    imageRecognitionStore.testResult = null;
  } catch (cause) {
    setError(cause);
  } finally {
    if (deadline) clearTimeout(deadline);
    imageRecognitionStore.loading = false;
  }
}

export function markImageRecognitionDirty(): void {
  imageRecognitionStore.dirty = true;
  imageRecognitionStore.message = "";
  imageRecognitionStore.testResult = null;
}

export function addImageRecognitionEngine(): void {
  const draft = imageRecognitionStore.draft;
  const model = imageRecognitionStore.summary?.models.find((item) => item.verification !== "failed");
  if (!draft || !model) return;
  let index = draft.engines.length + 1;
  let id = `vision-${index}`;
  while (draft.engines.some((engine) => engine.id === id)) id = `vision-${++index}`;
  draft.engines = [...draft.engines, { id, enabled: true, name: `Vision ${index}`, modelKey: model.key }];
  if (draft.engines.length === 1) draft.defaultEngine = "auto";
  markImageRecognitionDirty();
}

export function removeImageRecognitionEngine(id: string): void {
  const draft = imageRecognitionStore.draft;
  if (!draft) return;
  draft.engines = draft.engines.filter((engine) => engine.id !== id);
  if (draft.defaultEngine === id) draft.defaultEngine = "auto";
  if (imageRecognitionStore.testEngine === id) imageRecognitionStore.testEngine = "auto";
  markImageRecognitionDirty();
}

export function updateImageRecognitionEngine(
  id: string,
  patch: Partial<Omit<DesktopImageRecognitionEngine, "id">>
): void {
  const draft = imageRecognitionStore.draft;
  if (!draft) return;
  draft.engines = draft.engines.map((engine) => engine.id === id ? { ...engine, ...patch } : engine);
  markImageRecognitionDirty();
}

export function moveImageRecognitionEngine(id: string, direction: -1 | 1): void {
  const draft = imageRecognitionStore.draft;
  if (!draft) return;
  const from = draft.engines.findIndex((engine) => engine.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= draft.engines.length) return;
  const engines = draft.engines.slice();
  [engines[from], engines[to]] = [engines[to], engines[from]];
  draft.engines = engines;
  markImageRecognitionDirty();
}

export async function saveImageRecognition(): Promise<void> {
  const endpoint = session.endpoint;
  const draft = imageRecognitionStore.draft;
  if (!endpoint || !draft || !imageRecognitionStore.dirty || imageRecognitionStore.saving) return;
  imageRecognitionStore.saving = true;
  session.error = "";
  try {
    const summary = await saveDesktopImageRecognition(endpoint, draft);
    imageRecognitionStore.summary = summary;
    imageRecognitionStore.draft = draftFromSummary(summary);
    imageRecognitionStore.dirty = false;
    imageRecognitionStore.message = session.text.imageRecognitionSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    imageRecognitionStore.saving = false;
  }
}

export async function testImageRecognition(image: File | null): Promise<void> {
  const endpoint = session.endpoint;
  const draft = imageRecognitionStore.draft;
  if (!endpoint || !draft || !image || imageRecognitionStore.testBusy) return;
  imageRecognitionStore.testBusy = true;
  imageRecognitionStore.testResult = null;
  session.error = "";
  try {
    imageRecognitionStore.testResult = await testDesktopImageRecognitionSettings(
      endpoint,
      draft,
      image,
      imageRecognitionStore.testPrompt,
      imageRecognitionStore.testEngine
    );
  } catch (cause) {
    imageRecognitionStore.testResult = { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    imageRecognitionStore.testBusy = false;
  }
}
