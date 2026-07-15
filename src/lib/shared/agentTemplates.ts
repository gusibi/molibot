export interface BuiltInAgentTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
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
