/**
 * Header Molibot uses to identify the owning conversation of a model request.
 * Proxies that need a provider-specific session header (cli-proxy-api → OpenCode
 * Go's `x-opencode-session`) map from this stable Molibot-owned name. Both the
 * main chat stream and background helpers (extraction, reflection, profile
 * summary) must send it, or a proxy rejects the request before it reaches a
 * model.
 */
export const SESSION_AFFINITY_HEADER = "x-molibot-session";
