import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import type { ModelRole } from "$lib/server/config";

interface ProviderTestBody {
  baseUrl?: string;
  apiKey?: string;
  path?: string;
  model?: string;
}

interface ProviderTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  supportedRoles: ModelRole[];
}

const BASE_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];

function normalizePath(path: string | undefined): string {
  const raw = String(path ?? "/v1/chat/completions").trim();
  if (!raw) return "/v1/chat/completions";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

async function runRequest(url: string, apiKey: string, body: object): Promise<{ ok: boolean; status: number; text: string }> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  return {
    ok: resp.ok,
    status: resp.status,
    text: await resp.text()
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: ProviderTestBody;
  try {
    body = (await request.json()) as ProviderTestBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
  const apiKey = String(body.apiKey ?? "").trim();
  const path = normalizePath(body.path);
  const model = String(body.model ?? "").trim();

  if (!baseUrl || !apiKey || !model) {
    return json({ ok: false, error: "baseUrl, apiKey and model are required" }, { status: 400 });
  }

  const url = `${baseUrl}${path}`;
  const minimalMessages = [{ role: "user", content: "ping" }];
  const basePayload = {
    model,
    temperature: 0,
    max_tokens: 8
  };

  try {
    const connectivity = await runRequest(url, apiKey, {
      ...basePayload,
      messages: minimalMessages
    });

    if (!connectivity.ok) {
      const result: ProviderTestResult = {
        ok: false,
        status: connectivity.status,
        message: connectivity.text.slice(0, 500),
        supportedRoles: [...BASE_ROLES]
      };
      return json(result, { status: 200 });
    }

    const developerProbe = await runRequest(url, apiKey, {
      ...basePayload,
      messages: [{ role: "developer", content: "You are a test." }, ...minimalMessages]
    });

    const supportsDeveloper = developerProbe.ok;
    const supportedRoles: ModelRole[] = supportsDeveloper ? [...BASE_ROLES, "developer"] : [...BASE_ROLES];

    const result: ProviderTestResult = {
      ok: true,
      status: developerProbe.status,
      message: supportsDeveloper
        ? "Connectivity ok, developer role supported."
        : "Connectivity ok, developer role not supported.",
      supportedRoles
    };
    return json(result);
  } catch (error) {
    return json(
      {
        ok: false,
        status: null,
        message: error instanceof Error ? error.message : String(error),
        supportedRoles: [...BASE_ROLES]
      } satisfies ProviderTestResult
    );
  }
};
