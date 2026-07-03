// Runtime environment (dependency) settings — state + orchestration.
import { loadDesktopRuntimeEnv } from "../api";
import type { DesktopRuntimeEnvSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const runtimeEnvStore = $state({
  runtimeEnv: null as DesktopRuntimeEnvSummary | null,
  endpoint: "",
  loading: false
});

export async function loadRuntimeEnv(endpoint: string): Promise<void> {
  runtimeEnvStore.endpoint = endpoint;
  runtimeEnvStore.loading = true;
  session.error = "";
  try {
    runtimeEnvStore.runtimeEnv = await loadDesktopRuntimeEnv(endpoint);
  } catch (cause) {
    runtimeEnvStore.endpoint = "";
    setError(cause);
  } finally {
    runtimeEnvStore.loading = false;
  }
}
