<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";

    type ThemeMode = "system" | "light" | "dark";
    type LocaleKey = "zh-CN" | "en-US";
    const LS_THEME = "molibot-web-theme";
    const LS_LOCALE = "molibot-web-locale";

    const COPY: Record<LocaleKey, Record<string, string>> = {
        "zh-CN": {
            general: "总览",
            overview: "总览",
            aiEngine: "AI 引擎",
            routingPrompt: "路由与提示词",
            providersModels: "模型与提供方",
            usageStats: "用量统计",
            modelErrors: "模型报错记录",
            mcpServers: "MCP 服务",
            acpTargets: "ACP 目标",
            channels: "渠道",
            webProfiles: "Web 配置",
            telegramBot: "Telegram 机器人",
            wechatBot: "微信机器人",
            feishuBot: "飞书机器人",
            qqBot: "QQ 机器人",
            agentData: "助手数据",
            agents: "Agents",
            memory: "记忆",
            memoryRejections: "记忆拒绝记录",
            skills: "技能",
            skillDrafts: "技能草稿",
            runHistory: "运行历史",
            tasks: "任务",
            systemGroup: "系统",
            pluginsCore: "插件与核心",
            backToChat: "返回聊天",
            settings: "设置",
            workspaceTitle: "配置工作台",
            openChat: "打开聊天",
            navigateSettings: "设置导航",
            theme: "主题",
            language: "语言"
        },
        "en-US": {
            general: "General",
            overview: "Overview",
            aiEngine: "AI Engine",
            routingPrompt: "Routing & Prompt",
            providersModels: "Providers & Models",
            usageStats: "Usage Stats",
            modelErrors: "Model Error Logs",
            mcpServers: "MCP Servers",
            acpTargets: "ACP Targets",
            channels: "Channels",
            webProfiles: "Web Profiles",
            telegramBot: "Telegram Bot",
            wechatBot: "WeChat Bot",
            feishuBot: "Feishu Bot",
            qqBot: "QQ Bot",
            agentData: "Agent Data",
            agents: "Agents",
            memory: "Memory",
            memoryRejections: "Memory Rejections",
            skills: "Skills",
            skillDrafts: "Skill Drafts",
            runHistory: "Run History",
            tasks: "Tasks",
            systemGroup: "System",
            pluginsCore: "Plugins & Core",
            backToChat: "Back To Chat",
            settings: "Settings",
            workspaceTitle: "Configuration Workspace",
            openChat: "Open Chat",
            navigateSettings: "Navigate Settings",
            theme: "Theme",
            language: "Language"
        }
    };

    let themeMode: ThemeMode = "light";
    let locale: LocaleKey = "zh-CN";

    let navGroups = [
        {
            title: "General",
            links: [{ href: "/settings", label: "Overview", exact: true }],
        },
        {
            title: "AI Engine",
            links: [
                { href: "/settings/ai/routing", label: "Routing & Prompt", exact: true },
                { href: "/settings/ai/providers", label: "Providers & Models", exact: true },
                { href: "/settings/ai/usage", label: "Usage Stats", exact: true },
                { href: "/settings/ai/errors", label: "Model Error Logs", exact: true },
                { href: "/settings/mcp", label: "MCP Servers", exact: true },
                { href: "/settings/acp", label: "ACP Targets", exact: true },
            ],
        },
        {
            title: "Channels",
            links: [
                { href: "/settings/web", label: "Web Profiles", exact: true },
                { href: "/settings/telegram", label: "Telegram Bot", exact: true },
                { href: "/settings/weixin", label: "WeChat Bot", exact: true },
                { href: "/settings/feishu", label: "Feishu Bot", exact: true },
                { href: "/settings/qq", label: "QQ Bot", exact: true },
            ],
        },
        {
            title: "Agent Data",
            links: [
                { href: "/settings/agents", label: "Agents", exact: true },
                { href: "/settings/memory", label: "Memory", exact: true },
                { href: "/settings/memory-rejections", label: "Memory Rejections", exact: true },
                { href: "/settings/skills", label: "Skills", exact: true },
                { href: "/settings/skill-drafts", label: "Skill Drafts", exact: true },
                { href: "/settings/run-history", label: "Run History", exact: true },
                { href: "/settings/tasks", label: "Tasks", exact: true },
            ],
        },
        {
            title: "System",
            links: [{ href: "/settings/plugins", label: "Plugins & Core", exact: true }],
        },
    ];

    function t(key: string): string {
        return COPY[locale][key] ?? key;
    }

    function normalizePath(path: string): string {
        if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
        return path;
    }

    function isActive(pathname: string, href: string, exact: boolean = false) {
        const path = normalizePath(pathname);
        const target = normalizePath(href);
        if (exact) {
            return path === target;
        }
        return path === target || path.startsWith(`${target}/`);
    }

    function navLinkClass(
        pathname: string,
        href: string,
        exact: boolean = false,
    ): string {
        const base =
            "block rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200";
        const state = isActive(pathname, href, exact)
            ? "bg-[var(--muted)] text-[var(--foreground)]"
            : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]";
        return `${base} ${state}`;
    }

    let flatLinks = navGroups.flatMap((group) => group.links);

    function currentPageLabel(pathname: string): string {
        const found = flatLinks.find((link) =>
            isActive(pathname, link.href, link.exact),
        );
        return found?.label ?? t("settings");
    }

    function resolveShouldUseDark(mode: ThemeMode): boolean {
        if (mode === "dark") return true;
        if (mode === "light") return false;
        return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function applyTheme(mode: ThemeMode): void {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        root.classList.toggle("dark", resolveShouldUseDark(mode));
        root.setAttribute("data-theme-mode", mode);
    }

    function applyLocale(nextLocale: LocaleKey): void {
        if (typeof document === "undefined") return;
        document.documentElement.setAttribute("lang", nextLocale);
    }

    function onThemeModeChange(event: Event): void {
        themeMode = (event.target as HTMLSelectElement).value as ThemeMode;
        applyTheme(themeMode);
        localStorage.setItem(LS_THEME, themeMode);
    }

    function onLocaleChange(event: Event): void {
        locale = (event.target as HTMLSelectElement).value as LocaleKey;
        applyLocale(locale);
        localStorage.setItem(LS_LOCALE, locale);
    }

    onMount(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const handleSystemThemeChange = () => {
            if (themeMode === "system") applyTheme("system");
        };
        media.addEventListener("change", handleSystemThemeChange);

        const storedTheme = String(localStorage.getItem(LS_THEME) ?? "light");
        themeMode = storedTheme === "system" || storedTheme === "dark" ? storedTheme : "light";
        applyTheme(themeMode);

        const storedLocale = String(localStorage.getItem(LS_LOCALE) ?? "zh-CN");
        locale = storedLocale === "en-US" ? "en-US" : "zh-CN";
        applyLocale(locale);

        return () => {
            media.removeEventListener("change", handleSystemThemeChange);
        };
    });

    $: navGroups = [
        {
            title: t("general"),
            links: [{ href: "/settings", label: t("overview"), exact: true }],
        },
        {
            title: t("aiEngine"),
            links: [
                { href: "/settings/ai/routing", label: t("routingPrompt"), exact: true },
                { href: "/settings/ai/providers", label: t("providersModels"), exact: true },
                { href: "/settings/ai/usage", label: t("usageStats"), exact: true },
                { href: "/settings/ai/errors", label: t("modelErrors"), exact: true },
                { href: "/settings/mcp", label: t("mcpServers"), exact: true },
                { href: "/settings/acp", label: t("acpTargets"), exact: true },
            ],
        },
        {
            title: t("channels"),
            links: [
                { href: "/settings/web", label: t("webProfiles"), exact: true },
                { href: "/settings/telegram", label: t("telegramBot"), exact: true },
                { href: "/settings/weixin", label: t("wechatBot"), exact: true },
                { href: "/settings/feishu", label: t("feishuBot"), exact: true },
                { href: "/settings/qq", label: t("qqBot"), exact: true },
            ],
        },
        {
            title: t("agentData"),
            links: [
                { href: "/settings/agents", label: t("agents"), exact: true },
                { href: "/settings/memory", label: t("memory"), exact: true },
                { href: "/settings/memory-rejections", label: t("memoryRejections"), exact: true },
                { href: "/settings/skills", label: t("skills"), exact: true },
                { href: "/settings/skill-drafts", label: t("skillDrafts"), exact: true },
                { href: "/settings/run-history", label: t("runHistory"), exact: true },
                { href: "/settings/tasks", label: t("tasks"), exact: true },
            ],
        },
        {
            title: t("systemGroup"),
            links: [{ href: "/settings/plugins", label: t("pluginsCore"), exact: true }],
        },
    ];
    $: flatLinks = navGroups.flatMap((group) => group.links);
</script>

<main
    class="settings-theme flex h-[100dvh] w-full bg-[var(--background)] text-[var(--foreground)] antialiased selection:bg-[color-mix(in_oklab,var(--primary)_30%,transparent)]"
>
    <div class="grid h-full w-full grid-cols-1 lg:grid-cols-[300px_1fr]">
        <aside
            class="hidden flex-col border-r border-[var(--border)] bg-[var(--sidebar)] p-4 lg:flex"
        >
            <div class="mb-6 space-y-3 px-3">
                <a
                    href="/"
                    class="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                >
                    <span aria-hidden="true">←</span>
                    {t("backToChat")}
                </a>
                <h2 class="text-lg font-bold tracking-tight text-[var(--foreground)]">
                    {t("settings")}
                </h2>
            </div>

            {#key $page.url.pathname}
                <nav class="flex-1 space-y-6 overflow-y-auto pr-2">
                    {#each navGroups as group}
                        <div class="space-y-2">
                            <h3
                                class="px-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
                            >
                                {group.title}
                            </h3>
                            <div class="space-y-0.5">
                                {#each group.links as link}
                                    <a
                                        href={link.href}
                                        class={navLinkClass(
                                            $page.url.pathname,
                                            link.href,
                                            (link as any).exact,
                                        )}
                                        aria-current={isActive(
                                            $page.url.pathname,
                                            link.href,
                                            (link as any).exact,
                                        )
                                            ? "page"
                                            : undefined}
                                    >
                                        {link.label}
                                    </a>
                                {/each}
                            </div>
                        </div>
                    {/each}
                </nav>
            {/key}
        </aside>

        <section class="relative min-h-0 w-full overflow-y-auto">
            <header
                class="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)] px-5 py-4 sm:px-7"
            >
                <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <p
                            class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]"
                        >
                            {t("workspaceTitle")}
                        </p>
                        <h1 class="truncate text-lg font-semibold text-[var(--foreground)]">
                            {currentPageLabel($page.url.pathname)}
                        </h1>
                    </div>
                    <div class="flex items-center gap-2">
                        <select
                            class="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ring)]"
                            bind:value={themeMode}
                            on:change={onThemeModeChange}
                            aria-label={t("theme")}
                        >
                            <option value="system">System</option>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select>
                        <select
                            class="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ring)]"
                            bind:value={locale}
                            on:change={onLocaleChange}
                            aria-label={t("language")}
                        >
                            <option value="zh-CN">中文</option>
                            <option value="en-US">English</option>
                        </select>
                        <a
                            href="/"
                            class="hidden rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] sm:inline-flex"
                        >
                            {t("openChat")}
                        </a>
                    </div>
                </div>

                <details class="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 lg:hidden">
                    <summary class="cursor-pointer select-none px-2 py-1 text-sm font-medium text-[var(--foreground)]">
                        {t("navigateSettings")}
                    </summary>
                    <div class="mt-2 space-y-4 px-1 pb-1">
                        <a
                            href="/"
                            class="block rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
                        >
                            ← {t("backToChat")}
                        </a>
                        {#each navGroups as group}
                            <div class="space-y-2">
                                <p class="px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                                    {group.title}
                                </p>
                                <div class="space-y-1">
                                    {#each group.links as link}
                                        <a
                                            href={link.href}
                                            class={navLinkClass(
                                                $page.url.pathname,
                                                link.href,
                                                (link as any).exact,
                                            )}
                                        >
                                            {link.label}
                                        </a>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                </details>
            </header>
            <slot />
        </section>
    </div>
</main>
