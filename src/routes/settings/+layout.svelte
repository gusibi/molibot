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
                { href: "/settings/ai/routing", label: "Routing & Prompt" },
                { href: "/settings/ai/providers", label: "Providers & Models" },
                { href: "/settings/ai/usage", label: "Usage Stats" },
            ],
        },
        {
            title: "Channels",
            links: [
                { href: "/settings/telegram", label: "Telegram Bot" },
                { href: "/settings/feishu", label: "Feishu Bot" },
            ],
        },
        {
            title: "Agent Data",
            links: [
                { href: "/settings/agents", label: "Agents" },
                { href: "/settings/memory", label: "Memory" },
                { href: "/settings/skills", label: "Skills" },
                { href: "/settings/tasks", label: "Tasks" },
            ],
        },
        {
            title: "System",
            links: [{ href: "/settings/plugins", label: "Plugins & Core" }],
        },
    ];

    $: currentPath = $page.url.pathname;

    function isActive(href: string, exact: boolean = false) {
        if (exact) {
            return currentPath === href;
        }
        return currentPath.startsWith(href);
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
                                    class="block rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 {isActive(
                                        link.href,
                                        (link as any).exact,
                                    )
                                        ? 'bg-emerald-500/10 text-emerald-400'
                                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}"
                                >
                                    {link.label}
                                </a>
                            {/each}
                        </div>
                    </div>
                {/each}
            </nav>
        </aside>

        <!-- Main Content -->
        <section class="relative min-h-0 w-full overflow-y-auto">
            <slot />
        </section>
    </div>
</main>
