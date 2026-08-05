export interface BuiltInAgentTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  /** The version this build ships, from the template's AGENTS.md frontmatter. */
  version: string;
  installed: boolean;
  /** The version of the installed copy; empty when it predates version tracking. */
  installedVersion: string;
  /** True when the installed copy is at a different version than the shipped one. */
  updateAvailable: boolean;
  /** True when the installed copy no longer matches the files we wrote. */
  modified: boolean;
}

export interface BuiltInAgentTemplatesResponse {
  ok: true;
  templates: BuiltInAgentTemplateSummary[];
}

export interface BuiltInAgentTemplateInstallResponse {
  ok: true;
  templateId: string;
  agentId: string;
}

export interface BuiltInAgentTemplateUpdateResponse {
  ok: true;
  templateId: string;
  agentId: string;
  from: string;
  to: string;
  /** Set when the installed copy had diverged and was preserved at this path. */
  backupDir?: string;
}

export interface BuiltInAgentTemplateActionRequest {
  templateId?: string;
  /** Defaults to `install`, which is what every pre-update client sends. */
  action?: "install" | "update";
}
