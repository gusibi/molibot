<script lang="ts">
  import { onMount } from "svelte";

  interface RuntimeSettings {
    providerMode: "pi" | "custom";
    piModelProvider: string;
    piModelName: string;
    defaultCustomProviderId: string;
    customProviders: Array<{
      id: string;
      name: string;
      models: Array<{ id: string; tags: string[] }>;
      defaultModel: string;
    }>;
  }

  interface SessionSummary {
    id: string;
    title: string;
    updatedAt: string;
  }

  interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }

  let userId = "web-anonymous";
  let sessions: SessionSummary[] = [];
  let activeSessionId = "";
  let messages: ChatMessage[] = [];
  let messageInput = "";
  let status = "Loading...";
  let sending = false;

  let runtimeSettings: RuntimeSettings | null = null;
  let modelOptions: Array<{ key: string; label: string }> = [];
  let activeModelKey = "";
  let changingModel = false;

  function getWebUserId(): string {
    try {
      const key = "molibot-web-user-id";
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const id = crypto.randomUUID();
      localStorage.setItem(key, id);
      return id;
    } catch {
      return "web-anonymous";
    }
  }

  async function loadSessions(): Promise<void> {
    const response = await fetch(`/api/sessions?userId=${encodeURIComponent(userId)}`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to load sessions");
    }
    sessions = payload.sessions ?? [];
  }

  async function ensureActiveSession(): Promise<void> {
    if (sessions.length > 0) {
      if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        activeSessionId = sessions[0].id;
      }
      return;
    }

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to create session");
    }
    await loadSessions();
    activeSessionId = payload.session.id;
  }

  async function loadMessages(): Promise<void> {
    if (!activeSessionId) {
      messages = [];
      return;
    }
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(activeSessionId)}?userId=${encodeURIComponent(userId)}`
    );
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to load session messages");
    }
    messages = (payload.session.messages ?? [])
      .filter((m: { role?: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: "user" | "assistant"; content: string; createdAt: string }) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt
      }));
  }

  async function switchSession(sessionId: string): Promise<void> {
    activeSessionId = sessionId;
    await loadMessages();
  }

  async function createSession(): Promise<void> {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to create session");
    }
    await loadSessions();
    await switchSession(payload.session.id);
  }

  async function fetchRuntimeSettings(): Promise<RuntimeSettings> {
    const response = await fetch("/api/settings");
    const payload = await response.json();
    if (!response.ok || !payload?.ok || !payload?.settings) {
      throw new Error(payload?.error || "Failed to load runtime settings");
    }
    return payload.settings as RuntimeSettings;
  }

  function buildModelOptions(settings: RuntimeSettings): Array<{ key: string; label: string }> {
    const options: Array<{ key: string; label: string }> = [
      {
        key: `pi|${settings.piModelProvider}|${settings.piModelName}`,
        label: `[PI] ${settings.piModelProvider} / ${settings.piModelName}`
      }
    ];

    for (const provider of settings.customProviders) {
      for (const model of provider.models ?? []) {
        const modelId = typeof model === "string" ? model : model.id;
        if (!modelId) continue;
        options.push({
          key: `custom|${provider.id}|${modelId}`,
          label: `[Custom] ${provider.name} / ${modelId}`
        });
      }
    }
    return options;
  }

  function computeActiveModelKey(settings: RuntimeSettings): string {
    if (settings.providerMode === "custom") {
      const id = settings.defaultCustomProviderId || settings.customProviders[0]?.id || "";
      const provider = settings.customProviders.find((p) => p.id === id) ?? settings.customProviders[0];
      const firstModel = provider?.models?.[0];
      const firstModelId = typeof firstModel === "string" ? firstModel : firstModel?.id;
      const model = provider?.defaultModel || firstModelId || "";
      return id ? `custom|${id}|${model}` : `pi|${settings.piModelProvider}|${settings.piModelName}`;
    }
    return `pi|${settings.piModelProvider}|${settings.piModelName}`;
  }

  async function applyModelSelection(key: string): Promise<void> {
    if (!runtimeSettings) return;
    changingModel = true;
    try {
      let payload: Record<string, unknown>;
      if (key.startsWith("custom|")) {
        const [, customId, customModel = ""] = key.split("|");
        payload = {
          providerMode: "custom",
          defaultCustomProviderId: customId,
          customProviders: runtimeSettings.customProviders.map((p) =>
            p.id === customId
              ? {
                  ...p,
                  defaultModel:
                    customModel || p.defaultModel || (typeof p.models[0] === "string" ? p.models[0] : p.models[0]?.id) || ""
                }
              : p
          )
        };
      } else {
        const [, piProvider, ...rest] = key.split("|");
        payload = {
          providerMode: "pi",
          piModelProvider: piProvider,
          piModelName: rest.join("|")
        };
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update model selection");
      }
      runtimeSettings = data.settings as RuntimeSettings;
      modelOptions = buildModelOptions(runtimeSettings);
      activeModelKey = computeActiveModelKey(runtimeSettings);
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      changingModel = false;
    }
  }

  async function sendMessage(): Promise<void> {
    const text = messageInput.trim();
    if (!text || sending || !activeSessionId) return;
    sending = true;
    messageInput = "";
    messages = [...messages, { role: "user", content: text, createdAt: new Date().toISOString() }];
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, conversationId: activeSessionId, message: text })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Backend request failed (${response.status})`);
      }
      const assistant = String(payload.response ?? "").trim() || "(empty response)";
      messages = [...messages, { role: "assistant", content: assistant, createdAt: new Date().toISOString() }];
      if (typeof payload.conversationId === "string" && payload.conversationId) {
        activeSessionId = payload.conversationId;
      }
      await loadSessions();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      messages = [...messages, { role: "assistant", content: `Error: ${errorText}`, createdAt: new Date().toISOString() }];
    } finally {
      sending = false;
    }
  }

  onMount(async () => {
    try {
      userId = getWebUserId();
      runtimeSettings = await fetchRuntimeSettings();
      modelOptions = buildModelOptions(runtimeSettings);
      activeModelKey = computeActiveModelKey(runtimeSettings);
      await loadSessions();
      await ensureActiveSession();
      await loadMessages();
      status = "";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  });
</script>

<div class="page">
  <div class="toolbar">
    <select
      value={activeModelKey}
      disabled={changingModel}
      on:change={async (e) => applyModelSelection((e.target as HTMLSelectElement).value)}
    >
      {#each modelOptions as m}
        <option value={m.key}>{m.label}</option>
      {/each}
    </select>
    <select value={activeSessionId} on:change={async (e) => switchSession((e.target as HTMLSelectElement).value)}>
      {#each sessions as s}
        <option value={s.id}>{s.title}</option>
      {/each}
    </select>
    <button type="button" on:click={createSession}>New Session</button>
    <a class="settings-link" href="/settings">Settings</a>
  </div>

  {#if status}
    <div class="status">{status}</div>
  {/if}

  <div class="messages">
    {#each messages as m}
      <div class={`msg ${m.role}`}>
        <div class="role">{m.role}</div>
        <div class="content">{m.content}</div>
      </div>
    {/each}
  </div>

  <div class="composer">
    <textarea bind:value={messageInput} rows="3" placeholder="Type your message..."></textarea>
    <button type="button" disabled={sending} on:click={sendMessage}>{sending ? "Sending..." : "Send"}</button>
  </div>
</div>

<style>
  :global(html, body, #svelte) {
    margin: 0;
    width: 100%;
    height: 100%;
    background: #0b1020;
    color: #e5e7eb;
  }

  .page {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
  }

  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .toolbar select,
  .toolbar button,
  .composer button,
  .composer textarea {
    background: #111827;
    color: #e5e7eb;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 8px 10px;
    font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .settings-link {
    color: #d1d5db;
    text-decoration: none;
    margin-left: auto;
    font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .status {
    color: #fecaca;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .messages {
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 10px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: #0f172a;
  }

  .msg {
    padding: 8px;
    border-radius: 8px;
    max-width: 80%;
    white-space: pre-wrap;
  }

  .msg.user {
    align-self: flex-end;
    background: #1d4ed8;
  }

  .msg.assistant {
    align-self: flex-start;
    background: #1f2937;
  }

  .role {
    font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    opacity: 0.8;
    margin-bottom: 6px;
    text-transform: uppercase;
  }

  .content {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .composer {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .composer textarea {
    resize: vertical;
    min-height: 56px;
  }
</style>
