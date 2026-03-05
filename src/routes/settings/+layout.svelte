<script lang="ts">
    import { page } from "$app/stores";

    // Sidebar navigation structured by group
    const navGroups = [
        {
            title: "General",
            links: [
                { href: "/", label: "Chat", exact: true },
                { href: "/settings", label: "Overview", exact: true },
            ],
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
</script>

<main
    class="flex h-screen w-full bg-[#1e1e1e] text-slate-100 antialiased selection:bg-emerald-500/30"
>
    <div class="grid h-full w-full grid-cols-1 lg:grid-cols-[280px_1fr]">
        <!-- Sidebar -->
        <aside
            class="hidden flex-col border-r border-white/[0.08] bg-[#141414] p-4 lg:flex"
        >
            <div class="mb-6 px-3">
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

        <!-- Main Content -->
        <section class="relative min-h-0 w-full overflow-y-auto">
            <slot />
        </section>
    </div>
</main>
