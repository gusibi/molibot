<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { locale } from "$lib/ui/i18n";

  type ApprovalCategory = "all" | "bash" | "mcp" | "file_write" | "miniapp";
  type ApprovalMode = "all" | "persistent" | "ephemeral" | "session";
  type ApprovalStatus = "all" | "approved" | "rejected" | "executed" | "failed" | "expired";

  interface ApprovalPermissions {
    envAllowlist: string[];
    filesystem: string;
    network: string;
  }

  interface ApprovalPendingAction {
    kind: string;
    originalCommand: string;
    args?: string[];
  }

  interface PendingRecord {
    id: string;
    toolId: string;
    category?: "bash" | "mcp" | "file_write" | "miniapp";
    displayName: string;
    command: string;
    reason: string;
    channel: string;
    chatId: string;
    scopeId: string;
    sessionId?: string;
    approvalMode: ApprovalMode;
    status: string;
    permissions: ApprovalPermissions;
    pendingAction?: ApprovalPendingAction;
    requestedAt: string;
    resolvedAt?: string;
    executedAt?: string;
    errorText?: string;
    payload?: { path?: string; diff?: string; parameters?: Record<string, unknown> };
  }

  interface WhitelistEntry {
    id: string;
    toolId: string;
    category?: "bash" | "mcp" | "file_write" | "miniapp";
    displayName: string;
    command: string;
    reason: string;
    channel: string;
    chatId: string;
    scopeId: string;
    permissions: ApprovalPermissions;
    approvedAt: string;
    approvedFromRecordId: string;
    enabled: boolean;
  }

  interface ApprovalsResponse {
    ok: boolean;
    pending: PendingRecord[];
    whitelist: WhitelistEntry[];
    history: PendingRecord[];
    counts: {
      pending: number;
      whitelist: number;
      whitelistEnabled: number;
      history: number;
    };
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "Approvals",
      title: "审批中心与白名单",
      desc: "统一审计待处理审批、长期白名单和历史记录。涵盖宿主命令行、MCP 外部工具调用、文件修改与应用扩展。",
      pendingHeading: "Pending",
      pendingSub: "等待聊天侧处理",
      whitelistHeading: "Whitelist",
      whitelistSub: "当前长期白名单",
      enabledHeading: "Enabled",
      enabledSub: "生效中的白名单",
      historyHeading: "History",
      historySub: "已结束审批记录",
      filtersTitle: "历史记录筛选",
      filtersDesc: "按分类、状态、审批模式和关键词筛选记录。",
      placeholderSearch: "搜索工具、命令、MCP Action、路径、原因...",
      allCategory: "全部分类",
      categoryBash: "命令行 (Bash)",
      categoryMcp: "MCP 工具",
      categoryFile: "文件修改",
      categoryMiniApp: "插件与应用",
      allStatus: "所有状态",
      statusApproved: "已批准",
      statusRejected: "已拒绝",
      statusExecuted: "已执行",
      statusFailed: "执行失败",
      statusExpired: "已超时",
      allMode: "所有模式",
      modePersistent: "持久白名单",
      modeEphemeral: "单次授权",
      modeSession: "Session 授权",
      btnRefresh: "刷新",
      pendingTitle: "待审批记录",
      pendingDesc: "只读查看。实际批准/拒绝在对应聊天会话中完成。",
      loading: "正在加载审批数据...",
      colTime: "时间",
      colCategory: "分类",
      colTool: "工具 / 动作",
      colMode: "模式",
      colCommand: "命令 / 参数",
      colScope: "作用域",
      noPending: "没有待处理的审批。",
      whitelistTitle: "白名单管理",
      whitelistDesc: "管理长期允许的命令与工具。可随时禁用或删除。",
      colApproved: "批准时间",
      colStatus: "状态",
      colActions: "操作",
      noWhitelist: "尚未添加长期白名单。",
      btnDisable: "禁用",
      btnEnable: "启用",
      btnDelete: "删除",
      historyTitle: "审批历史记录",
      historyDesc: "保留单次、会话和长期白名单审批的完整审计流水。",
      colReason: "原因 / 结果详情",
      noHistory: "没有匹配的历史记录。",
      failedLoad: "加载审批数据失败。",
      requestFailed: "请求失败。"
    },
    "en-US": {
      eyebrow: "Approvals",
      title: "Approval Center & Allowlist",
      desc: "Audit pending approval requests, durable allowlists, and execution logs across Host Bash, MCP tools, file writes, and Mini Apps.",
      pendingHeading: "Pending",
      pendingSub: "Waiting in chat",
      whitelistHeading: "Allowlist",
      whitelistSub: "Active persistent allowlists",
      enabledHeading: "Enabled",
      enabledSub: "Durable active entries",
      historyHeading: "History",
      historySub: "Resolved approval logs",
      filtersTitle: "History Filters",
      filtersDesc: "Filter approval logs by category, status, mode, and query strings.",
      placeholderSearch: "Search tool, command, MCP action, path, reason...",
      allCategory: "All Categories",
      categoryBash: "Command (Bash)",
      categoryMcp: "MCP Tools",
      categoryFile: "File Write",
      categoryMiniApp: "Plugins & Apps",
      allStatus: "All status",
      statusApproved: "Approved",
      statusRejected: "Rejected",
      statusExecuted: "Executed",
      statusFailed: "Failed",
      statusExpired: "Expired",
      allMode: "All mode",
      modePersistent: "Persistent",
      modeEphemeral: "One-time",
      modeSession: "Session",
      btnRefresh: "Refresh",
      pendingTitle: "Pending Approvals",
      pendingDesc: "Read-only audit view. Approvals resolve in chat environments.",
      loading: "Loading approval data...",
      colTime: "Time",
      colCategory: "Category",
      colTool: "Tool / Action",
      colMode: "Mode",
      colCommand: "Command / Target",
      colScope: "Scope",
      noPending: "No pending approval requests.",
      whitelistTitle: "Allowlist Management",
      whitelistDesc: "Manage durable approval grants. You can temporarily disable or remove entries.",
      colApproved: "Approved At",
      colStatus: "Status",
      colActions: "Actions",
      noWhitelist: "No durable allowlists registered yet.",
      btnDisable: "Disable",
      btnEnable: "Enable",
      btnDelete: "Delete",
      historyTitle: "Approval History",
      historyDesc: "Audit trail of one-time, session, and persistent approval executions.",
      colReason: "Reason / Error Details",
      noHistory: "No matching history logs found.",
      failedLoad: "Failed to load approval data.",
      requestFailed: "Request failed."
    }
  };

  $: t = (key: keyof (typeof COPY)["zh-CN"]) => {
    const lang = ($locale || "zh-CN") as "zh-CN" | "en-US";
    return COPY[lang]?.[key] ?? COPY["zh-CN"][key] ?? key;
  };

  let loading = false;
  let errorMsg = "";
  let successMsg = "";

  let selectedCategory: ApprovalCategory = "all";
  let selectedStatus: ApprovalStatus = "all";
  let selectedMode: ApprovalMode = "all";
  let searchQuery = "";

  let pendingList: PendingRecord[] = [];
  let whitelist: WhitelistEntry[] = [];
  let history: PendingRecord[] = [];
  let counts = {
    pending: 0,
    whitelist: 0,
    whitelistEnabled: 0,
    history: 0
  };

  function formatDate(isoStr?: string): string {
    if (!isoStr) return "-";
    try {
      const d = new Date(isoStr);
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    } catch {
      return isoStr;
    }
  }

  function getCategoryLabel(cat?: string): string {
    if (cat === "mcp") return t("categoryMcp");
    if (cat === "file_write") return t("categoryFile");
    if (cat === "miniapp") return t("categoryMiniApp");
    return t("categoryBash");
  }

  function getCategoryBadgeClass(cat?: string): string {
    if (cat === "mcp") return "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:border-purple-500/30 dark:bg-purple-950/30 dark:text-purple-400";
    if (cat === "file_write") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-400";
    if (cat === "miniapp") return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400";
    return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:border-blue-500/30 dark:bg-blue-950/30 dark:text-blue-400";
  }

  function getStatusBadgeClass(status?: string): string {
    switch (status) {
      case "approved":
        return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:border-sky-500/30 dark:bg-sky-950/30 dark:text-sky-400";
      case "executed":
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-400";
      case "rejected":
        return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:border-rose-500/30 dark:bg-rose-950/30 dark:text-rose-400";
      case "failed":
        return "border-red-500/30 bg-red-500/10 text-red-600 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-400";
      case "expired":
        return "border-neutral-500/30 bg-neutral-500/10 text-neutral-500 dark:border-neutral-500/30 dark:bg-neutral-900/30 dark:text-neutral-400";
      case "pending":
        return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400";
      default:
        return "border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dark:border-neutral-500/30 dark:bg-neutral-950/30 dark:text-neutral-400";
    }
  }

  function getModeLabel(mode?: string): string {
    switch (mode) {
      case "persistent":
        return t("modePersistent");
      case "session":
        return t("modeSession");
      case "ephemeral":
      default:
        return t("modeEphemeral");
    }
  }

  async function loadData() {
    loading = true;
    errorMsg = "";
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (selectedStatus !== "all") params.set("status", selectedStatus);
      if (selectedMode !== "all") params.set("mode", selectedMode);
      if (searchQuery.trim()) params.set("query", searchQuery.trim());

      const res = await fetch(`/api/settings/approvals?${params.toString()}`);
      if (!res.ok) throw new Error(`${t("failedLoad")} (${res.status})`);
      const data = (await res.json()) as ApprovalsResponse;
      if (data.ok) {
        pendingList = data.pending || [];
        whitelist = data.whitelist || [];
        history = data.history || [];
        counts = data.counts || { pending: 0, whitelist: 0, whitelistEnabled: 0, history: 0 };
      } else {
        throw new Error(t("failedLoad"));
      }
    } catch (e: any) {
      errorMsg = e.message || t("failedLoad");
    } finally {
      loading = false;
    }
  }

  async function toggleWhitelist(id: string, enabled: boolean) {
    try {
      const res = await fetch("/api/settings/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_whitelist", id, enabled })
      });
      if (!res.ok) throw new Error(t("requestFailed"));
      const data = await res.json();
      if (data.ok) {
        await loadData();
      }
    } catch (e: any) {
      errorMsg = e.message || t("requestFailed");
    }
  }

  async function deleteWhitelist(id: string) {
    if (!confirm("确定要删除这条白名单吗？")) return;
    try {
      const res = await fetch("/api/settings/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_whitelist", id })
      });
      if (!res.ok) throw new Error(t("requestFailed"));
      const data = await res.json();
      if (data.ok) {
        await loadData();
      }
    } catch (e: any) {
      errorMsg = e.message || t("requestFailed");
    }
  }

  async function deleteHistory(id: string) {
    try {
      const res = await fetch("/api/settings/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_history", id })
      });
      if (!res.ok) throw new Error(t("requestFailed"));
      const data = await res.json();
      if (data.ok) {
        history = history.filter((item) => item.id !== id);
        counts.history = Math.max(0, counts.history - 1);
      }
    } catch (e: any) {
      errorMsg = e.message || t("requestFailed");
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<svelte:head>
  <title>{t("title")} - Molibot</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="space-y-1">
    <span class="text-xs font-semibold tracking-wider text-[var(--primary)] uppercase">{t("eyebrow")}</span>
    <h1 class="text-2xl font-bold tracking-tight text-[var(--foreground)]">{t("title")}</h1>
    <p class="text-sm text-[var(--muted-foreground)]">{t("desc")}</p>
  </div>

  {#if errorMsg}
    <div class="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      {errorMsg}
    </div>
  {/if}

  <!-- Stats Grid -->
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div class="text-xs font-medium text-[var(--muted-foreground)]">{t("pendingHeading")}</div>
      <div class="mt-1 text-2xl font-bold text-[var(--foreground)]">{counts.pending}</div>
      <div class="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("pendingSub")}</div>
    </div>
    <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div class="text-xs font-medium text-[var(--muted-foreground)]">{t("whitelistHeading")}</div>
      <div class="mt-1 text-2xl font-bold text-[var(--foreground)]">{counts.whitelist}</div>
      <div class="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("whitelistSub")}</div>
    </div>
    <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div class="text-xs font-medium text-[var(--muted-foreground)]">{t("enabledHeading")}</div>
      <div class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{counts.whitelistEnabled}</div>
      <div class="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("enabledSub")}</div>
    </div>
    <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div class="text-xs font-medium text-[var(--muted-foreground)]">{t("historyHeading")}</div>
      <div class="mt-1 text-2xl font-bold text-[var(--foreground)]">{counts.history}</div>
      <div class="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("historySub")}</div>
    </div>
  </div>

  <!-- Filters Card -->
  <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-[var(--foreground)]">{t("filtersTitle")}</h2>
      <p class="text-xs text-[var(--muted-foreground)]">{t("filtersDesc")}</p>
    </div>

    <div class="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-5">
      <div class="md:col-span-2">
        <Input
          type="search"
          placeholder={t("placeholderSearch")}
          bind:value={searchQuery}
          on:keydown={(e) => e.key === "Enter" && loadData()}
        />
      </div>
      <div>
        <NativeSelect bind:value={selectedCategory} on:change={loadData}>
          <NativeSelectOption value="all">{t("allCategory")}</NativeSelectOption>
          <NativeSelectOption value="bash">{t("categoryBash")}</NativeSelectOption>
          <NativeSelectOption value="mcp">{t("categoryMcp")}</NativeSelectOption>
          <NativeSelectOption value="file_write">{t("categoryFile")}</NativeSelectOption>
          <NativeSelectOption value="miniapp">{t("categoryMiniApp")}</NativeSelectOption>
        </NativeSelect>
      </div>
      <div>
        <NativeSelect bind:value={selectedStatus} on:change={loadData}>
          <NativeSelectOption value="all">{t("allStatus")}</NativeSelectOption>
          <NativeSelectOption value="approved">{t("statusApproved")}</NativeSelectOption>
          <NativeSelectOption value="executed">{t("statusExecuted")}</NativeSelectOption>
          <NativeSelectOption value="rejected">{t("statusRejected")}</NativeSelectOption>
          <NativeSelectOption value="failed">{t("statusFailed")}</NativeSelectOption>
          <NativeSelectOption value="expired">{t("statusExpired")}</NativeSelectOption>
        </NativeSelect>
      </div>
      <div>
        <NativeSelect bind:value={selectedMode} on:change={loadData}>
          <NativeSelectOption value="all">{t("allMode")}</NativeSelectOption>
          <NativeSelectOption value="persistent">{t("modePersistent")}</NativeSelectOption>
          <NativeSelectOption value="session">{t("modeSession")}</NativeSelectOption>
          <NativeSelectOption value="ephemeral">{t("modeEphemeral")}</NativeSelectOption>
        </NativeSelect>
      </div>
    </div>

    <div class="mt-3 flex justify-end">
      <Button variant="outline" size="sm" on:click={loadData} disabled={loading}>
        {loading ? t("loading") : t("btnRefresh")}
      </Button>
    </div>
  </div>

  <!-- Pending Approvals Section -->
  <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-[var(--foreground)]">{t("pendingTitle")}</h2>
      <p class="text-xs text-[var(--muted-foreground)]">{t("pendingDesc")}</p>
    </div>

    <div class="mt-4">
      {#if pendingList.length === 0}
        <div class="py-6 text-center text-xs text-[var(--muted-foreground)]">
          {t("noPending")}
        </div>
      {:else}
        <div class="overflow-x-auto rounded-lg border border-[var(--border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colTime")}</TableHead>
                <TableHead>{t("colCategory")}</TableHead>
                <TableHead>{t("colTool")}</TableHead>
                <TableHead>{t("colMode")}</TableHead>
                <TableHead>{t("colCommand")}</TableHead>
                <TableHead>{t("colScope")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each pendingList as item (item.id)}
                <TableRow>
                  <TableCell class="whitespace-nowrap text-xs text-[var(--muted-foreground)]">{formatDate(item.requestedAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" class={`px-2 py-0.5 text-[10px] ${getCategoryBadgeClass(item.category)}`}>
                      {getCategoryLabel(item.category)}
                    </Badge>
                  </TableCell>
                  <TableCell class="font-medium text-xs text-[var(--foreground)]">
                    {item.displayName || item.toolId}
                  </TableCell>
                  <TableCell class="text-xs text-[var(--muted-foreground)]">
                    {getModeLabel(item.approvalMode)}
                  </TableCell>
                  <TableCell class="max-w-xs truncate font-mono text-xs text-[var(--foreground)]" title={item.command}>
                    {item.command || item.payload?.path || item.toolId}
                  </TableCell>
                  <TableCell class="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
                    {item.channel || "web"} / {item.chatId || "-"}
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </div>
  </div>

  <!-- Whitelist / Allowlist Section -->
  <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-[var(--foreground)]">{t("whitelistTitle")}</h2>
      <p class="text-xs text-[var(--muted-foreground)]">{t("whitelistDesc")}</p>
    </div>

    <div class="mt-4">
      {#if whitelist.length === 0}
        <div class="py-6 text-center text-xs text-[var(--muted-foreground)]">
          {t("noWhitelist")}
        </div>
      {:else}
        <div class="overflow-x-auto rounded-lg border border-[var(--border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colCategory")}</TableHead>
                <TableHead>{t("colTool")}</TableHead>
                <TableHead>{t("colCommand")}</TableHead>
                <TableHead>{t("colScope")}</TableHead>
                <TableHead>{t("colApproved")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead class="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each whitelist as item (item.id)}
                <TableRow>
                  <TableCell>
                    <Badge variant="outline" class={`px-2 py-0.5 text-[10px] ${getCategoryBadgeClass(item.category)}`}>
                      {getCategoryLabel(item.category)}
                    </Badge>
                  </TableCell>
                  <TableCell class="font-medium text-xs text-[var(--foreground)]">
                    {item.displayName || item.toolId}
                  </TableCell>
                  <TableCell class="max-w-xs truncate font-mono text-xs text-[var(--foreground)]" title={item.command}>
                    {item.command || item.toolId}
                  </TableCell>
                  <TableCell class="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
                    {item.channel || "all"} / {item.chatId || "*"}
                  </TableCell>
                  <TableCell class="whitespace-nowrap text-xs text-[var(--muted-foreground)]">{formatDate(item.approvedAt)}</TableCell>
                  <TableCell>
                    {#if item.enabled}
                      <span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        {t("btnEnable")}
                      </span>
                    {:else}
                      <span class="inline-flex items-center gap-1 rounded-full bg-neutral-500/10 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                        <span class="h-1.5 w-1.5 rounded-full bg-neutral-400"></span>
                        {t("btnDisable")}
                      </span>
                    {/if}
                  </TableCell>
                  <TableCell class="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      on:click={() => toggleWhitelist(item.id, !item.enabled)}
                    >
                      {item.enabled ? t("btnDisable") : t("btnEnable")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      on:click={() => deleteWhitelist(item.id)}
                    >
                      {t("btnDelete")}
                    </Button>
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </div>
  </div>

  <!-- History Section -->
  <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-[var(--foreground)]">{t("historyTitle")}</h2>
      <p class="text-xs text-[var(--muted-foreground)]">{t("historyDesc")}</p>
    </div>

    <div class="mt-4">
      {#if history.length === 0}
        <div class="py-6 text-center text-xs text-[var(--muted-foreground)]">
          {t("noHistory")}
        </div>
      {:else}
        <div class="overflow-x-auto rounded-lg border border-[var(--border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colTime")}</TableHead>
                <TableHead>{t("colCategory")}</TableHead>
                <TableHead>{t("colTool")}</TableHead>
                <TableHead>{t("colMode")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCommand")}</TableHead>
                <TableHead>{t("colReason")}</TableHead>
                <TableHead class="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each history as item (item.id)}
                <TableRow>
                  <TableCell class="whitespace-nowrap text-xs text-[var(--muted-foreground)]">{formatDate(item.resolvedAt || item.requestedAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" class={`px-2 py-0.5 text-[10px] ${getCategoryBadgeClass(item.category)}`}>
                      {getCategoryLabel(item.category)}
                    </Badge>
                  </TableCell>
                  <TableCell class="font-medium text-xs text-[var(--foreground)]">
                    {item.displayName || item.toolId}
                  </TableCell>
                  <TableCell class="text-xs text-[var(--muted-foreground)]">
                    {getModeLabel(item.approvalMode)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" class={`px-2 py-0.5 text-[10px] ${getStatusBadgeClass(item.status)}`}>
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell class="max-w-xs truncate font-mono text-xs text-[var(--foreground)]" title={item.command}>
                    {item.command || item.payload?.path || item.toolId}
                  </TableCell>
                  <TableCell class="max-w-xs truncate text-xs text-[var(--muted-foreground)]" title={item.errorText || item.reason}>
                    {item.errorText ? `❌ ${item.errorText}` : item.reason || "-"}
                  </TableCell>
                  <TableCell class="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      on:click={() => deleteHistory(item.id)}
                    >
                      {t("btnDelete")}
                    </Button>
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </div>
      {/if}
    </div>
  </div>
</div>
