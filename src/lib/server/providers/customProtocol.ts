import type {
  CustomProviderConfig,
  CustomProviderProtocol,
  ModelCapabilityTag,
  ModelCapabilityVerification,
  ModelRole,
  RuntimeSettings
} from "../settings/index.js";
import {
  applyDirectReasoningParams,
  resolveThinkingLevel
} from "./customThinking.js";
import type { ConversationMessage } from "../../shared/types/message.js";

export interface DirectProviderReply {
  text: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  };
  provider: string;
  model: string;
  api: "openai-completions" | "anthropic-messages";
}

export interface ProviderTestPayload {
  protocol?: CustomProviderProtocol;
  baseUrl: string;
  apiKey: string;
  path?: string;
  model: string;
  tags?: ModelCapabilityTag[];
}

export interface ProviderTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  supportedRoles: ModelRole[];
  verification: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>>;
}

const BASE_ROLES: ModelRole[] = ["system", "user", "assistant", "tool"];
const ANTHROPIC_VERSION = "2023-06-01";
const TESTABLE_CAPABILITY_SET = new Set<ModelCapabilityTag>(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0yoAAAAASUVORK5CYII=";

export function resolveCustomProviderProtocol(input: unknown): CustomProviderProtocol {
  return String(input ?? "").trim() === "anthropic" ? "anthropic" : "openai-compatible";
}

export function defaultPathForProtocol(protocol: CustomProviderProtocol): string {
  return protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
}

export function normalizeProviderPath(path: string | undefined, protocol: CustomProviderProtocol): string {
  const raw = String(path ?? defaultPathForProtocol(protocol)).trim();
  const value = raw || defaultPathForProtocol(protocol);
  return value.startsWith("/") ? value : `/${value}`;
}

export function normalizeProviderBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

export function buildOpenAIBaseUrl(baseUrl: string, path: string | undefined): string {
  const base = normalizeProviderBaseUrl(baseUrl);
  const normalizedPath = normalizeProviderPath(path, "openai-compatible");
  const chatCompletionsSuffix = "/chat/completions";

  if (normalizedPath.endsWith(chatCompletionsSuffix)) {
    const prefix = normalizedPath.slice(0, -chatCompletionsSuffix.length);
    return `${base}${prefix}`;
  }

  const slash = normalizedPath.lastIndexOf("/");
  const dir = slash > 0 ? normalizedPath.slice(0, slash) : "";
  return `${base}${dir}`;
}

export function buildAnthropicBaseUrl(baseUrl: string, path: string | undefined): string {
  const base = normalizeProviderBaseUrl(baseUrl);
  const normalizedPath = normalizeProviderPath(path, "anthropic");
  const messagesSuffix = "/v1/messages";

  if (normalizedPath.endsWith(messagesSuffix)) {
    const prefix = normalizedPath.slice(0, -messagesSuffix.length);
    return `${base}${prefix}`;
  }

  const slash = normalizedPath.lastIndexOf("/");
  const dir = slash > 0 ? normalizedPath.slice(0, slash) : "";
  return `${base}${dir}`;
}

export function buildDirectProviderUrl(provider: Pick<CustomProviderConfig, "baseUrl" | "path" | "protocol">): string {
  const protocol = resolveCustomProviderProtocol(provider.protocol);
  return `${normalizeProviderBaseUrl(provider.baseUrl)}${normalizeProviderPath(provider.path, protocol)}`;
}

function formatProviderBody(body: string): string {
  const text = body.trim();
  if (!text) return "(empty body)";
  let formatted = text;
  try {
    formatted = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Non-JSON upstream errors are common; keep their original text.
  }
  return formatted.length > 4000
    ? `${formatted.slice(0, 4000)}\n... [truncated ${formatted.length - 4000} chars]`
    : formatted;
}

function toOpenAIMessages(history: ConversationMessage[], systemPrompt: string): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt }
  ];
  for (const msg of history) {
    if (msg.role === "user" || msg.role === "assistant" || msg.role === "system") {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  return messages;
}

function toAnthropicMessages(history: ConversationMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of history) {
    if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    } else if (msg.role === "user" || msg.role === "system") {
      messages.push({ role: "user", content: msg.content });
    }
  }
  return messages.length > 0 ? messages : [{ role: "user", content: "ping" }];
}

function extractAnthropicText(data: { content?: Array<{ type?: string; text?: string }> }): string {
  return (data.content ?? [])
    .map((part) => part.type === "text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function runRequest(url: string, headers: Record<string, string>, body: object): Promise<{ ok: boolean; status: number; text: string }> {
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return {
    ok: resp.ok,
    status: resp.status,
    text: await resp.text()
  };
}

export async function callDirectCustomProvider(
  provider: CustomProviderConfig,
  model: string,
  history: ConversationMessage[],
  settings: Pick<RuntimeSettings, "defaultThinkingLevel" | "systemPrompt">,
  memoryContext: string
): Promise<DirectProviderReply> {
  const protocol = resolveCustomProviderProtocol(provider.protocol);
  const systemPrompt = memoryContext.trim()
    ? `${settings.systemPrompt}\n\nRelevant memory:\n${memoryContext.trim()}`
    : settings.systemPrompt;

  if (protocol === "anthropic") {
    const thinkingLevel = resolveThinkingLevel(settings, provider.supportsThinking === true);
    const requestBody = applyDirectReasoningParams(
      {
        model,
        system: systemPrompt,
        messages: toAnthropicMessages(history),
        max_tokens: 8192,
        temperature: 0.2
      },
      provider,
      thinkingLevel
    );
    const response = await fetch(buildDirectProviderUrl(provider), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(requestBody)
    });
    const textBody = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}: ${formatProviderBody(textBody)}`), { status: response.status });
    }
    const data = JSON.parse(textBody) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const text = extractAnthropicText(data);
    if (!text) throw new Error("Custom provider returned empty content");
    return {
      text,
      provider: provider.id,
      model,
      api: "anthropic-messages",
      usage: {
        input: data.usage?.input_tokens ?? 0,
        output: data.usage?.output_tokens ?? 0,
        cacheRead: data.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
      }
    };
  }

  const thinkingLevel = resolveThinkingLevel(settings, provider.supportsThinking === true);
  const requestBody = applyDirectReasoningParams(
    {
      model,
      messages: toOpenAIMessages(history, systemPrompt),
      temperature: 0.2
    },
    provider,
    thinkingLevel
  );
  const response = await fetch(buildDirectProviderUrl(provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });
  const textBody = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}: ${formatProviderBody(textBody)}`), { status: response.status });
  }
  const data = JSON.parse(textBody) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Custom provider returned empty content");
  return {
    text,
    provider: provider.id,
    model,
    api: "openai-completions",
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWrite: 0,
      totalTokens: data.usage?.total_tokens ?? 0
    }
  };
}

export async function testCustomProvider(payload: ProviderTestPayload): Promise<ProviderTestResult> {
  const protocol = resolveCustomProviderProtocol(payload.protocol);
  const declaredTags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is ModelCapabilityTag => TESTABLE_CAPABILITY_SET.has(tag as ModelCapabilityTag))
    : [];
  const verification: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>> = {};

  if (protocol === "anthropic") {
    const url = `${normalizeProviderBaseUrl(payload.baseUrl)}${normalizeProviderPath(payload.path, "anthropic")}`;
    const basePayload = {
      model: payload.model,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }]
    };
    const connectivity = await runRequest(url, {
      "Content-Type": "application/json",
      "x-api-key": payload.apiKey,
      "anthropic-version": ANTHROPIC_VERSION
    }, basePayload);
    if (!connectivity.ok) {
      for (const tag of declaredTags) {
        verification[tag] = tag === "text" || tag === "vision" ? "failed" : "untested";
      }
      return {
        ok: false,
        status: connectivity.status,
        message: formatProviderBody(connectivity.text),
        supportedRoles: ["system", "user", "assistant"],
        verification
      };
    }
    verification.text = "passed";
    if (declaredTags.includes("vision")) {
      const visionProbe = await runRequest(url, {
        "Content-Type": "application/json",
        "x-api-key": payload.apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      }, {
        model: payload.model,
        max_tokens: 8,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Reply with the single word ok." },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: SAMPLE_PNG_BASE64
              }
            }
          ]
        }]
      });
      verification.vision = visionProbe.ok ? "passed" : "failed";
    }
    for (const tag of declaredTags) {
      if (verification[tag]) continue;
      verification[tag] = "untested";
    }
    const summary = declaredTags.length > 0
      ? declaredTags.map((tag) => `${tag}:${verification[tag] ?? "untested"}`).join(", ")
      : "no declared capability checks";
    return {
      ok: true,
      status: connectivity.status,
      message: `Connectivity ok via Anthropic Messages API. Capability checks: ${summary}.`,
      supportedRoles: ["system", "user", "assistant"],
      verification
    };
  }

  const url = `${normalizeProviderBaseUrl(payload.baseUrl)}${normalizeProviderPath(payload.path, "openai-compatible")}`;
  const basePayload = {
    model: payload.model,
    temperature: 0,
    max_tokens: 8
  };
  const connectivity = await runRequest(url, {
    "Content-Type": "application/json",
    Authorization: `Bearer ${payload.apiKey}`
  }, {
    ...basePayload,
    messages: [{ role: "user", content: "ping" }]
  });

  if (!connectivity.ok) {
    for (const tag of declaredTags) {
      verification[tag] = tag === "tool" || tag === "stt" || tag === "tts" || tag === "audio_input"
        ? "untested"
        : "failed";
    }
    return {
      ok: false,
      status: connectivity.status,
      message: formatProviderBody(connectivity.text),
      supportedRoles: [...BASE_ROLES],
      verification
    };
  }

  verification.text = "passed";
  const developerProbe = await runRequest(url, {
    "Content-Type": "application/json",
    Authorization: `Bearer ${payload.apiKey}`
  }, {
    ...basePayload,
    messages: [{ role: "developer", content: "You are a test." }, { role: "user", content: "ping" }]
  });
  const supportsDeveloper = developerProbe.ok;
  const supportedRoles: ModelRole[] = supportsDeveloper ? [...BASE_ROLES, "developer"] : [...BASE_ROLES];

  if (declaredTags.includes("vision")) {
    const visionProbe = await runRequest(url, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${payload.apiKey}`
    }, {
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

  const summary = declaredTags.length > 0
    ? declaredTags.map((tag) => `${tag}:${verification[tag] ?? "untested"}`).join(", ")
    : "no declared capability checks";

  return {
    ok: true,
    status: developerProbe.status,
    message: supportsDeveloper
      ? `Connectivity ok, developer role supported. Capability checks: ${summary}.`
      : `Connectivity ok, developer role not supported. Capability checks: ${summary}.`,
    supportedRoles,
    verification
  };
}
