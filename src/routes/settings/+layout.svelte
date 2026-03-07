<script lang="ts">
    import { page } from "$app/stores";

    const navGroups = [
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
            ],
        },
        {
            title: "Channels",
            links: [
                { href: "/settings/web", label: "Web Profiles", exact: true },
                { href: "/settings/telegram", label: "Telegram Bot", exact: true },
                { href: "/settings/feishu", label: "Feishu Bot", exact: true },
            ],
        },
        {
            title: "Agent Data",
            links: [
                { href: "/settings/agents", label: "Agents", exact: true },
                { href: "/settings/memory", label: "Memory", exact: true },
                { href: "/settings/skills", label: "Skills", exact: true },
                { href: "/settings/tasks", label: "Tasks", exact: true },
            ],
        },
        {
            title: "System",
            links: [{ href: "/settings/plugins", label: "Plugins & Core", exact: true }],
        },
    ];

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
            ? "bg-emerald-500/10 text-emerald-400"
            : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200";
        return `${base} ${state}`;
    }

    const flatLinks = navGroups.flatMap((group) => group.links);

    function currentPageLabel(pathname: string): string {
        const found = flatLinks.find((link) =>
            isActive(pathname, link.href, link.exact),
        );
        return found?.label ?? "Settings";
    }
</script>

<main
    class="flex h-[100dvh] w-full bg-[#1a1f24] text-slate-100 antialiased selection:bg-emerald-500/30"
>
    <div class="grid h-full w-full grid-cols-1 lg:grid-cols-[300px_1fr]">
        <aside
            class="hidden flex-col border-r border-white/[0.08] bg-[#101418] p-4 lg:flex"
        >
            <div class="mb-6 space-y-3 px-3">
                <a
                    href="/"
                    class="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-300"
                >
                    <span aria-hidden="true">←</span>
                    Back To Chat
                </a>
                <h2 class="text-lg font-bold tracking-tight text-white">
                    Settings
                </h2>
            </div>

            {#key $page.url.pathname}
                <nav class="flex-1 space-y-6 overflow-y-auto pr-2">
                    {#each navGroups as group}
                        <div class="space-y-2">
                            <h3
                                class="px-3 text-xs font-semibold uppercase tracking-wider text-slate-500"
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
                class="sticky top-0 z-10 border-b border-white/[0.08] bg-[#11161b]/95 px-5 py-4 backdrop-blur sm:px-7"
            >
                <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <p
                            class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                        >
                            Configuration Workspace
                        </p>
                        <h1 class="truncate text-lg font-semibold text-white">
                            {currentPageLabel($page.url.pathname)}
                        </h1>
                    </div>
                    <a
                        href="/"
                        class="hidden rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-emerald-300 sm:inline-flex"
                    >
                        Open Chat
                    </a>
                </div>

                <details class="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-2 lg:hidden">
                    <summary class="cursor-pointer select-none px-2 py-1 text-sm font-medium text-slate-200">
                        Navigate Settings
                    </summary>
                    <div class="mt-2 space-y-4 px-1 pb-1">
                        <a
                            href="/"
                            class="block rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-slate-200"
                        >
                            ← Back To Chat
                        </a>
                        {#each navGroups as group}
                            <div class="space-y-2">
                                <p class="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
