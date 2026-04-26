<script lang="ts">
    import { onMount } from "svelte";
    import PageShell from "$lib/ui/PageShell.svelte";
    import Button from "$lib/ui/Button.svelte";

    type ProviderMode = "pi" | "custom";
    type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
    type ThinkingSupportMode = "auto" | "enabled" | "disabled";
    type ThinkingFormat =
        | "auto"
        | "openai"
        | "openrouter"
        | "deepseek"
        | "zai"
        | "qwen"
        | "qwen-chat-template";
    type ThinkingEffortLevel = "low" | "medium" | "high";
    type ModelCapabilityTag =
        | "text"
        | "vision"
        | "audio_input"
        | "stt"
        | "tts"
        | "tool";
    type ModelCapabilityVerification = "untested" | "passed" | "failed";

    interface ProviderModelForm {
        id: string;
        tags: ModelCapabilityTag[];
        supportedRoles: ModelRole[];
        verification?: Partial<
            Record<ModelCapabilityTag, ModelCapabilityVerification>
        >;
    }

    interface CustomProviderForm {
        id: string;
        name: string;
        enabled: boolean;
        baseUrl: string;
        apiKey: string;
        models: ProviderModelForm[];
        defaultModel: string;
        path: string;
        supportsThinking?: boolean;
        thinkingSupportMode: ThinkingSupportMode;
        thinkingFormat: ThinkingFormat;
        reasoningEffortMap: Partial<Record<ThinkingEffortLevel, string>>;
    }

    interface AIForm {
        providerMode: ProviderMode;
        piModelProvider: string;
        piModelName: string;
        defaultCustomProviderId: string;
        customProviders: CustomProviderForm[];
        modelRouting: {
            textModelKey: string;
            visionModelKey: string;
            sttModelKey: string;
            ttsModelKey: string;
        };
        systemPrompt: string;
    }

    interface MetaResponse {
        providers: Array<{ id: string; name: string }>;
        providerModels: Record<string, string[]>;
        capabilityTags: ModelCapabilityTag[];
    }

    interface ProviderTestResult {
        ok: boolean;
        status: number | null;
        message: string;
        supportedRoles: ModelRole[];
        verification: Partial<
            Record<ModelCapabilityTag, ModelCapabilityVerification>
        >;
    }

    type ProviderTab = "builtin" | "custom";
    type BuiltinAuthMode = "oauth" | "api_key" | "platform";

    interface BuiltinAuthGuide {
        mode: BuiltinAuthMode;
        modeLabel: string;
        summary: string;
        command?: string;
        tokenHint?: string;
        envVar?: string;
        steps: string[];
        links?: Array<{ label: string; url: string }>;
    }

    let loading = true;
    let saving = false;
    let testingModelKey = "";
    let selectedProviderId = "";
    let activeProviderTab: ProviderTab = "builtin";
    let providerSearch = "";
    let error = "";
    let message = "";
    let builtinProviders: Array<{ id: string; name: string }> = [];
    let builtinProviderModels: Record<string, string[]> = {};
    let expandedProviderModelIds = new Set<string>();
    const collapsedBuiltinModelLimit = 8;
    const thinkingEffortLevels: ThinkingEffortLevel[] = [
        "low",
        "medium",
        "high",
    ];
    const oauthBuiltinProviderIds = new Set([
        "openai-codex",
        "google-gemini-cli",
        "google-antigravity",
        "github-copilot",
    ]);

    function providerEnvVar(provider: string): string | undefined {
        switch (provider) {
            case "anthropic":
                return "ANTHROPIC_API_KEY";
            case "openai":
            case "openai-codex":
                return "OPENAI_API_KEY";
            case "google":
            case "google-antigravity":
            case "google-gemini-cli":
                return "GOOGLE_API_KEY";
            case "xai":
                return "XAI_API_KEY";
            case "groq":
                return "GROQ_API_KEY";
            case "cerebras":
                return "CEREBRAS_API_KEY";
            case "openrouter":
                return "OPENROUTER_API_KEY";
            case "mistral":
                return "MISTRAL_API_KEY";
            case "zai":
                return "ZAI_API_KEY";
            case "minimax":
            case "minimax-cn":
                return "MINIMAX_API_KEY";
            case "huggingface":
                return "HUGGINGFACE_API_KEY";
            default:
                return undefined;
        }
    }

    function builtinAuthGuide(providerId: string): BuiltinAuthGuide {
        if (providerId === "openai-codex") {
            return {
                mode: "oauth",
                modeLabel: "OAuth 登录",
                summary:
                    "使用 pi-ai 的设备登录流程获取 OpenAI Codex 授权，不需要在本页填写固定 API Key。",
                command: "npx @mariozechner/pi-ai login openai-codex",
                tokenHint:
                    "登录后会写入 auth.json；运行时会自动读取并按需刷新 token。",
                steps: [
                    "在终端执行登录命令并按提示完成浏览器授权。",
                    "确认 auth.json 位于 DATA_DIR（默认 ~/.molibot）或通过 PI_AI_AUTH_FILE 指定路径。",
                    "返回本页仅管理模型与默认路由，无需填写 baseUrl/path。",
                ],
                links: [{ label: "OpenAI 平台", url: "https://platform.openai.com/" }],
            };
        }
        if (providerId === "google-gemini-cli") {
            return {
                mode: "oauth",
                modeLabel: "OAuth 登录",
                summary:
                    "Gemini CLI 使用 Google OAuth 授权链，优先使用 auth.json，不建议手填 API Key。",
                command: "npx @mariozechner/pi-ai login google-gemini-cli",
                tokenHint:
                    "token 保存在 auth.json；运行时会自动读取并在过期时刷新。",
                steps: [
                    "执行登录命令并在浏览器完成 Google 账号授权。",
                    "把 auth.json 放到 DATA_DIR（默认 ~/.molibot）或设置 PI_AI_AUTH_FILE。",
                    "授权完成后在本页只需配置模型与能力标签。",
                ],
                links: [{ label: "Google AI Studio", url: "https://aistudio.google.com/" }],
            };
        }
        if (providerId === "google-antigravity") {
            return {
                mode: "oauth",
                modeLabel: "OAuth 登录",
                summary:
                    "该提供商走 Google OAuth 授权，不通过 OpenAI 兼容 key/path 模式。",
                command: "npx @mariozechner/pi-ai login google-antigravity",
                tokenHint:
                    "token 信息存储在 auth.json，并在运行时自动刷新。",
                steps: [
                    "执行登录命令，完成浏览器设备授权流程。",
                    "确保 auth.json 在 DATA_DIR 或通过 PI_AI_AUTH_FILE 指向文件。",
                    "返回本页管理模型映射与默认模型。",
                ],
                links: [{ label: "Google Cloud", url: "https://console.cloud.google.com/" }],
            };
        }
        if (providerId === "github-copilot") {
            return {
                mode: "oauth",
                modeLabel: "OAuth 登录",
                summary:
                    "GitHub Copilot 通过 GitHub 账号 OAuth 授权，不是静态 API Key 方案。",
                command: "npx @mariozechner/pi-ai login github-copilot",
                tokenHint:
                    "授权后 token 保存在 auth.json，runner 会自动读取。",
                steps: [
                    "执行命令后按终端提示完成 GitHub 登录授权。",
                    "确认 auth.json 的存放位置（DATA_DIR 或 PI_AI_AUTH_FILE）。",
                    "本页只维护模型清单、能力标注和默认模型。",
                ],
                links: [{ label: "GitHub Copilot", url: "https://github.com/features/copilot" }],
            };
        }
        if (providerId === "azure-openai-responses") {
            return {
                mode: "platform",
                modeLabel: "平台凭据",
                summary:
                    "Azure OpenAI 通常需要 endpoint + deployment + key/credential 组合，不是单一 API Key。",
                steps: [
                    "在 Azure Portal 创建 OpenAI 资源并拿到 endpoint/deployment/key。",
                    "在运行环境配置 Azure 所需环境变量；本页只支持有限 key 覆盖。",
                    "建议先在服务端环境完成 Azure 配置，再在本页维护模型元数据。",
                ],
                links: [{ label: "Azure OpenAI 文档", url: "https://learn.microsoft.com/azure/ai-services/openai/" }],
            };
        }

        const envVar = providerEnvVar(providerId);
        if (envVar) {
            return {
                mode: "api_key",
                modeLabel: "API Key",
                summary:
                    "该 provider 使用 API Key 认证。你可以在本页填写覆盖值，或通过环境变量提供。",
                envVar,
                steps: [
                    "去 provider 控制台创建/复制 API Key。",
                    "二选一：在本页填写 API Key，或在运行环境设置对应环境变量。",
                    "保存后用模型测试或实际对话验证。",
                ],
            };
        }

        return {
            mode: "platform",
            modeLabel: "平台凭据",
            summary:
                "该内置 provider 可能依赖平台侧凭据或多字段认证，请参考其官方文档配置运行环境。",
            steps: [
                "先确认该 provider 在 pi-ai 中需要的认证字段。",
                "在运行环境完成必要凭据配置。",
                "本页继续用于模型元数据和默认模型管理。",
            ],
        };
    }

    let capabilityTags: ModelCapabilityTag[] = [
        "text",
        "vision",
        "audio_input",
        "stt",
        "tts",
        "tool",
    ];

    let form: AIForm = {
        providerMode: "pi",
        piModelProvider: "anthropic",
        piModelName: "claude-sonnet-4-20250514",
        defaultCustomProviderId: "",
        customProviders: [],
        modelRouting: {
            textModelKey: "",
            visionModelKey: "",
            sttModelKey: "",
            ttsModelKey: "",
        },
        systemPrompt: "You are Molibot, a concise and helpful assistant.",
    };

    function newCustomProvider(): CustomProviderForm {
        const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
        return {
            id,
            name: "New Provider",
            enabled: true,
            baseUrl: "",
            apiKey: "",
            models: [],
            defaultModel: "",
            path: "/v1/chat/completions",
            thinkingSupportMode: "auto",
            thinkingFormat: "auto",
            reasoningEffortMap: {},
        };
    }

    function newBuiltinProvider(providerId: string): CustomProviderForm {
        const models = (builtinProviderModels[providerId] ?? []).map((id) => ({
            id,
            tags: ["text"] as ModelCapabilityTag[],
            supportedRoles: ["system", "user", "assistant", "tool"],
        }));
        return {
            id: providerId,
            name: `[Built-in] ${providerId}`,
            enabled: false,
            baseUrl: "",
            apiKey: "",
            models,
            defaultModel: models[0]?.id ?? "",
            path: "/v1/chat/completions",
            thinkingSupportMode: "auto",
            thinkingFormat: "auto",
            reasoningEffortMap: {},
        };
    }

    function modelIds(provider: CustomProviderForm): string[] {
        return provider.models.map((m) => m.id.trim()).filter(Boolean);
    }

    function hasUsableProviderConfig(provider: CustomProviderForm): boolean {
        if (!provider.enabled) return false;
        if (isBuiltinProvider(provider)) return true;
        return Boolean(provider.baseUrl.trim() && provider.apiKey.trim());
    }

    function ensureModelDefaults(model: ProviderModelForm): void {
        model.id = model.id.trim();
        model.tags = Array.isArray(model.tags)
            ? model.tags.filter((t) => capabilityTags.includes(t))
            : ["text"];
        if (model.tags.length === 0) model.tags = ["text"];
        if (
            !Array.isArray(model.supportedRoles) ||
            model.supportedRoles.length === 0
        ) {
            model.supportedRoles = ["system", "user", "assistant", "tool"];
        }
        model.verification =
            model.verification && typeof model.verification === "object"
                ? Object.fromEntries(
                      Object.entries(model.verification).filter(
                          ([tag, status]) =>
                              capabilityTags.includes(
                                  tag as ModelCapabilityTag,
                              ) &&
                              ["untested", "passed", "failed"].includes(
                                  String(status),
                              ),
                      ),
                  )
                : {};
    }

    function ensureProviderDefaults(provider: CustomProviderForm): void {
        provider.models = provider.models.map((m) => {
            const normalized: ProviderModelForm =
                typeof (m as any) === "string"
                    ? {
                          id: String(m),
                          tags: ["text"] as ModelCapabilityTag[],
                          supportedRoles: [
                              "system",
                              "user",
                              "assistant",
                              "tool",
                          ],
                      }
                    : {
                          id: String(m.id ?? ""),
                          tags: Array.isArray(m.tags) ? m.tags : ["text"],
                          supportedRoles: Array.isArray(m.supportedRoles)
                              ? m.supportedRoles
                              : ["system", "user", "assistant", "tool"],
                          verification:
                              m.verification &&
                              typeof m.verification === "object"
                                  ? m.verification
                                  : {},
                      };
            ensureModelDefaults(normalized);
            return normalized;
        });

        const ids = modelIds(provider);
        if (ids.length === 0) {
            provider.defaultModel = "";
        } else if (!ids.includes(provider.defaultModel)) {
            provider.defaultModel = ids[0];
        }
    }

    function ensureDefaultCustomProvider(): void {
        for (const provider of form.customProviders)
            ensureProviderDefaults(provider);

        if (form.customProviders.length === 0) {
            form.defaultCustomProviderId = "";
            selectedProviderId = "";
            return;
        }

        const customRows = form.customProviders.filter(
            (p) => !isBuiltinProvider(p),
        );
        const enabledCustomRows = customRows.filter((p) => p.enabled);

        if (
            !enabledCustomRows.some(
                (p) => p.id === form.defaultCustomProviderId,
            )
        ) {
            form.defaultCustomProviderId =
                enabledCustomRows[0]?.id ?? customRows[0]?.id ?? "";
        }

        if (
            !selectedProviderId ||
            !form.customProviders.some((p) => p.id === selectedProviderId)
        ) {
            selectedProviderId =
                form.defaultCustomProviderId || form.customProviders[0].id;
        }
    }

    function addCustomProvider(): void {
        const provider = newCustomProvider();
        form.customProviders = [provider, ...form.customProviders];
        selectedProviderId = provider.id;
        activeProviderTab = "custom";
        ensureDefaultCustomProvider();
    }

    function removeCustomProvider(id: string): void {
        const target = form.customProviders.find((p) => p.id === id);
        if (target && isBuiltinProvider(target)) return;
        form.customProviders = form.customProviders.filter((p) => p.id !== id);
        if (form.defaultCustomProviderId === id) {
            form.defaultCustomProviderId = form.customProviders[0]?.id ?? "";
        }
        if (selectedProviderId === id) {
            selectedProviderId = form.customProviders[0]?.id ?? "";
        }
        ensureDefaultCustomProvider();
        const selected = getSelectedProvider();
        if (selected) {
            activeProviderTab = providerTabOf(selected);
            return;
        }
        if (providersForTab(activeProviderTab).length > 0) {
            selectedProviderId = providersForTab(activeProviderTab)[0].id;
            return;
        }
        const fallbackTab = activeProviderTab === "builtin" ? "custom" : "builtin";
        if (providersForTab(fallbackTab).length > 0) {
            activeProviderTab = fallbackTab;
            selectedProviderId = providersForTab(fallbackTab)[0].id;
        }
    }

    function updateProviderById(
        providerId: string,
        updater: (provider: CustomProviderForm) => CustomProviderForm,
    ): void {
        form.customProviders = form.customProviders.map((row) => {
            if (row.id !== providerId) return row;
            const next = updater({
                ...row,
                models: Array.isArray(row.models) ? [...row.models] : [],
            });
            ensureProviderDefaults(next);
            return next;
        });
        ensureDefaultCustomProvider();
    }

    function addModel(providerId: string): void {
        updateProviderById(providerId, (provider) => ({
            ...provider,
            models: [
                {
                    id: "",
                    tags: ["text"] as ModelCapabilityTag[],
                    supportedRoles: ["system", "user", "assistant", "tool"],
                },
                ...provider.models,
            ],
        }));
    }

    function removeModel(providerId: string, index: number): void {
        updateProviderById(providerId, (provider) => ({
            ...provider,
            models: provider.models.filter((_, i) => i !== index),
        }));
    }

    function setAsDefaultProvider(id: string): void {
        const provider = form.customProviders.find((row) => row.id === id);
        if (!provider || isBuiltinProvider(provider)) return;
        form.defaultCustomProviderId = id;
        updateProviderById(id, (provider) => ({ ...provider, enabled: true }));
    }

    function toggleTag(
        providerId: string,
        modelIndex: number,
        tag: ModelCapabilityTag,
    ): void {
        updateProviderById(providerId, (provider) => {
            const models = provider.models.map((m, i) => {
                if (i !== modelIndex) return m;
                const set = new Set(m.tags);
                if (set.has(tag)) set.delete(tag);
                else set.add(tag);
                const tags = Array.from(set) as ModelCapabilityTag[];
                return {
                    ...m,
                    tags:
                        tags.length > 0
                            ? tags
                            : (["text"] as ModelCapabilityTag[]),
                };
            });
            return { ...provider, models };
        });
    }

    function setProviderEnabled(providerId: string, enabled: boolean): void {
        updateProviderById(providerId, (provider) => ({ ...provider, enabled }));
        if (!enabled && form.defaultCustomProviderId === providerId) {
            ensureDefaultCustomProvider();
        }
    }

    function mergeBuiltinProviders(
        rows: CustomProviderForm[],
    ): CustomProviderForm[] {
        const byId = new Map(rows.map((row) => [row.id, row]));
        const merged: CustomProviderForm[] = [];

        for (const builtin of builtinProviders) {
            const existing = byId.get(builtin.id);
            if (existing) {
                merged.push({
                    ...existing,
                    name:
                        existing.name?.trim() ||
                        `[Built-in] ${builtin.id}`,
                    enabled: existing.enabled === true,
                });
            } else {
                merged.push(newBuiltinProvider(builtin.id));
            }
        }

        for (const row of rows) {
            if (builtinProviders.some((b) => b.id === row.id)) continue;
            merged.push({
                ...row,
                enabled: row.enabled !== false,
            });
        }

        return merged;
    }

    function filteredCustomProviders(): CustomProviderForm[] {
        const keyword = providerSearch.trim().toLowerCase();
        const tabProviders = providersForTab(activeProviderTab);
        if (!keyword) return tabProviders;
        return tabProviders.filter((p) => {
            return (
                p.name.toLowerCase().includes(keyword) ||
                p.id.toLowerCase().includes(keyword) ||
                p.models.some((m) => m.id.toLowerCase().includes(keyword))
            );
        });
    }

    function getSelectedProvider(): CustomProviderForm | undefined {
        return form.customProviders.find((p) => p.id === selectedProviderId);
    }

    function getSelectedProviderInActiveTab():
        | CustomProviderForm
        | undefined {
        const selected = getSelectedProvider();
        if (selected && providerTabOf(selected) === activeProviderTab) {
            return selected;
        }
        return filteredCustomProviders()[0];
    }

    function providerTabOf(provider: CustomProviderForm): ProviderTab {
        return isBuiltinProvider(provider) ? "builtin" : "custom";
    }

    function providersForTab(tab: ProviderTab): CustomProviderForm[] {
        return form.customProviders.filter((p) => providerTabOf(p) === tab);
    }

    function isBuiltinProvider(provider: CustomProviderForm): boolean {
        return builtinProviders.some((row) => row.id === provider.id);
    }

    function isOauthBuiltinProvider(provider: CustomProviderForm): boolean {
        return (
            isBuiltinProvider(provider) &&
            oauthBuiltinProviderIds.has(provider.id)
        );
    }

    function visibleModelRows(
        provider: CustomProviderForm,
    ): Array<{ model: ProviderModelForm; index: number }> {
        const rows = provider.models.map((model, index) => ({ model, index }));
        if (
            !isBuiltinProvider(provider) ||
            expandedProviderModelIds.has(provider.id) ||
            rows.length <= collapsedBuiltinModelLimit
        ) {
            return rows;
        }
        return rows.slice(0, collapsedBuiltinModelLimit);
    }

    function hiddenModelCount(provider: CustomProviderForm): number {
        if (!isBuiltinProvider(provider)) return 0;
        if (expandedProviderModelIds.has(provider.id)) return 0;
        return Math.max(0, provider.models.length - collapsedBuiltinModelLimit);
    }

    function toggleModelList(providerId: string): void {
        const next = new Set(expandedProviderModelIds);
        if (next.has(providerId)) next.delete(providerId);
        else next.add(providerId);
        expandedProviderModelIds = next;
    }

    function thinkingFormatLabel(format: ThinkingFormat): string {
        switch (format) {
            case "openrouter":
                return "OpenRouter reasoning.effort";
            case "deepseek":
                return "DeepSeek thinking.type + reasoning_effort";
            case "zai":
                return "z.ai enable_thinking";
            case "qwen":
                return "Qwen enable_thinking";
            case "qwen-chat-template":
                return "Qwen chat_template_kwargs.enable_thinking";
            case "openai":
                return "OpenAI reasoning_effort";
            case "auto":
            default:
                return "OpenAI-style reasoning_effort fallback";
        }
    }

    function thinkingNotices(provider: CustomProviderForm): string[] {
        if (isBuiltinProvider(provider)) return [];
        if (provider.thinkingSupportMode === "auto") {
            return [
                "Not enabled / unknown 不会自动探测；当前运行时不会给这个 provider 发送 thinking 参数。",
            ];
        }
        if (provider.thinkingSupportMode === "disabled") {
            return ["Thinking 已明确关闭；全局或会话思索深度会被降为 off。"];
        }

        const notices = [
            `Thinking 已启用；非 off 请求会按 ${thinkingFormatLabel(provider.thinkingFormat)} 发送参数。`,
        ];
        if (provider.thinkingFormat === "auto") {
            notices.push(
                "Format 保持 Auto 时实际会走 OpenAI-style reasoning_effort。若上游不是这种协议，建议明确选择格式或关闭。",
            );
        }
        if (provider.models.length > 1) {
            notices.push(
                "这组 thinking 配置作用于该 provider 下所有模型；如果不同模型来自不同厂商或协议，建议拆成多个 provider。",
            );
        }
        return notices;
    }

    function switchProviderTab(tab: ProviderTab): void {
        activeProviderTab = tab;
        const selected = getSelectedProvider();
        if (selected && providerTabOf(selected) === tab) return;
        selectedProviderId = providersForTab(tab)[0]?.id ?? "";
    }

    async function testProviderModel(
        providerId: string,
        modelId: string,
    ): Promise<void> {
        const provider = form.customProviders.find((p) => p.id === providerId);
        if (!provider) return;
        const targetModel = modelId.trim();
        if (!targetModel) return;
        testingModelKey = `${providerId}|${targetModel}`;
        error = "";
        message = "";
        try {
            ensureProviderDefaults(provider);

            const res = await fetch("/api/settings/provider-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    baseUrl: provider.baseUrl,
                    apiKey: provider.apiKey,
                    path: provider.path,
                    model: targetModel,
                    tags:
                        provider.models.find((m) => m.id.trim() === targetModel)
                            ?.tags ?? [],
                }),
            });

            const data = (await res.json()) as ProviderTestResult & {
                error?: string;
            };
            if (!res.ok) throw new Error(data.error || "Provider test failed");

            updateProviderById(providerId, (current) => ({
                ...current,
                models: current.models.map((m) =>
                    m.id.trim() === targetModel
                        ? {
                              ...m,
                              supportedRoles: data.supportedRoles,
                              verification: {
                                  ...(m.verification ?? {}),
                                  ...(data.verification ?? {}),
                              },
                          }
                        : m,
                ),
            }));
            message = `[${provider.name} / ${targetModel}] ${data.message}`;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            testingModelKey = "";
        }
    }

    async function loadAll(): Promise<void> {
        loading = true;
        error = "";
        message = "";

        try {
            const [settingsRes, metaRes] = await Promise.all([
                fetch("/api/settings"),
                fetch("/api/settings/ai-meta"),
            ]);

            const settingsData = await settingsRes.json();
            const metaData = (await metaRes.json()) as MetaResponse & {
                ok: boolean;
                error?: string;
            };

            if (!settingsData.ok)
                throw new Error(
                    settingsData.error || "Failed to load settings",
                );
            if (!metaData.ok)
                throw new Error(metaData.error || "Failed to load AI metadata");

            capabilityTags = metaData.capabilityTags ?? capabilityTags;
            builtinProviders = Array.isArray(metaData.providers)
                ? metaData.providers
                : [];
            builtinProviderModels =
                metaData.providerModels ?? builtinProviderModels;

            const s = settingsData.settings;
            const loadedProviders = (s.customProviders ?? []) as Array<
                CustomProviderForm & { supportedRoles?: ModelRole[] }
            >;

            form = {
                providerMode: s.providerMode,
                piModelProvider: s.piModelProvider,
                piModelName: s.piModelName,
                defaultCustomProviderId: s.defaultCustomProviderId ?? "",
                customProviders: mergeBuiltinProviders(
                    loadedProviders.map((cp) => ({
                    ...cp,
                    enabled:
                        builtinProviders.some((b) => b.id === cp.id)
                            ? cp.enabled === true
                            : cp.enabled !== false,
                    models: Array.isArray(cp.models)
                        ? cp.models.map((m: any) => {
                              if (typeof m === "string") {
                                  return {
                                      id: m,
                                      tags: [
                                          "text",
                                      ] as ModelCapabilityTag[] as ModelCapabilityTag[],
                                      supportedRoles:
                                          Array.isArray(cp.supportedRoles) &&
                                          cp.supportedRoles.length > 0
                                              ? cp.supportedRoles
                                              : [
                                                    "system",
                                                    "user",
                                                    "assistant",
                                                    "tool",
                                                ],
                                  };
                              }
                              const tags = Array.isArray(m.tags)
                                  ? m.tags.filter((t: any) =>
                                        capabilityTags.includes(t),
                                    )
                                  : ["text"];
                              const roles = Array.isArray(m.supportedRoles)
                                  ? m.supportedRoles
                                  : [];
                              return {
                                  id: String(m.id ?? ""),
                                  tags:
                                      tags.length > 0
                                          ? tags
                                          : (["text"] as ModelCapabilityTag[]),
                                  supportedRoles:
                                      roles.length > 0
                                          ? roles
                                          : Array.isArray(cp.supportedRoles) &&
                                              cp.supportedRoles.length > 0
                                            ? cp.supportedRoles
                                            : [
                                                  "system",
                                                  "user",
                                                  "assistant",
                                                  "tool",
                                              ],
                                  verification:
                                      m.verification &&
                                      typeof m.verification === "object"
                                          ? m.verification
                                          : {},
                              };
                          })
                        : [],
                    defaultModel: cp.defaultModel ?? "",
                    thinkingSupportMode:
                        cp.supportsThinking === true
                            ? "enabled"
                            : cp.supportsThinking === false
                              ? "disabled"
                              : "auto",
                    thinkingFormat:
                        (cp.thinkingFormat as ThinkingFormat | undefined) ??
                        "auto",
                    reasoningEffortMap:
                        cp.reasoningEffortMap &&
                        typeof cp.reasoningEffortMap === "object"
                            ? cp.reasoningEffortMap
                            : {},
                })),
                ),
                modelRouting: {
                    textModelKey: s.modelRouting?.textModelKey ?? "",
                    visionModelKey: s.modelRouting?.visionModelKey ?? "",
                    sttModelKey: s.modelRouting?.sttModelKey ?? "",
                    ttsModelKey: s.modelRouting?.ttsModelKey ?? "",
                },
                systemPrompt: s.systemPrompt,
            };

            ensureDefaultCustomProvider();
            const selected = getSelectedProvider();
            if (selected) {
                activeProviderTab = providerTabOf(selected);
            } else if (providersForTab("builtin").length > 0) {
                activeProviderTab = "builtin";
                selectedProviderId = providersForTab("builtin")[0].id;
            } else if (providersForTab("custom").length > 0) {
                activeProviderTab = "custom";
                selectedProviderId = providersForTab("custom")[0].id;
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loading = false;
        }
    }

    async function save(): Promise<void> {
        saving = true;
        error = "";
        message = "";

        try {
            ensureDefaultCustomProvider();
            const payload: AIForm = {
                ...form,
                customProviders: form.customProviders.map((provider) => ({
                    ...provider,
                    supportsThinking:
                        provider.thinkingSupportMode === "auto"
                            ? undefined
                            : provider.thinkingSupportMode === "enabled",
                    thinkingFormat:
                        provider.thinkingFormat === "auto"
                            ? undefined
                            : provider.thinkingFormat,
                    reasoningEffortMap: Object.fromEntries(
                        Object.entries(provider.reasoningEffortMap ?? {}).filter(
                            ([, value]) =>
                                String(value ?? "").trim().length > 0,
                        ),
                    ),
                    models: provider.models.map((model) => ({
                        id: model.id.trim(),
                        tags: [...model.tags],
                        supportedRoles: [...model.supportedRoles],
                        verification:
                            model.verification &&
                            Object.keys(model.verification).length > 0
                                ? { ...model.verification }
                                : {},
                    })),
                })),
            };
            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!data.ok)
                throw new Error(data.error || "Failed to save AI settings");
            message = "Custom Providers settings saved.";
            await loadAll();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            saving = false;
        }
    }

    onMount(loadAll);

    function verificationBadgeClass(
        status: ModelCapabilityVerification | undefined,
    ): string {
        if (status === "passed") {
            return "border-[color-mix(in_oklab,hsl(146_55%_42%)_30%,var(--border))] bg-[color-mix(in_oklab,hsl(146_55%_42%)_10%,var(--card))] text-[color-mix(in_oklab,hsl(146_55%_42%)_84%,var(--foreground))]";
        }
        if (status === "failed") {
            return "border-[color-mix(in_oklab,var(--destructive)_30%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))] text-[var(--destructive)]";
        }
        return "border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] text-[var(--muted-foreground)]";
    }

    function verificationLabel(
        model: ProviderModelForm,
        tag: ModelCapabilityTag,
    ): string {
        return model.verification?.[tag] ?? "untested";
    }

    const autoTestedCapabilities: ModelCapabilityTag[] = ["text", "vision"];
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-6" className="providers-page">
    <div class="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <header>
            <p class="mb-1 text-xs font-bold uppercase tracking-normal text-[var(--muted-foreground)]">
                Unified model pool
            </p>
            <h1 class="text-3xl font-bold tracking-tight text-[var(--foreground)]">
                Providers & Models
            </h1>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
                Built-in transports and custom OpenAI-compatible endpoints feed
                the same routing pool. Enable providers here, declare model
                capabilities, then choose any enabled model from AI Routing.
            </p>
        </header>
        <a
            class="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
            href="/settings/ai/routing"
        >
            Open routing
        </a>
    </div>

    {#if loading}
        <div
            class="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-5 text-sm text-[var(--muted-foreground)]"
        >
            Loading providers...
        </div>
    {:else}
        <form
            class="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]"
            on:submit|preventDefault={save}
        >
            <!-- Providers List Pane -->
            <aside class="w-full shrink-0 md:w-[300px] xl:w-[320px]">
                <div
                    class="provider-panel sticky top-6 flex flex-col space-y-4 overflow-y-auto p-5 md:max-h-[calc(100vh-9rem)]"
                >
                    <div class="flex items-center justify-between">
                        <h2
                            class="text-sm font-semibold uppercase tracking-normal text-[var(--muted-foreground)]"
                        >
                            Provider Source
                        </h2>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            class={`cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                                activeProviderTab === "builtin"
                                    ? "border-[var(--ring)] bg-[color-mix(in_oklab,var(--accent)_45%,transparent)] text-[var(--foreground)]"
                                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                            }`}
                            on:click={() => switchProviderTab("builtin")}
                        >
                            Built-in
                        </button>
                        <button
                            type="button"
                            class={`cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                                activeProviderTab === "custom"
                                    ? "border-[var(--ring)] bg-[color-mix(in_oklab,var(--accent)_45%,transparent)] text-[var(--foreground)]"
                                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                            }`}
                            on:click={() => switchProviderTab("custom")}
                        >
                            Custom
                        </button>
                    </div>

                    {#if activeProviderTab === "builtin"}
                        <div
                            class="rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
                        >
                            Built-in providers are always listed below. Use the
                            `Enabled` switch to put native transports into the
                            shared routing pool.
                        </div>
                    {:else}
                        <button
                            type="button"
                            class="flex cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                            on:click={addCustomProvider}
                        >
                            + Create Custom Provider
                        </button>
                    {/if}

                    <div class="relative">
                        <input
                            class="w-full rounded-xl border border-[var(--input)] bg-[var(--card)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--input)]"
                            bind:value={providerSearch}
                            placeholder="Search provider..."
                        />
                    </div>

                    <div class="flex flex-col space-y-2">
                        {#if filteredCustomProviders().length === 0}
                            <div
                                class="py-2 text-center text-xs text-[var(--muted-foreground)]"
                            >
                                No items matched
                            </div>
                        {/if}

                        {#each filteredCustomProviders() as provider (provider.id)}
                            <button
                                type="button"
                                    class={`flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-all ${
                                    selectedProviderId === provider.id
                                        ? "border-[var(--ring)] bg-[color-mix(in_oklab,var(--accent)_35%,transparent)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                                        : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--input)] hover:bg-[var(--muted)]"
                                }`}
                                on:click={() =>
                                    (selectedProviderId = provider.id)}
                            >
                                <div
                                    class={`font-medium ${selectedProviderId === provider.id ? "text-[var(--foreground)]" : "text-[var(--foreground)]"}`}
                                >
                                    {provider.name}
                                </div>
                                <div class="text-xs text-[var(--muted-foreground)]">
                                    ID: {provider.id}
                                </div>
                                <div class="mt-1 flex items-center gap-2">
                                    <span
                                        class="rounded bg-[var(--muted)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]"
                                    >
                                        {provider.models.length} model{provider
                                            .models.length === 1
                                            ? ""
                                            : "s"}
                                    </span>
                                    {#if form.defaultCustomProviderId === provider.id}
                                        <span
                                            class="rounded bg-[color-mix(in_oklab,var(--accent)_60%,transparent)] px-2 py-0.5 text-[10px] uppercase font-bold text-[var(--foreground)]"
                                        >
                                            Default
                                        </span>
                                    {/if}
                                    <span
                                        class={`rounded px-2 py-0.5 text-[10px] uppercase font-bold ${
                                            provider.enabled
                                                ? "bg-[color-mix(in_oklab,var(--accent)_55%,transparent)] text-[var(--foreground)]"
                                                : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                                        }`}
                                    >
                                        {provider.enabled
                                            ? "Enabled"
                                            : "Disabled"}
                                    </span>
                                    <span
                                        class={`rounded px-2 py-0.5 text-[10px] uppercase font-bold ${
                                            hasUsableProviderConfig(provider)
                                                ? "bg-[color-mix(in_oklab,var(--secondary)_75%,transparent)] text-[var(--secondary-foreground)]"
                                                : "bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-[var(--destructive)]"
                                        }`}
                                    >
                                        {hasUsableProviderConfig(provider)
                                            ? "Available"
                                            : "Unavailable"}
                                    </span>
                                </div>
                            </button>
                        {/each}
                    </div>
                </div>
            </aside>

            <!-- Provider Edit Pane -->
            <section class="flex-1 min-w-0">
                <div
                    class="provider-panel p-6"
                >
                    {#if getSelectedProviderInActiveTab()}
                        {@const cp = getSelectedProviderInActiveTab()!}

                        <div
                            class="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-5"
                        >
                            <h2
                                class="text-xl font-bold tracking-tight text-[var(--foreground)]"
                            >
                                {cp.name || "Unnamed Provider"}
                            </h2>

                            <div class="flex flex-wrap gap-2">
                                <label
                                    class="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-semibold uppercase tracking-normal text-[var(--foreground)]"
                                >
                                    <input
                                        type="checkbox"
                                        checked={cp.enabled}
                                        on:change={(e) =>
                                            setProviderEnabled(
                                                cp.id,
                                                (e.currentTarget as HTMLInputElement)
                                                    .checked,
                                            )}
                                    />
                                    Enabled
                                </label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    on:click={() => setAsDefaultProvider(cp.id)}
                                    disabled={isBuiltinProvider(cp) || form.defaultCustomProviderId === cp.id || !cp.enabled}
                                >
                                    {form.defaultCustomProviderId === cp.id
                                        ? "Targeted as Default"
                                        : "Set as Default"}
                                </Button>
                                {#if !isBuiltinProvider(cp)}
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        on:click={() => removeCustomProvider(cp.id)}
                                    >
                                        Delete
                                    </Button>
                                {/if}
                            </div>
                        </div>

                        <div
                            class="provider-savebar mt-5 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
                        >
                            <label class="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
                                <span class="font-semibold text-[var(--foreground)]"
                                    >Default model in this provider</span
                                >
                                <select
                                    class="min-w-[220px] rounded-lg border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-3 py-2 outline-none transition-colors focus:border-[var(--ring)]"
                                    bind:value={cp.defaultModel}
                                    disabled={!cp.enabled}
                                >
                                    <option value="">(None)</option>
                                    {#each modelIds(cp) as modelId}
                                        <option value={modelId}
                                            >{modelId}</option
                                        >
                                    {/each}
                                </select>
                            </label>

                            <div class="flex flex-wrap items-center gap-3">
                                {#if message}
                                    <span
                                        class="status-text success"
                                        >{message}</span
                                    >
                                {/if}
                                {#if error}
                                    <span
                                        class="status-text error"
                                        title={error}>{error}</span
                                    >
                                {/if}

                                <Button
                                    type="submit"
                                    variant="default"
                                    size="md"
                                    className="shrink-0"
                                    disabled={saving}
                                >
                                    {saving
                                        ? "Saving..."
                                        : "Save Provider Settings"}
                                </Button>
                            </div>
                        </div>

                        <div class="mt-6 grid gap-5 md:grid-cols-2">
                            <label class="grid gap-2 text-sm">
                                <span class="font-medium text-[var(--foreground)]"
                                    >Provider ID</span
                                >
                                <input
                                    class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)]"
                                    bind:value={cp.id}
                                    disabled={isBuiltinProvider(cp)}
                                />
                            </label>

                            <label class="grid gap-2 text-sm">
                                <span class="font-medium text-[var(--foreground)]"
                                    >Display Name</span
                                >
                                <input
                                    class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)]"
                                    bind:value={cp.name}
                                />
                            </label>
                            {#if isBuiltinProvider(cp)}
                                {@const authGuide = builtinAuthGuide(cp.id)}
                                <div
                                    class="rounded-xl border border-[color-mix(in_oklab,var(--primary)_24%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-4 py-3 text-xs leading-5 text-[color-mix(in_oklab,var(--primary)_70%,var(--foreground))] md:col-span-2"
                                >
                                    Built-in provider detected. Request protocol
                                    is managed by pi-ai natively, so `baseUrl`
                                    and `path` are ignored here.
                                </div>
                                <div
                                    class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-3 text-xs leading-5 text-[var(--foreground)] md:col-span-2"
                                >
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="font-semibold text-[var(--foreground)]"
                                            >认证方式：</span
                                        >
                                        <span
                                            class="rounded border border-[var(--border)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--foreground)]"
                                        >
                                            {authGuide.modeLabel}
                                        </span>
                                    </div>
                                    <p class="mt-2 text-[var(--foreground)]">
                                        {authGuide.summary}
                                    </p>
                                    {#if authGuide.command}
                                        <p class="mt-2 text-[var(--foreground)]">
                                            登录命令：
                                            <code>{authGuide.command}</code>
                                        </p>
                                    {/if}
                                    {#if authGuide.tokenHint}
                                        <p class="mt-2 text-[var(--muted-foreground)]">
                                            {authGuide.tokenHint}
                                        </p>
                                    {/if}
                                    {#if authGuide.envVar}
                                        <p class="mt-2 text-[var(--foreground)]">
                                            环境变量：
                                            <code>{authGuide.envVar}</code>
                                        </p>
                                    {/if}
                                    <ol class="mt-2 list-decimal space-y-1 pl-5 text-[var(--foreground)]">
                                        {#each authGuide.steps as step}
                                            <li>{step}</li>
                                        {/each}
                                    </ol>
                                    {#if authGuide.links && authGuide.links.length > 0}
                                        <div class="mt-2 flex flex-wrap gap-2">
                                            {#each authGuide.links as link}
                                                <a
                                                    class="inline-flex items-center rounded border border-[color-mix(in_oklab,var(--primary)_30%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-2 py-1 text-[11px] text-[color-mix(in_oklab,var(--primary)_70%,var(--foreground))] hover:bg-[color-mix(in_oklab,var(--primary)_16%,var(--card))]"
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    {link.label}
                                                </a>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                                {#if isOauthBuiltinProvider(cp)}
                                    <div
                                        class="rounded-xl border border-[color-mix(in_oklab,hsl(38_84%_54%)_24%,var(--border))] bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] px-4 py-3 text-xs leading-5 text-[color-mix(in_oklab,hsl(38_84%_44%)_72%,var(--foreground))] md:col-span-2"
                                    >
                                        OAuth provider: static API key input is
                                        hidden by design. Use the command above,
                                        then keep <code>auth.json</code> under
                                        <code>${"{DATA_DIR}"}</code> (or set
                                        <code>PI_AI_AUTH_FILE</code>).
                                    </div>
                                {:else}
                                    <label
                                        class="grid gap-2 text-sm md:col-span-2"
                                    >
                                        <span class="font-medium text-[var(--foreground)]"
                                            >API Key Override (Optional)</span
                                        >
                                        <input
                                            class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 font-mono text-sm tracking-widest outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                            bind:value={cp.apiKey}
                                            type="password"
                                            placeholder="Leave empty to use env/OAuth source"
                                        />
                                    </label>
                                {/if}
                            {:else}
                                <label
                                    class="grid gap-2 text-sm md:col-span-2 xl:col-span-1"
                                >
                                    <span class="font-medium text-[var(--foreground)]"
                                        >API Base URL</span
                                    >
                                    <input
                                        class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                        bind:value={cp.baseUrl}
                                        placeholder="https://api.openai.com"
                                    />
                                </label>

                                <label
                                    class="grid gap-2 text-sm md:col-span-2 xl:col-span-1"
                                >
                                    <span class="font-medium text-[var(--foreground)]"
                                        >Path Endpoint</span
                                    >
                                    <input
                                        class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                        bind:value={cp.path}
                                        placeholder="/v1/chat/completions"
                                    />
                                </label>

                                <label
                                    class="grid gap-2 text-sm md:col-span-2 xl:col-span-1"
                                >
                                    <span class="font-medium text-[var(--foreground)]"
                                        >Thinking Support</span
                                    >
                                    <select
                                        class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                        bind:value={cp.thinkingSupportMode}
                                    >
                                        <option value="auto">
                                            Not enabled / unknown
                                        </option>
                                        <option value="enabled">
                                            Enabled
                                        </option>
                                        <option value="disabled">
                                            Disabled
                                        </option>
                                    </select>
                                </label>

                                <label
                                    class="grid gap-2 text-sm md:col-span-2 xl:col-span-1"
                                >
                                    <span class="font-medium text-[var(--foreground)]"
                                        >Thinking Format</span
                                    >
                                    <select
                                        class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                        bind:value={cp.thinkingFormat}
                                    >
                                        <option value="auto">
                                            Auto / OpenAI fallback
                                        </option>
                                        <option value="openai">
                                            OpenAI `reasoning_effort`
                                        </option>
                                        <option value="openrouter">
                                            OpenRouter `reasoning.effort`
                                        </option>
                                        <option value="deepseek">
                                            DeepSeek `thinking.type` + `reasoning_effort`
                                        </option>
                                        <option value="zai">
                                            z.ai `enable_thinking`
                                        </option>
                                        <option value="qwen">
                                            Qwen `enable_thinking`
                                        </option>
                                        <option value="qwen-chat-template">
                                            Qwen
                                            `chat_template_kwargs.enable_thinking`
                                        </option>
                                    </select>
                                </label>

                                <div class="grid gap-3 text-sm md:col-span-2">
                                    {#if thinkingNotices(cp).length > 0}
                                        <div
                                            class={`rounded-xl border px-4 py-3 text-xs leading-5 md:col-span-2 ${
                                                cp.thinkingSupportMode === "enabled"
                                                    ? "border-[color-mix(in_oklab,hsl(38_84%_54%)_28%,var(--border))] bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] text-[color-mix(in_oklab,hsl(38_84%_44%)_72%,var(--foreground))]"
                                                    : "border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] text-[var(--muted-foreground)]"
                                            }`}
                                        >
                                            <div class="font-semibold text-[var(--foreground)]">
                                                Thinking behavior
                                            </div>
                                            <ul class="mt-2 space-y-1">
                                                {#each thinkingNotices(cp) as notice}
                                                    <li>{notice}</li>
                                                {/each}
                                            </ul>
                                        </div>
                                    {/if}

                                    <div>
                                        <span class="font-medium text-[var(--foreground)]"
                                            >Reasoning Effort Value Mapping</span
                                        >
                                        <p class="mt-1 text-xs text-[var(--muted-foreground)]">
                                            这不是“思维维度”配置，只是把 low /
                                            medium / high 转成上游要求的字符串；
                                            不需要映射时留空。
                                        </p>
                                    </div>
                                    <div class="grid gap-3 md:grid-cols-3">
                                        {#each thinkingEffortLevels as level}
                                            <label
                                                class="grid gap-2 text-sm"
                                            >
                                                <span
                                                    class="font-medium capitalize text-[var(--muted-foreground)]"
                                                    >{level}</span
                                                >
                                                <input
                                                    class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                                    bind:value={cp.reasoningEffortMap[level]}
                                                    placeholder={level}
                                                />
                                            </label>
                                        {/each}
                                    </div>
                                </div>

                                <label class="grid gap-2 text-sm md:col-span-2">
                                    <span class="font-medium text-[var(--foreground)]"
                                        >API Signature / Key</span
                                    >
                                    <input
                                        class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-2.5 font-mono text-sm tracking-widest outline-none transition-colors focus:border-[var(--ring)] focus:bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                                        bind:value={cp.apiKey}
                                        type="password"
                                        placeholder="sk-..."
                                    />
                                </label>
                            {/if}
                        </div>

                        <!-- Models Header -->
                        <div
                            class="mt-8 flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-3 sm:flex-row sm:items-center"
                        >
                            <h3
                                class="text-sm font-bold uppercase tracking-normal text-[var(--foreground)]"
                            >
                                Attached Models
                            </h3>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                on:click={() => addModel(cp.id)}
                                disabled={!cp.enabled}
                            >
                                + Add Model
                            </Button>
                        </div>

                        {#if cp.models.length === 0}
                            <div
                                class="mt-4 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-8 text-center text-sm text-[var(--muted-foreground)]"
                            >
                                This provider currently has no defined models.
                                Add a model identifier down below.
                            </div>
                        {/if}

                        <div class="mt-4 space-y-4">
                            {#each visibleModelRows(cp) as row (row.index)}
                                {@const model = row.model}
                                {@const index = row.index}
                                <div
                                    class="relative overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)]"
                                >
                                    <div
                                        class="grid gap-y-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:gap-x-3"
                                    >
                                        <label class="col-span-1 block">
                                            <span class="hidden sr-only"
                                                >Model ID</span
                                            >
                                            <input
                                                class="w-full rounded-lg border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_48%,var(--card))] px-4 py-2 text-sm outline-none transition-colors focus:border-[var(--ring)]"
                                                bind:value={model.id}
                                                placeholder="e.g. gpt-4o"
                                            />
                                        </label>

                                        {#if !isBuiltinProvider(cp)}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="col-span-1 sm:col-span-1"
                                                on:click={() =>
                                                    testProviderModel(
                                                        cp.id,
                                                        model.id,
                                                    )}
                                                disabled={!cp.enabled ||
                                                    !model.id.trim() ||
                                                    testingModelKey ===
                                                        `${cp.id}|${model.id.trim()}`}
                                            >
                                                {testingModelKey ===
                                                `${cp.id}|${model.id.trim()}`
                                                    ? "Pinging..."
                                                    : "Test Connection"}
                                            </Button>
                                        {:else}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="col-span-1 sm:col-span-1"
                                                disabled={true}
                                                title="Built-in providers use native APIs; OpenAI compatibility test is not applicable."
                                            >
                                                Native Provider
                                            </Button>
                                        {/if}

                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="sm"
                                            className="col-span-1 sm:col-span-1"
                                            on:click={() =>
                                                removeModel(cp.id, index)}
                                        >
                                            Remove
                                        </Button>
                                    </div>

                                    <div class="bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-3">
                                        <div
                                            class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
                                        >
                                            Declared Capabilities
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            {#each capabilityTags as tag}
                                                <label
                                                    class={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                                                        model.tags.includes(tag)
                                                            ? "bg-[color-mix(in_oklab,hsl(146_55%_42%)_14%,var(--card))] text-[color-mix(in_oklab,hsl(146_55%_42%)_84%,var(--foreground))] ring-1 ring-inset ring-[color-mix(in_oklab,hsl(146_55%_42%)_34%,var(--border))]"
                                                            : "bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] text-[var(--muted-foreground)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--border)_72%,transparent)] hover:bg-[color-mix(in_oklab,var(--muted)_54%,var(--card))]"
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        class="hidden"
                                                        checked={model.tags.includes(
                                                            tag,
                                                        )}
                                                        on:change={() =>
                                                            toggleTag(
                                                                cp.id,
                                                                index,
                                                                tag,
                                                            )}
                                                    />
                                                    <span class="font-medium"
                                                        >{tag}</span
                                                    >
                                                </label>
                                            {/each}
                                        </div>

                                        {#if model.tags.length > 0}
                                            <div class="mt-4">
                                                <div
                                                    class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
                                                >
                                                    Verification Status
                                                </div>
                                                <div
                                                    class="flex flex-wrap gap-2"
                                                >
                                                    {#each model.tags as tag}
                                                        <span
                                                            class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${verificationBadgeClass(
                                                                verificationLabel(
                                                                    model,
                                                                    tag,
                                                                ),
                                                            )}`}
                                                        >
                                                            <span
                                                                class="font-medium"
                                                                >{tag}</span
                                                            >
                                                            <span
                                                                class="uppercase"
                                                                >{verificationLabel(
                                                                    model,
                                                                    tag,
                                                                )}</span
                                                            >
                                                        </span>
                                                    {/each}
                                                </div>
                                                <p
                                                    class="mt-3 text-[11px] leading-5 text-[var(--muted-foreground)]"
                                                >
                                                    Automatic verification
                                                    currently covers
                                                    {autoTestedCapabilities.join(
                                                        " / ",
                                                    )}. Declared capabilities
                                                    outside that set stay
                                                    `untested` until we add
                                                    deeper probes.
                                                    `audio_input` is config-only
                                                    for now; runtime audio
                                                    handling still falls back to
                                                    STT because native audio
                                                    prompt transport is not
                                                    wired yet.
                                                </p>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>

                        {#if isBuiltinProvider(cp) && cp.models.length > collapsedBuiltinModelLimit}
                            <div class="mt-4 flex justify-center">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    on:click={() => toggleModelList(cp.id)}
                                >
                                    {expandedProviderModelIds.has(cp.id)
                                        ? "Collapse built-in models"
                                        : `Show ${hiddenModelCount(cp)} more built-in models`}
                                </Button>
                            </div>
                        {/if}

                    {:else}
                        <div
                            class="flex flex-col items-center justify-center py-20 text-center"
                        >
                            <div
                                class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))]"
                            >
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="text-[var(--muted-foreground)]"
                                >
                                    <path
                                        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                                    ></path>
                                    <polyline points="3.29 7 12 12 20.71 7"
                                    ></polyline>
                                    <line x1="12" y1="22" x2="12" y2="12"
                                    ></line>
                                </svg>
                            </div>
                            <h3 class="text-lg font-medium text-[var(--foreground)]">
                                No Provider Selected
                            </h3>
                            <p
                                class="mt-2 max-w-[250px] text-sm text-[var(--muted-foreground)]"
                            >
                                {#if activeProviderTab === "builtin"}
                                    Choose a built-in provider from the sidebar
                                    or add one above.
                                {:else}
                                    Choose a custom provider from the sidebar
                                    or create a new one to begin configuration.
                                {/if}
                            </p>
                        </div>
                    {/if}
                </div>
            </section>
        </form>
    {/if}
</PageShell>
