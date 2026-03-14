<script lang="ts">
  import PageShell from "$lib/ui/PageShell.svelte";
  import Card from "$lib/ui/Card.svelte";

  const entries = [
    {
      title: "AI Engine",
      description: "Configure model routing, system prompts, and custom providers.",
      href: "/settings/ai/routing",
      action: "Open"
    },
    {
      title: "Providers & Models",
      description: "Manage built-in/custom providers and verify model capabilities.",
      href: "/settings/ai/providers",
      action: "Open"
    },
    {
      title: "Usage Stats",
      description: "Monitor token usage trends and model-level consumption.",
      href: "/settings/ai/usage",
      action: "Open"
    },
    {
      title: "Agents",
      description: "Define reusable agent identities and profile files.",
      href: "/settings/agents",
      action: "Open"
    },
    {
      title: "Web Profiles",
      description: "Manage web profile instances and agent bindings.",
      href: "/settings/web",
      action: "Open"
    },
    {
      title: "Telegram / Feishu / QQ",
      description: "Configure channel bots and credentials.",
      href: "/settings/telegram",
      action: "Open"
    },
    {
      title: "Memory",
      description: "Search, sync, compact, and edit memory items.",
      href: "/settings/memory",
      action: "Open"
    },
    {
      title: "Skills",
      description: "Inspect installed skills and enable/disable runtime usage.",
      href: "/settings/skills",
      action: "Open"
    },
    {
      title: "Tasks",
      description: "Review scheduled tasks, trigger jobs, and clean stale entries.",
      href: "/settings/tasks",
      action: "Open"
    },
    {
      title: "MCP Servers",
      description: "Configure stdio/http MCP endpoints and server status.",
      href: "/settings/mcp",
      action: "Open"
    },
    {
      title: "Plugins",
      description: "Control core plugin toggles and memory backend selection.",
      href: "/settings/plugins",
      action: "Open"
    }
  ];
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-8">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight text-[var(--foreground)]">Settings Overview</h1>
    <p class="text-sm text-[var(--muted-foreground)]">
      Unified configuration workspace for runtime, channels, data, and operations.
    </p>
  </header>

  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {#each entries as item}
      <a class="group block" href={item.href}>
        <Card className="flex min-h-[154px] flex-col justify-between p-5 transition-colors group-hover:bg-[var(--muted)]">
          <div>
            <h2 class="text-base font-semibold text-[var(--foreground)]">{item.title}</h2>
            <p class="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{item.description}</p>
          </div>
          <div class="mt-4 text-xs font-medium text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--foreground)]">
            {item.action} →
          </div>
        </Card>
      </a>
    {/each}
  </div>
</PageShell>
