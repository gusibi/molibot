<script lang="ts">
  import PageShell from "$lib/ui/PageShell.svelte";
  import Card from "$lib/ui/Card.svelte";
  import { locale } from "$lib/ui/i18n";

  const COPY = {
    "zh-CN": {
      eyebrow: "设置总览",
      title: "把模型、渠道和运行状态收在一个地方",
      subtitle: "从这里统一处理日常配置、检查风险点，也能更快定位哪里需要继续打磨。",
      badge: "常用入口",
      action: "打开",
      sections: [
        { title: "AI 引擎", description: "统一查看路由、提示词、模型能力和调用风险。", href: "/settings/ai/routing" },
        { title: "模型与提供方", description: "管理模型清单、默认选择和可用能力。", href: "/settings/ai/providers" },
        { title: "用量统计", description: "看最近的消耗趋势，避免成本和调用异常失控。", href: "/settings/ai/usage" },
        { title: "模型报错记录", description: "只看真正失败的调用，方便快速定位问题。", href: "/settings/ai/errors" },
        { title: "Agents", description: "整理可复用的角色、身份和长期规则。", href: "/settings/agents" },
        { title: "Web 配置", description: "管理网页侧配置实例，以及它们绑定到哪个助手。", href: "/settings/web" },
        { title: "渠道机器人", description: "集中处理 Telegram、微信、飞书、QQ 的接入状态。", href: "/settings/telegram" },
        { title: "记忆", description: "搜索、同步、整理和修正助手记住的内容。", href: "/settings/memory" },
        { title: "技能", description: "查看已安装技能，确认哪些能力真的在运行。", href: "/settings/skills" },
        { title: "任务", description: "检查定时任务、补跑任务和清理过期项。", href: "/settings/tasks" },
        { title: "MCP 服务", description: "管理外部工具连接和运行状态。", href: "/settings/mcp" },
        { title: "ACP 目标", description: "维护 coding-agent 目标、项目范围和默认审批方式。", href: "/settings/acp" },
        { title: "插件与核心", description: "控制插件开关，以及底层运行能力的总设置。", href: "/settings/plugins" }
      ]
    },
    "en-US": {
      eyebrow: "Settings Overview",
      title: "Keep models, channels, and runtime controls in one place",
      subtitle: "Use this workspace to handle day-to-day configuration, spot operational risk, and see what still needs polish.",
      badge: "Core Sections",
      action: "Open",
      sections: [
        { title: "AI Engine", description: "Review routing, prompts, model capability, and request risk in one place.", href: "/settings/ai/routing" },
        { title: "Providers & Models", description: "Manage the model catalog, defaults, and available capabilities.", href: "/settings/ai/providers" },
        { title: "Usage Stats", description: "Track recent usage before cost and call volume drift out of control.", href: "/settings/ai/usage" },
        { title: "Model Error Logs", description: "Focus on the requests that actually failed so debugging is faster.", href: "/settings/ai/errors" },
        { title: "Agents", description: "Maintain reusable roles, identities, and long-term behavior rules.", href: "/settings/agents" },
        { title: "Web Profiles", description: "Manage web-side profiles and which assistant each one uses.", href: "/settings/web" },
        { title: "Channel Bots", description: "Handle Telegram, WeChat, Feishu, and QQ access in one place.", href: "/settings/telegram" },
        { title: "Memory", description: "Search, sync, tidy, and correct what the assistant remembers.", href: "/settings/memory" },
        { title: "Skills", description: "Inspect installed skills and verify which capabilities are truly live.", href: "/settings/skills" },
        { title: "Tasks", description: "Check scheduled jobs, reruns, and stale work items.", href: "/settings/tasks" },
        { title: "MCP Servers", description: "Manage external tool connections and live server status.", href: "/settings/mcp" },
        { title: "ACP Targets", description: "Maintain coding-agent targets, project scope, and approval defaults.", href: "/settings/acp" },
        { title: "Plugins & Core", description: "Control plugin toggles and the main runtime-level settings.", href: "/settings/plugins" }
      ]
    }
  } as const;

  $: copy = COPY[$locale];
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-8">
  <header class="relative overflow-hidden rounded-[1.8rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-6 py-7 shadow-[var(--shadow)] backdrop-blur-xl sm:px-8">
    <div class="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_right,rgba(18,132,168,0.12),transparent_60%)]"></div>
    <div class="relative space-y-3">
      <div class="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--muted)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
        {copy.eyebrow}
      </div>
      <div class="max-w-3xl space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">{copy.title}</h1>
        <p class="text-sm leading-7 text-[var(--muted-foreground)] sm:text-base">{copy.subtitle}</p>
      </div>
    </div>
  </header>

  <section class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div class="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)] shadow-[var(--shadow-sm)]">
        {copy.badge}
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {#each copy.sections as item}
        <a class="group block" href={item.href}>
          <Card className="flex min-h-[172px] flex-col justify-between rounded-[1.4rem] border-[color-mix(in_oklab,var(--border)_88%,transparent)] bg-[color-mix(in_oklab,var(--card)_92%,transparent)] p-5 shadow-[var(--shadow-sm)] transition duration-200 group-hover:-translate-y-1 group-hover:border-[color-mix(in_oklab,var(--primary)_34%,var(--border))] group-hover:shadow-[var(--shadow)]">
            <div class="space-y-3">
              <h2 class="text-lg font-semibold text-[var(--foreground)]">{item.title}</h2>
              <p class="text-sm leading-7 text-[var(--muted-foreground)]">{item.description}</p>
            </div>
            <div class="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--foreground)]">
              <span>{copy.action}</span>
              <span aria-hidden="true">→</span>
            </div>
          </Card>
        </a>
      {/each}
    </div>
  </section>
</PageShell>
