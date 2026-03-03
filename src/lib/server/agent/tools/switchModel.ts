import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "../../settings/index.js";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  switchModelSelection,
  type ModelRoute
} from "../../settings/modelSwitch.js";

const switchModelSchema = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("switch")]),
  route: Type.Optional(Type.String()),
  selector: Type.Optional(Type.String())
});

function formatModelOptions(settings: RuntimeSettings, route: ModelRoute): string {
  const options = buildModelOptions(settings, route);
  const activeKey = currentModelKey(settings, route);
  const lines = [
    `Route: ${route}`,
    `Provider mode: ${settings.providerMode}`,
    `Configured model options: ${options.length}`,
    ""
  ];

  if (options.length === 0) {
    lines.push("(no configured models)");
  } else {
    for (let i = 0; i < options.length; i += 1) {
      const option = options[i];
      const marker = option.key === activeKey ? " (active)" : "";
      lines.push(`${i + 1}. ${option.label}${marker}`);
      lines.push(`   - key: ${option.key}`);
    }
  }

  return lines.join("\n");
}

export function createSwitchModelTool(options: {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}): AgentTool<typeof switchModelSchema> {
  return {
    name: "switch_model",
    label: "switch_model",
    description: "List configured runtime model options or safely switch the active route via runtime settings. Use this instead of editing settings files directly.",
    parameters: switchModelSchema,
    execute: async (_toolCallId, params) => {
      const route = parseModelRoute(String(params.route ?? "").trim()) ?? "text";
      const settings = options.getSettings();

      if (params.action === "list") {
        return {
          content: [{ type: "text", text: formatModelOptions(settings, route) }],
          details: undefined
        };
      }

      const selector = String(params.selector ?? "").trim();
      if (!selector) {
        throw new Error("selector is required for action=switch");
      }

      const switched = switchModelSelection({
        settings,
        route,
        selector,
        updateSettings: options.updateSettings
      });
      if (!switched) {
        throw new Error(`Invalid model selector: ${selector}\n\n${formatModelOptions(settings, route)}`);
      }

      return {
        content: [{
          type: "text",
          text: [
            `Switched ${route} model to: ${switched.selected.label}`,
            `Mode: ${switched.settings.providerMode}`,
            "",
            formatModelOptions(switched.settings, route)
          ].join("\n")
        }],
        details: {
          route,
          selector,
          selectedKey: switched.selected.key,
          providerMode: switched.settings.providerMode
        }
      };
    }
  };
}
