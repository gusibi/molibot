<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";

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

  let loading = true;
  let error = "";
  let data: HostBashResponse | null = null;
  let query = "";
  let status: ApprovalStatus = "all";
  let mode: ApprovalMode = "all";

  function formatDate(value?: string): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function formatPermissions(permissions: HostBashPermissions): string {
    return `fs=${permissions.filesystem} / net=${permissions.network} / env=${permissions.envAllowlist.join(", ") || "(none)"}`;
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
        throw new Error("error" in payload ? payload.error || "Failed to load Host Bash data." : "Failed to load Host Bash data.");
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
    if (!res.ok || !payload.ok) throw new Error(payload.error || "Request failed.");
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

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Host Bash</Badge>
    <div class="space-y-2">
      <h1 class="text-3xl font-semibold tracking-tight">Host Bash 审批与白名单</h1>
      <p class="max-w-4xl text-sm leading-6 text-muted-foreground">
        这里查看待处理审批、长期白名单和历史记录。聊天里的审批流保持原样，这个页面只负责审计和管理。
      </p>
    </div>
  </header>

  <section class="grid gap-4 md:grid-cols-4">
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-sm">Pending</CardTitle>
        <CardDescription>等待聊天侧处理</CardDescription>
      </CardHeader>
      <CardContent class="text-2xl font-semibold">{data?.counts.pending ?? 0}</CardContent>
    </Card>
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-sm">Whitelist</CardTitle>
        <CardDescription>当前长期白名单</CardDescription>
      </CardHeader>
      <CardContent class="text-2xl font-semibold">{data?.counts.whitelist ?? 0}</CardContent>
    </Card>
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-sm">Enabled</CardTitle>
        <CardDescription>仍生效的 Host Bash</CardDescription>
      </CardHeader>
      <CardContent class="text-2xl font-semibold">{data?.counts.whitelistEnabled ?? 0}</CardContent>
    </Card>
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-sm">History</CardTitle>
        <CardDescription>已结束审批记录</CardDescription>
      </CardHeader>
      <CardContent class="text-2xl font-semibold">{data?.counts.history ?? 0}</CardContent>
    </Card>
  </section>

  <Card>
    <CardHeader>
      <CardTitle>History Filters</CardTitle>
      <CardDescription>按状态、审批模式和关键词筛选历史记录。</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="grid gap-3 md:grid-cols-[2fr,1fr,1fr,auto]" on:submit={onFilterSubmit}>
        <Input bind:value={query} placeholder="Search command, tool, reason, chat..." />
        <NativeSelect bind:value={status}>
          <NativeSelectOption value="all">All status</NativeSelectOption>
          <NativeSelectOption value="approved">Approved</NativeSelectOption>
          <NativeSelectOption value="rejected">Rejected</NativeSelectOption>
          <NativeSelectOption value="executed">Executed</NativeSelectOption>
          <NativeSelectOption value="failed">Failed</NativeSelectOption>
        </NativeSelect>
        <NativeSelect bind:value={mode}>
          <NativeSelectOption value="all">All mode</NativeSelectOption>
          <NativeSelectOption value="persistent">Persistent</NativeSelectOption>
          <NativeSelectOption value="ephemeral">One-time</NativeSelectOption>
          <NativeSelectOption value="session">Session</NativeSelectOption>
        </NativeSelect>
        <Button type="submit">Refresh</Button>
      </form>
      {#if error}
        <p class="mt-3 text-sm text-destructive">{error}</p>
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Pending</CardTitle>
      <CardDescription>只读查看。实际批准/拒绝仍在聊天会话里完成。</CardDescription>
    </CardHeader>
    <CardContent class="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Command</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Permissions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#if !loading && (data?.pending.length ?? 0) === 0}
            <TableRow><TableCell colspan="6" class="text-muted-foreground">No pending Host Bash approvals.</TableCell></TableRow>
          {:else}
            {#each data?.pending ?? [] as item}
              <TableRow>
                <TableCell>{formatDate(item.requestedAt)}</TableCell>
                <TableCell>
                  <div class="font-medium">{item.displayName}</div>
                  <div class="text-xs text-muted-foreground">{item.toolId}</div>
                </TableCell>
                <TableCell>{item.approvalMode}</TableCell>
                <TableCell class="max-w-[26rem] break-all text-xs">{item.pendingAction?.originalCommand || item.command}</TableCell>
                <TableCell class="text-xs">{item.channel} / {item.chatId}</TableCell>
                <TableCell class="max-w-[22rem] text-xs">{formatPermissions(item.permissions)}</TableCell>
              </TableRow>
            {/each}
          {/if}
        </TableBody>
      </Table>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Whitelist</CardTitle>
      <CardDescription>管理长期批准项。你可以临时禁用，或者直接删除。</CardDescription>
    </CardHeader>
    <CardContent class="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>Command</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#if !loading && (data?.whitelist.length ?? 0) === 0}
            <TableRow><TableCell colspan="6" class="text-muted-foreground">No Host Bash whitelist entries yet.</TableCell></TableRow>
          {:else}
            {#each data?.whitelist ?? [] as item}
              <TableRow>
                <TableCell>
                  <div class="font-medium">{item.displayName}</div>
                  <div class="text-xs text-muted-foreground">{item.toolId}</div>
                </TableCell>
                <TableCell class="max-w-[24rem] break-all text-xs">{item.command}</TableCell>
                <TableCell class="text-xs">{item.channel} / {item.chatId}</TableCell>
                <TableCell class="text-xs">{formatDate(item.approvedAt)}</TableCell>
                <TableCell>
                  <Badge variant={item.enabled ? "default" : "outline"}>{item.enabled ? "enabled" : "disabled"}</Badge>
                </TableCell>
                <TableCell class="space-x-2">
                  <Button variant="outline" size="sm" onclick={() => toggleWhitelist(item.id, !item.enabled)}>
                    {item.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="destructive" size="sm" onclick={() => deleteWhitelist(item.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            {/each}
          {/if}
        </TableBody>
      </Table>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>History</CardTitle>
      <CardDescription>保留一次性、本 Session 和长期批准的完整记录。</CardDescription>
    </CardHeader>
    <CardContent class="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Command</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#if !loading && (data?.history.length ?? 0) === 0}
            <TableRow><TableCell colspan="7" class="text-muted-foreground">No matching history records.</TableCell></TableRow>
          {:else}
            {#each data?.history ?? [] as item}
              <TableRow>
                <TableCell class="text-xs">{formatDate(item.executedAt || item.resolvedAt || item.requestedAt)}</TableCell>
                <TableCell>
                  <div class="font-medium">{item.displayName}</div>
                  <div class="text-xs text-muted-foreground">{item.toolId}</div>
                </TableCell>
                <TableCell>{item.approvalMode}</TableCell>
                <TableCell><Badge variant="outline">{item.status}</Badge></TableCell>
                <TableCell class="max-w-[22rem] break-all text-xs">{item.pendingAction?.originalCommand || item.command}</TableCell>
                <TableCell class="max-w-[22rem] text-xs">
                  <div>{item.reason}</div>
                  {#if item.errorText}
                    <div class="mt-1 text-destructive">{item.errorText}</div>
                  {/if}
                </TableCell>
                <TableCell>
                  <Button variant="destructive" size="sm" onclick={() => deleteHistory(item.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            {/each}
          {/if}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</div>
