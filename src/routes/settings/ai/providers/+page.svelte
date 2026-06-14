<script lang="ts">
    import { onMount } from "svelte";
    import { Checkbox } from "$lib/components/ui/checkbox";
    import { Input } from "$lib/components/ui/input";
    import { IosSwitch } from "$lib/components/ui/ios-switch";
    import { Label } from "$lib/components/ui/label";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { Textarea } from "$lib/components/ui/textarea";
    import { locale } from "$lib/ui/i18n";

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
        enabled: boolean;
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

    const COPY = {
        "zh-CN": {
            eyebrow: "AI 引擎",
            title: "服务商与模型",
            desc: "配置 AI 推理服务商，管理模型注册表，并为文本、视觉、STT 和 TTS 能力配置路由。",
            backToRouting: "← 返回路由设置",
            loading: "正在加载服务商设置...",
            providerSource: "服务商来源",
            builtinTab: "内置",
            customTab: "自定义",
            builtinDesc: "内置服务商列表如下。启用它们以将原生传输通道加入路由池。",
            createCustomBtn: "+ 创建自定义服务商",
            searchPlaceholder: "搜索服务商...",
            noItemsMatched: "没有匹配的项",
            defaultTag: "默认",
            enabledStatus: "已启用",
            disabledStatus: "已禁用",
            availableStatus: "可用",
            unavailableStatus: "不可用",
            unnamedProvider: "未命名服务商",
            setAsDefaultBtn: "设为默认",
            deleteBtn: "删除",
            providerIdLabel: "服务商 ID",
            displayNameLabel: "显示名称",
            builtinNotice: "检测到内置服务商。协议由 pi-ai 原生管理；`baseUrl` 和 `path` 将被忽略。",
            authMethodLabel: "认证方式：",
            loginCmdLabel: "登录命令：",
            envVarLabel: "环境变量：",
            oauthNotice: "OAuth 服务商：静态 API Key 输入已隐藏。请使用上述命令，并在 DATA_DIR（或通过 PI_AI_AUTH_FILE）下保留 auth.json。",
            apiKeyOverrideLabel: "API Key 覆盖（可选）",
            apiKeyOverridePlaceholder: "留空则使用环境变量/OAuth 凭据",
            protocolLabel: "协议",
            apiKeyLabel: "API Key",
            apiBaseUrlLabel: "API 基准 URL",
            pathEndpointLabel: "接口路径 (Path Endpoint)",
            thinkingSupportLabel: "Thinking (思考推理) 支持",
            thinkingFormatLabel: "Thinking 格式",
            thinkingBehaviorTitle: "Thinking 行为表现",
            reasoningEffortMappingLabel: "推理力度映射",
            reasoningEffortMappingAuto: "自动 (推荐)",
            reasoningEffortMappingCustom: "自定义覆盖",
            reasoningEffortMappingDesc: "自动为 {format} 映射 low / medium / high: {levels}",
            thinkingFormatNotice: "{format} 仅支持开启/关闭 thinking，因此不会为此格式发送 low / medium / high 映射参数。",
            modelRegistryTitle: "模型注册表",
            pullModelsBtn: "拉取模型",
            addModelBtn: "+ 添加模型",
            noModelsDefined: "未定义模型。点击“+ 添加模型”开始。",
            identifierCol: "标识符",
            capabilitiesCol: "能力标签",
            contextCol: "上下文窗口",
            enabledCol: "启用状态",
            collapseModelsBtn: "收起模型",
            showMoreModelsBtn: "展示另外 {count} 个模型",
            noProviderSelectedTitle: "未选择服务商",
            noProviderSelectedBuiltinDesc: "从侧边栏选择一个内置服务商，或在上方添加一个。",
            noProviderSelectedCustomDesc: "从侧边栏选择一个自定义服务商，或创建一个新的。",
            addModelModalTitle: "添加模型",
            addModelIdLabel: "模型 ID",
            addModelCwLabel: "上下文窗口 (Tokens)",
            cancelBtn: "取消",
            confirmAddModelBtn: "添加模型",
            pullModelsModalTitle: "从服务商拉取模型",
            fetchingModels: "正在获取模型列表...",
            noModelsReturned: "此服务商未返回任何模型。",
            closeBtn: "关闭",
            saving: "保存中...",
            saveProvidersBtn: "保存服务商",
            deleteConfirm: "您确定要删除此自定义服务商吗？",
            fillFieldsError: "在拉取模型前，请先填写 API 基准 URL 和 API Key。",
            testFailed: "服务商测试失败",
            savedSuccess: "AI 设置已保存。",
            authGuides: {
                "openai-codex": {
                    modeLabel: "OAuth 登录",
                    summary: "使用 pi-ai 的设备登录流程获取 OpenAI Codex 授权，不需要在本页填写固定 API Key。",
                    tokenHint: "登录后会写入 auth.json；运行时会自动读取并按需刷新 token。",
                    steps: [
                        "在终端执行登录命令并按提示完成浏览器授权。",
                        "确认 auth.json 位于 DATA_DIR（默认 ~/.molibot）或通过 PI_AI_AUTH_FILE 指定路径。",
                        "返回本页仅管理模型与默认路由，无需填写 baseUrl/path。"
                    ]
                },
                "google-gemini-cli": {
                    modeLabel: "OAuth 登录",
                    summary: "Gemini CLI 使用 Google OAuth 授权链，优先使用 auth.json，不建议手填 API Key。",
                    tokenHint: "token 保存在 auth.json；运行时会自动读取并在过期时刷新。",
                    steps: [
                        "执行登录命令并在浏览器完成 Google 账号授权。",
                        "把 auth.json 放到 DATA_DIR（默认 ~/.molibot）或设置 PI_AI_AUTH_FILE。",
                        "授权完成后在本页只需配置模型与能力标签。"
                    ]
                },
                "google-antigravity": {
                    modeLabel: "OAuth 登录",
                    summary: "该提供商走 Google OAuth 授权，不通过 OpenAI 兼容 key/path 模式。",
                    tokenHint: "token 信息存储在 auth.json，并在运行时自动刷新。",
                    steps: [
                        "执行登录命令，完成浏览器设备授权流程。",
                        "确保 auth.json 在 DATA_DIR 或通过 PI_AI_AUTH_FILE 指向文件。",
                        "返回本页管理模型映射与默认模型。"
                    ]
                },
                "github-copilot": {
                    modeLabel: "OAuth 登录",
                    summary: "GitHub Copilot 通过 GitHub 账号 OAuth 授权，不是静态 API Key 方案。",
                    tokenHint: "授权后 token 保存在 auth.json，runner 会自动读取。",
                    steps: [
                        "执行命令后按终端提示完成 GitHub 登录授权。",
                        "确认 auth.json 的存放位置（DATA_DIR 或 PI_AI_AUTH_FILE）。",
                        "本页只维护模型清单、能力标注和默认模型。"
                    ]
                },
                "azure-openai-responses": {
                    modeLabel: "平台凭据",
                    summary: "Azure OpenAI 通常需要 endpoint + deployment + key/credential 组合，不是单一 API Key。",
                    steps: [
                        "在 Azure Portal 创建 OpenAI 资源并拿到 endpoint/deployment/key。",
                        "在运行环境配置 Azure 所需环境变量；本页只支持有限 key 覆盖。",
                        "建议先在服务端环境完成 Azure 配置，再在本页维护模型元数据。"
                    ]
                },
                "default": {
                    modeLabel: "API Key",
                    summary: "该 provider 使用 API Key 认证。你可以在本页填写覆盖值，或通过环境变量提供。",
                    steps: [
                        "去 provider 控制台创建/复制 API Key。",
                        "二选一：在本页填写 API Key，或在运行环境设置对应环境变量。",
                        "保存后用模型测试或实际对话验证。"
                    ]
                },
                "platform_default": {
                    modeLabel: "平台凭据",
                    summary: "该内置 provider 可能依赖平台侧凭据或多字段认证，请参考其官方文档配置运行环境。",
                    steps: [
                        "先确认该 provider 在 pi-ai 中需要的认证字段。",
                        "在运行环境完成必要凭据配置。",
                        "本页继续用于模型元数据和默认模型管理。"
                    ]
                }
            }
        },
        "en-US": {
            eyebrow: "AI Engine",
            title: "Providers & Models",
            desc: "Configure AI inference providers, manage model registries, and set up routing for text, vision, STT, and TTS capabilities.",
            backToRouting: "← Back to routing",
            loading: "Loading providers...",
            providerSource: "Provider Source",
            builtinTab: "Built-in",
            customTab: "Custom",
            builtinDesc: "Built-in providers are listed below. Enable them to add native transports to the routing pool.",
            createCustomBtn: "+ Create Custom Provider",
            searchPlaceholder: "Search provider...",
            noItemsMatched: "No items matched",
            defaultTag: "Default",
            enabledStatus: "Enabled",
            disabledStatus: "Disabled",
            availableStatus: "Available",
            unavailableStatus: "Unavailable",
            unnamedProvider: "Unnamed Provider",
            setAsDefaultBtn: "Set as Default",
            deleteBtn: "Delete",
            providerIdLabel: "Provider ID",
            displayNameLabel: "Display Name",
            builtinNotice: "Built-in provider detected. Protocol is managed by pi-ai natively; `baseUrl` and `path` are ignored.",
            authMethodLabel: "Auth method:",
            loginCmdLabel: "Login command:",
            envVarLabel: "Env variable:",
            oauthNotice: "OAuth provider: static API key input is hidden by design. Use the command above, then keep auth.json under DATA_DIR (or set PI_AI_AUTH_FILE).",
            apiKeyOverrideLabel: "API Key Override (Optional)",
            apiKeyOverridePlaceholder: "Leave empty to use env/OAuth source",
            protocolLabel: "Protocol",
            apiKeyLabel: "API Key",
            apiBaseUrlLabel: "API Base URL",
            pathEndpointLabel: "Path Endpoint",
            thinkingSupportLabel: "Thinking Support",
            thinkingFormatLabel: "Thinking Format",
            thinkingBehaviorTitle: "Thinking behavior",
            reasoningEffortMappingLabel: "Reasoning Effort Mapping",
            reasoningEffortMappingAuto: "Auto (recommended)",
            reasoningEffortMappingCustom: "Custom override",
            reasoningEffortMappingDesc: "Auto maps low / medium / high for {format}: {levels}",
            thinkingFormatNotice: "{format} only toggles thinking on/off, so low / medium / high mapping is not sent for this format.",
            modelRegistryTitle: "Model Registry",
            pullModelsBtn: "Pull Models",
            addModelBtn: "+ Add Model",
            noModelsDefined: "No models defined. Click \"+ Add Model\" to begin.",
            identifierCol: "Identifier",
            capabilitiesCol: "Capabilities",
            contextCol: "Context",
            enabledCol: "Enabled",
            collapseModelsBtn: "Collapse models",
            showMoreModelsBtn: "Show {count} more models",
            noProviderSelectedTitle: "No Provider Selected",
            noProviderSelectedBuiltinDesc: "Choose a built-in provider from the sidebar or add one above.",
            noProviderSelectedCustomDesc: "Choose a custom provider from the sidebar or create a new one.",
            addModelModalTitle: "Add Model",
            addModelIdLabel: "Model ID",
            addModelCwLabel: "Context Window (tokens)",
            cancelBtn: "Cancel",
            confirmAddModelBtn: "Add Model",
            pullModelsModalTitle: "Pull Models from Provider",
            fetchingModels: "Fetching models...",
            noModelsReturned: "No models returned by this provider.",
            closeBtn: "Close",
            saving: "Saving...",
            saveProvidersBtn: "Save Providers",
            deleteConfirm: "Are you sure you want to delete this custom provider?",
            fillFieldsError: "Please fill API Base URL and API Key before pulling models.",
            testFailed: "Provider test failed",
            savedSuccess: "AI Settings saved.",
            authGuides: {
                "openai-codex": {
                    modeLabel: "OAuth Login",
                    summary: "Use pi-ai's device login flow for OpenAI Codex authentication, no fixed API Key required.",
                    tokenHint: "Token is saved in auth.json; runtime reads and refreshes token as needed.",
                    steps: [
                        "Run login command in terminal and complete browser authorization.",
                        "Verify auth.json is in DATA_DIR (default ~/.molibot) or configured via PI_AI_AUTH_FILE.",
                        "Return here to manage models and routing. No baseUrl/path needed."
                    ]
                },
                "google-gemini-cli": {
                    modeLabel: "OAuth Login",
                    summary: "Gemini CLI uses Google OAuth chain, prefers auth.json, API Key input not recommended.",
                    tokenHint: "Token is saved in auth.json; runtime reads and refreshes on expiration.",
                    steps: [
                        "Run login command and authorize in the browser.",
                        "Place auth.json in DATA_DIR (default ~/.molibot) or set PI_AI_AUTH_FILE.",
                        "Once authenticated, configure models and capabilities here."
                    ]
                },
                "google-antigravity": {
                    modeLabel: "OAuth Login",
                    summary: "Uses Google OAuth authorization, not OpenAI compatible key/path mode.",
                    tokenHint: "Token info stored in auth.json and auto-refreshed at runtime.",
                    steps: [
                        "Run login command and complete browser device authorization.",
                        "Ensure auth.json is in DATA_DIR or pointed to by PI_AI_AUTH_FILE.",
                        "Return here to manage model registry and default model."
                    ]
                },
                "github-copilot": {
                    modeLabel: "OAuth Login",
                    summary: "GitHub Copilot auth goes through GitHub OAuth flow, not static API Keys.",
                    tokenHint: "Token is saved in auth.json, read automatically by the runner.",
                    steps: [
                        "Run command and complete GitHub login authorization.",
                        "Confirm auth.json path (DATA_DIR or PI_AI_AUTH_FILE).",
                        "Maintain model listings, capability tags, and default model here."
                    ]
                },
                "azure-openai-responses": {
                    modeLabel: "Credentials",
                    summary: "Azure OpenAI requires endpoint + deployment + key/credential, not a single API Key.",
                    steps: [
                        "Create OpenAI resource in Azure Portal and obtain endpoint/deployment/key.",
                        "Set Azure environment variables in runtime; page supports limited key overrides.",
                        "Configure Azure environment first, then maintain model metadata on this page."
                    ]
                },
                "default": {
                    modeLabel: "API Key",
                    summary: "Authenticates with an API Key. You can specify overrides here or provide it via environment variables.",
                    steps: [
                        "Create/Copy API Key from provider console.",
                        "Either enter API Key here, or set corresponding environment variables in runtime.",
                        "Save and verify using model tests or chat."
                    ]
                },
                "platform_default": {
                    modeLabel: "Platform Credentials",
                    summary: "May require platform-side credentials or multi-field authentication, please consult official docs.",
                    steps: [
                        "Identify required authentication fields in pi-ai.",
                        "Set up necessary credentials in your runtime environment.",
                        "Use this page to manage model metadata and default models."
                    ]
                }
            }
        }
    } as const;

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

    $: copy = COPY[$locale] ?? COPY["en-US"];

    // Reactive derivations. The helper functions read activeProviderTab /
    // selectedProviderId / providerSearch / form internally; in legacy mode a
    // bare `{#each fn()}` would NOT track those reads, so we reference the
    // dependencies explicitly here to force recomputation on change.
    $: filteredProviders =
        (form.customProviders,
        activeProviderTab,
        providerSearch,
        filteredCustomProviders());
    $: selectedProviderDetail =
        (form.customProviders,
        selectedProviderId,
        activeProviderTab,
        providerSearch,
        getSelectedProviderInActiveTab());
    $: visibleModels = selectedProviderDetail
        ? (expandedProviderModelIds, visibleModelRows(selectedProviderDetail))
        : [];

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
        const guides = copy.authGuides;
        const guideTemplate = providerId === "openai-codex" ? guides["openai-codex"]
            : providerId === "google-gemini-cli" ? guides["google-gemini-cli"]
            : providerId === "google-antigravity" ? guides["google-antigravity"]
            : providerId === "github-copilot" ? guides["github-copilot"]
            : providerId === "azure-openai-responses" ? guides["azure-openai-responses"]
            : null;

        if (guideTemplate) {
            const mode = providerId === "azure-openai-responses" ? "platform" : "oauth";
            return {
                mode,
                modeLabel: guideTemplate.modeLabel,
                summary: guideTemplate.summary,
                command: (guideTemplate as any).command,
                tokenHint: (guideTemplate as any).tokenHint,
                steps: guideTemplate.steps,
                links: providerId === "openai-codex" ? [{ label: "OpenAI Platform", url: "https://platform.openai.com/" }]
                     : providerId === "google-gemini-cli" ? [{ label: "Google AI Studio", url: "https://aistudio.google.com/" }]
                     : providerId === "google-antigravity" ? [{ label: "Google Cloud", url: "https://console.cloud.google.com/" }]
                     : providerId === "github-copilot" ? [{ label: "GitHub Copilot", url: "https://github.com/features/copilot" }]
                     : providerId === "azure-openai-responses" ? [{ label: "Azure OpenAI Docs", url: "https://learn.microsoft.com/azure/ai-services/openai/" }]
                     : undefined
            };
        }

        const envVar = providerEnvVar(providerId);
        if (envVar) {
            return {
                mode: "api_key",
                modeLabel: guides.default.modeLabel,
                summary: guides.default.summary,
                envVar,
                steps: guides.default.steps
            };
        }

        return {
            mode: "platform",
            modeLabel: guides.platform_default.modeLabel,
            summary: guides.platform_default.summary,
            steps: guides.platform_default.steps
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
                          enabled: true,
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
                          enabled: (m as any).enabled !== false,
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

    async function removeCustomProvider(id: string): Promise<void> {
        const target = form.customProviders.find((p) => p.id === id);
        if (target && isBuiltinProvider(target)) return;

        if (!confirm(copy.deleteConfirm)) return;

        try {
            const res = await fetch(`/api/settings/custom-providers?id=${id}`, {
                method: "DELETE"
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Failed to delete custom provider");

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
            message = "Provider deleted.";
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
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
                    enabled: true,
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
                    enabled: true,
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
        void fetchProviderModels(provider);
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

    function setProviderId(newId: string): void {
        const oldId = selectedProviderId;
        if (!oldId) return;
        form.customProviders = form.customProviders.map((p) =>
            p.id === oldId ? { ...p, id: newId } : p,
        );
        if (form.defaultCustomProviderId === oldId) {
            form.defaultCustomProviderId = newId;
        }
        selectedProviderId = newId;
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
            return copy.locale === "zh-CN"
                ? ["未启用 / 未知，不会自动探测；当前运行时不会给这个 provider 发送 thinking 参数。"]
                : ["Not enabled / unknown; runtime will not send thinking parameters to this provider."];
        }
        if (provider.thinkingSupportMode === "disabled") {
            return copy.locale === "zh-CN"
                ? ["Thinking 已明确关闭；全局或会话思索深度会被降为 off。"]
                : ["Thinking is explicitly disabled; global or session reasoning effort falls back to off."];
        }

        const notices = copy.locale === "zh-CN"
            ? [`Thinking 已启用；非 off 请求会按 ${thinkingFormatLabel(provider.thinkingFormat)} 发送参数。`]
            : [`Thinking is enabled; non-off requests send parameters via ${thinkingFormatLabel(provider.thinkingFormat)}.`];
        
        if (provider.thinkingFormat === "auto") {
            notices.push(copy.locale === "zh-CN"
                ? "Format 保持 Auto 时实际会走 OpenAI-style reasoning_effort。若上游不是这种协议，建议明确选择格式或关闭。"
                : "Format set to Auto defaults to OpenAI-style reasoning_effort. If the upstream provider uses a different protocol, please select it explicitly.");
        }
        if (provider.models.length > 1) {
            notices.push(copy.locale === "zh-CN"
                ? "这组 thinking 配置作用于该 provider 下所有模型；如果不同模型来自不同厂商或协议，建议拆成多个 provider。"
                : "This thinking config applies to all models under this provider. If different models use different backends, split them into separate custom providers.");
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
            error = copy.fillFieldsError;
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
                        enabled: true,
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
            if (!res.ok) throw new Error(data.error || copy.testFailed);

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
                fetch("/api/settings/custom-providers"),
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

            const s = settingsData;
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
                                  enabled: m.enabled !== false,
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

            // 1. If a provider is selected and edited, save it individually via fine-grained API.
            //    Built-in providers are persisted too so enabling/model edits take effect.
            const selected = getSelectedProvider();
            if (selected) {
                const normalizedProvider = {
                    ...selected,
                    protocol: normalizeProviderProtocol(selected.protocol),
                    supportsThinking:
                        selected.thinkingSupportMode === "auto"
                            ? undefined
                            : selected.thinkingSupportMode === "enabled",
                    thinkingFormat:
                        selected.thinkingFormat === "auto"
                            ? undefined
                            : selected.thinkingFormat,
                    reasoningEffortMap: Object.fromEntries(
                        Object.entries(selected.reasoningEffortMap ?? {}).filter(
                            ([, value]) =>
                                String(value ?? "").trim().length > 0,
                        ),
                    ),
                    models: selected.models.map((model) => ({
                        id: model.id.trim(),
                        tags: [...model.tags],
                        supportedRoles: [...model.supportedRoles],
                        contextWindow: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : undefined,
                        enabled: model.enabled !== false,
                        verification:
                            model.verification &&
                            Object.keys(model.verification).length > 0
                                ? { ...model.verification }
                                : {},
                    })),
                };
                const res = await fetch("/api/settings/custom-providers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ provider: normalizedProvider }),
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || "Failed to save custom provider");
            }

            // 2. Save global settings (providerMode, piModelProvider, piModelName, defaultCustomProviderId) using PUT /api/settings/custom-providers
            const globalPayload = {
                providerMode: form.providerMode,
                piModelProvider: form.piModelProvider,
                piModelName: form.piModelName,
                defaultCustomProviderId: form.defaultCustomProviderId,
            };

            const res = await fetch("/api/settings/custom-providers", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(globalPayload),
            });
            const data = await res.json();
            if (!data.ok)
                throw new Error(data.error || "Failed to save AI settings");
            message = copy.savedSuccess;
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
  <!-- Hero Header -->
  <header class="providers-hero">
    <span class="providers-badge">{copy.eyebrow}</span>
    <h1 class="providers-hero-title">{copy.title}</h1>
    <p class="providers-hero-desc">
      {copy.desc}
    </p>
    <a class="providers-hero-link" href="/settings/ai/routing">{copy.backToRouting}</a>
  </header>
    {#if loading}
        <p class="providers-loading">{copy.loading}</p>
    {:else}
        <form
            id="providers-form"
            class="providers-form-grid"
            onsubmit={(e) => { e.preventDefault(); void save(); }}
        >
            <!-- Providers List Pane -->
            <aside class="providers-sidebar">
                <div class="providers-sidebar-card">
                    <h2 class="providers-sidebar-title">{copy.providerSource}</h2>

                    <div class="providers-sidebar-tabs">
                        <button type="button" class="providers-sidebar-tab" class:providers-sidebar-tab--active={activeProviderTab === "builtin"} onclick={() => switchProviderTab("builtin")}>{copy.builtinTab}</button>
                        <button type="button" class="providers-sidebar-tab" class:providers-sidebar-tab--active={activeProviderTab === "custom"} onclick={() => switchProviderTab("custom")}>{copy.customTab}</button>
                    </div>

                    {#if activeProviderTab === "builtin"}
                        <div class="providers-sidebar-info">{copy.builtinDesc}</div>
                    {:else}
                        <button type="button" class="providers-btn-outline" onclick={addCustomProvider}>{copy.createCustomBtn}</button>
                    {/if}

                    <input class="providers-sidebar-search" bind:value={providerSearch} placeholder={copy.searchPlaceholder} />

                    <div class="providers-sidebar-list">
                        {#if filteredProviders.length === 0}
                            <div class="providers-sidebar-empty">{copy.noItemsMatched}</div>
                        {/if}

                        {#each filteredProviders as provider (provider.id)}
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
                                        <span class="providers-sbadge providers-sbadge--accent">{copy.defaultTag}</span>
                                    {/if}
                                    <span class="providers-sbadge" class:providers-sbadge--on={provider.enabled}>{provider.enabled ? copy.enabledStatus : copy.disabledStatus}</span>
                                    <span class="providers-sbadge" class:providers-sbadge--ok={hasUsableProviderConfig(provider)} class:providers-sbadge--err={!hasUsableProviderConfig(provider)}>{hasUsableProviderConfig(provider) ? copy.availableStatus : copy.unavailableStatus}</span>
                                </div>
                            </button>
                        {/each}
                    </div>
                </div>
            </aside>

            <!-- Provider Edit Pane -->
            <section class="providers-detail-section">
                <div class="providers-detail-card">
                    {#if selectedProviderDetail}
                        {@const cp = selectedProviderDetail!}

                        <div class="providers-detail-header">
                            <h2 class="providers-detail-name">{cp.name || copy.unnamedProvider}</h2>
                            <div class="providers-detail-actions">
                                <label class="providers-toggle-label">
                                    <IosSwitch checked={cp.enabled} onCheckedChange={(val) => setProviderEnabled(cp.id, val)} />
                                    <span>{cp.enabled ? copy.enabledStatus : copy.disabledStatus}</span>
                                </label>
                                <button type="button" class="providers-btn-outline-sm" onclick={() => setAsDefaultProvider(cp.id)} disabled={isBuiltinProvider(cp) || form.defaultCustomProviderId === cp.id || !cp.enabled}>{form.defaultCustomProviderId === cp.id ? copy.defaultTag : copy.setAsDefaultBtn}</button>
                                {#if !isBuiltinProvider(cp)}
                                    <button type="button" class="providers-btn-danger-sm" onclick={() => removeCustomProvider(cp.id)}>{copy.deleteBtn}</button>
                                {/if}
                            </div>
                        </div>

                        <div class="providers-detail-form-grid">
                            <label class="providers-detail-form-label">
                                <span class="providers-detail-form-label-text">{copy.providerIdLabel}</span>
                                <Input value={cp.id} disabled={isBuiltinProvider(cp)} oninput={(e) => setProviderId(e.currentTarget.value)} />
                            </label>

                            <label class="providers-detail-form-label">
                                <span class="providers-detail-form-label-text">{copy.displayNameLabel}</span>
                                <Input bind:value={cp.name} />
                            </label>
                            {#if isBuiltinProvider(cp)}
                                {@const authGuide = builtinAuthGuide(cp.id)}
                                <div class="providers-detail-notice md:col-span-2">
                                    {copy.builtinNotice}
                                </div>
                                <div class="providers-detail-auth md:col-span-2">
                                    <div class="providers-detail-auth-row">
                                        <span class="providers-detail-auth-label">{copy.authMethodLabel}</span>
                                        <span class="providers-detail-auth-badge">{authGuide.modeLabel}</span>
                                    </div>
                                    <p class="providers-detail-auth-summary">{authGuide.summary}</p>
                                    {#if authGuide.command}
                                        <p class="providers-detail-auth-text">
                                            {copy.loginCmdLabel} <code class="providers-detail-auth-code">{authGuide.command}</code>
                                        </p>
                                    {/if}
                                    {#if authGuide.tokenHint}
                                        <p class="providers-detail-auth-hint">{authGuide.tokenHint}</p>
                                    {/if}
                                    {#if authGuide.envVar}
                                        <p class="providers-detail-auth-text">
                                            {copy.envVarLabel} <code class="providers-detail-auth-code">{authGuide.envVar}</code>
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
                                        {copy.oauthNotice}
                                    </div>
                                {:else}
                                    <label class="providers-detail-form-label md:col-span-2">
                                        <span class="providers-detail-form-label-text">{copy.apiKeyOverrideLabel}</span>
                                        <div class="providers-key-row">
                                            <Input
                                                class="providers-key-input"
                                                bind:value={cp.apiKey}
                                                type={showApiKey ? "text" : "password"}
                                                placeholder={copy.apiKeyOverridePlaceholder}
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
                                        >{copy.protocolLabel}</span
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
                                        >{copy.apiKeyLabel}</span
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
                                        >{copy.apiBaseUrlLabel}</span
                                    >
                                    <Input bind:value={cp.baseUrl} placeholder="https://api.openai.com" />
                                </label>

                                <label
                                    class="providers-detail-form-label md:col-span-2 xl:col-span-1"
                                >
                                    <span class="providers-detail-form-label-text"
                                        >{copy.pathEndpointLabel}</span
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
                                        >{copy.thinkingSupportLabel}</span
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
                                        >{copy.thinkingFormatLabel}</span
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
                                            Qwen `chat_template_kwargs.enable_thinking`
                                        </NativeSelectOption>
                                    </NativeSelect>
                                </label>

                                <div class="providers-thinking-section">
                                    {#if thinkingNotices(cp).length > 0}
                                        <div
                                            class={`providers-thinking-notice ${
                                                cp.thinkingSupportMode === "enabled"
                                                    ? "providers-thinking-notice--enabled"
                                                    : "providers-thinking-notice--default"
                                            }`}
                                        >
                                            <div class="providers-thinking-notice-title">
                                                {copy.thinkingBehaviorTitle}
                                            </div>
                                            <ul class="providers-thinking-notice-list">
                                                {#each thinkingNotices(cp) as notice}
                                                    <li>{notice}</li>
                                                {/each}
                                            </ul>
                                        </div>
                                    {/if}

                                    {#if thinkingFormatUsesEffortMap(cp.thinkingFormat)}
                                        <div class="providers-effort-mapping-label">
                                                <span class="providers-detail-form-label-text"
                                                    >{copy.reasoningEffortMappingLabel}</span
                                                >
                                                <NativeSelect
                                                    value={reasoningEffortMappingMode(cp)}
                                                    onchange={(event) =>
                                                        setReasoningEffortMappingMode(
                                                            cp.id,
                                                            event.currentTarget
                                                                .value as ReasoningEffortMappingMode,
                                                        )}
                                                >
                                                    <NativeSelectOption value="auto">
                                                        {copy.reasoningEffortMappingAuto}
                                                    </NativeSelectOption>
                                                    <NativeSelectOption value="custom">
                                                        {copy.reasoningEffortMappingCustom}
                                                    </NativeSelectOption>
                                                </NativeSelect>
                                            <p class="providers-effort-mapping-desc">
                                                {copy.reasoningEffortMappingDesc
                                                    .replace("{format}", thinkingFormatLabel(cp.thinkingFormat))
                                                    .replace("{levels}", thinkingEffortLevels.map((level) => `${level} -> ${autoReasoningEffortValue(cp.thinkingFormat, level)}`).join(", "))}
                                            </p>
                                        </div>

                                        {#if reasoningEffortMappingMode(cp) === "custom"}
                                            <div class="providers-effort-levels">
                                                {#each thinkingEffortLevels as level}
                                                    <label
                                                        class="providers-detail-form-label"
                                                    >
                                                        <span
                                                            class="providers-effort-level-label"
                                                            >{level}</span
                                                        >
                                                        <NativeSelect
                                                            value={cp.reasoningEffortMap[level] ?? autoReasoningEffortValue(cp.thinkingFormat, level)}
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
                                        <div class="providers-thinking-notice providers-thinking-notice--default">
                                            {copy.thinkingFormatNotice.replace("{format}", thinkingFormatLabel(cp.thinkingFormat))}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>

                        <!-- Models Header -->
                        <div class="providers-models-header">
                            <h3 class="providers-section-title">
                                {copy.modelRegistryTitle}
                            </h3>
                            <div class="flex gap-2">
                                {#if !isBuiltinProvider(cp)}
                                    <button
                                        type="button"
                                        class="providers-btn-outline"
                                        onclick={() => openPullModal(cp)}
                                        disabled={!cp.enabled}
                                    >
                                        {copy.pullModelsBtn}
                                    </button>
                                {/if}
                                <button
                                    type="button"
                                    class="providers-btn-primary-sm"
                                    onclick={() => openAddModelModal(cp.id)}
                                    disabled={!cp.enabled}
                                >
                                    {copy.addModelBtn}
                                </button>
                            </div>
                        </div>

                        {#if cp.models.length === 0}
                            <div class="providers-empty-models">
                                {copy.noModelsDefined}
                            </div>
                        {:else}
                            <div class="providers-table-wrap">
                                <table class="providers-table">
                                    <thead>
                                        <tr>
                                            <th>{copy.identifierCol}</th>
                                            <th>{copy.capabilitiesCol}</th>
                                            <th>{copy.contextCol}</th>
                                            <th class="text-center">{copy.enabledCol}</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each visibleModels as row (row.index)}
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
                                                    <IosSwitch
                                                        checked={model.enabled !== false}
                                                        onCheckedChange={(val) => { model.enabled = val; }}
                                                    />
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
                            <div class="providers-models-expand">
                                <button
                                    type="button"
                                    class="providers-btn-outline"
                                    onclick={() => toggleModelList(cp.id)}
                                >
                                    {expandedProviderModelIds.has(cp.id)
                                        ? copy.collapseModelsBtn
                                        : copy.showMoreModelsBtn.replace("{count}", String(hiddenModelCount(cp)))}
                                </button>
                            </div>
                        {/if}

                    {:else}
                        <div class="providers-empty-state">
                            <div class="providers-empty-state-icon">◈</div>
                            <h3>{copy.noProviderSelectedTitle}</h3>
                            <p>
                                {#if activeProviderTab === "builtin"}
                                    {copy.noProviderSelectedBuiltinDesc}
                                {:else}
                                    {copy.noProviderSelectedCustomDesc}
                                {/if}
                            </p>
                        </div>
                    {/if}
                </div>
            </section>
        </form>
    {/if}

    <!-- ── Add Model Modal ── -->
    {#if showAddModelModal}
        <div class="providers-modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showAddModelModal = false; }} onkeydown={(e) => { if (e.key === 'Escape') showAddModelModal = false; }} role="dialog" aria-label="Add Model" tabindex="-1">
            <div class="providers-modal-card">
                <h3 class="providers-modal-title">{copy.addModelModalTitle}</h3>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">{copy.addModelIdLabel}</span>
                    <input class="providers-table-input" bind:value={addModelId} placeholder="e.g. gpt-4o, claude-sonnet-4-20250514" />
                </label>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">{copy.addModelCwLabel}</span>
                    <input class="providers-table-input" type="number" min="0" step="1000" placeholder="200000" value={addModelContextWindow ?? ""} oninput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); addModelContextWindow = v > 0 ? v : undefined; }} />
                </label>
                <div class="providers-modal-caps">
                    <span class="providers-detail-form-label-text">{copy.capabilitiesCol}</span>
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
                    <button type="button" class="providers-btn-outline" onclick={() => (showAddModelModal = false)}>{copy.cancelBtn}</button>
                    <button type="button" class="providers-btn-primary-sm" onclick={confirmAddModel} disabled={!addModelId.trim()}>{copy.confirmAddModelBtn}</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- ── Pull Models Modal ── -->
    {#if showPullModal}
        <div class="providers-modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showPullModal = false; }} onkeydown={(e) => { if (e.key === 'Escape') showPullModal = false; }} role="dialog" aria-label="Pull Models" tabindex="-1">
            <div class="providers-modal-card providers-modal-card--wide">
                <h3 class="providers-modal-title">{copy.pullModelsModalTitle}</h3>
                {#if loadingProviderModelsFor === pullTargetProviderId}
                    <p class="providers-modal-loading">{copy.fetchingModels}</p>
                {:else if discoveredModels(pullTargetProviderId).length === 0}
                    <p class="providers-modal-loading">{copy.noModelsReturned}</p>
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
                    <button type="button" class="providers-btn-outline" onclick={() => (showPullModal = false)}>{copy.closeBtn}</button>
                </div>
            </div>
        </div>
    {/if}
</div>

{#if !loading}
    <footer class="settings-footbar">
        <div class="settings-footbar-status">
            {#if message}
                <span class="settings-footbar-ok">{message}</span>
            {/if}
            {#if error}
                <span class="settings-footbar-error">{error}</span>
            {/if}
        </div>
        <button type="submit" form="providers-form" class="settings-footbar-btn" disabled={saving}>
            {saving ? copy.saving : copy.saveProvidersBtn}
        </button>
    </footer>
{/if}
