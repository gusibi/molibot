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

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[280px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:flex lg:flex-col lg:gap-3">
      <button
        class="w-full cursor-pointer rounded-lg border border-white/20 px-3 py-2 text-left text-sm font-medium transition-colors duration-200 hover:bg-white/10"
        type="button"
        on:click={createSession}
      >
        + New chat
      </button>
      <a
        class="cursor-pointer rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition-colors duration-200 hover:bg-white/10"
        href="/settings">Settings</a
      >
      <div class="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {#each sessions as s}
          <button
            class={`w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors duration-200 ${s.id === activeSessionId
              ? "bg-white/15 text-white"
              : "text-slate-300 hover:bg-white/10"}`}
            type="button"
            on:click={() => switchSession(s.id)}
          >
            {s.title}
          </button>
        {/each}
      </div>
      <div class="text-xs text-slate-500">Molibot Web</div>
    </aside>

    <section class="flex min-h-0 flex-col">
      <header class="border-b border-white/10 bg-[#212121] px-4 py-3 sm:px-6">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div class="text-sm font-semibold text-slate-200">Molibot</div>
          <div class="flex items-center gap-2 sm:ml-auto">
            <select
              class="w-full rounded-md border border-white/15 bg-[#2f2f2f] px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-400 sm:w-[320px]"
              value={activeModelKey}
              disabled={changingModel}
              on:change={async (e) => applyModelSelection((e.target as HTMLSelectElement).value)}
            >
              {#each modelOptions as m}
                <option value={m.key}>{m.label}</option>
              {/each}
            </select>
            <button
              class="cursor-pointer rounded-md border border-white/15 bg-[#2f2f2f] px-3 py-1.5 text-xs text-slate-100 transition-colors duration-200 hover:bg-[#3a3a3a] lg:hidden"
              type="button"
              on:click={createSession}
            >
              New
            </button>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
          {#if status}
            <div class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{status}</div>
          {/if}

          {#if messages.length === 0}
            <div class="rounded-xl border border-white/10 bg-[#2a2a2a] px-5 py-6 text-sm text-slate-300">
              Start a new conversation.
            </div>
          {/if}

          {#each messages as m}
            <article class={`rounded-xl px-4 py-3 text-sm leading-7 ${m.role === "user"
              ? "ml-auto w-fit max-w-[88%] bg-[#303030] text-slate-100"
              : "w-full bg-transparent text-slate-100"}`}>
              <div class="whitespace-pre-wrap">{m.content}</div>
            </article>
          {/each}
        </div>
      </div>

      <footer class="border-t border-white/10 bg-[#212121] px-4 py-4 sm:px-6">
        <div class="mx-auto grid w-full max-w-3xl gap-2 rounded-2xl border border-white/15 bg-[#2f2f2f] p-3 sm:grid-cols-[1fr_auto]">
          <textarea
            class="min-h-16 w-full resize-y rounded-xl bg-transparent px-2 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            bind:value={messageInput}
            rows="3"
            placeholder="Message Molibot"
          ></textarea>
          <button
            class="cursor-pointer self-end rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            type="button"
            disabled={sending}
            on:click={sendMessage}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </footer>
    </section>
  </div>
</main>
