export type StartupPhase = "checking" | "starting" | "delayed" | "ready" | "error" | "retrying";

export type StartupState = {
  phase: StartupPhase;
  error: string;
};

export type StartupEvent =
  | { type: "check" }
  | { type: "status"; ready: boolean; recoverable: boolean }
  | { type: "delayed" }
  | { type: "failed"; error: string }
  | { type: "retry" };

export const initialStartupState: StartupState = {
  phase: "checking",
  error: ""
};

export function reduceStartup(
  state: StartupState,
  event: StartupEvent
): StartupState {
  switch (event.type) {
    case "check":
      return state.phase === "retrying" ? state : { ...state, phase: "checking" };
    case "status":
      if (event.ready) return { phase: "ready", error: "" };
      return {
        phase: state.phase === "delayed" ? "delayed" : "starting",
        error: event.recoverable ? "" : state.error
      };
    case "delayed":
      return state.phase === "ready" || state.phase === "error"
        ? state
        : { ...state, phase: "delayed" };
    case "failed":
      return { phase: "error", error: event.error };
    case "retry":
      return { phase: "retrying", error: "" };
  }
}
