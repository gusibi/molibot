<script lang="ts">
    import { onMount } from "svelte";
    import { Checkbox } from "$lib/components/ui/checkbox";
    import { Input } from "$lib/components/ui/input";
    import { IosSwitch } from "$lib/components/ui/ios-switch";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { Eye, EyeOff } from "@lucide/svelte";
    import type {
        DesktopProviderAuthItem,
        DesktopProviderAuthOverviewResponse,
        DesktopProviderAuthSession,
        DesktopProviderAuthSessionResponse,
    } from "$lib/shared/desktop";
    import { locale } from "$lib/ui/i18n";

    type ProviderMode = "pi" | "custom";
    type CustomProviderProtocol = "openai-compatible" | "anthropic";
    type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
    type ThinkingFormat =
        | "auto"
        | "openai"
        | "openrouter"
        | "anthropic"
        | "deepseek"
        | "zai"
        | "qwen"
        | "qwen-chat-template";
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
        alias?: string;
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
        thinkingFormat: ThinkingFormat;
    }

    interface AIForm {
        providerMode: ProviderMode;
        piModelProvider: string;
        piModelName: string;
        defaultCustomProviderId: string;
        customProviders: CustomProviderForm[];
        modelRouting: {
            textModelKey: string;
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
            modelTabBuiltin: "内置模型",
            modelTabCustom: "自建模型",
            modelSearchPlaceholder: "搜索模型 ID...",
            modelSortActive: "已启用优先",
            modelSortDefault: "默认排序",
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
            providerAuthTitle: "快捷登录",
            providerAuthHint: "直接在这里完成账号授权；凭据会安全保存在服务端，并由运行时自动刷新。",
            providerAuthConnected: "已登录",
            providerAuthNotConnected: "未登录",
            providerAuthEffective: "当前认证来源：{source}",
            providerAuthSignIn: "立即登录",
            providerAuthSignOut: "退出登录",
            providerAuthDialogHint: "按提示打开链接、输入设备码，或粘贴回调地址。远程部署时请优先使用设备码或手动粘贴。",
            providerAuthWaiting: "等待授权完成…",
            providerAuthOpenBrowser: "打开授权页面",
            providerAuthDeviceCode: "设备码",
            providerAuthCopyCode: "复制设备码",
            providerAuthCodeCopied: "已复制",
            providerAuthContinue: "继续",
            providerAuthAnswerPlaceholder: "输入答案或粘贴回调 URL",
            providerAuthDone: "登录成功，凭据已保存。",
            providerAuthFailed: "登录失败",
            providerAuthCancelled: "登录已取消",
            providerAuthExpired: "登录会话已过期，请重新开始。",
            providerAuthOverrideWarning: "下方保存的「API Key 覆盖」优先于 OAuth 凭据：清空它之后，这里的登录才会真正生效。",
            providerAuthVerify: "测试连通性",
            providerAuthVerifying: "测试中…",
            providerAuthVerifyOk: "连通正常（{model}，{ms}ms）",
            providerAuthVerifyFailed: "连通失败（{model}）",
            apiKeyOverrideLabel: "API Key 覆盖（可选）",
            apiKeyOverridePlaceholder: "留空则使用环境变量/OAuth 凭据",
            protocolLabel: "协议",
            apiKeyLabel: "API Key",
            apiBaseUrlLabel: "API 基准 URL",
            pathEndpointLabel: "接口路径 (Path Endpoint)",
            thinkingFormatLabel: "Thinking 格式",
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
            editModelModalTitle: "编辑模型",
            addModelIdLabel: "模型 ID",
            addModelAliasLabel: "别名（可选）",
            addModelAliasPlaceholder: "显示用的简短名称",
            addModelCwLabel: "上下文窗口 (Tokens)",
            modelEnabledLabel: "启用此模型",
            cancelBtn: "取消",
            confirmAddModelBtn: "添加模型",
            saveModelBtn: "保存模型",
            duplicateModelError: "该模型 ID 已存在。",
            pullModelsModalTitle: "从服务商拉取模型",
            searchAvailableModels: "搜索可用模型…",
            availableModelsCount: "{count} 个可用模型",
            addedLabel: "已添加",
            addLabel: "添加",
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
            modelTabBuiltin: "Built-in Models",
            modelTabCustom: "Custom Models",
            modelSearchPlaceholder: "Search model ID...",
            modelSortActive: "Active First",
            modelSortDefault: "Default Sort",
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
            providerAuthTitle: "Quick sign-in",
            providerAuthHint: "Authorize your account here. Credentials are stored on the server and refreshed automatically by the runtime.",
            providerAuthConnected: "Signed in",
            providerAuthNotConnected: "Not signed in",
            providerAuthEffective: "Current auth source: {source}",
            providerAuthSignIn: "Sign in now",
            providerAuthSignOut: "Sign out",
            providerAuthDialogHint: "Open the link, enter a device code, or paste the callback URL when prompted. For remote deployments, prefer device code or manual paste.",
            providerAuthWaiting: "Waiting for authorization…",
            providerAuthOpenBrowser: "Open authorization page",
            providerAuthDeviceCode: "Device code",
            providerAuthCopyCode: "Copy code",
            providerAuthCodeCopied: "Copied",
            providerAuthContinue: "Continue",
            providerAuthAnswerPlaceholder: "Enter an answer or paste the callback URL",
            providerAuthDone: "Signed in. Credentials have been saved.",
            providerAuthFailed: "Sign-in failed",
            providerAuthCancelled: "Sign-in cancelled",
            providerAuthExpired: "This sign-in session expired. Start again.",
            providerAuthOverrideWarning: "The saved API key override below takes precedence over the OAuth credential. Clear it before this sign-in takes effect.",
            providerAuthVerify: "Test connection",
            providerAuthVerifying: "Testing…",
            providerAuthVerifyOk: "Reachable ({model}, {ms}ms)",
            providerAuthVerifyFailed: "Unreachable ({model})",
            apiKeyOverrideLabel: "API Key Override (Optional)",
            apiKeyOverridePlaceholder: "Leave empty to use env/OAuth source",
            protocolLabel: "Protocol",
            apiKeyLabel: "API Key",
            apiBaseUrlLabel: "API Base URL",
            pathEndpointLabel: "Path Endpoint",
            thinkingFormatLabel: "Thinking Format",
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
            editModelModalTitle: "Edit Model",
            addModelIdLabel: "Model ID",
            addModelAliasLabel: "Alias (optional)",
            addModelAliasPlaceholder: "Short display name",
            addModelCwLabel: "Context Window (tokens)",
            modelEnabledLabel: "Enable this model",
            cancelBtn: "Cancel",
            confirmAddModelBtn: "Add Model",
            saveModelBtn: "Save Model",
            duplicateModelError: "That model ID is already registered.",
            pullModelsModalTitle: "Pull Models from Provider",
            searchAvailableModels: "Search available models…",
            availableModelsCount: "{count} available models",
            addedLabel: "Added",
            addLabel: "Add",
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
    let providerAuthProviders: DesktopProviderAuthItem[] = [];
    let providerAuthSession: DesktopProviderAuthSession | null = null;
    let providerAuthAnswer = "";
    let providerAuthBusy = "";
    let providerAuthError = "";
    let providerAuthPollGeneration = 0;
    let providerAuthCopiedCode = "";
    let providerAuthVerifying = "";
    let providerAuthVerified: Record<string, { ok: boolean; modelId: string; elapsedMs: number; error?: string }> = {};

    /* ── Single Model Editor ── */
    let showModelEditor = false;
    let modelEditorTargetProviderId = "";
    let modelEditorIndex: number | null = null;
    let modelEditorId = "";
    let modelEditorAlias = "";
    let modelEditorTags: ModelCapabilityTag[] = ["text"];
    let modelEditorContextWindow: number | undefined = undefined;
    let modelEditorEnabled = true;

    /* ── Pull Models Modal ── */
    let showPullModal = false;
    let pullTargetProviderId = "";
    let pullAddingModelId = "";
    let pullAddingTags: ModelCapabilityTag[] = ["text"];
    let pullModelSearch = "";
    let modelTestResults: Record<string, ModelTestStatus> = {};
    let discoveredProviderModels: Record<string, string[]> = {};
    let discoveredSelectedModel: Record<string, string> = {};
    let providerModelsPulled: Record<string, boolean> = {};
    let loadingProviderModelsFor = "";
    let builtinProviders: Array<{ id: string; name: string }> = [];
    let builtinProviderModels: Record<string, string[]> = {};
    let expandedProviderModelIds = new Set<string>();
    const collapsedBuiltinModelLimit = 8;
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
    $: selectedProviderQuickAuth =
        (providerAuthProviders,
        selectedProviderDetail,
        providerAuthProviders.find((provider) => provider.id === selectedProviderDetail?.id));
    let modelSearch = "";
    let modelTab: "builtin" | "custom" = "builtin";
    let sortActiveFirst = true;

    let lastProviderId = "";
    $: {
        const currentId = selectedProviderDetail?.id ?? "";
        if (currentId !== lastProviderId) {
            lastProviderId = currentId;
            if (selectedProviderDetail) {
                const isBuiltin = builtinProviders.some((p) => p.id === selectedProviderDetail?.id);
                modelTab = isBuiltin ? "builtin" : "custom";
                modelSearch = "";
            }
        }
    }

    $: visibleModels = selectedProviderDetail
        ? getVisibleModelsList(selectedProviderDetail, modelTab, modelSearch, sortActiveFirst, expandedProviderModelIds)
        : [];
    $: pullVisibleModels = (discoveredProviderModels, pullTargetProviderId, pullModelSearch,
        discoveredModels(pullTargetProviderId).filter((modelId) =>
            modelId.toLowerCase().includes(pullModelSearch.trim().toLowerCase()),
        ));

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
            case "moonshotai":
            case "moonshotai-cn":
                return "MOONSHOT_API_KEY";
            case "huggingface":
                return "HUGGINGFACE_API_KEY";
            default:
                return undefined;
        }
    }

    function providerAuthIsTerminal(state: DesktopProviderAuthSession["state"]): boolean {
        return ["done", "failed", "cancelled", "expired"].includes(state);
    }

    function builtinAuthGuide(providerId: string, interactiveAuth?: DesktopProviderAuthItem): BuiltinAuthGuide {
        const guides = copy.authGuides;
        if (interactiveAuth) {
            return {
                mode: "oauth",
                modeLabel: copy.providerAuthTitle,
                summary: copy.providerAuthHint,
                tokenHint: copy.providerAuthDialogHint,
                steps: [],
            };
        }
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
            thinkingFormat: "auto",
        };
    }

    function newBuiltinProvider(providerId: string): CustomProviderForm {
        const models = (builtinProviderModels[providerId] ?? []).map((id) => ({
            id,
            tags: ["text"] as ModelCapabilityTag[],
            supportedRoles: ["system", "user", "assistant", "tool"] as ModelRole[],
            enabled: true,
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
            thinkingFormat: "auto",
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
            };
        });
    }

    function ensureModelDefaults(model: ProviderModelForm): void {
        model.id = model.id.trim();
        model.alias = model.alias?.trim() || undefined;
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
                          alias: String((m as any).alias ?? "").trim() || undefined,
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

    function openAddModelModal(providerId: string): void {
        modelEditorTargetProviderId = providerId;
        modelEditorIndex = null;
        modelEditorId = "";
        modelEditorAlias = "";
        modelEditorTags = ["text"];
        modelEditorContextWindow = undefined;
        modelEditorEnabled = true;
        showModelEditor = true;
    }

    function openModelEditor(providerId: string, modelIndex: number): void {
        const model = form.customProviders.find((provider) => provider.id === providerId)?.models[modelIndex];
        if (!model) return;
        modelEditorTargetProviderId = providerId;
        modelEditorIndex = modelIndex;
        modelEditorId = model.id;
        modelEditorAlias = model.alias ?? "";
        modelEditorTags = [...model.tags];
        modelEditorContextWindow = model.contextWindow;
        modelEditorEnabled = model.enabled !== false;
        showModelEditor = true;
    }

    function confirmModelEditor(): void {
        const modelId = modelEditorId.trim();
        if (!modelId) return;
        const modelAlias = modelEditorAlias.trim() || undefined;
        const targetIndex = modelEditorIndex;
        const provider = form.customProviders.find((row) => row.id === modelEditorTargetProviderId);
        if (!provider) return;
        if (provider.models.some((model, index) => model.id.trim() === modelId && index !== targetIndex)) {
            error = copy.duplicateModelError;
            return;
        }
        updateProviderById(modelEditorTargetProviderId, (current) => {
            const nextModel: ProviderModelForm = targetIndex === null
                ? {
                    id: modelId,
                    alias: modelAlias,
                    tags: [...modelEditorTags],
                    supportedRoles: ["system", "user", "assistant", "tool"],
                    contextWindow: modelEditorContextWindow,
                    enabled: modelEditorEnabled,
                }
                : {
                    ...current.models[targetIndex],
                    id: modelId,
                    alias: modelAlias,
                    tags: [...modelEditorTags],
                    contextWindow: modelEditorContextWindow,
                    enabled: modelEditorEnabled,
                };
            const previousId = targetIndex === null ? "" : current.models[targetIndex]?.id ?? "";
            const models = targetIndex === null
                ? [...current.models, nextModel]
                : current.models.map((model, index) => index === targetIndex ? nextModel : model);
            return {
                ...current,
                models,
                defaultModel: previousId && current.defaultModel === previousId ? modelId : current.defaultModel,
            };
        });
        error = "";
        showModelEditor = false;
    }

    function toggleModelEditorTag(tag: ModelCapabilityTag): void {
        const set = new Set(modelEditorTags);
        if (set.has(tag)) set.delete(tag); else set.add(tag);
        modelEditorTags = Array.from(set) as ModelCapabilityTag[];
        if (modelEditorTags.length === 0) modelEditorTags = ["text"];
    }

    function openPullModal(provider: CustomProviderForm): void {
        pullTargetProviderId = provider.id;
        pullAddingModelId = "";
        pullAddingTags = ["text"];
        pullModelSearch = "";
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

    function getVisibleModelsList(
        provider: CustomProviderForm,
        tab: "builtin" | "custom",
        search: string,
        sortActive: boolean,
        expandedIds: Set<string>
    ): Array<{ model: ProviderModelForm; index: number }> {
        const builtinModels = builtinProviderModels[provider.id] ?? [];

        let rows = provider.models.map((model, index) => ({ model, index }));

        // 1. Filter by Tab
        rows = rows.filter((item) => {
            const isBuiltin = builtinModels.includes(item.model.id);
            return tab === "builtin" ? isBuiltin : !isBuiltin;
        });

        // 2. Filter by Search Query
        const query = search.trim().toLowerCase();
        if (query) {
            rows = rows.filter((item) => item.model.id.toLowerCase().includes(query));
        }

        // 3. Sort active first
        if (sortActive) {
            rows = [...rows].sort((a, b) => {
                const aVal = a.model.enabled !== false ? 1 : 0;
                const bVal = b.model.enabled !== false ? 1 : 0;
                if (aVal !== bVal) return bVal - aVal;
                return a.index - b.index;
            });
        }

        // Apply built-in limit
        if (
            isBuiltinProvider(provider) &&
            !expandedIds.has(provider.id) &&
            tab === "builtin"
        ) {
            if (rows.length > collapsedBuiltinModelLimit) {
                return rows.slice(0, collapsedBuiltinModelLimit);
            }
        }

        return rows;
    }

    function hiddenModelCount(provider: CustomProviderForm, tab: "builtin" | "custom", search: string): number {
        if (!isBuiltinProvider(provider)) return 0;
        if (expandedProviderModelIds.has(provider.id)) return 0;
        if (tab !== "builtin") return 0;

        const builtinModels = builtinProviderModels[provider.id] ?? [];
        let rows = provider.models.filter(m => builtinModels.includes(m.id));
        const query = search.trim().toLowerCase();
        if (query) {
            rows = rows.filter(m => m.id.toLowerCase().includes(query));
        }
        return Math.max(0, rows.length - collapsedBuiltinModelLimit);
    }

    function toggleModelList(providerId: string): void {
        const next = new Set(expandedProviderModelIds);
        if (next.has(providerId)) next.delete(providerId);
        else next.add(providerId);
        expandedProviderModelIds = next;
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

    async function providerAuthRequest<T extends { ok: true }>(path: string, init?: RequestInit): Promise<T> {
        const response = await fetch(path, {
            ...init,
            headers: init?.body
                ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
                : init?.headers,
        });
        const data = await response.json() as T | { ok: false; error?: string };
        if (!response.ok || data.ok !== true) {
            throw new Error("error" in data && data.error ? data.error : `Provider authentication failed (${response.status})`);
        }
        return data;
    }

    async function loadProviderAuth(): Promise<void> {
        try {
            const data = await providerAuthRequest<DesktopProviderAuthOverviewResponse>("/api/desktop/provider-auth");
            providerAuthProviders = data.providers;
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
        }
    }

    async function startProviderAuth(providerId: string): Promise<void> {
        if (providerAuthBusy) return;
        const generation = ++providerAuthPollGeneration;
        providerAuthBusy = providerId;
        providerAuthError = "";
        providerAuthAnswer = "";
        providerAuthCopiedCode = "";
        try {
            const data = await providerAuthRequest<DesktopProviderAuthSessionResponse>("/api/desktop/provider-auth", {
                method: "POST",
                body: JSON.stringify({ providerId }),
            });
            providerAuthSession = data.session;
            void pollProviderAuth(data.session.id, generation);
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
            error = providerAuthError;
        } finally {
            providerAuthBusy = "";
        }
    }

    async function pollProviderAuth(sessionId: string, generation: number): Promise<void> {
        while (generation === providerAuthPollGeneration && providerAuthSession?.id === sessionId) {
            if (providerAuthIsTerminal(providerAuthSession.state)) {
                await loadProviderAuth();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (generation !== providerAuthPollGeneration || providerAuthSession?.id !== sessionId) return;
            try {
                const data = await providerAuthRequest<DesktopProviderAuthSessionResponse>(`/api/desktop/provider-auth/sessions/${encodeURIComponent(sessionId)}`);
                providerAuthSession = data.session;
            } catch (cause) {
                if (generation !== providerAuthPollGeneration) return;
                providerAuthError = cause instanceof Error ? cause.message : String(cause);
                return;
            }
        }
    }

    async function answerProviderAuth(value = providerAuthAnswer): Promise<void> {
        const active = providerAuthSession;
        if (!active?.prompt || providerAuthBusy) return;
        providerAuthBusy = active.providerId;
        providerAuthError = "";
        try {
            const data = await providerAuthRequest<DesktopProviderAuthSessionResponse>(`/api/desktop/provider-auth/sessions/${encodeURIComponent(active.id)}/answer`, {
                method: "POST",
                body: JSON.stringify({ promptId: active.prompt.id, value }),
            });
            providerAuthSession = data.session;
            providerAuthAnswer = "";
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
        } finally {
            providerAuthBusy = "";
        }
    }

    /**
     * Send one real request through the stored credential. "Signed in" only
     * means a credential exists; this is what proves it reaches the model.
     */
    async function verifyProviderAuth(providerId: string): Promise<void> {
        if (providerAuthVerifying) return;
        providerAuthVerifying = providerId;
        providerAuthError = "";
        try {
            const data = await providerAuthRequest<{ ok: true; result: { ok: boolean; providerId: string; modelId: string; elapsedMs: number; reply?: string; error?: string } }>(
                "/api/desktop/provider-auth/verify",
                { method: "POST", body: JSON.stringify({ providerId }) },
            );
            providerAuthVerified = { ...providerAuthVerified, [providerId]: data.result };
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
        } finally {
            providerAuthVerifying = "";
        }
    }

    async function closeProviderAuth(): Promise<void> {
        const active = providerAuthSession;
        ++providerAuthPollGeneration;
        providerAuthSession = null;
        providerAuthAnswer = "";
        providerAuthError = "";
        if (!active || providerAuthIsTerminal(active.state)) return;
        try {
            await providerAuthRequest<DesktopProviderAuthSessionResponse>(`/api/desktop/provider-auth/sessions/${encodeURIComponent(active.id)}`, { method: "DELETE" });
        } catch {
            // Closing the dialog is still complete if the session expired or the service stopped.
        }
    }

    function providerAuthFocusTrap(node: HTMLElement): { destroy: () => void } {
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const focusableSelector = [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            '[tabindex]:not([tabindex="-1"])',
        ].join(",");
        const focusFirst = () => {
            const first = node.querySelector<HTMLElement>(focusableSelector);
            (first ?? node).focus();
        };
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                void closeProviderAuth();
                return;
            }
            if (event.key !== "Tab") return;
            const focusable = [...node.querySelectorAll<HTMLElement>(focusableSelector)]
                .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
            if (focusable.length === 0) {
                event.preventDefault();
                node.focus();
                return;
            }
            const first = focusable[0]!;
            const last = focusable[focusable.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        queueMicrotask(focusFirst);
        node.addEventListener("keydown", handleKeydown);
        return {
            destroy: () => {
                node.removeEventListener("keydown", handleKeydown);
                if (previousFocus?.isConnected) previousFocus.focus();
            },
        };
    }

    async function logoutProviderAuth(providerId: string): Promise<void> {
        if (providerAuthBusy) return;
        providerAuthBusy = providerId;
        providerAuthError = "";
        try {
            await providerAuthRequest<{ ok: true; removed: boolean }>(`/api/desktop/provider-auth/credentials/${encodeURIComponent(providerId)}`, { method: "DELETE" });
            await loadProviderAuth();
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
            error = providerAuthError;
        } finally {
            providerAuthBusy = "";
        }
    }

    function openProviderAuthUrl(rawUrl: string): void {
        try {
            const parsed = new URL(rawUrl);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported authorization URL");
            window.open(parsed.href, "_blank", "noopener,noreferrer");
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
        }
    }

    async function copyProviderAuthCode(code: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(code);
            providerAuthCopiedCode = code;
        } catch (cause) {
            providerAuthError = cause instanceof Error ? cause.message : String(cause);
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
                                      enabled: true,
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
                                  alias: String(m.alias ?? "").trim() || undefined,
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
                    thinkingFormat:
                        (cp.thinkingFormat as ThinkingFormat | undefined) ??
                        "auto",
                })),
                ),
                modelRouting: {
                    textModelKey: s.modelRouting?.textModelKey ?? "",
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
                    thinkingFormat:
                        selected.thinkingFormat === "auto"
                            ? undefined
                            : selected.thinkingFormat,
                    models: selected.models.map((model) => ({
                        id: model.id.trim(),
                        alias: model.alias?.trim() || undefined,
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

    onMount(() => {
        void loadAll();
        void loadProviderAuth();
        return () => {
            ++providerAuthPollGeneration;
        };
    });
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
                                {@const interactiveAuth = selectedProviderQuickAuth?.id === cp.id ? selectedProviderQuickAuth : undefined}
                                {@const authGuide = builtinAuthGuide(cp.id, interactiveAuth)}
                                <div class="providers-detail-notice md:col-span-2">
                                    {copy.builtinNotice}
                                </div>
                                <div class="providers-detail-auth md:col-span-2">
                                    <div class="providers-detail-auth-row">
                                        <span class="providers-detail-auth-label">{copy.authMethodLabel}</span>
                                        <span class="providers-detail-auth-badge">{authGuide.modeLabel}</span>
                                    </div>
                                    <p class="providers-detail-auth-summary">{authGuide.summary}</p>
                                    {#if interactiveAuth}
                                        <div class="providers-auth-connect">
                                            <div class="providers-auth-connect-copy">
                                                <span class:providers-auth-connected={Boolean(interactiveAuth.credential)}>{interactiveAuth.credential ? copy.providerAuthConnected : copy.providerAuthNotConnected}</span>
                                                <small>{interactiveAuth.effectiveAuth?.source ? copy.providerAuthEffective.replace("{source}", interactiveAuth.effectiveAuth.source) : copy.providerAuthHint}</small>
                                            </div>
                                            <div class="providers-auth-connect-actions">
                                                {#if interactiveAuth.credential}
                                                    <button type="button" class="providers-btn-outline" disabled={Boolean(providerAuthBusy)} onclick={() => void logoutProviderAuth(cp.id)}>{copy.providerAuthSignOut}</button>
                                                {/if}
                                                {#if interactiveAuth.credential}
                                                    <button type="button" class="providers-btn-outline" disabled={Boolean(providerAuthVerifying)} onclick={() => void verifyProviderAuth(cp.id)}>{providerAuthVerifying === cp.id ? copy.providerAuthVerifying : copy.providerAuthVerify}</button>
                                                {/if}
                                                <button type="button" class="providers-btn-primary-sm" disabled={Boolean(providerAuthBusy)} onclick={() => void startProviderAuth(cp.id)}>{providerAuthBusy === cp.id ? copy.loading : copy.providerAuthSignIn}</button>
                                            </div>
                                        </div>
                                        {#if providerAuthVerified[cp.id]}
                                            {@const verdict = providerAuthVerified[cp.id]}
                                            <p class="providers-auth-verdict" class:providers-auth-verdict-ok={verdict.ok}>
                                                {verdict.ok
                                                    ? copy.providerAuthVerifyOk.replace("{model}", verdict.modelId).replace("{ms}", String(verdict.elapsedMs))
                                                    : `${copy.providerAuthVerifyFailed.replace("{model}", verdict.modelId)} — ${verdict.error ?? ""}`}
                                            </p>
                                        {/if}
                                        {#if interactiveAuth.apiKeyOverride}
                                            <p class="providers-auth-shadow-warning">{copy.providerAuthOverrideWarning}</p>
                                        {/if}
                                    {/if}
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
                                    {#if authGuide.steps.length > 0}
                                        <ol class="providers-detail-auth-steps">
                                            {#each authGuide.steps as step}
                                                <li>{step}</li>
                                            {/each}
                                        </ol>
                                    {/if}
                                    {#if authGuide.links && authGuide.links.length > 0}
                                        <div class="providers-detail-auth-links">
                                            {#each authGuide.links as link}
                                                <a class="providers-detail-auth-link" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                                <!--
                                    The API-key override stays visible for OAuth providers too. Hiding it
                                    did not disable it: a key saved earlier still wins over the stored
                                    credential inside pi, so hiding the field only made that precedence
                                    invisible. The quick sign-in card warns when both are present.
                                -->
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
                                            {#if showApiKey}<EyeOff size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
                                        </button>
                                    </div>
                                </label>
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
                                            {#if showApiKey}<EyeOff size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
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
                            <div class="provider-model-controls">
                                <div class="model-controls-left">
                                    <input
                                        type="text"
                                        class="providers-table-input model-search-input"
                                        placeholder={copy.modelSearchPlaceholder}
                                        bind:value={modelSearch}
                                    />
                                    <div class="model-tabs-wrap">
                                        <button
                                            type="button"
                                            class="model-tab-button"
                                            class:active={modelTab === "builtin"}
                                            onclick={() => (modelTab = "builtin")}
                                        >
                                            {copy.modelTabBuiltin}
                                        </button>
                                        <button
                                            type="button"
                                            class="model-tab-button"
                                            class:active={modelTab === "custom"}
                                            onclick={() => (modelTab = "custom")}
                                        >
                                            {copy.modelTabCustom}
                                        </button>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    class="providers-btn-outline sort-toggle-button"
                                    class:active={sortActiveFirst}
                                    onclick={() => (sortActiveFirst = !sortActiveFirst)}
                                >
                                    {sortActiveFirst ? copy.modelSortActive : copy.modelSortDefault}
                                </button>
                            </div>
                            <div class="providers-model-list" role="list" aria-label={copy.modelRegistryTitle}>
                                {#each visibleModels as row (row.index)}
                                    {@const model = row.model}
                                    {@const index = row.index}
                                    <article class="providers-model-row" role="listitem">
                                        <div class="providers-model-row-copy">
                                            <strong>{model.alias || model.id}</strong>
                                            <small>{model.alias ? model.id : (model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : copy.addModelCwLabel)}</small>
                                        </div>
                                        <div class="providers-model-row-caps" aria-label={copy.capabilitiesCol}>
                                            {#each model.tags as tag}
                                                <span class="providers-cap-badge providers-cap-badge--on">{tag}</span>
                                            {/each}
                                        </div>
                                        <div class="providers-model-row-actions">
                                            <IosSwitch
                                                checked={model.enabled !== false}
                                                onCheckedChange={(enabled) => updateProviderById(cp.id, (provider) => ({ ...provider, models: provider.models.map((item, modelIndex) => modelIndex === index ? { ...item, enabled } : item) }))}
                                            />
                                            <button type="button" class="providers-btn-outline-sm" onclick={() => openModelEditor(cp.id, index)}>{copy.editModelModalTitle}</button>
                                            <button type="button" class="providers-remove-btn" aria-label={`${copy.deleteBtn}: ${model.id}`} onclick={() => removeModel(cp.id, index)}>×</button>
                                        </div>
                                    </article>
                                {/each}
                            </div>
                        {/if}

                        {#if isBuiltinProvider(cp) && modelTab === "builtin" && hiddenModelCount(cp, modelTab, modelSearch) > 0}
                            <div class="providers-models-expand">
                                <button
                                    type="button"
                                    class="providers-btn-outline"
                                    onclick={() => toggleModelList(cp.id)}
                                >
                                    {expandedProviderModelIds.has(cp.id)
                                        ? copy.collapseModelsBtn
                                        : copy.showMoreModelsBtn.replace("{count}", String(hiddenModelCount(cp, modelTab, modelSearch)))}
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

    {#if providerAuthSession}
        {@const authSession = providerAuthSession}
        <div class="providers-modal-backdrop" onclick={(event) => { if (event.target === event.currentTarget) void closeProviderAuth(); }} role="presentation">
            <div use:providerAuthFocusTrap class="providers-modal-card providers-auth-modal" role="dialog" aria-modal="true" aria-labelledby="provider-auth-modal-title" aria-describedby="provider-auth-modal-description" tabindex="-1">
                <div class="providers-auth-modal-head">
                    <div>
                        <h3 id="provider-auth-modal-title" class="providers-modal-title">{providerAuthProviders.find((provider) => provider.id === authSession.providerId)?.loginLabel ?? copy.providerAuthTitle}</h3>
                        <p id="provider-auth-modal-description">{copy.providerAuthDialogHint}</p>
                    </div>
                    <button type="button" class="providers-auth-close" aria-label={copy.closeBtn} onclick={() => void closeProviderAuth()}>×</button>
                </div>

                {#if authSession.state === "done"}
                    <div class="providers-auth-terminal providers-auth-terminal--success"><span aria-hidden="true">✓</span><strong>{copy.providerAuthDone}</strong></div>
                {:else if authSession.state === "failed"}
                    <div class="providers-auth-terminal providers-auth-terminal--danger"><span aria-hidden="true">!</span><strong>{copy.providerAuthFailed}</strong><small>{authSession.error ?? providerAuthError}</small></div>
                {:else if authSession.state === "cancelled"}
                    <div class="providers-auth-terminal"><span aria-hidden="true">×</span><strong>{copy.providerAuthCancelled}</strong></div>
                {:else if authSession.state === "expired"}
                    <div class="providers-auth-terminal providers-auth-terminal--danger"><span aria-hidden="true">!</span><strong>{copy.providerAuthExpired}</strong></div>
                {:else}
                    <div class="providers-auth-waiting"><span aria-hidden="true"></span>{copy.providerAuthWaiting}</div>

                    {#if authSession.authUrl}
                        <section class="providers-auth-step">
                            <p>{authSession.authUrl.instructions ?? copy.providerAuthOpenBrowser}</p>
                            <button type="button" class="providers-btn-primary-sm" onclick={() => openProviderAuthUrl(authSession.authUrl!.url)}>{copy.providerAuthOpenBrowser} ↗</button>
                        </section>
                    {/if}

                    {#if authSession.deviceCode}
                        <section class="providers-auth-device">
                            <span>{copy.providerAuthDeviceCode}</span>
                            <code>{authSession.deviceCode.userCode}</code>
                            <div>
                                <button type="button" class="providers-btn-outline" onclick={() => void copyProviderAuthCode(authSession.deviceCode!.userCode)}>{providerAuthCopiedCode === authSession.deviceCode.userCode ? copy.providerAuthCodeCopied : copy.providerAuthCopyCode}</button>
                                <button type="button" class="providers-btn-primary-sm" onclick={() => openProviderAuthUrl(authSession.deviceCode!.verificationUri)}>{copy.providerAuthOpenBrowser} ↗</button>
                            </div>
                        </section>
                    {/if}

                    {#if authSession.prompt}
                        <section class="providers-auth-prompt">
                            <strong>{authSession.prompt.message}</strong>
                            {#if authSession.prompt.type === "select"}
                                <div class="providers-auth-options">
                                    {#each authSession.prompt.options ?? [] as option (option.id)}
                                        <button type="button" class="providers-auth-option" disabled={Boolean(providerAuthBusy)} onclick={() => void answerProviderAuth(option.id)}><span>{option.label}</span>{#if option.description}<small>{option.description}</small>{/if}<b aria-hidden="true">›</b></button>
                                    {/each}
                                </div>
                            {:else}
                                <form class="providers-auth-answer" onsubmit={(event) => { event.preventDefault(); void answerProviderAuth(); }}>
                                    <Input type={authSession.prompt.type === "secret" ? "password" : "text"} bind:value={providerAuthAnswer} placeholder={authSession.prompt.placeholder ?? copy.providerAuthAnswerPlaceholder} autocomplete="off" />
                                    <button type="submit" class="providers-btn-primary-sm" disabled={Boolean(providerAuthBusy) || (authSession.prompt.type !== "text" && !providerAuthAnswer.trim())}>{copy.providerAuthContinue}</button>
                                </form>
                            {/if}
                        </section>
                    {/if}

                    {#if authSession.messages.length > 0}
                        <div class="providers-auth-messages">
                            {#each authSession.messages.slice(-4) as authMessage (authMessage.id)}
                                <p>{authMessage.message}</p>
                            {/each}
                        </div>
                    {/if}
                {/if}

                {#if providerAuthError}<p class="providers-auth-error">{providerAuthError}</p>{/if}
                <div class="providers-modal-actions">
                    <button type="button" class="providers-btn-outline" onclick={() => void closeProviderAuth()}>{providerAuthIsTerminal(authSession.state) ? copy.closeBtn : copy.cancelBtn}</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- ── Focused Model Editor ── -->
    {#if showModelEditor}
        <div class="providers-modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showModelEditor = false; }} onkeydown={(e) => { if (e.key === 'Escape') showModelEditor = false; }} role="presentation">
            <div class="providers-modal-card" role="dialog" aria-modal="true" aria-labelledby="providers-model-editor-title">
                <h3 id="providers-model-editor-title" class="providers-modal-title">{modelEditorIndex === null ? copy.addModelModalTitle : copy.editModelModalTitle}</h3>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">{copy.addModelIdLabel}</span>
                    <Input bind:value={modelEditorId} placeholder="e.g. gpt-4o, claude-sonnet-4-20250514" />
                </label>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">{copy.addModelAliasLabel}</span>
                    <Input bind:value={modelEditorAlias} placeholder={copy.addModelAliasPlaceholder} />
                </label>
                <label class="providers-detail-form-label">
                    <span class="providers-detail-form-label-text">{copy.addModelCwLabel}</span>
                    <Input type="number" min="0" step="1000" placeholder="200000" value={modelEditorContextWindow ?? ""} oninput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); modelEditorContextWindow = v > 0 ? v : undefined; }} />
                </label>
                <div class="providers-modal-caps">
                    <span class="providers-detail-form-label-text">{copy.capabilitiesCol}</span>
                    <div class="providers-caps-grid">
                        {#each capabilityTags as tag}
                            <label class="providers-cap-check">
                                <Checkbox checked={modelEditorTags.includes(tag)} onCheckedChange={() => toggleModelEditorTag(tag)} />
                                <span>{tag}</span>
                            </label>
                        {/each}
                    </div>
                </div>
                <label class="providers-model-enabled-row">
                    <span>{copy.modelEnabledLabel}</span>
                    <IosSwitch checked={modelEditorEnabled} onCheckedChange={(enabled) => (modelEditorEnabled = enabled)} />
                </label>
                <div class="providers-modal-actions">
                    <button type="button" class="providers-btn-outline" onclick={() => (showModelEditor = false)}>{copy.cancelBtn}</button>
                    <button type="button" class="providers-btn-primary-sm" onclick={confirmModelEditor} disabled={!modelEditorId.trim()}>{modelEditorIndex === null ? copy.confirmAddModelBtn : copy.saveModelBtn}</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- ── Pull Models Modal ── -->
    {#if showPullModal}
        <div class="providers-modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) showPullModal = false; }} onkeydown={(e) => { if (e.key === 'Escape') showPullModal = false; }} role="presentation">
            <div class="providers-modal-card providers-modal-card--wide" role="dialog" aria-modal="true" aria-labelledby="providers-model-discovery-title">
                <div class="providers-discovery-head">
                    <div><h3 id="providers-model-discovery-title" class="providers-modal-title">{copy.pullModelsModalTitle}</h3><p>{copy.availableModelsCount.replace("{count}", String(discoveredModels(pullTargetProviderId).length))}</p></div>
                    <Input bind:value={pullModelSearch} placeholder={copy.searchAvailableModels} />
                </div>
                {#if loadingProviderModelsFor === pullTargetProviderId}
                    <p class="providers-modal-loading">{copy.fetchingModels}</p>
                {:else if discoveredModels(pullTargetProviderId).length === 0}
                    <p class="providers-modal-loading">{copy.noModelsReturned}</p>
                {:else}
                    <div class="providers-pull-list">
                        {#each pullVisibleModels as remoteModelId}
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
                                        <button type="button" class="providers-btn-primary-sm" onclick={() => confirmPullAdd(remoteModelId)}>{copy.confirmAddModelBtn}</button>
                                        <button type="button" class="providers-btn-outline" onclick={() => { pullAddingModelId = ""; }}>{copy.cancelBtn}</button>
                                    </div>
                                {:else}
                                    <button type="button" class="providers-btn-outline" onclick={() => { pullAddingModelId = remoteModelId; pullAddingTags = ["text"]; }} disabled={alreadyAdded}>{alreadyAdded ? copy.addedLabel : copy.addLabel}</button>
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
