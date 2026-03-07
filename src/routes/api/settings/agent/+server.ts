import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

interface AgentPayload {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
}

function sanitizeAgent(input: AgentPayload): {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
} {
  const id = String(input.id ?? "").trim();
  if (!id) {
    throw new Error("agent.id is required");
  }

  return {
    id,
    name: String(input.name ?? "").trim() || id,
    description: String(input.description ?? "").trim(),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled)
  };
}

export const PUT: RequestHandler = async ({ request }) => {
  let body: { previousId?: string; agent?: AgentPayload };
  try {
    body = (await request.json()) as { previousId?: string; agent?: AgentPayload };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.agent) {
    return json({ ok: false, error: "agent is required" }, { status: 400 });
  }

  let nextAgent: ReturnType<typeof sanitizeAgent>;
  try {
    nextAgent = sanitizeAgent(body.agent);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Invalid agent" }, { status: 400 });
  }

  const runtime = getRuntime();
  const current = runtime.getSettings();
  const previousId = String(body.previousId ?? "").trim();
  const nextAgents = current.agents.filter((agent) => agent.id !== nextAgent.id && (!previousId || agent.id !== previousId));
  nextAgents.push(nextAgent);

  const updated = runtime.updateSettings({
    agents: nextAgents
  });

  return json({ ok: true, agent: updated.agents.find((agent) => agent.id === nextAgent.id) });
};

export const DELETE: RequestHandler = async ({ request }) => {
  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) {
    return json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const runtime = getRuntime();
  const current = runtime.getSettings();

  const referenced = Object.entries(current.channels ?? {}).some(([, channel]) =>
    Array.isArray(channel?.instances) && channel.instances.some((instance) => String(instance.agentId ?? "").trim() === id)
  );
  if (referenced) {
    return json({ ok: false, error: "This agent is still linked to one or more channel instances." }, { status: 400 });
  }

  runtime.updateSettings({
    agents: current.agents.filter((agent) => agent.id !== id)
  });

  return json({ ok: true });
};
