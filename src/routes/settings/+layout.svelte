<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { initLocale, locale, localizeSettings, setLocale, type LocaleKey } from "$lib/ui/i18n";

  type ThemeMode = "system" | "light" | "dark";
  const LS_THEME = "molibot-web-theme";

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
      searchTools: "搜索工具",
      imageTools: "图片工具",
      videoTools: "视频工具",
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
      hostBash: "Host Bash",
      systemGroup: "系统",
      systemConfig: "系统配置",
      sandbox: "Sandbox",
      pluginsCore: "插件与核心",
      backToChat: "返回聊天",
      settings: "设置",
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
      searchTools: "Search Tools",
      imageTools: "Image Tools",
      videoTools: "Video Tools",
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
      hostBash: "Host Bash",
      systemGroup: "System",
      systemConfig: "System Config",
      sandbox: "Sandbox",
      pluginsCore: "Plugins & Core",
      backToChat: "Back To Chat",
      settings: "Settings",
      openChat: "Open Chat",
      navigateSettings: "Navigate Settings",
      theme: "Theme",
      language: "Language"
    }
  };

  let themeMode: ThemeMode = "light";

  function t(key: string): string {
    return COPY[$locale][key] ?? key;
  }

  /* ── Derive active group from current URL ── */
  function findActiveGroup(pathname: string): string {
    const p = normalizePath(pathname);
    if (p.startsWith("/settings/ai") || p === "/settings/mcp" || p === "/settings/search" || p === "/settings/image" || p === "/settings/video") return "ai";
    if (p.startsWith("/settings/web") || p.startsWith("/settings/telegram") || p.startsWith("/settings/weixin") || p.startsWith("/settings/feishu") || p.startsWith("/settings/qq")) return "channels";
    if (p.startsWith("/settings/agents") || p.startsWith("/settings/memory") || p.startsWith("/settings/skills") || p.startsWith("/settings/skill-drafts") || p.startsWith("/settings/run-history") || p.startsWith("/settings/tasks") || p.startsWith("/settings/host-bash")) return "data";
    if (p.startsWith("/settings/system") || p.startsWith("/settings/sandbox") || p.startsWith("/settings/plugins")) return "system";
    return "general";
  }

  /* ── i18n-synced group array ── */
  $: navGroups = [
    { key: "general", icon: "✦", title: t("general"), links: [{ href: "/settings", label: t("overview"), exact: true }] },
    { key: "ai", icon: "◈", title: t("aiEngine"), links: [
        { href: "/settings/ai/routing", label: t("routingPrompt"), exact: true },
        { href: "/settings/ai/providers", label: t("providersModels"), exact: true },
        { href: "/settings/ai/usage", label: t("usageStats"), exact: true },
        { href: "/settings/ai/errors", label: t("modelErrors"), exact: true },
        { href: "/settings/mcp", label: t("mcpServers"), exact: true },
        { href: "/settings/search", label: t("searchTools"), exact: true },
        { href: "/settings/image", label: t("imageTools"), exact: true },
        { href: "/settings/video", label: t("videoTools"), exact: true },
      ] },
    { key: "channels", icon: "▣", title: t("channels"), links: [
        { href: "/settings/web", label: t("webProfiles"), exact: true },
        { href: "/settings/telegram", label: t("telegramBot"), exact: true },
        { href: "/settings/weixin", label: t("wechatBot"), exact: true },
        { href: "/settings/feishu", label: t("feishuBot"), exact: true },
        { href: "/settings/qq", label: t("qqBot"), exact: true },
      ] },
    { key: "data", icon: "◉", title: t("agentData"), links: [
        { href: "/settings/agents", label: t("agents"), exact: true },
        { href: "/settings/memory", label: t("memory"), exact: true },
        { href: "/settings/memory-rejections", label: t("memoryRejections"), exact: true },
        { href: "/settings/skills", label: t("skills"), exact: true },
        { href: "/settings/skill-drafts", label: t("skillDrafts"), exact: true },
        { href: "/settings/run-history", label: t("runHistory"), exact: true },
        { href: "/settings/tasks", label: t("tasks"), exact: true },
        { href: "/settings/host-bash", label: t("hostBash"), exact: true },
      ] },
    { key: "system", icon: "⚙", title: t("systemGroup"), links: [
        { href: "/settings/system", label: t("systemConfig"), exact: true },
        { href: "/settings/sandbox", label: t("sandbox"), exact: true },
        { href: "/settings/plugins", label: t("pluginsCore"), exact: true },
      ] },
  ];

  $: activeGroupKey = findActiveGroup($page.url.pathname);
  $: activeGroup = navGroups.find(g => g.key === activeGroupKey) ?? navGroups[0];
  $: flatLinks = navGroups.flatMap((group) => group.links);

  function normalizePath(path: string): string {
    if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
    return path;
  }

  function isActive(pathname: string, href: string, exact: boolean = false) {
    const path = normalizePath(pathname);
    const target = normalizePath(href);
    if (exact) return path === target;
    return path === target || path.startsWith(`${target}/`);
  }

  function navLinkClass(
    pathname: string,
    href: string,
    exact: boolean = false,
  ): string {
    const active = isActive(pathname, href, exact);
    return active ? "settings-nav-link settings-nav-link--active" : "settings-nav-link";
  }

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

  function onThemeModeChange(event: Event): void {
    themeMode = (event.target as HTMLSelectElement).value as ThemeMode;
    applyTheme(themeMode);
    localStorage.setItem(LS_THEME, themeMode);
  }

  function toggleTheme(): void {
    themeMode = themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
    applyTheme(themeMode);
    localStorage.setItem(LS_THEME, themeMode);
  }

  function onLocaleChange(event: Event): void {
    setLocale((event.target as HTMLSelectElement).value as LocaleKey);
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

    initLocale();

    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  });
</script>

<main
  class="settings-shell settings-theme text-foreground antialiased selection:bg-[color-mix(in_oklab,var(--primary)_30%,transparent)]"
  use:localizeSettings={$locale}
>
  <!-- Three-column grid: icon sidebar | page sidebar | content -->
  <div class="settings-layout-grid">

    <!-- ── Primary Sidebar: Icon Navigation (72px) ── -->
    <aside class="settings-sidebar-primary">
      <a href="/settings" class="settings-pnav-brand" title={t("settings")}>
        <span class="settings-brand-dot" aria-hidden="true"></span>
      </a>
      {#each navGroups as group}
        <a
          href={group.links[0].href}
          class="settings-pnav-icon"
          class:settings-pnav-icon--active={activeGroupKey === group.key}
          title={group.title}
          aria-current={activeGroupKey === group.key ? "true" : undefined}
        >
          {group.icon}
        </a>
      {/each}
      <div class="settings-pnav-spacer"></div>
      <button type="button" class="settings-pnav-icon settings-pnav-theme" onclick={toggleTheme} title={t("theme")} aria-label={t("theme")}>
        {themeMode === "dark" ? "☼" : "☾"}
      </button>
    </aside>

    <!-- ── Secondary Sidebar: Page Links (260px) ── -->
    <aside class="settings-sidebar-secondary">
      <div class="settings-snav-title">{activeGroup.title}</div>
      <nav class="settings-snav-list">
        {#each activeGroup.links as link}
          <a
            href={link.href}
            class={navLinkClass($page.url.pathname, link.href, link.exact)}
            aria-current={isActive($page.url.pathname, link.href, link.exact) ? "page" : undefined}
          >
            {link.label}
          </a>
        {/each}
      </nav>
    </aside>

    <!-- ── Main Content Area ── -->
    <section class="settings-stage">
      <header class="settings-topbar">
        <div class="settings-topbar-breadcrumb">
          <span class="settings-topbar-label">{t("settings")}</span>
          <span class="settings-topbar-sep" aria-hidden="true">›</span>
          <span class="settings-topbar-page">{currentPageLabel($page.url.pathname)}</span>
        </div>
        <div class="settings-topbar-actions">
          <NativeSelect
            class="settings-topbar-select"
            value={$locale}
            onchange={onLocaleChange}
            aria-label={t("language")}
          >
            <NativeSelectOption value="zh-CN">中文</NativeSelectOption>
            <NativeSelectOption value="en-US">English</NativeSelectOption>
          </NativeSelect>
          <a href="/" class="settings-topbar-chat">
            {t("openChat")}
          </a>
        </div>
      </header>

      <!-- Mobile nav (hidden on desktop) -->
      <details class="settings-mobile-nav">
        <summary class="settings-mobile-summary">
          {t("navigateSettings")}
        </summary>
        <div class="settings-mobile-body">
          <button type="button" class="settings-mobile-theme-toggle" onclick={toggleTheme} title={t("theme")} aria-label={t("theme")}>
            <span class="settings-mobile-theme-icon">{themeMode === "dark" ? "☼" : "☾"}</span>
            <span>{t("theme")}: {themeMode === "light" ? "Light" : themeMode === "dark" ? "Dark" : "System"}</span>
          </button>
          {#each navGroups as group}
            <div class="settings-mobile-group">
              <p class="settings-mobile-group-label">{group.title}</p>
              {#each group.links as link}
                <a
                  href={link.href}
                  class={navLinkClass(
                    $page.url.pathname,
                    link.href,
                    link.exact,
                  )}
                >
                  {link.label}
                </a>
              {/each}
            </div>
          {/each}
        </div>
      </details>

      <div class="settings-viewport">
        <slot />
      </div>
    </section>
  </div>
</main>

<style>
  /* ── Layout Grid ── */
  .settings-layout-grid {
    display: grid;
    grid-template-columns: 72px 260px 1fr;
    height: 100dvh;
    width: 100%;
  }

  /* ── Primary Sidebar (icon column) ── */
  .settings-sidebar-primary {
    background: var(--card);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem 0;
    gap: 1.25rem;
    z-index: 20;
  }

  .settings-pnav-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-bottom: 0.625rem;
    text-decoration: none;
  }

  .settings-brand-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--primary);
    flex-shrink: 0;
  }

  .settings-pnav-icon {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.625rem;
    cursor: pointer;
    color: var(--muted-foreground);
    text-decoration: none;
    font-size: 1.25rem;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .settings-pnav-icon:hover {
    background: var(--background);
    color: var(--foreground);
  }

  .settings-pnav-icon--active {
    background: color-mix(in oklab, var(--primary) 12%, var(--card));
    color: var(--primary);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 15%, transparent);
  }

  .settings-pnav-theme {
    font-size: 1.125rem;
    opacity: 0.7;
    transition: opacity 160ms ease, background 160ms ease;
  }

  .settings-pnav-theme:hover {
    opacity: 1;
  }

  .settings-pnav-spacer {
    flex: 1;
  }

  /* ── Secondary Sidebar (page list) ── */
  .settings-sidebar-secondary {
    background: var(--card);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 1.5rem 1rem;
    z-index: 10;
  }

  .settings-snav-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted-foreground);
    margin: 0 0.75rem 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .settings-snav-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow-y: auto;
    flex: 1;
  }

  /* ── Navigation links (shared between sidenav and mobile) ── */
  :global(.settings-nav-link) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.875rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    text-decoration: none;
    transition: background-color 150ms ease, color 150ms ease;
  }

  :global(.settings-nav-link:hover) {
    background: var(--background);
  }

  :global(.settings-nav-link--active) {
    background: color-mix(in oklab, var(--primary) 12%, var(--card));
    color: var(--primary);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 15%, transparent);
  }

  :global(.settings-nav-link--active:hover) {
    background: color-mix(in oklab, var(--primary) 16%, var(--card));
  }

  /* ── Main Content Stage ── */
  .settings-stage {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100dvh;
    overflow: hidden;
    position: relative;
    background: var(--background);
  }

  /* ── Top Bar ── */
  .settings-topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    height: 3.75rem;
    min-height: 3.75rem;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2rem;
    backdrop-filter: blur(12px);
  }

  .settings-topbar-breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .settings-topbar-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }

  .settings-topbar-sep {
    font-size: 1rem;
    color: var(--border);
    line-height: 1;
  }

  .settings-topbar-page {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-topbar-actions {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-shrink: 0;
  }

  :global(.settings-topbar-select) {
    width: auto;
    font-size: 0.75rem;
  }

  .settings-topbar-chat {
    display: inline-flex;
    align-items: center;
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--primary);
    text-decoration: none;
    transition: opacity 160ms ease;
  }

  .settings-topbar-chat:hover {
    opacity: 0.8;
  }

  /* ── Viewport (scrollable content) ── */
  .settings-viewport {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2rem 4.5rem;
  }

  /* ── Fixed Footer Bar ── */
  :global(.settings-footbar) {
    position: fixed;
    bottom: 0;
    left: calc(72px + 260px);
    right: 0;
    z-index: 5;
    height: 3.5rem;
    background: color-mix(in oklab, var(--card) 85%, transparent);
    border-top: 1px solid var(--border);
    backdrop-filter: blur(16px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2rem;
  }

  :global(.settings-footbar-status) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  :global(.settings-footbar-ok) {
    font-size: 0.8125rem;
    font-weight: 500;
    color: oklch(55% 0.15 155);
  }

  :global(.settings-footbar-error) {
    font-size: 0.8125rem;
    font-weight: 500;
    color: oklch(55% 0.2 25);
  }

  :global(.settings-footbar-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 1.5rem;
    border-radius: 0.375rem;
    border: none;
    background: var(--primary);
    color: var(--primary-foreground, oklch(99% 0 0));
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 160ms ease;
    flex-shrink: 0;
  }

  :global(.settings-footbar-btn:hover:not(:disabled)) { opacity: 0.88; }
  :global(.settings-footbar-btn:disabled) { opacity: 0.5; cursor: not-allowed; }

  :global(.settings-footbar-saving) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }

  :global(.settings-footbar-pulse) {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: oklch(60% 0.15 35);
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  :global(.settings-footbar-actions) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  /* ── Mobile Nav ── */
  .settings-mobile-nav {
    display: none;
    margin: 0.75rem 1rem 0;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--card) 82%, transparent);
    padding: 0.5rem;
  }

  .settings-mobile-summary {
    cursor: pointer;
    user-select: none;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--foreground);
  }

  .settings-mobile-body {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0 0.25rem 0.25rem;
  }

  .settings-mobile-theme-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--foreground);
    background: transparent;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: background 160ms ease;
  }

  .settings-mobile-theme-toggle:hover {
    background: var(--background);
  }

  .settings-mobile-theme-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .settings-mobile-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .settings-mobile-group-label {
    padding: 0 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
  }

  /* ── Responsive: collapse sidebars on mobile ── */
  @media (max-width: 1023px) {
    .settings-layout-grid {
      grid-template-columns: 1fr;
    }

    .settings-sidebar-primary,
    .settings-sidebar-secondary {
      display: none;
    }

    .settings-mobile-nav {
      display: block;
    }

    :global(.settings-footbar) {
      left: 0;
    }

    .settings-viewport {
      padding-bottom: 4.5rem;
    }
  }
</style>
