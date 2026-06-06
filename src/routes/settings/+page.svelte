<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { locale } from "$lib/ui/i18n";
  import Cpu from "@lucide/svelte/icons/cpu";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import Settings from "@lucide/svelte/icons/settings";
  import type { Component } from "svelte";

  type Section = { title: string; href: string };
  type Group = {
    icon: Component;
    title: string;
    description: string;
    badge: string;
    sections: Section[];
  };

  const COPY: Record<string, { title: string; subtitle: string; groups: Group[] }> = {
    "zh-CN": {
      title: "控制中心",
      subtitle: "AI 引擎、消息渠道和运行状态——从一个地方管理。",
      groups: [
        {
          icon: Cpu,
          title: "AI 智能",
          description: "配置引擎路由、模型提供方、用量和错误跟踪。",
          badge: "8 个模块",
          sections: [
            { title: "引擎路由", href: "/settings/ai/routing" },
            { title: "模型与提供方", href: "/settings/ai/providers" },
            { title: "用量统计", href: "/settings/ai/usage" },
            { title: "错误记录", href: "/settings/ai/errors" },
            { title: "MCP 服务", href: "/settings/mcp" },
            { title: "搜索工具", href: "/settings/search" },
            { title: "图片工具", href: "/settings/image" },
            { title: "视频工具", href: "/settings/video" },
          ],
        },
        {
          icon: MessageSquare,
          title: "消息渠道",
          description: "管理 Telegram、微信、飞书、QQ 和 Web 端接入。",
          badge: "5 个渠道",
          sections: [
            { title: "Web 配置", href: "/settings/web" },
            { title: "Telegram 机器人", href: "/settings/telegram" },
            { title: "微信机器人", href: "/settings/weixin" },
            { title: "飞书机器人", href: "/settings/feishu" },
            { title: "QQ 机器人", href: "/settings/qq" },
          ],
        },
        {
          icon: BookOpen,
          title: "知识与数据",
          description: "管理助手记忆、技能、运行历史和任务调度。",
          badge: "8 个模块",
          sections: [
            { title: "Agents", href: "/settings/agents" },
            { title: "记忆", href: "/settings/memory" },
            { title: "记忆拒绝记录", href: "/settings/memory-rejections" },
            { title: "技能", href: "/settings/skills" },
            { title: "技能草稿", href: "/settings/skill-drafts" },
            { title: "运行历史", href: "/settings/run-history" },
            { title: "任务", href: "/settings/tasks" },
            { title: "Host Bash", href: "/settings/host-bash" },
          ],
        },
        {
          icon: Settings,
          title: "系统",
          description: "系统配置、沙箱安全和插件管理。",
          badge: "3 个页面",
          sections: [
            { title: "系统配置", href: "/settings/system" },
            { title: "Sandbox", href: "/settings/sandbox" },
            { title: "插件与核心", href: "/settings/plugins" },
          ],
        },
      ],
    },
    "en-US": {
      title: "Control Center",
      subtitle: "AI engine, messaging channels, and runtime controls — all in one place.",
      groups: [
        {
          icon: Cpu,
          title: "AI Intelligence",
          description: "Configure engine routing, model providers, usage, and error tracking.",
          badge: "8 Sections",
          sections: [
            { title: "Engine Routing", href: "/settings/ai/routing" },
            { title: "Providers & Models", href: "/settings/ai/providers" },
            { title: "Usage Stats", href: "/settings/ai/usage" },
            { title: "Error Logs", href: "/settings/ai/errors" },
            { title: "MCP Servers", href: "/settings/mcp" },
            { title: "Search Tools", href: "/settings/search" },
            { title: "Image Tools", href: "/settings/image" },
            { title: "Video Tools", href: "/settings/video" },
          ],
        },
        {
          icon: MessageSquare,
          title: "Messaging",
          description: "Manage Telegram, WeChat, Feishu, QQ, and web-side bot access.",
          badge: "5 Channels",
          sections: [
            { title: "Web Profiles", href: "/settings/web" },
            { title: "Telegram Bot", href: "/settings/telegram" },
            { title: "WeChat Bot", href: "/settings/weixin" },
            { title: "Feishu Bot", href: "/settings/feishu" },
            { title: "QQ Bot", href: "/settings/qq" },
          ],
        },
        {
          icon: BookOpen,
          title: "Knowledge",
          description: "Manage assistant memory, skills, run history, and scheduled tasks.",
          badge: "8 Modules",
          sections: [
            { title: "Agents", href: "/settings/agents" },
            { title: "Memory", href: "/settings/memory" },
            { title: "Memory Rejections", href: "/settings/memory-rejections" },
            { title: "Skills", href: "/settings/skills" },
            { title: "Skill Drafts", href: "/settings/skill-drafts" },
            { title: "Run History", href: "/settings/run-history" },
            { title: "Tasks", href: "/settings/tasks" },
            { title: "Host Bash", href: "/settings/host-bash" },
          ],
        },
        {
          icon: Settings,
          title: "System",
          description: "System configuration, sandbox security, and plugin management.",
          badge: "3 Pages",
          sections: [
            { title: "System Config", href: "/settings/system" },
            { title: "Sandbox", href: "/settings/sandbox" },
            { title: "Plugins & Core", href: "/settings/plugins" },
          ],
        },
      ],
    },
  };

  let copy = $derived(COPY[$locale]);
</script>

<div class="settings-overview">
  <header class="settings-overview-header">
    <h1 class="settings-overview-title">{copy.title}</h1>
    <p class="settings-overview-subtitle">{copy.subtitle}</p>
  </header>

  <div class="settings-overview-grid">
    {#each copy.groups as group}
      {@const Icon = group.icon}
      <div class="settings-feature-card">
        <div class="settings-feature-card-head">
          <Icon class="settings-feature-icon" size={24} strokeWidth={1.8} />
          <Badge variant="default" class="settings-feature-badge">{group.badge}</Badge>
        </div>
        <h2 class="settings-feature-title">{group.title}</h2>
        <p class="settings-feature-desc">{group.description}</p>
        <nav class="settings-feature-sections">
          {#each group.sections as section}
            <a href={section.href} class="settings-feature-section-link">
              <span>{section.title}</span>
              <span class="settings-feature-arrow" aria-hidden="true">→</span>
            </a>
          {/each}
        </nav>
      </div>
    {/each}
  </div>
</div>

<style>
  .settings-overview {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem;
  }

  @media (min-width: 640px) {
    .settings-overview {
      padding: 2.5rem 2.5rem;
    }
  }

  /* Header */
  .settings-overview-header {
    margin-bottom: 2.5rem;
  }

  .settings-overview-title {
    font-family: var(--font-serif);
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--foreground);
    margin: 0 0 0.5rem;
  }

  @media (min-width: 640px) {
    .settings-overview-title {
      font-size: 2.5rem;
    }
  }

  .settings-overview-subtitle {
    font-size: 0.9375rem;
    line-height: 1.7;
    color: var(--muted-foreground);
    margin: 0;
    max-width: 42rem;
  }

  /* Card Grid */
  .settings-overview-grid {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: 1fr;
  }

  @media (min-width: 640px) {
    .settings-overview-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* Feature Card */
  .settings-feature-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: var(--shadow-xs);
    transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
  }

  .settings-feature-card:hover {
    border-color: color-mix(in oklab, var(--primary) 35%, var(--border));
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .settings-feature-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  :global(.settings-feature-icon) {
    color: var(--primary);
  }

  :global(.settings-feature-badge) {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
  }

  .settings-feature-title {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--foreground);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .settings-feature-desc {
    font-size: 0.875rem;
    line-height: 1.65;
    color: var(--muted-foreground);
    margin: 0;
  }

  /* Subsection Links */
  .settings-feature-sections {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin-top: 0.5rem;
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
  }

  .settings-feature-section-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    text-decoration: none;
    transition: background-color 150ms ease, color 150ms ease;
  }

  .settings-feature-section-link:hover {
    background: var(--muted);
    color: var(--foreground);
  }

  .settings-feature-arrow {
    font-size: 0.75rem;
    opacity: 0;
    transition: opacity 150ms ease, transform 150ms ease;
    transform: translateX(-4px);
  }

  .settings-feature-section-link:hover .settings-feature-arrow {
    opacity: 1;
    transform: translateX(0);
  }

  :global(.dark) .settings-feature-card {
    background: color-mix(in oklab, var(--card) 92%, transparent);
  }
</style>
