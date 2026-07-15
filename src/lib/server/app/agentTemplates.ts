import fs from "node:fs";
import { getRuntime } from "$lib/server/app/runtime";
import { installBuiltInAgentTemplate, listBuiltInAgentTemplates } from "$lib/server/agent/prompts/builtInAgentTemplates";
import type { BuiltInAgentTemplateSummary } from "$lib/shared/agentTemplates";

export function listInstallableAgentTemplates(): BuiltInAgentTemplateSummary[] {
  return listBuiltInAgentTemplates();
}

export function installAgentTemplate(templateId: string): { templateId: string; agentId: string } {
  const runtime = getRuntime();
  const current = runtime.getSettings();
  const id = String(templateId ?? "").trim();
  if (current.agents.some((agent) => agent.id === id)) throw new Error(`Agent already exists: ${id}`);

  const installed = installBuiltInAgentTemplate(id);
  try {
    runtime.updateSettings({
      agents: [
        ...current.agents,
        {
          id: installed.template.id,
          name: installed.template.name,
          description: installed.template.description,
          enabled: true
        }
      ]
    });
  } catch (error) {
    fs.rmSync(installed.agentDir, { recursive: true, force: true });
    throw error;
  }

  return { templateId: id, agentId: id };
}
