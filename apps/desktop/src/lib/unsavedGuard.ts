/**
 * Guards against silently losing unsaved settings: while any registered check
 * returns true, closing or reloading the window asks for confirmation. Each
 * settings section registers one check reading its own dirty flag; registration
 * is refcounted so the beforeunload listener exists only while guards live.
 *
 * In-component usage (legacy-mode sections):
 *   onDestroy(trackUnsaved(() => dirty));
 */
const checks = new Set<() => boolean>();

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (![...checks].some((check) => check())) return;
  event.preventDefault();
  event.returnValue = "";
}

export function trackUnsaved(isDirty: () => boolean): () => void {
  checks.add(isDirty);
  if (checks.size === 1) window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    checks.delete(isDirty);
    if (checks.size === 0) window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
