<script lang="ts">
    import { onMount } from "svelte";
    import { Checkbox } from "$lib/components/ui/checkbox";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { Textarea } from "$lib/components/ui/textarea";

    type ProviderMode = "pi" | "custom";
    type CustomProviderProtocol = "openai-compatible" | "anthropic";
    type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
    type ThinkingSupportMode = "auto" | "enabled" | "disabled";
    type ThinkingFormat =
        | "auto"
        | "openai"
        | "openrouter"
        | "anthropic"
        | "deepseek"
        | "zai"
        | "qwen"
        | "qwen-chat-template";
    type ThinkingEffortLevel = "low" | "medium" | "high";
    type ReasoningEffortMappingMode = "auto" | "custom";
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
        contextWindow?: number;
        verification?: Partial<
            Record<ModelCapabilityTag, ModelCapabilityVerification>
        >;
    }

    interface CustomProviderForm {
        id: string;
        name: string;
        enabled: boolean;
        protocol: CustomProviderProtocol;
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

    interface ModelTestStatus {
        ok: boolean;
        status: number | null;
        message: string;
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
    let showApiKey = false;
    let testingModelKey = "";
    let selectedProviderId = "";
    let activeProviderTab: ProviderTab = "builtin";
    let providerSearch = "";
    let error = "";
    let message = "";

    /* ── Add Model Modal ── */
    let showAddModelModal = false;
    let addModelTargetProviderId = "";
    let addModelId = "";
    let addModelTags: ModelCapabilityTag[] = ["text"];
    let addModelContextWindow: number | undefined = undefined;

    /* ── Pull Models Modal ── */
    let showPullModal = false;
    let pullTargetProviderId = "";
    let pullAddingModelId = "";
    let pullAddingTags: ModelCapabilityTag[] = ["text"];
    let modelTestResults: Record<string, ModelTestStatus> = {};
    let discoveredProviderModels: Record<string, string[]> = {};
    let discoveredSelectedModel: Record<string, string> = {};
    let providerModelsPulled: Record<string, boolean> = {};
    let loadingProviderModelsFor = "";
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
            protocol: "openai-compatible",
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
            protocol: "openai-compatible",
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

    function defaultPathForProtocol(protocol: CustomProviderProtocol): string {
        return protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
    }

    function normalizeProviderProtocol(input: unknown): CustomProviderProtocol {
        return input === "anthropic" ? "anthropic" : "openai-compatible";
    }

    function setProviderProtocol(
        providerId: string,
        protocol: CustomProviderProtocol,
    ): void {
        updateProviderById(providerId, (provider) => {
            const previousDefaultPath = defaultPathForProtocol(
                provider.protocol,
            );
            const path = !provider.path.trim() ||
                provider.path.trim() === previousDefaultPath
                ? defaultPathForProtocol(protocol)
                : provider.path;
            const thinkingFormat = protocol === "anthropic"
                ? "anthropic"
                : provider.thinkingFormat === "anthropic"
                  ? "openai"
                  : provider.thinkingFormat;
            return {
                ...provider,
                protocol,
                path,
                thinkingFormat,
                reasoningEffortMap: {},
            };
        });
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
                          contextWindow: undefined,
                      }
                    : {
                          id: String(m.id ?? ""),
                          tags: Array.isArray(m.tags) ? m.tags : ["text"],
                          supportedRoles: Array.isArray(m.supportedRoles)
                              ? m.supportedRoles
                              : ["system", "user", "assistant", "tool"],
                          contextWindow: typeof (m as any).contextWindow === "number" && (m as any).contextWindow > 0 ? (m as any).contextWindow : undefined,
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
                    contextWindow: undefined,
                },
                ...provider.models,
            ],
        }));
    }

    function openAddModelModal(providerId: string): void {
        addModelTargetProviderId = providerId;
        addModelId = "";
        addModelTags = ["text"];
        addModelContextWindow = undefined;
        showAddModelModal = true;
    }

    function confirmAddModel(): void {
        if (!addModelId.trim()) return;
        updateProviderById(addModelTargetProviderId, (provider) => ({
            ...provider,
            models: [
                ...provider.models,
                {
                    id: addModelId.trim(),
                    tags: addModelTags.length > 0 ? [...addModelTags] : ["text"],
                    supportedRoles: ["system", "user", "assistant", "tool"],
                    contextWindow: addModelContextWindow,
                },
            ],
        }));
        showAddModelModal = false;
    }

    function toggleAddModelTag(tag: ModelCapabilityTag): void {
        const set = new Set(addModelTags);
        if (set.has(tag)) set.delete(tag); else set.add(tag);
        addModelTags = Array.from(set) as ModelCapabilityTag[];
        if (addModelTags.length === 0) addModelTags = ["text"];
    }

    function openPullModal(provider: CustomProviderForm): void {
        pullTargetProviderId = provider.id;
        pullAddingModelId = "";
        pullAddingTags = ["text"];
        showPullModal = true;
        fetchProviderModels(provider);
    }

    function confirmPullAdd(modelId: string): void {
        addDiscoveredModel(pullTargetProviderId, modelId);
        /* set tags on the newly added model */
        updateProviderById(pullTargetProviderId, (provider) => {
            const models = provider.models.map((m) =>
                m.id === modelId ? { ...m, tags: [...pullAddingTags] } : m,
            );
            return { ...provider, models };
        });
        pullAddingModelId = "";
        pullAddingTags = ["text"];
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
        return form.customProviders
            .filter((p) => providerTabOf(p) === tab)
            .sort((a, b) => {
                const aAvail = hasUsableProviderConfig(a) ? 0 : 1;
                const bAvail = hasUsableProviderConfig(b) ? 0 : 1;
                if (aAvail !== bAvail) return aAvail - bAvail;
                return a.name.localeCompare(b.name);
            });
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
            case "anthropic":
                return "Anthropic adaptive thinking";
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

    function thinkingFormatUsesEffortMap(format: ThinkingFormat): boolean {
        return !["zai", "qwen", "qwen-chat-template"].includes(format);
    }

    function autoReasoningEffortValue(
        format: ThinkingFormat,
        level: ThinkingEffortLevel,
    ): string {
        if (format === "deepseek") return "high";
        return level;
    }

    function reasoningEffortOptions(format: ThinkingFormat): string[] {
        if (format === "deepseek") return ["high"];
        if (format === "anthropic") return ["low", "medium", "high", "xhigh", "max"];
        return ["low", "medium", "high"];
    }

    function reasoningEffortMappingMode(
        provider: CustomProviderForm,
    ): ReasoningEffortMappingMode {
        return Object.values(provider.reasoningEffortMap ?? {}).some((value) =>
            String(value ?? "").trim(),
        )
            ? "custom"
            : "auto";
    }

    function defaultReasoningEffortMap(
        format: ThinkingFormat,
    ): Partial<Record<ThinkingEffortLevel, string>> {
        return Object.fromEntries(
            thinkingEffortLevels.map((level) => [
                level,
                autoReasoningEffortValue(format, level),
            ]),
        ) as Partial<Record<ThinkingEffortLevel, string>>;
    }

    function setReasoningEffortMappingMode(
        providerId: string,
        mode: ReasoningEffortMappingMode,
    ): void {
        updateProviderById(providerId, (provider) => ({
            ...provider,
            reasoningEffortMap:
                mode === "custom"
                    ? defaultReasoningEffortMap(provider.thinkingFormat)
                    : {},
        }));
    }

    function setReasoningEffortMapValue(
        providerId: string,
        level: ThinkingEffortLevel,
        value: string,
    ): void {
        updateProviderById(providerId, (provider) => ({
            ...provider,
            reasoningEffortMap: {
                ...(provider.reasoningEffortMap ?? {}),
                [level]: value,
            },
        }));
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

    function modelTestKey(providerId: string, modelId: string): string {
        return `${providerId}|${modelId.trim()}`;
    }

    function getModelTestResult(
        providerId: string,
        modelId: string,
    ): ModelTestStatus | undefined {
        return modelTestResults[modelTestKey(providerId, modelId)];
    }

    function setModelTestResult(
        providerId: string,
        modelId: string,
        result?: ModelTestStatus,
    ): void {
        const key = modelTestKey(providerId, modelId);
        if (result) {
            modelTestResults = { ...modelTestResults, [key]: result };
            return;
        }
        const { [key]: _removed, ...remaining } = modelTestResults;
        modelTestResults = remaining;
    }

    function discoveredModels(providerId: string): string[] {
        return discoveredProviderModels[providerId] ?? [];
    }

    function providerHasModel(
        provider: CustomProviderForm,
        modelId: string,
    ): boolean {
        const target = modelId.trim();
        if (!target) return false;
        return provider.models.some((row) => row.id.trim() === target);
    }

    async function fetchProviderModels(provider: CustomProviderForm): Promise<void> {
        const baseUrl = provider.baseUrl.trim();
        const apiKey = provider.apiKey.trim();
        if (!baseUrl || !apiKey) {
            error = "Please fill API Base URL and API Key before pulling models.";
            return;
        }

        loadingProviderModelsFor = provider.id;
        message = "";
        error = "";

        try {
            const res = await fetch("/api/settings/provider-models", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    protocol: provider.protocol,
                    baseUrl,
                    apiKey,
                    path: provider.path,
                }),
            });
            const data = (await res.json()) as {
                ok: boolean;
                models?: string[];
                error?: string;
            };
            if (!res.ok || !data.ok) {
                throw new Error(data.error || "Failed to pull provider models");
            }
            discoveredProviderModels = {
                ...discoveredProviderModels,
                [provider.id]: Array.isArray(data.models) ? data.models : [],
            };
            providerModelsPulled = {
                ...providerModelsPulled,
                [provider.id]: true,
            };
            const fetchedModels = Array.isArray(data.models) ? data.models : [];
            discoveredSelectedModel = {
                ...discoveredSelectedModel,
                [provider.id]: fetchedModels[0] ?? "",
            };
            message = `Pulled ${data.models?.length ?? 0} models from provider.`;
        } catch (e) {
            providerModelsPulled = {
                ...providerModelsPulled,
                [provider.id]: true,
            };
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loadingProviderModelsFor = "";
        }
    }

    function addDiscoveredModel(
        providerId: string,
        modelId: string,
    ): void {
        const normalized = modelId.trim();
        if (!normalized) return;
        updateProviderById(providerId, (provider) => {
            if (provider.models.some((row) => row.id.trim() === normalized)) {
                return provider;
            }
            return {
                ...provider,
                models: [
                    {
                        id: normalized,
                        tags: ["text"] as ModelCapabilityTag[],
                        supportedRoles: ["system", "user", "assistant", "tool"],
                    },
                    ...provider.models,
                ],
            };
        });
    }

    function selectedDiscoveredModel(providerId: string): string {
        return discoveredSelectedModel[providerId] ?? "";
    }

    async function testProviderModel(
        providerId: string,
        modelId: string,
    ): Promise<void> {
        const provider = form.customProviders.find((p) => p.id === providerId);
        if (!provider) return;
        const targetModel = modelId.trim();
        if (!targetModel) return;
        testingModelKey = modelTestKey(providerId, targetModel);
        setModelTestResult(providerId, targetModel);
        try {
            ensureProviderDefaults(provider);

            const res = await fetch("/api/settings/provider-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    protocol: provider.protocol,
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
            setModelTestResult(providerId, targetModel, {
                ok: data.ok,
                status: data.status,
                message: data.message,
            });
        } catch (e) {
            setModelTestResult(providerId, targetModel, {
                ok: false,
                status: null,
                message: e instanceof Error ? e.message : String(e),
            });
        } finally {
            testingModelKey = "";
        }
    }

    async function loadAll(): Promise<void> {
        loading = true;
        error = "";
        message = "";
        modelTestResults = {};
        discoveredProviderModels = {};

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
                    protocol: normalizeProviderProtocol((cp as any).protocol),
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
                                  contextWindow: typeof m.contextWindow === "number" && m.contextWindow > 0 ? m.contextWindow : undefined,
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
                    protocol: normalizeProviderProtocol(provider.protocol),
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
                        contextWindow: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : undefined,
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
</script>

<div class="providers-page">
    {#if loading}
        <p class="providers-loading">Loading providers...</p>
    {:else}
        <form
            id="providers-form"
            class="providers-form-grid"
            onsubmit={(e) => { e.preventDefault(); save(); }}
        >
            <!-- Providers List Pane -->
            <aside class="providers-sidebar">
                <div class="providers-sidebar-card">
                    <h2 class="providers-sidebar-title">Provider Source</h2>

                    <div class="providers-sidebar-tabs">
                        <button type="button" class="providers-sidebar-tab" class:providers-sidebar-tab--active={activeProviderTab === "builtin"} onclick={() => switchProviderTab("builtin")}>Built-in</button>
                        <button type="button" class="providers-sidebar-tab" class:providers-sidebar-tab--active={activeProviderTab === "custom"} onclick={() => switchProviderTab("custom")}>Custom</button>
                    </div>

                    {#if activeProviderTab === "builtin"}
                        <div class="providers-sidebar-info">Built-in providers are listed below. Enable them to add native transports to the routing pool.</div>
                    {:else}
                        <button type="button" class="providers-btn-outline" onclick={addCustomProvider}>+ Create Custom Provider</button>
                    {/if}

                    <input class="providers-sidebar-search" bind:value={providerSearch} placeholder="Search provider..." />

                    <div class="providers-sidebar-list">
                        {#if filteredCustomProviders().length === 0}
                            <div class="providers-sidebar-empty">No items matched</div>
                        {/if}

                        {#each filteredCustomProviders() as provider (provider.id)}
                            <button
                                type="button"
                                class="providers-sidebar-item"
                                class:providers-sidebar-item--selected={selectedProviderId === provider.id}
                                onclick={() => (selectedProviderId = provider.id)}
                            >
                                <div class="providers-sidebar-item-name">{provider.name}</div>
                                <div class="providers-sidebar-item-id">ID: {provider.id}</div>
                                <div class="providers-sidebar-item-badges">
                                    <span class="providers-sbadge">{provider.models.length} model{provider.models.length === 1 ? "" : "s"}</span>
                                    {#if form.defaultCustomProviderId === provider.id}
                                        <span class="providers-sbadge providers-sbadge--accent">Default</span>
                                    {/if}
                                    <span class="providers-sbadge" class:providers-sbadge--on={provider.enabled}>{provider.enabled ? "Enabled" : "Disabled"}</span>
                                    <span class="providers-sbadge" class:providers-sbadge--ok={hasUsableProviderConfig(provider)} class:providers-sbadge--err={!hasUsableProviderConfig(provider)}>{hasUsableProviderConfig(provider) ? "Available" : "Unavailable"}</span>
                                </div>
                            </button>
                        {/each}
                    </div>
                </div>
            </aside>

            <!-- Provider Edit Pane -->
            <section class="providers-detail-section">
                <div class="providers-detail-card">
                    {#if getSelectedProviderInActiveTab()}
                        {@const cp = getSelectedProviderInActiveTab()!}

                        <div class="providers-detail-header">
                            <h2 class="providers-detail-name">{cp.name || "Unnamed Provider"}</h2>
                            <div class="providers-detail-actions">
                                <label class="providers-toggle-label">
                                    <label class="switch">
                                        <input type="checkbox" checked={cp.enabled} onchange={() => setProviderEnabled(cp.id, !cp.enabled)} />
                                        <span class="slider"></span>
                                    </label>
                                    <span>{cp.enabled ? "Enabled" : "Disabled"}</span>
                                </label>
                                <button type="button" class="providers-btn-outline-sm" onclick={() => setAsDefaultProvider(cp.id)} disabled={isBuiltinProvider(cp) || form.defaultCustomProviderId === cp.id || !cp.enabled}>{form.defaultCustomProviderId === cp.id ? "Default" : "Set as Default"}</button>
                                {#if !isBuiltinProvider(cp)}
                                    <button type="button" class="providers-btn-danger-sm" onclick={() => removeCustomProvider(cp.id)}>Delete</button>
                                {/if}
                            </div>
                        </div>

                        <div class="providers-detail-form-grid">
                            <label class="providers-detail-form-label">
                                <span class="providers-detail-form-label-text">Provider ID</span>
                                <Input bind:value={cp.id} disabled={isBuiltinProvider(cp)} />
                            </label>

                            <label class="providers-detail-form-label">
                                <span class="providers-detail-form-label-text">Display Name</span>
                                <Input bind:value={cp.name} />
                            </label>
                            {#if isBuiltinProvider(cp)}
                                {@const authGuide = builtinAuthGuide(cp.id)}
                                <div class="providers-detail-notice md:col-span-2">
                                    Built-in provider detected. Protocol is managed by pi-ai natively; `baseUrl` and `path` are ignored.
                                </div>
                                <div class="providers-detail-auth md:col-span-2">
                                    <div class="providers-detail-auth-row">
                                        <span class="providers-detail-auth-label">Auth method:</span>
                                        <span class="providers-detail-auth-badge">{authGuide.modeLabel}</span>
                                    </div>
                                    <p class="providers-detail-auth-summary">{authGuide.summary}</p>
                                    {#if authGuide.command}
                                        <p class="providers-detail-auth-text">
                                            Login command: <code class="providers-detail-auth-code">{authGuide.command}</code>
                                        </p>
                                    {/if}
                                    {#if authGuide.tokenHint}
                                        <p class="providers-detail-auth-hint">{authGuide.tokenHint}</p>
                                    {/if}
                                    {#if authGuide.envVar}
                                        <p class="providers-detail-auth-text">
                                            Env variable: <code class="providers-detail-auth-code">{authGuide.envVar}</code>
                                        </p>
                                    {/if}
                                    <ol class="providers-detail-auth-steps">
                                        {#each authGuide.steps as step}
                                            <li>{step}</li>
                                        {/each}
                                    </ol>
                                    {#if authGuide.links && authGuide.links.length > 0}
                                        <div class="providers-detail-auth-links">
                                            {#each authGuide.links as link}
                                                <a class="providers-detail-auth-link" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                                {#if isOauthBuiltinProvider(cp)}
                                    <div class="providers-detail-oauth-notice md:col-span-2">
                                        OAuth provider: static API key input is hidden by design. Use the command above, then keep <code>auth.json</code> under <code>DATA_DIR</code> (or set <code>PI_AI_AUTH_FILE</code>).
                                    </div>
                                {:else}
                                    <label class="providers-detail-form-label md:col-span-2">
                                        <span class="providers-detail-form-label-text">API Key Override (Optional)</span>
                                        >
                                        <div class="providers-key-row">
                                            <Input
                                                class="providers-key-input"
                                                bind:value={cp.apiKey}
                                                type={showApiKey ? "text" : "password"}
                                                placeholder="Leave empty to use env/OAuth source"
                                            />
                                            <button type="button" class="providers-key-eye" onclick={() => showApiKey = !showApiKey} title={showApiKey ? "Hide" : "Show"}>
                                                {showApiKey ? "🙈" : "👁"}
                                            </button>
                                        </div>
                                    </label>
                                {/if}
                            {:else}
                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >Protocol</span
                                    >
                                    <NativeSelect
                                        
                                        value={cp.protocol}
                                        onchange={(event) =>
                                            setProviderProtocol(
                                                cp.id,
                                                normalizeProviderProtocol(
                                                    event.currentTarget.value,
                                                ),
                                            )}
                                    >
                                        <NativeSelectOption value="openai-compatible">
                                            OpenAI-compatible
                                        </NativeSelectOption>
                                        <NativeSelectOption value="anthropic">
                                            Anthropic Messages
                                        </NativeSelectOption>
                                    </NativeSelect>
                                </label>

                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >API Key</span
                                    >
                                    <div class="providers-key-row">
                                        <Input
                                            class="providers-key-input"
                                            bind:value={cp.apiKey}
                                            type={showApiKey ? "text" : "password"}
                                            placeholder="sk-..."
                                        />
                                        <button type="button" class="providers-key-eye" onclick={() => showApiKey = !showApiKey} title={showApiKey ? "Hide" : "Show"}>
                                            {showApiKey ? "🙈" : "👁"}
                                        </button>
                                    </div>
                                </label>

                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >API Base URL</span
                                    >
                                    <Input bind:value={cp.baseUrl} placeholder="https://api.openai.com" />
                                </label>

                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >Path Endpoint</span
                                    >
                                    <Input
                                        bind:value={cp.path}
                                        placeholder={defaultPathForProtocol(cp.protocol)}
                                    />
                                </label>

                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >Thinking Support</span
                                    >
                                    <NativeSelect  bind:value={cp.thinkingSupportMode}>
                                        <NativeSelectOption value="auto">
                                            Not enabled / unknown
                                        </NativeSelectOption>
                                        <NativeSelectOption value="enabled">
                                            Enabled
                                        </NativeSelectOption>
                                        <NativeSelectOption value="disabled">
                                            Disabled
                                        </NativeSelectOption>
                                    </NativeSelect>
                                </label>

                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >Thinking Format</span
                                    >
                                    <NativeSelect  bind:value={cp.thinkingFormat}>
                                        <NativeSelectOption value="auto">
                                            Auto / OpenAI fallback
                                        </NativeSelectOption>
                                        <NativeSelectOption value="openai">
                                            OpenAI `reasoning_effort`
                                        </NativeSelectOption>
                                        <NativeSelectOption value="openrouter">
                                            OpenRouter `reasoning.effort`
                                        </NativeSelectOption>
                                        <NativeSelectOption value="anthropic">
                                            Anthropic adaptive `thinking`
                                        </NativeSelectOption>
                                        <NativeSelectOption value="deepseek">
                                            DeepSeek `thinking.type` + `reasoning_effort`
                                        </NativeSelectOption>
                                        <NativeSelectOption value="zai">
                                            z.ai `enable_thinking`
                                        </NativeSelectOption>
                                        <NativeSelectOption value="qwen">
                                            Qwen `enable_thinking`
                                        </NativeSelectOption>
                                        <NativeSelectOption value="qwen-chat-template">
                                            Qwen
                                            `chat_template_kwargs.enable_thinking`
                                        </NativeSelectOption>
                                    </NativeSelect>
                                </label>

                                <div class="grid gap-3 text-sm md:col-span-2">
                                    {#if thinkingNotices(cp).length > 0}
                                        <div
                                            class={`rounded-xl border px-4 py-3 text-xs leading-5 md:col-span-2 ${
                                                cp.thinkingSupportMode === "enabled"
                                                    ? "border-[color-mix(in_oklab,hsl(38_84%_54%)_28%,var(--border))] bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] text-[color-mix(in_oklab,hsl(38_84%_44%)_72%,var(--foreground))]"
                                                    : "border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] text-muted-foreground"
                                            }`}
                                        >
                                            <div class="font-semibold text-foreground">
                                                Thinking behavior
                                            </div>
                                            <ul class="mt-2 space-y-1">
                                                {#each thinkingNotices(cp) as notice}
                                                    <li>{notice}</li>
                                                {/each}
                                            </ul>
                                        </div>
                                    {/if}

                                    {#if thinkingFormatUsesEffortMap(cp.thinkingFormat)}
                                        <div class="grid gap-2">
                                            <label
                                                class="grid gap-2 text-sm md:max-w-xs"
                                            >
                                                <span class="providers-detail-form-label-text"
                                                    >Reasoning Effort Mapping</span
                                                >
                                                <NativeSelect
                                                    
                                                    value={reasoningEffortMappingMode(
                                                        cp,
                                                    )}
                                                    onchange={(event) =>
                                                        setReasoningEffortMappingMode(
                                                            cp.id,
                                                            event.currentTarget
                                                                .value as ReasoningEffortMappingMode,
                                                        )}
                                                >
                                                    <NativeSelectOption value="auto">
                                                        Auto (recommended)
                                                    </NativeSelectOption>
                                                    <NativeSelectOption value="custom">
                                                        Custom override
                                                    </NativeSelectOption>
                                                </NativeSelect>
                                            </label>
                                            <p class="text-xs leading-5 text-muted-foreground">
                                                Auto maps low / medium / high for
                                                {thinkingFormatLabel(
                                                    cp.thinkingFormat,
                                                )}: {thinkingEffortLevels
                                                    .map(
                                                        (level) =>
                                                            `${level} -> ${autoReasoningEffortValue(
                                                                cp.thinkingFormat,
                                                                level,
                                                            )}`,
                                                    )
                                                    .join(", ")}.
                                            </p>
                                        </div>

                                        {#if reasoningEffortMappingMode(cp) === "custom"}
                                            <div class="grid gap-3 md:grid-cols-3">
                                                {#each thinkingEffortLevels as level}
                                                    <label
                                                        class="providers-detail-form-label"
                                                    >
                                                        <span
                                                            class="font-medium capitalize text-muted-foreground"
                                                            >{level}</span
                                                        >
                                                        <NativeSelect
                                                            
                                                            value={cp
                                                                .reasoningEffortMap[
                                                                level
                                                            ] ??
                                                                autoReasoningEffortValue(
                                                                    cp.thinkingFormat,
                                                                    level,
                                                                )}
                                                            onchange={(event) =>
                                                                setReasoningEffortMapValue(
                                                                    cp.id,
                                                                    level,
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )}
                                                        >
                                                            {#each reasoningEffortOptions(cp.thinkingFormat) as option}
                                                                <NativeSelectOption
                                                                    value={option}
                                                                >
                                                                    {option}
                                                                </NativeSelectOption>
                                                            {/each}
                                                        </NativeSelect>
                                                    </label>
                                                {/each}
                                            </div>
                                        {/if}
                                    {:else}
                                        <div class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-4 py-3 text-xs leading-5 text-muted-foreground">
                                            {thinkingFormatLabel(cp.thinkingFormat)}
                                            only toggles thinking on/off, so low
                                            / medium / high mapping is not sent
                                            for this format.
                                        </div>
                                    {/if}
                                </div>

                                <label class="providers-detail-form-label md:col-span-2">
                                    <span class="providers-detail-form-label-text"
                                        >API Signature / Key</span
                                    >
                                    <Input
                                        class="providers-key-input"
                                        bind:value={cp.apiKey}
                                        type="password"
                                        placeholder="sk-..."
                                    />
                                </label>
                            {/if}
                        </div>

                        <!-- Models Header -->
                        <div
                            class="mt-8 flex flex-col justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-center"
                        >
                            <h3 class="providers-section-title">
                                Model Registry
                            </h3>
                            <div class="flex gap-2">
                                {#if !isBuiltinProvider(cp)}
                                    <button
                                        type="button"
                                        class="providers-btn-outline"
                                        onclick={() => openPullModal(cp)}
                                        disabled={!cp.enabled}
                                    >
                                        Pull Models
                                    </button>
                                {/if}
                                <button
                                    type="button"
                                    class="providers-btn-primary-sm"
                                    onclick={() => openAddModelModal(cp.id)}
                                    disabled={!cp.enabled}
                                >
                                    + Add Model
                                </button>
                            </div>
                        </div>

                        {#if cp.models.length === 0}
                            <div class="providers-empty-models">
                                No models defined. Click "+ Add Model" to begin.
                            </div>
                        {:else}
                            <div class="providers-table-wrap">
                                <table class="providers-table">
                                    <thead>
                                        <tr>
                                            <th>Identifier</th>
                                            <th>Capabilities</th>
                                            <th>Context</th>
                                            <th class="text-center">Enabled</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each visibleModelRows(cp) as row (row.index)}
                                            {@const model = row.model}
                                            {@const index = row.index}
                                            <tr>
                                                <td>
                                                    <input
                                                        class="providers-table-input"
                                                        bind:value={model.id}
                                                        placeholder="e.g. gpt-4o"
                                                    />
                                                </td>
                                                <td>
                                                    <div class="providers-table-caps">
                                                        {#each capabilityTags as tag}
                                                            <button
                                                                type="button"
                                                                class="providers-cap-badge"
                                                                class:providers-cap-badge--on={model.tags.includes(tag)}
                                                                onclick={() => toggleTag(cp.id, index, tag)}
                                                            >
                                                                {tag.slice(0, 3).toUpperCase()}
                                                            </button>
                                                        {/each}
                                                    </div>
                                                </td>
                                                <td>
                                                    <input
                                                        class="providers-table-input providers-table-input--narrow"
                                                        type="number"
                                                        min="0"
                                                        step="1000"
                                                        placeholder="200k"
                                                        value={model.contextWindow ?? ""}
                                                        oninput={(e) => {
                                                            const v = Number((e.currentTarget as HTMLInputElement).value);
                                                            model.contextWindow = v > 0 ? v : undefined;
                                                        }}
                                                    />
                                                </td>
                                                <td class="text-center">
                                                    <label class="switch">
                                                        <input type="checkbox" checked={model.enabled !== false} onchange={() => { model.enabled = model.enabled === false ? true : false; }} />
                                                        <span class="slider"></span>
                                                    </label>
                                                </td>
                                                <td class="text-right">
                                                    <button type="button" class="providers-remove-btn" onclick={() => removeModel(cp.id, index)}>×</button>
                                                </td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        {/if}

                        {#if isBuiltinProvider(cp) && cp.models.length > collapsedBuiltinModelLimit}
                            <div class="mt-3 flex justify-center">
                                <button
                                    type="button"
                                    class="providers-btn-outline"
                                    onclick={() => toggleModelList(cp.id)}
                                >
                                    {expandedProviderModelIds.has(cp.id)
                                        ? "Collapse models"
                                        : `Show ${hiddenModelCount(cp)} more models`}
                                </button>
                            </div>
                        {/if}

                    {:else}
                        <div class="providers-empty-state">
                            <div class="providers-empty-state-icon">◈</div>
                            <h3>No Provider Selected</h3>
                            <p>
                                {#if activeProviderTab === "builtin"}
                                    Choose a built-in provider from the sidebar or add one above.
                                {:else}
                                    Choose a custom provider from the sidebar or create a new one.
                                {/if}
                            </p>
                        </div>
                    {/if}
                </div>
            </section>
        </form>

        <div class="settings-footbar">
            <div class="settings-footbar-status">
                {#if message}
                    <span class="settings-footbar-ok">{message}</span>
                {/if}
                {#if error}
                    <span class="settings-footbar-error">{error}</span>
                {/if}
            </div>
            <button type="submit" form="providers-form" class="settings-footbar-btn" disabled={saving}>
                {saving ? "Saving..." : "Save Providers"}
            </button>
        </div>
    {/if}

    <!-- ── Add Model Modal ── -->
    {#if showAddModelModal}
        <div class="providers-modal-backdrop" onclick={() => (showAddModelModal = false)} onkeydown={(e) => { if (e.key === 'Escape') showAddModelModal = false; }} role="dialog" aria-label="Add Model" tabindex="-1">
            <div class="providers-modal-card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
                <h3 class="providers-modal-title">Add Model</h3>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">Model ID</span>
                    <input class="providers-table-input" bind:value={addModelId} placeholder="e.g. gpt-4o, claude-sonnet-4-20250514" />
                </label>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">Context Window (tokens)</span>
                    <input class="providers-table-input" type="number" min="0" step="1000" placeholder="200000" value={addModelContextWindow ?? ""} oninput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); addModelContextWindow = v > 0 ? v : undefined; }} />
                </label>
                <div class="providers-modal-caps">
                    <span class="providers-detail-form-label-text">Capabilities</span>
                    <div class="providers-caps-grid">
                        {#each capabilityTags as tag}
                            <label class="providers-cap-check">
                                <Checkbox checked={addModelTags.includes(tag)} onCheckedChange={() => toggleAddModelTag(tag)} />
                                <span>{tag}</span>
                            </label>
                        {/each}
                    </div>
                </div>
                <div class="providers-modal-actions">
                    <button type="button" class="providers-btn-outline" onclick={() => (showAddModelModal = false)}>Cancel</button>
                    <button type="button" class="providers-btn-primary-sm" onclick={confirmAddModel} disabled={!addModelId.trim()}>Add Model</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- ── Pull Models Modal ── -->
    {#if showPullModal}
        <div class="providers-modal-backdrop" onclick={() => (showPullModal = false)} onkeydown={(e) => { if (e.key === 'Escape') showPullModal = false; }} role="dialog" aria-label="Pull Models" tabindex="-1">
            <div class="providers-modal-card providers-modal-card--wide" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
                <h3 class="providers-modal-title">Pull Models from Provider</h3>
                {#if loadingProviderModelsFor === pullTargetProviderId}
                    <p class="providers-modal-loading">Fetching models...</p>
                {:else if discoveredModels(pullTargetProviderId).length === 0}
                    <p class="providers-modal-loading">No models returned by this provider.</p>
                {:else}
                    <div class="providers-pull-list">
                        {#each discoveredModels(pullTargetProviderId) as remoteModelId}
                            {@const alreadyAdded = form.customProviders.find(p => p.id === pullTargetProviderId)?.models.some(m => m.id === remoteModelId) ?? false}
                            <div class="providers-pull-item">
                                <span class="providers-pull-item-name">{remoteModelId}</span>
                                {#if pullAddingModelId === remoteModelId}
                                    <div class="providers-pull-item-caps">
                                        {#each capabilityTags as tag}
                                            <label class="providers-cap-check">
                                                <Checkbox checked={pullAddingTags.includes(tag)} onCheckedChange={() => { const set = new Set(pullAddingTags); if (set.has(tag)) set.delete(tag); else set.add(tag); pullAddingTags = Array.from(set) as ModelCapabilityTag[]; if (pullAddingTags.length === 0) pullAddingTags = ["text"]; }} />
                                                <span>{tag}</span>
                                            </label>
                                        {/each}
                                        <button type="button" class="providers-btn-primary-sm" onclick={() => confirmPullAdd(remoteModelId)}>Confirm</button>
                                        <button type="button" class="providers-btn-outline" onclick={() => { pullAddingModelId = ""; }}>Cancel</button>
                                    </div>
                                {:else}
                                    <button type="button" class="providers-btn-outline" onclick={() => { pullAddingModelId = remoteModelId; pullAddingTags = ["text"]; }} disabled={alreadyAdded}>{alreadyAdded ? "Added" : "Add"}</button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
                <div class="providers-modal-actions">
                    <button type="button" class="providers-btn-outline" onclick={() => (showPullModal = false)}>Close</button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
  /* ── Page Shell ── */
  .providers-page { max-width: 56rem; display: flex; flex-direction: column; gap: 1.5rem; }
  .providers-loading { padding: 2.5rem 0; font-size: 0.875rem; color: var(--muted-foreground); }
  .providers-form-grid { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 1.5rem; }
  .providers-detail-section { flex: 1; min-width: 0; }
  .providers-detail-card {
    background: var(--card); border: 1px solid var(--border); border-radius: 0.625rem;
    padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.04);
    display: flex; flex-direction: column; gap: 1rem;
  }

  /* ── Sidebar ── */
  .providers-sidebar { width: 100%; flex-shrink: 0; }
  .providers-sidebar-card {
    position: sticky; top: 1.5rem;
    display: flex; flex-direction: column; gap: 1rem;
    padding: 1.25rem;
    background: var(--card); border: 1px solid var(--border); border-radius: 0.625rem;
    max-height: calc(100dvh - 9rem); overflow-y: auto;
  }
  .providers-sidebar-title { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-foreground); margin: 0; }
  .providers-sidebar-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .providers-sidebar-tab {
    padding: 0.5rem; border-radius: 0.375rem;
    border: 1px solid var(--border); background: transparent;
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--muted-foreground); cursor: pointer; transition: all 150ms ease;
  }
  .providers-sidebar-tab--active { background: var(--primary); color: var(--primary-foreground, oklch(99% 0 0)); border-color: var(--primary); }
  .providers-sidebar-info { border-radius: 0.5rem; border: 1px solid var(--border); background: var(--background); padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--muted-foreground); line-height: 1.5; }
  .providers-sidebar-search {
    width: 100%; padding: 0.5rem 0.75rem;
    border: 1px solid var(--border); border-radius: 0.375rem;
    background: var(--card); color: var(--foreground); font-size: 0.8125rem;
  }
  .providers-sidebar-search:focus { outline: none; border-color: var(--primary); }
  .providers-sidebar-list { display: flex; flex-direction: column; gap: 0.375rem; }
  .providers-sidebar-empty { padding: 0.5rem; text-align: center; font-size: 0.75rem; color: var(--muted-foreground); }
  .providers-sidebar-item {
    display: flex; flex-direction: column; gap: 0.25rem;
    padding: 0.75rem 1rem; border-radius: 0.375rem;
    border: none; background: transparent; cursor: pointer;
    text-align: left; width: 100%; transition: background 150ms ease;
  }
  .providers-sidebar-item:hover { background: var(--background); }
  .providers-sidebar-item--selected { background: var(--background); box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.05); }
  .providers-sidebar-item-name { font-size: 0.875rem; font-weight: 500; color: var(--foreground); }
  .providers-sidebar-item-id { font-size: 0.6875rem; color: var(--muted-foreground); }
  .providers-sidebar-item-badges { display: flex; align-items: center; gap: 0.375rem; margin-top: 0.25rem; flex-wrap: wrap; }

  /* ── Sidebar Badges ── */
  .providers-sbadge {
    display: inline-flex; padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem; font-size: 0.625rem; font-weight: 600;
    background: var(--background); color: var(--muted-foreground);
    border: 1px solid var(--border);
  }
  .providers-sbadge--accent { background: color-mix(in oklab, var(--primary) 12%, var(--card)); color: var(--primary); border-color: transparent; }
  .providers-sbadge--on { background: color-mix(in oklab, var(--primary) 8%, var(--card)); color: var(--primary); }
  .providers-sbadge--ok { color: oklch(50% 0.14 155); border-color: oklch(50% 0.14 155 / 0.3); background: oklch(50% 0.14 155 / 0.08); }
  .providers-sbadge--err { color: oklch(55% 0.2 25); border-color: oklch(55% 0.2 25 / 0.3); background: oklch(55% 0.2 25 / 0.08); }

  /* ── Detail Header ── */
  .providers-detail-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); }
  .providers-detail-name { font-family: var(--font-serif); font-size: 1.375rem; font-weight: 700; letter-spacing: -0.01em; color: var(--foreground); margin: 0; }
  .providers-detail-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .providers-toggle-label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; font-weight: 500; color: var(--foreground); cursor: pointer; user-select: none; }

  /* ── Detail Form ── */
  .providers-detail-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-top: 1.5rem; }
  .providers-detail-form-label { display: flex; flex-direction: column; gap: 0.375rem; }
  .providers-detail-form-label-text { font-size: 0.8125rem; font-weight: 500; color: var(--foreground); }

  /* ── Built-in Auth ── */
  .providers-detail-notice {
    border-radius: 0.5rem; padding: 0.75rem 1rem;
    border: 1px solid color-mix(in oklab, var(--primary) 24%, var(--border));
    background: color-mix(in oklab, var(--primary) 8%, var(--card));
    font-size: 0.75rem; line-height: 1.5;
    color: color-mix(in oklab, var(--primary) 70%, var(--foreground));
  }
  .providers-detail-auth {
    border-radius: 0.5rem; padding: 0.875rem 1rem;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--card) 70%, var(--background));
    font-size: 0.75rem; line-height: 1.6; color: var(--foreground);
  }
  .providers-detail-auth-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .providers-detail-auth-label { font-weight: 600; }
  .providers-detail-auth-badge {
    display: inline-flex; padding: 0.125rem 0.5rem;
    border-radius: 0.25rem; border: 1px solid var(--border);
    background: var(--background);
    font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .providers-detail-auth-summary { margin: 0 0 0.5rem; }
  .providers-detail-auth-text { margin: 0.5rem 0 0; }
  .providers-detail-auth-hint { margin: 0.5rem 0 0; color: var(--muted-foreground); }
  .providers-detail-auth-code { font-family: var(--font-mono); font-size: 0.75rem; padding: 0.0625rem 0.25rem; border-radius: 0.125rem; background: var(--background); }
  .providers-detail-auth-steps { margin: 0.5rem 0 0; padding-left: 1.25rem; list-style: decimal; display: flex; flex-direction: column; gap: 0.25rem; }
  .providers-detail-auth-links { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
  .providers-detail-auth-link { display: inline-flex; align-items: center; padding: 0.25rem 0.5rem; border-radius: 0.25rem; border: 1px solid color-mix(in oklab, var(--primary) 30%, var(--border)); background: color-mix(in oklab, var(--primary) 10%, var(--card)); font-size: 0.6875rem; color: color-mix(in oklab, var(--primary) 70%, var(--foreground)); text-decoration: none; transition: background 150ms ease; }
  .providers-detail-auth-link:hover { background: color-mix(in oklab, var(--primary) 16%, var(--card)); }
  .providers-detail-oauth-notice { border-radius: 0.5rem; padding: 0.75rem 1rem; border: 1px solid oklch(65% 0.15 60 / 0.25); background: oklch(65% 0.15 60 / 0.08); font-size: 0.75rem; line-height: 1.5; color: oklch(50% 0.12 60); }
  .providers-key-input { font-family: var(--font-mono); letter-spacing: 0.05em; }

  /* ── Section Header ── */
  .providers-section-title { font-family: var(--font-serif); font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; color: var(--foreground); margin: 0; line-height: 1.25; }

  /* ── API Key Eye ── */
  .providers-key-row { display: flex; align-items: center; gap: 0.375rem; }
  .providers-key-row :global(input) { flex: 1; }
  .providers-key-eye {
    display: flex; align-items: center; justify-content: center;
    width: 2.25rem; height: 2.25rem; border-radius: 0.375rem;
    border: 1px solid var(--border); background: transparent;
    cursor: pointer; font-size: 0.875rem; flex-shrink: 0; transition: background 150ms ease;
  }
  .providers-key-eye:hover { background: var(--background); }

  /* ── Model Table ── */
  .providers-table-wrap { margin-top: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden; }
  .providers-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  .providers-table thead { background: color-mix(in oklab, var(--card) 70%, var(--background)); }
  .providers-table th { padding: 0.625rem 0.875rem; text-align: left; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-foreground); border-bottom: 1px solid var(--border); }
  .providers-table td { padding: 0.5rem 0.875rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .providers-table tr:last-child td { border-bottom: none; }
  .providers-table-input { width: 100%; padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 0.25rem; background: var(--card); color: var(--foreground); font-family: var(--font-mono); font-size: 0.8125rem; transition: border-color 150ms ease; }
  .providers-table-input:focus { outline: none; border-color: var(--primary); }
  .providers-table-input--narrow { width: 5.5rem; text-align: right; }
  .providers-table-caps { display: flex; gap: 0.25rem; flex-wrap: wrap; }

  /* ── Capability Badges ── */
  .providers-cap-badge { display: inline-flex; align-items: center; padding: 0.125rem 0.375rem; border-radius: 0.25rem; border: 1px solid var(--border); background: transparent; color: var(--muted-foreground); font-size: 0.625rem; font-weight: 600; cursor: pointer; transition: all 150ms ease; }
  .providers-cap-badge:hover { border-color: var(--primary); }
  .providers-cap-badge--on { background: color-mix(in oklab, var(--primary) 12%, var(--card)); color: var(--primary); border-color: color-mix(in oklab, var(--primary) 30%, var(--border)); }

  /* ── Capability Checkboxes ── */
  .providers-caps-grid { display: flex; flex-wrap: wrap; gap: 0.5rem 0.875rem; }
  .providers-cap-check { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; font-weight: 500; color: var(--foreground); cursor: pointer; }

  /* ── Remove Button ── */
  .providers-remove-btn { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 0.25rem; border: 1px solid var(--border); background: transparent; color: var(--muted-foreground); font-size: 1rem; cursor: pointer; transition: all 150ms ease; }
  .providers-remove-btn:hover { border-color: oklch(55% 0.2 25); color: oklch(55% 0.2 25); background: oklch(55% 0.2 25 / 0.08); }

  /* ── Empty States ── */
  .providers-empty-models { margin-top: 1rem; border: 1px solid var(--border); border-radius: 0.5rem; padding: 2rem; text-align: center; font-size: 0.8125rem; color: var(--muted-foreground); }
  .providers-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5rem 1rem; text-align: center; }
  .providers-empty-state-icon { font-size: 2.5rem; opacity: 0.15; margin-bottom: 1rem; }
  .providers-empty-state h3 { font-size: 1.125rem; font-weight: 500; color: var(--foreground); margin: 0 0 0.5rem; }
  .providers-empty-state p { font-size: 0.8125rem; color: var(--muted-foreground); max-width: 16rem; margin: 0; }

  /* ── Buttons ── */
  .providers-btn-primary-sm { display: inline-flex; align-items: center; padding: 0.375rem 0.875rem; border-radius: 0.375rem; border: none; background: var(--primary); color: var(--primary-foreground, oklch(99% 0 0)); font-size: 0.8125rem; font-weight: 600; cursor: pointer; transition: opacity 160ms ease; }
  .providers-btn-primary-sm:hover:not(:disabled) { opacity: 0.88; }
  .providers-btn-primary-sm:disabled { opacity: 0.5; cursor: not-allowed; }
  .providers-btn-outline { display: inline-flex; align-items: center; padding: 0.375rem 0.875rem; border-radius: 0.375rem; border: 1px solid var(--border); background: transparent; color: var(--foreground); font-size: 0.8125rem; font-weight: 500; cursor: pointer; transition: all 150ms ease; }
  .providers-btn-outline:hover:not(:disabled) { background: var(--background); border-color: var(--muted-foreground); }
  .providers-btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }
  .providers-btn-outline-sm { display: inline-flex; align-items: center; padding: 0.375rem 0.75rem; border-radius: 0.375rem; border: 1px solid var(--border); background: transparent; color: var(--foreground); font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: all 150ms ease; }
  .providers-btn-outline-sm:hover:not(:disabled) { background: var(--background); }
  .providers-btn-outline-sm:disabled { opacity: 0.5; cursor: not-allowed; }
  .providers-btn-danger-sm { display: inline-flex; align-items: center; padding: 0.375rem 0.75rem; border-radius: 0.375rem; border: 1px solid oklch(55% 0.2 25 / 0.3); background: oklch(55% 0.2 25 / 0.06); color: oklch(55% 0.2 25); font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: all 150ms ease; }
  .providers-btn-danger-sm:hover { background: oklch(55% 0.2 25 / 0.12); }

  /* ── Modals ── */
  .providers-modal-backdrop {
    position: fixed; inset: 0; z-index: 50;
    display: flex; align-items: center; justify-content: center;
    background: oklch(20% 0 0 / 0.6); backdrop-filter: blur(4px);
    padding: 1rem;
  }
  .providers-modal-card {
    width: 100%; max-width: 28rem;
    background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem;
    padding: 1.5rem;
    display: flex; flex-direction: column; gap: 1rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    max-height: 85dvh; overflow-y: auto;
  }
  .providers-modal-card--wide { max-width: 40rem; }
  .providers-modal-title { font-family: var(--font-serif); font-size: 1.25rem; font-weight: 700; color: var(--foreground); margin: 0; }
  .providers-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  .providers-modal-caps { display: flex; flex-direction: column; gap: 0.375rem; }
  .providers-modal-loading { font-size: 0.8125rem; color: var(--muted-foreground); padding: 1rem 0; }

  /* ── Pull Models List ── */
  .providers-pull-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 50dvh; overflow-y: auto; }
  .providers-pull-item { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 0.375rem; }
  .providers-pull-item-name { font-family: var(--font-mono); font-size: 0.8125rem; color: var(--foreground); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .providers-pull-item-caps { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }

  /* ── Toggle Switch (iOS/macOS style) ── */
  .switch { position: relative; display: inline-block; width: 36px; height: 20px; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider {
    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
    background-color: var(--border); transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 20px;
  }
  .slider:before {
    position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px;
    background-color: white; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  input:checked + .slider { background-color: var(--primary); }
  input:checked + .slider:before { transform: translateX(16px); }

  /* ── Utility ── */
  .text-center { text-align: center; }
  .text-right { text-align: right; }

  /* ── Responsive ── */
  @media (max-width: 767px) {
    .providers-detail-form-grid { grid-template-columns: 1fr; }
    .providers-form-grid { grid-template-columns: 1fr; }
  }
</style>
