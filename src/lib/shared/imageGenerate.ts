export interface ImageEngineAvailability {
  id: string;
  enabled: boolean;
  hasCredentials: boolean;
  credentialSource?: "api-key" | "provider";
}

/** One selection rule for execution and both settings test forms. */
export function selectImageEngine(requested: string | undefined, defaultEngine: string, engines: readonly ImageEngineAvailability[]): string | undefined {
  const available = (id: string) => engines.some(engine => engine.id === id && engine.enabled && (engine.credentialSource === "provider" || engine.hasCredentials));
  if (requested && requested !== "auto") return available(requested) ? requested : undefined;
  const priority = [defaultEngine, "agnes", "openai", "openai-chat", "google", "volcengine", "modelscope", "pi", ...engines.map(engine => engine.id)];
  return priority.find(id => id !== "auto" && available(id));
}
