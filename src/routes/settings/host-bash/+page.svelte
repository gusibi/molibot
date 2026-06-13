<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { locale } from "$lib/ui/i18n";

  type ApprovalMode = "all" | "persistent" | "ephemeral" | "session";
  type ApprovalStatus = "all" | "approved" | "rejected" | "executed" | "failed";

  interface HostBashPermissions {
    envAllowlist: string[];
    filesystem: string;
    network: string;
  }

  interface HostBashPendingAction {
    kind: string;
    originalCommand: string;
    args?: string[];
  }

  interface HostBashCapability {
    executable: string;
    toolId: string;
    argv: string[];
    originalSegment: string;
  }

  interface HostBashSafeHelper {
    executable: string;
    argv: string[];
    originalSegment: string;
    reason: string;
  }

  interface HostBashSafeGlue {
    token: "|" | "&&" | ";" | "2>&1" | "1>&2";
    reason: string;
  }

  type HostBashClassification =
    | {
        kind: "persistent-capability";
        capability: HostBashCapability;
        capabilities: HostBashCapability[];
        originalCommand: string;
        safeHelpers: HostBashSafeHelper[];
        safeGlue: HostBashSafeGlue[];
      }
    | {
        kind: "compound-capabilities";
        capabilities: HostBashCapability[];
        originalCommand: string;
        safeHelpers: HostBashSafeHelper[];
        safeGlue: HostBashSafeGlue[];
      }
    | {
        kind: "one-time-script";
        originalCommand: string;
        reason: string;
      };

  interface PendingRecord {
    id: string;
    toolId: string;
    displayName: string;
    command: string;
    reason: string;
    channel: string;
    chatId: string;
    scopeId: string;
    sessionId?: string;
    approvalMode: ApprovalMode;
    status: string;
    permissions: HostBashPermissions;
    pendingAction?: HostBashPendingAction;
    classification?: HostBashClassification;
    requestedAt: string;
    resolvedAt?: string;
    executedAt?: string;
    errorText?: string;
  }

  interface WhitelistEntry {
    id: string;
    toolId: string;
    displayName: string;
    command: string;
    reason: string;
    channel: string;
    chatId: string;
    scopeId: string;
    permissions: HostBashPermissions;
    approvedAt: string;
    approvedFromRecordId: string;
    enabled: boolean;
  }

  interface HostBashResponse {
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
      eyebrow: "Host Bash",
      title: "Host Bash 审批与白名单",
      desc: "这里查看待处理审批、长期白名单和历史记录。聊天里的审批流保持原样，这个页面只负责审计和管理。",
      pendingHeading: "Pending",
      pendingSub: "等待聊天侧处理",
      whitelistHeading: "Whitelist",
      whitelistSub: "当前长期白名单",
      enabledHeading: "Enabled",
      enabledSub: "仍生效的 Host Bash",
      historyHeading: "History",
      historySub: "已结束审批记录",
      filtersTitle: "历史记录筛选",
      filtersDesc: "按状态、审批模式和关键词筛选历史记录。",
      placeholderSearch: "搜索命令、工具、原因、会话...",
      allStatus: "所有状态",
      statusApproved: "已批准",
      statusRejected: "已拒绝",
      statusExecuted: "已执行",
      statusFailed: "执行失败",
      allMode: "所有模式",
      modePersistent: "持久白名单",
      modeEphemeral: "单次授权",
      modeSession: "Session 授权",
      btnRefresh: "刷新",
      pendingTitle: "待审批记录",
      pendingDesc: "只读查看。实际批准/拒绝仍在聊天会话里完成。",
      loading: "正在加载 Host Bash 数据...",
      colTime: "时间",
      colTool: "工具",
      colMode: "模式",
      colCommand: "命令",
      colClassification: "动作分类",
      colScope: "作用域",
      colPermissions: "安全权限",
      noPending: "没有待处理的 Host Bash 审批。",
      whitelistTitle: "白名单管理",
      whitelistDesc: "管理长期批准项。你可以临时禁用，或者直接删除。",
      colApproved: "批准时间",
      colStatus: "状态",
      colActions: "操作",
      noWhitelist: "尚未添加 Host Bash 白名单。",
      btnDisable: "禁用",
      btnEnable: "启用",
      btnDelete: "删除",
      historyTitle: "审批历史记录",
      historyDesc: "保留一次性、本 Session 和长期批准的完整记录。",
      colReason: "原因/错误",
      noHistory: "没有匹配的历史记录。",
      failedLoad: "加载 Host Bash 数据失败。",
      requestFailed: "请求失败。"
    },
    "en-US": {
      eyebrow: "Host Bash",
      title: "Host Bash Whitelist & Approvals",
      desc: "Audit pending approvals, whitelisted commands, and history logs here. Real approvals still occur inside the chat.",
      pendingHeading: "Pending",
      pendingSub: "Waiting in chat sessions",
      whitelistHeading: "Whitelist",
      whitelistSub: "Active persistent whitelists",
      enabledHeading: "Enabled",
      enabledSub: "Durable active whitelists",
      historyHeading: "History",
      historySub: "Resolved approval logs",
      filtersTitle: "History Filters",
      filtersDesc: "Filter approval logs by status, mode, and query strings.",
      placeholderSearch: "Search command, tool, reason, chat...",
      allStatus: "All status",
      statusApproved: "Approved",
      statusRejected: "Rejected",
      statusExecuted: "Executed",
      statusFailed: "Failed",
      allMode: "All mode",
      modePersistent: "Persistent",
      modeEphemeral: "One-time",
      modeSession: "Session",
      btnRefresh: "Refresh",
      pendingTitle: "Pending Approvals",
      pendingDesc: "Read-only view. Actions are completed within chat environments.",
      loading: "Loading Host Bash data...",
      colTime: "Time",
      colTool: "Tool",
      colMode: "Mode",
      colCommand: "Command",
      colClassification: "Classification",
      colScope: "Scope",
      colPermissions: "Permissions",
      noPending: "No pending Host Bash approvals.",
      whitelistTitle: "Whitelist Management",
      whitelistDesc: "Manage persistent whitelists. Temporarily disable or delete entries.",
      colApproved: "Approved",
      colStatus: "Status",
      colActions: "Actions",
      noWhitelist: "No Host Bash whitelist entries yet.",
      btnDisable: "Disable",
      btnEnable: "Enable",
      btnDelete: "Delete",
      historyTitle: "Approval History",
      historyDesc: "Durable history logs for persistent, session-based, and one-time approvals.",
      colReason: "Reason / Error",
      noHistory: "No matching history records.",
      failedLoad: "Failed to load Host Bash data.",
      requestFailed: "Request failed."
    }
  } as const;

  let loading = true;
  let error = "";
  let data: HostBashResponse | null = null;
  let query = "";
  let status: ApprovalStatus = "all";
  let mode: ApprovalMode = "all";

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function formatDate(value?: string): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US");
  }

  function formatPermissions(permissions: HostBashPermissions): string {
    return `fs=${permissions.filesystem} / net=${permissions.network} / env=${permissions.envAllowlist.join(", ") || "(none)"}`;
  }

  function formatClassification(item: PendingRecord): string {
    const classification = item.classification;
    if (!classification) return "—";
    if (classification.kind === "one-time-script") return `one-time: ${classification.reason}`;
    const capabilityIds = [...new Set(classification.capabilities.map((entry) => entry.toolId))].join(", ");
    const helpers = classification.safeHelpers.map((entry) => entry.originalSegment).join(" | ");
    const glue = classification.safeGlue.map((entry) => entry.token).join(" ");
    return [
      `capability=${capabilityIds || item.toolId}`,
      helpers ? `helpers=${helpers}` : "",
      glue ? `glue=${glue}` : ""
    ].filter(Boolean).join(" / ");
  }

  async function loadData(): Promise<void> {
    loading = true;
    error = "";
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("mode", mode);
      if (query.trim()) params.set("query", query.trim());
      const res = await fetch(`/api/settings/host-bash?${params.toString()}`);
      const payload = await res.json() as HostBashResponse | { ok: false; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error("error" in payload ? payload.error || copy.failedLoad : copy.failedLoad);
      }
      data = payload;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function postAction(body: Record<string, unknown>): Promise<void> {
    const res = await fetch("/api/settings/host-bash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok || !payload.ok) throw new Error(payload.error || copy.requestFailed);
    await loadData();
  }

  async function toggleWhitelist(id: string, enabled: boolean): Promise<void> {
    await postAction({ action: "toggle_whitelist", id, enabled });
  }

  async function deleteWhitelist(id: string): Promise<void> {
    await postAction({ action: "delete_whitelist", id });
  }

  async function deleteHistory(id: string): Promise<void> {
    await postAction({ action: "delete_history", id });
  }

  function onFilterSubmit(event: Event): void {
    event.preventDefault();
    void loadData();
  }

  onMount(() => {
    void loadData();
  });
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  <div class="channel-field-row" style="grid-template-columns: repeat(4, 1fr); gap: 1rem;">
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title" style="font-size: 0.875rem;">{copy.pendingHeading}</h2>
          <p class="channel-card-desc">{copy.pendingSub}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div style="font-size: 1.5rem; font-weight: 700;">{data?.counts.pending ?? 0}</div>
      </div>
    </div>
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title" style="font-size: 0.875rem;">{copy.whitelistHeading}</h2>
          <p class="channel-card-desc">{copy.whitelistSub}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div style="font-size: 1.5rem; font-weight: 700;">{data?.counts.whitelist ?? 0}</div>
      </div>
    </div>
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title" style="font-size: 0.875rem;">{copy.enabledHeading}</h2>
          <p class="channel-card-desc">{copy.enabledSub}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div style="font-size: 1.5rem; font-weight: 700;">{data?.counts.whitelistEnabled ?? 0}</div>
      </div>
    </div>
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title" style="font-size: 0.875rem;">{copy.historyHeading}</h2>
          <p class="channel-card-desc">{copy.historySub}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div style="font-size: 1.5rem; font-weight: 700;">{data?.counts.history ?? 0}</div>
      </div>
    </div>
  </div>

  <div class="channel-card">
    <div class="channel-card-header">
      <div>
        <h2 class="channel-card-title">{copy.filtersTitle}</h2>
        <p class="channel-card-desc">{copy.filtersDesc}</p>
      </div>
    </div>
    <div class="channel-card-body">
      <form class="channel-field-row" style="grid-template-columns: 2fr 1fr 1fr auto; gap: 0.75rem; align-items: center;" onsubmit={onFilterSubmit}>
        <Input bind:value={query} placeholder={copy.placeholderSearch} />
        <NativeSelect bind:value={status}>
          <NativeSelectOption value="all">{copy.allStatus}</NativeSelectOption>
          <NativeSelectOption value="approved">{copy.statusApproved}</NativeSelectOption>
          <NativeSelectOption value="rejected">{copy.statusRejected}</NativeSelectOption>
          <NativeSelectOption value="executed">{copy.statusExecuted}</NativeSelectOption>
          <NativeSelectOption value="failed">{copy.statusFailed}</NativeSelectOption>
        </NativeSelect>
        <NativeSelect bind:value={mode}>
          <NativeSelectOption value="all">{copy.allMode}</NativeSelectOption>
          <NativeSelectOption value="persistent">{copy.modePersistent}</NativeSelectOption>
          <NativeSelectOption value="ephemeral">{copy.modeEphemeral}</NativeSelectOption>
          <NativeSelectOption value="session">{copy.modeSession}</NativeSelectOption>
        </NativeSelect>
        <Button type="submit">{copy.btnRefresh}</Button>
      </form>
      {#if error}
        <div class="settings-footbar-error" style="margin-top: 0.5rem;">{error}</div>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.pendingTitle}</h2>
          <p class="channel-card-desc">{copy.pendingDesc}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.colTime}</TableHead>
                <TableHead>{copy.colTool}</TableHead>
                <TableHead>{copy.colMode}</TableHead>
                <TableHead>{copy.colCommand}</TableHead>
                <TableHead>{copy.colClassification}</TableHead>
                <TableHead>{copy.colScope}</TableHead>
                <TableHead>{copy.colPermissions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if (data?.pending.length ?? 0) === 0}
                <TableRow><TableCell colspan="7" class="text-muted-foreground">{copy.noPending}</TableCell></TableRow>
              {:else}
                {#each data?.pending ?? [] as item}
                  <TableRow>
                    <TableCell class="text-xs">{formatDate(item.requestedAt)}</TableCell>
                    <TableCell>
                      <div class="channel-sidebar-btn-name">{item.displayName}</div>
                      <div class="channel-sidebar-btn-id">{item.toolId}</div>
                    </TableCell>
                    <TableCell class="text-xs">{item.approvalMode}</TableCell>
                    <TableCell class="max-w-[26rem] break-all text-xs font-mono">{item.pendingAction?.originalCommand || item.command}</TableCell>
                    <TableCell class="max-w-[24rem] break-all text-xs">{formatClassification(item)}</TableCell>
                    <TableCell class="text-xs">{item.channel} / {item.chatId}</TableCell>
                    <TableCell class="max-w-[22rem] text-xs font-mono">{formatPermissions(item.permissions)}</TableCell>
                  </TableRow>
                {/each}
              {/if}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>

    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.whitelistTitle}</h2>
          <p class="channel-card-desc">{copy.whitelistDesc}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.colTool}</TableHead>
                <TableHead>{copy.colCommand}</TableHead>
                <TableHead>{copy.colScope}</TableHead>
                <TableHead>{copy.colApproved}</TableHead>
                <TableHead>{copy.colStatus}</TableHead>
                <TableHead>{copy.colActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if (data?.whitelist.length ?? 0) === 0}
                <TableRow><TableCell colspan="6" class="text-muted-foreground">{copy.noWhitelist}</TableCell></TableRow>
              {:else}
                {#each data?.whitelist ?? [] as item}
                  <TableRow>
                    <TableCell>
                      <div class="channel-sidebar-btn-name">{item.displayName}</div>
                      <div class="channel-sidebar-btn-id">{item.toolId}</div>
                    </TableCell>
                    <TableCell class="max-w-[24rem] break-all text-xs font-mono">{item.command}</TableCell>
                    <TableCell class="text-xs">{item.channel} / {item.chatId}</TableCell>
                    <TableCell class="text-xs">{formatDate(item.approvedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={item.enabled ? "default" : "outline"}>{item.enabled ? "enabled" : "disabled"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div style="display: flex; gap: 0.5rem;">
                        <Button variant="outline" size="sm" onclick={() => toggleWhitelist(item.id, !item.enabled)}>
                          {item.enabled ? copy.btnDisable : copy.btnEnable}
                        </Button>
                        <Button variant="destructive" size="sm" onclick={() => deleteWhitelist(item.id)}>
                          {copy.btnDelete}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                {/each}
              {/if}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>

    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.historyHeading}</h2>
          <p class="channel-card-desc">{copy.historySub}</p>
        </div>
      </div>
      <div class="channel-card-body">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.colTime}</TableHead>
                <TableHead>{copy.colTool}</TableHead>
                <TableHead>{copy.colMode}</TableHead>
                <TableHead>{copy.colStatus}</TableHead>
                <TableHead>{copy.colCommand}</TableHead>
                <TableHead>{copy.colClassification}</TableHead>
                <TableHead>{copy.colReason}</TableHead>
                <TableHead>{copy.colActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if (data?.history.length ?? 0) === 0}
                <TableRow><TableCell colspan="8" class="text-muted-foreground">{copy.noHistory}</TableCell></TableRow>
              {:else}
                {#each data?.history ?? [] as item}
                  <TableRow>
                    <TableCell class="text-xs">{formatDate(item.executedAt || item.resolvedAt || item.requestedAt)}</TableCell>
                    <TableCell>
                      <div class="channel-sidebar-btn-name">{item.displayName}</div>
                      <div class="channel-sidebar-btn-id">{item.toolId}</div>
                    </TableCell>
                    <TableCell class="text-xs">{item.approvalMode}</TableCell>
                    <TableCell><Badge variant="outline">{item.status}</Badge></TableCell>
                    <TableCell class="max-w-[22rem] break-all text-xs font-mono">{item.pendingAction?.originalCommand || item.command}</TableCell>
                    <TableCell class="max-w-[22rem] break-all text-xs">{formatClassification(item)}</TableCell>
                    <TableCell class="max-w-[22rem] text-xs">
                      <div>{item.reason}</div>
                      {#if item.errorText}
                        <div class="text-destructive" style="margin-top: 0.25rem;">{item.errorText}</div>
                      {/if}
                    </TableCell>
                    <TableCell>
                      <Button variant="destructive" size="sm" onclick={() => deleteHistory(item.id)}>
                        {copy.btnDelete}
                      </Button>
                    </TableCell>
                  </TableRow>
                {/each}
              {/if}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  {/if}
</div>
