import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import type { ModelCapabilityTag, ModelCapabilityVerification, ModelRole } from "$lib/server/settings";

interface ProviderTestBody {
  baseUrl?: string;
  apiKey?: string;
  path?: string;
  model?: string;
  tags?: ModelCapabilityTag[];
}

interface ProviderTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  supportedRoles: ModelRole[];
  verification: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>>;
}

const BASE_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];
const TESTABLE_CAPABILITY_SET = new Set<ModelCapabilityTag>(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0yoAAAAASUVORK5CYII=";

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
  const declaredTags = Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is ModelCapabilityTag => TESTABLE_CAPABILITY_SET.has(tag as ModelCapabilityTag))
    : [];

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

    const verification: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>> = {};

    if (!connectivity.ok) {
      for (const tag of declaredTags) {
        verification[tag] = tag === "tool" || tag === "stt" || tag === "tts" || tag === "audio_input"
          ? "untested"
          : "failed";
      }
      const result: ProviderTestResult = {
        ok: false,
        status: connectivity.status,
        message: connectivity.text.slice(0, 500),
        supportedRoles: [...BASE_ROLES],
        verification
      };
      return json(result, { status: 200 });
    }

    verification.text = "passed";

    const developerProbe = await runRequest(url, apiKey, {
      ...basePayload,
      messages: [{ role: "developer", content: "You are a test." }, ...minimalMessages]
    });

    const supportsDeveloper = developerProbe.ok;
    const supportedRoles: ModelRole[] = supportsDeveloper ? [...BASE_ROLES, "developer"] : [...BASE_ROLES];

    if (declaredTags.includes("vision")) {
      const visionProbe = await runRequest(url, apiKey, {
        ...basePayload,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Reply with the single word ok." },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${SAMPLE_PNG_BASE64}`
                }
              }
            ]
          }
        ]
      });
      verification.vision = visionProbe.ok ? "passed" : "failed";
    }

    for (const tag of declaredTags) {
      if (verification[tag]) continue;
      verification[tag] = "untested";
    }

    const verificationSummary = declaredTags.length > 0
      ? declaredTags.map((tag) => `${tag}:${verification[tag] ?? "untested"}`).join(", ")
      : "no declared capability checks";

    const result: ProviderTestResult = {
      ok: true,
      status: developerProbe.status,
      message: supportsDeveloper
        ? `Connectivity ok, developer role supported. Capability checks: ${verificationSummary}.`
        : `Connectivity ok, developer role not supported. Capability checks: ${verificationSummary}.`,
      supportedRoles,
      verification
    };
    return json(result);
  } catch (error) {
    return json(
      {
        ok: false,
        status: null,
        message: error instanceof Error ? error.message : String(error),
        supportedRoles: [...BASE_ROLES],
        verification: {}
      } satisfies ProviderTestResult
    );
  }
};
