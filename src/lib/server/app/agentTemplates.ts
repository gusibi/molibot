import fs from "node:fs";
import { getRuntime } from "$lib/server/app/runtime";
import {
  installBuiltInAgentTemplate,
  listBuiltInAgentTemplates,
  updateBuiltInAgentTemplate
} from "$lib/server/agent/prompts/builtInAgentTemplates";
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

export interface AgentTemplateUpdateResult {
  templateId: string;
  agentId: string;
  from: string;
  to: string;
  backupDir?: string;
}

/**
 * Re-apply a built-in Agent's shipped files over the installed copy.
 *
 * The prompt files on disk are the substance of the update; the settings row is
 * only the Agent's registration, so it is refreshed — name and description
 * only — to match the template that now backs it. Everything the owner set on
 * that row (enabled state, model routing, sandbox) is deliberately preserved:
 * an update replaces what Molibot ships, not what the owner configured.
 */
export function updateAgentTemplate(templateId: string): AgentTemplateUpdateResult {
  const runtime = getRuntime();
  const id = String(templateId ?? "").trim();
  const updated = updateBuiltInAgentTemplate(id);

  const current = runtime.getSettings();
  const registered = current.agents.find((agent) => agent.id === id);
  if (registered) {
    runtime.updateSettings({
      agents: current.agents.map((agent) => (
        agent.id === id
          ? { ...agent, name: updated.template.name, description: updated.template.description }
          : agent
      ))
    });
  } else {
    // The directory existed without a settings row — an Agent that was
    // unregistered by hand, or a half-finished install. Updating the files and
    // leaving it invisible would look like the button did nothing.
    runtime.updateSettings({
      agents: [
        ...current.agents,
        {
          id,
          name: updated.template.name,
          description: updated.template.description,
          enabled: true
        }
      ]
    });
  }

  return {
    templateId: id,
    agentId: id,
    from: updated.from,
    to: updated.to,
    backupDir: updated.backupDir
  };
}
