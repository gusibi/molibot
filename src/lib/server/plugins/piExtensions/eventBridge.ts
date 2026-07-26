import { momError, momWarn } from "$lib/server/agent/common/log.js";
import type {
  GateDecision,
  HookEvent,
  HookPlugin,
  HookStage,
  RuntimeHook
} from "$lib/server/agent/hooks/types.js";
import { createHeadlessExtensionContext } from "$lib/server/plugins/piExtensions/context.js";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import type { LoadedPiExtension } from "$lib/server/plugins/piExtensions/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

/**
 * pi events Molibot can raise, and the Molibot stage each one is derived from.
 *
 * Everything pi defines outside this table is unsupported here — the session
 * tree events (`session_before_fork` / `switch` / `compact` / `tree`), the
 * terminal-only ones (`user_bash`, `message_update`), the provider-level ones
 * (`before_provider_request` / `before_provider_headers`), `resources_discover`
 * and `model_select` (pi's payload requires a pi `Model` object, which Molibot's
 * routing layer does not produce). Handlers for those never fire; the settings
 * page shows which events an extension registered so the gap is visible.
 */
export const SUPPORTED_PI_EVENTS = [
  "agent_start",
  "agent_end",
  "tool_call",
  "tool_result",
  "input",
  "before_agent_start",
  "session_start"
] as const;

export type SupportedPiEvent = (typeof SUPPORTED_PI_EVENTS)[number];

const HOOK_PLUGIN_ID = "pi-extensions";

interface EventBridgeDeps {
  getSettings: () => RuntimeSettings;
  /** Test seam; defaults to the process-wide extension host. */
  getExtensions?: (settings: RuntimeSettings, botId?: string) => LoadedPiExtension[];
}

type HandlerFn = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

function handlersFor(
  extensions: LoadedPiExtension[],
  event: SupportedPiEvent
): Array<{ extension: LoadedPiExtension; handler: HandlerFn }> {
  const out: Array<{ extension: LoadedPiExtension; handler: HandlerFn }> = [];
  for (const extension of extensions) {
    for (const handler of extension.extension.handlers.get(event) ?? []) {
      out.push({ extension, handler: handler as HandlerFn });
    }
  }
  return out;
}

function botIdFrom(hookEvent: HookEvent<any>): string | undefined {
  return hookEvent.context.botId;
}

/**
 * Hook plugin that fans Molibot runtime stages out to pi extension handlers.
 *
 * One extension throwing never breaks the turn (except on the tool gate, where
 * pi's own contract is "extension failed → block"), and handlers are resolved
 * per event so enabling or disabling an extension takes effect immediately.
 */
export function createPiExtensionHookPlugin(deps: EventBridgeDeps): HookPlugin {
  const getExtensions = deps.getExtensions
    ?? ((settings: RuntimeSettings, botId?: string) =>
      getPiExtensionHost().getActiveExtensions(settings, botId));

  const contextFor = (extension: LoadedPiExtension, hookEvent: HookEvent<any>) =>
    createHeadlessExtensionContext({
      cwd: process.cwd(),
      signal: hookEvent.context.signal,
      extensionId: extension.id
    });

  const dispatch = async (
    hookEvent: HookEvent<any>,
    event: SupportedPiEvent,
    payload: Record<string, unknown>,
    onResult?: (result: any, extension: LoadedPiExtension) => void
  ): Promise<void> => {
    const extensions = getExtensions(deps.getSettings(), botIdFrom(hookEvent));
    for (const { extension, handler } of handlersFor(extensions, event)) {
      try {
        const result = await handler({ type: event, ...payload }, contextFor(extension, hookEvent));
        if (result && onResult) onResult(result, extension);
      } catch (error) {
        momError("plugins", "pi_extension_handler_failed", {
          extensionId: extension.id,
          event,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  const observe = (
    id: string,
    stages: HookStage[],
    toEvent: (hookEvent: HookEvent<any>) => { event: SupportedPiEvent; payload: Record<string, unknown> } | null
  ): RuntimeHook => ({
    id,
    kind: "observe",
    stages,
    async handle(hookEvent) {
      const mapped = toEvent(hookEvent);
      if (!mapped) return;
      await dispatch(hookEvent, mapped.event, mapped.payload);
    }
  });

  // Sessions that already emitted session_start; pi fires it once per session,
  // Molibot's run.beforeStart fires once per turn.
  const startedSessions = new Set<string>();

  const hooks: RuntimeHook[] = [
    {
      id: `${HOOK_PLUGIN_ID}:tool-call`,
      kind: "gate",
      stages: ["tool.call.before"],
      // pi's contract for a throwing tool_call handler is "block execution".
      failMode: "closed",
      async handle(hookEvent): Promise<GateDecision> {
        const payload = hookEvent.payload as { toolName: string; toolCallId: string; args?: unknown };
        const extensions = getExtensions(deps.getSettings(), botIdFrom(hookEvent));
        const handlers = handlersFor(extensions, "tool_call");
        if (handlers.length === 0) return { type: "allow" };

        // `input` is the live arguments object: pi extensions patch tool
        // arguments by mutating it in place, and Molibot's runner passes the
        // same object on to execution.
        const input = (payload.args ?? {}) as Record<string, unknown>;

        for (const { extension, handler } of handlers) {
          let result: any;
          try {
            result = await handler(
              {
                type: "tool_call",
                toolName: payload.toolName,
                toolCallId: payload.toolCallId,
                input
              },
              contextFor(extension, hookEvent)
            );
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            momError("plugins", "pi_extension_tool_call_failed", {
              extensionId: extension.id,
              toolName: payload.toolName,
              error: reason
            });
            return { type: "deny", reason: `pi extension "${extension.id}" failed: ${reason}` };
          }
          if (result?.block) {
            return {
              type: "deny",
              reason: result.reason || `Blocked by pi extension "${extension.id}"`
            };
          }
        }
        return { type: "allow" };
      }
    },

    observe(`${HOOK_PLUGIN_ID}:tool-result`, ["tool.call.after", "tool.call.error"], (hookEvent) => {
      const payload = hookEvent.payload as {
        toolName: string;
        toolCallId: string;
        args?: unknown;
        result?: { content?: unknown; details?: unknown };
        isError?: boolean;
      };
      return {
        event: "tool_result",
        payload: {
          toolName: payload.toolName,
          toolCallId: payload.toolCallId,
          input: payload.args ?? {},
          content: payload.result?.content ?? [],
          details: payload.result?.details,
          isError: Boolean(payload.isError)
        }
      };
    }),

    observe(`${HOOK_PLUGIN_ID}:agent-start`, ["run.started"], () => ({
      event: "agent_start",
      payload: {}
    })),

    // pi hands agent_end the full message list; Molibot's run.finished carries
    // only run-level status, so `messages` is empty here.
    observe(`${HOOK_PLUGIN_ID}:agent-end`, ["run.finished"], () => ({
      event: "agent_end",
      payload: { messages: [] }
    })),

    observe(`${HOOK_PLUGIN_ID}:session-start`, ["run.beforeStart"], (hookEvent) => {
      const sessionId = hookEvent.context.sessionId;
      if (startedSessions.has(sessionId)) return null;
      startedSessions.add(sessionId);
      return { event: "session_start", payload: { reason: "resume" } };
    }),

    {
      id: `${HOOK_PLUGIN_ID}:input`,
      kind: "transform",
      stages: ["input.enrich.after"],
      async handle(hookEvent) {
        const payload = hookEvent.payload as { text?: string };
        let text = typeof payload.text === "string" ? payload.text : "";
        const original = text;

        await dispatch(hookEvent, "input", { text, source: "user" }, (result, extension) => {
          if (result.action === "transform" && typeof result.text === "string") {
            text = result.text;
            return;
          }
          if (result.action === "handled") {
            // pi would swallow the input and skip the turn; Molibot has no
            // equivalent, so the turn continues with the text unchanged.
            momWarn("plugins", "pi_extension_input_handled_unsupported", { extensionId: extension.id });
          }
        });

        if (text === original) return { type: "continue" };
        return {
          type: "replace",
          payload: { ...(hookEvent.payload as Record<string, unknown>), text, textLength: text.length }
        };
      }
    },

    {
      id: `${HOOK_PLUGIN_ID}:before-agent-start`,
      kind: "transform",
      stages: ["prompt.build.after"],
      async handle(hookEvent) {
        const payload = hookEvent.payload as { systemPrompt: string; prompt?: string };
        let systemPrompt = payload.systemPrompt;

        await dispatch(
          hookEvent,
          "before_agent_start",
          {
            prompt: payload.prompt ?? "",
            systemPrompt,
            systemPromptOptions: {}
          },
          (result, extension) => {
            if (typeof result.systemPrompt === "string" && result.systemPrompt.trim()) {
              systemPrompt = result.systemPrompt;
            }
            if (result.message) {
              // pi injects the returned custom message into the transcript;
              // Molibot's prompt-build stage cannot add messages.
              momWarn("plugins", "pi_extension_injected_message_dropped", { extensionId: extension.id });
            }
          }
        );

        if (systemPrompt === payload.systemPrompt) return { type: "continue" };
        return {
          type: "replace",
          payload: { ...(hookEvent.payload as Record<string, unknown>), systemPrompt }
        };
      }
    }
  ];

  return {
    id: HOOK_PLUGIN_ID,
    name: "pi extensions",
    description: "Fans Molibot runtime stages out to installed pi extension event handlers.",
    getHooks: () => hooks
  };
}
