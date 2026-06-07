<script lang="ts">
    import { onMount } from "svelte";
    import { Alert, AlertDescription } from "$lib/components/ui/alert";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import {
        Table,
        TableBody,
        TableCell,
        TableHead,
        TableHeader,
        TableRow,
    } from "$lib/components/ui/table";

    type TimeRange = "today" | "yesterday" | "last7Days" | "last30Days";
    type FactType =
        | "all"
        | "run"
        | "tool_call"
        | "model_call"
        | "skill_usage"
        | "subagent_task"
        | "runtime_notice"
        | "approval"
        | "input_enrichment";

    interface TraceTotals {
        facts: number;
        toolCalls: number;
        executedToolCalls: number;
        modelCalls: number;
        distinctTools: number;
        bots: number;
        channels: number;
        chats: number;
        sessions: number;
        runs: number;
        failedTools: number;
        blockedTools: number;
        totalTokens: number;
        avgToolDurationMs: number;
        avgModelDurationMs: number;
    }

    interface ToolSummary {
        name: string;
        calls: number;
        executedCalls: number;
        success: number;
        error: number;
        blocked: number;
        avgDurationMs: number;
    }

    interface ModelSummary {
        id: string;
        provider: string;
        model: string;
        api: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
        avgDurationMs: number;
    }

    interface BotSummary {
        botId: string;
        channels: number;
        chats: number;
        sessions: number;
        runs: number;
        toolCalls: number;
        modelCalls: number;
        distinctTools: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
        lastAt: string;
    }

    interface SessionSummary {
        sessionId: string;
        runs: number;
        toolCalls: number;
        modelCalls: number;
        distinctTools: number;
        totalTokens: number;
        lastAt: string;
    }

    interface RunSummary {
        runId: string;
        sessionId: string;
        toolCalls: number;
        modelCalls: number;
        distinctTools: number;
        totalTokens: number;
        lastAt: string;
    }

    interface ChatSummary {
        id: string;
        channel: string;
        chatId: string;
        sessions: number;
        runs: number;
        toolCalls: number;
        modelCalls: number;
        distinctTools: number;
        totalTokens: number;
        lastAt: string;
    }

    interface TraceFact {
        id: string;
        factType: Exclude<FactType, "all">;
        runId: string;
        factId: string;
        channel: string;
        botId?: string;
        chatId: string;
        sessionId: string;
        name?: string;
        provider?: string;
        model?: string;
        api?: string;
        status: "started" | "success" | "error" | "blocked" | "waiting" | "aborted" | "info" | "warning";
        durationMs?: number;
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        totalTokens?: number;
        blockedBy?: string;
        errorPreview?: string;
        resultPreview?: string;
        createdAt: string;
        updatedAt: string;
    }

    interface TraceStatsResponse {
        timezone: string;
        generatedAt: string;
        range: TimeRange;
        window: { startDate: string; endDate: string };
        filters: { factType: FactType; botId: string; channel: string; chatId: string; sessionId: string; runId: string; limit: number };
        sourceLimit: number;
        facts: TraceFact[];
        totals: TraceTotals;
        tools: ToolSummary[];
        models: ModelSummary[];
        bots: BotSummary[];
        chats: ChatSummary[];
        sessions: SessionSummary[];
        runs: RunSummary[];
    }

    const timeRangeOptions: TimeRange[] = ["today", "yesterday", "last7Days", "last30Days"];

    let traceLoading = true;
    let traceError = "";
    let traceStats: TraceStatsResponse | null = null;

    let selectedRange: TimeRange = "today";
    let selectedFactType: FactType = "all";
    let botFilter = "";
    let channelFilter = "";
    let chatFilter = "";
    let sessionFilter = "";
    let runFilter = "";
    let sourceLimit = "5000";

    function windowTitle(range: TimeRange): string {
        const titles: Record<TimeRange, string> = {
            today: "今天",
            yesterday: "昨天",
            last7Days: "最近 7 天",
            last30Days: "最近 30 天",
        };
        return titles[range];
    }

    function factTypeLabel(type: FactType | TraceFact["factType"]): string {
        if (type === "run") return "运行";
        if (type === "tool_call") return "工具调用";
        if (type === "model_call") return "模型请求";
        if (type === "skill_usage") return "技能使用";
        if (type === "subagent_task") return "Sub Agent";
        if (type === "runtime_notice") return "运行提示";
        if (type === "approval") return "审批";
        if (type === "input_enrichment") return "输入增强";
        return "全部类型";
    }

    function statusLabel(status: TraceFact["status"]): string {
        const labels: Record<TraceFact["status"], string> = {
            started: "进行中",
            success: "成功",
            error: "失败",
            blocked: "已阻止",
            waiting: "等待中",
            aborted: "已中止",
            info: "信息",
            warning: "警告",
        };
        return labels[status];
    }

    function statusVariant(status: TraceFact["status"]): "default" | "secondary" | "destructive" | "outline" {
        if (status === "success") return "secondary";
        if (status === "error") return "destructive";
        if (status === "blocked" || status === "warning" || status === "aborted") return "outline";
        return "default";
    }

    function formatNumber(value: number): string {
        return new Intl.NumberFormat("en-US").format(value ?? 0);
    }

    function formatCompact(value: number): string {
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
        if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
        return formatNumber(value);
    }

    function formatDuration(value: number): string {
        if (!value) return "--";
        if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
        return `${value}ms`;
    }

    function formatDateTime(value: string): string {
        return new Intl.DateTimeFormat("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        }).format(new Date(value));
    }

    function displayFactName(fact: TraceFact): string {
        if (fact.factType === "tool_call") return fact.name || "unknown";
        if (fact.factType === "model_call") return fact.model || fact.provider || "unknown";
        return fact.name || fact.factId || "unknown";
    }

    function factSubtitle(fact: TraceFact): string {
        if (fact.factType === "tool_call") return fact.blockedBy || fact.errorPreview || fact.factId;
        if (fact.factType === "model_call") return [fact.provider, fact.api].filter(Boolean).join(" / ") || fact.factId;
        return fact.resultPreview || fact.errorPreview || fact.factId;
    }

    function shortId(value: string): string {
        if (value.length <= 18) return value;
        return `${value.slice(0, 8)}...${value.slice(-6)}`;
    }

    async function loadTrace() {
        traceLoading = true;
        traceError = "";
        const params = new URLSearchParams({
            range: selectedRange,
            factType: selectedFactType,
            limit: sourceLimit,
        });
        if (botFilter.trim()) params.set("botId", botFilter.trim());
        if (channelFilter.trim()) params.set("channel", channelFilter.trim());
        if (chatFilter.trim()) params.set("chatId", chatFilter.trim());
        if (sessionFilter.trim()) params.set("sessionId", sessionFilter.trim());
        if (runFilter.trim()) params.set("runId", runFilter.trim());

        try {
            const res = await fetch(`/api/settings/trace?${params.toString()}`);
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || res.statusText);
            }
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Failed to fetch trace stats");
            traceStats = data.trace as TraceStatsResponse;
        } catch (e) {
            traceError = e instanceof Error ? e.message : String(e);
        } finally {
            traceLoading = false;
        }
    }

    function selectRange(range: TimeRange): void {
        selectedRange = range;
        void loadTrace();
    }

    function resetFilters(): void {
        selectedFactType = "all";
        botFilter = "";
        channelFilter = "";
        chatFilter = "";
        sessionFilter = "";
        runFilter = "";
        sourceLimit = "5000";
        void loadTrace();
    }

    onMount(loadTrace);

    $: totals = traceStats?.totals;
    $: recentFacts = traceStats?.facts ?? [];
</script>

<div class="usage-page">
    <header class="usage-header">
        <div class="usage-header-left">
            <div class="usage-header-badges">
                <Badge variant="secondary" class="usage-badge-medium">Agent Trace Observatory</Badge>
                <Badge variant="outline" class="usage-badge-medium">{windowTitle(selectedRange)}</Badge>
            </div>
            <div class="usage-header-text">
                <h1 class="usage-header-title">Trace 分析</h1>
                <p class="usage-header-desc">
                    基于 agent_trace_facts 汇总工具调用、模型请求、session 和 run 维度的执行数据；原始 agent_trace_events 仍作为审计事件保留。
                </p>
            </div>
        </div>
        <div class="usage-header-right">
            <div class="usage-range-buttons" aria-label="时间范围">
                {#each timeRangeOptions as range}
                    <Button
                        type="button"
                        variant={selectedRange === range ? "default" : "outline"}
                        size="sm"
                        onclick={() => selectRange(range)}
                        class={selectedRange === range ? "usage-range-active" : ""}
                    >
                        {windowTitle(range)}
                    </Button>
                {/each}
            </div>
        </div>
    </header>

    {#if traceError}
        <Alert variant="destructive">
            <AlertDescription>Error: {traceError}</AlertDescription>
        </Alert>
    {:else if traceLoading && !traceStats}
        <Card>
            <CardHeader>
                <Skeleton class="usage-skeleton-title" />
                <Skeleton class="usage-skeleton-subtitle" />
            </CardHeader>
            <CardContent class="usage-filters">
                <Skeleton class="usage-skeleton-block" />
                <Skeleton class="usage-skeleton-block" />
                <Skeleton class="usage-skeleton-block" />
            </CardContent>
        </Card>
    {:else if traceStats && totals}
        <Card>
            <CardContent class="usage-filters trace-filters">
                <div class="usage-filter-group">
                    <Label for="trace-fact-type" class="usage-filter-label">调用类型</Label>
                    <NativeSelect id="trace-fact-type" class="w-full" bind:value={selectedFactType}>
                        <NativeSelectOption value="all">全部类型</NativeSelectOption>
                        <NativeSelectOption value="run">运行</NativeSelectOption>
                        <NativeSelectOption value="tool_call">工具调用</NativeSelectOption>
                        <NativeSelectOption value="model_call">模型请求</NativeSelectOption>
                        <NativeSelectOption value="skill_usage">技能使用</NativeSelectOption>
                        <NativeSelectOption value="subagent_task">Sub Agent</NativeSelectOption>
                        <NativeSelectOption value="runtime_notice">运行提示</NativeSelectOption>
                        <NativeSelectOption value="approval">审批</NativeSelectOption>
                        <NativeSelectOption value="input_enrichment">输入增强</NativeSelectOption>
                    </NativeSelect>
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-bot-id" class="usage-filter-label">Bot</Label>
                    <Input id="trace-bot-id" placeholder="按 botId 精确筛选" bind:value={botFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-channel" class="usage-filter-label">Channel</Label>
                    <Input id="trace-channel" placeholder="telegram / feishu / web" bind:value={channelFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-chat-id" class="usage-filter-label">Chat ID</Label>
                    <Input id="trace-chat-id" placeholder="按 chatId 精确筛选" bind:value={chatFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-session-id" class="usage-filter-label">Session ID</Label>
                    <Input id="trace-session-id" placeholder="按 session 精确筛选" bind:value={sessionFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-run-id" class="usage-filter-label">Run ID</Label>
                    <Input id="trace-run-id" placeholder="按 run 精确筛选" bind:value={runFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-source-limit" class="usage-filter-label">读取上限</Label>
                    <NativeSelect id="trace-source-limit" class="w-full" bind:value={sourceLimit}>
                        <NativeSelectOption value="1000">最近 1,000 条</NativeSelectOption>
                        <NativeSelectOption value="5000">最近 5,000 条</NativeSelectOption>
                        <NativeSelectOption value="10000">最近 10,000 条</NativeSelectOption>
                    </NativeSelect>
                </div>
                <div class="usage-filter-reset trace-filter-actions">
                    <Button variant="default" type="button" onclick={loadTrace} disabled={traceLoading}>应用筛选</Button>
                    <Button variant="outline" type="button" onclick={resetFilters} disabled={traceLoading}>清空</Button>
                </div>
                <div class="usage-filter-meta trace-filter-meta">
                    <span>{traceStats.window.startDate} → {traceStats.window.endDate}</span>
                    <span>更新于 {formatDateTime(traceStats.generatedAt)}</span>
                </div>
            </CardContent>
        </Card>

        <div class="usage-metrics">
            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">工具调用</CardTitle>
                        <Badge variant="secondary" class="usage-badge-requests">Tools</Badge>
                    </div>
                    <CardDescription>包含成功、失败、已阻止和进行中的工具 fact</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    <strong class="usage-metric-value">{formatNumber(totals.toolCalls)}</strong>
                    <span class="usage-card-subtext">
                        实际执行 {formatNumber(totals.executedToolCalls)} · 已阻止 {formatNumber(totals.blockedTools)} · 失败 {formatNumber(totals.failedTools)}
                    </span>
                </CardContent>
            </Card>

            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">模型请求</CardTitle>
                        <Badge variant="secondary" class="usage-badge-tokens">Model</Badge>
                    </div>
                    <CardDescription>来自 model_call fact 的请求数和 token 汇总</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    <strong class="usage-metric-value">{formatNumber(totals.modelCalls)}</strong>
                    <span class="usage-card-subtext">Token {formatCompact(totals.totalTokens)} · 平均耗时 {formatDuration(totals.avgModelDurationMs)}</span>
                </CardContent>
            </Card>

            <Card class="usage-metric-accent-1">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">关联 Bots</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.bots)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">口径与 Usage 页 botId 一致</CardContent>
            </Card>
            <Card class="usage-metric-accent-2">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">关联 Chats</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.chats)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">按 channel + chatId 去重</CardContent>
            </Card>
            <Card class="usage-metric-accent-3">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">工具种类</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.distinctTools)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">按工具 name 去重</CardContent>
            </Card>
            <Card class="usage-metric-accent-4">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">关联 Sessions</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.sessions)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">当前筛选范围内的 session 数</CardContent>
            </Card>
        </div>

        <div class="usage-detail-grid">
            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">Channel / Chat 汇总</CardTitle>
                    <CardDescription>按 channel + chatId 聚合，定位某个渠道会话的工具和模型调用</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Channel</TableHead>
                                <TableHead>Chat ID</TableHead>
                                <TableHead class="text-right">Sessions</TableHead>
                                <TableHead class="text-right">Runs</TableHead>
                                <TableHead class="text-right">工具</TableHead>
                                <TableHead class="text-right">模型</TableHead>
                                <TableHead class="text-right">工具种类</TableHead>
                                <TableHead class="text-right">Token</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.chats.length === 0}
                                <TableRow><TableCell colspan={8} class="usage-empty-cell">当前筛选范围没有 channel/chat 数据</TableCell></TableRow>
                            {:else}
                                {#each traceStats.chats.slice(0, 30) as chat}
                                    <TableRow>
                                        <TableCell>{chat.channel}</TableCell>
                                        <TableCell class="trace-id-cell" title={chat.chatId}>{shortId(chat.chatId)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(chat.sessions)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(chat.runs)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(chat.toolCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(chat.modelCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(chat.distinctTools)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(chat.totalTokens)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">工具调用排行</CardTitle>
                    <CardDescription>按工具 name 聚合调用次数、成功/失败/阻止次数</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>工具</TableHead>
                                <TableHead class="text-right">调用</TableHead>
                                <TableHead class="text-right">执行</TableHead>
                                <TableHead class="text-right">成功</TableHead>
                                <TableHead class="text-right">失败</TableHead>
                                <TableHead class="text-right">阻止</TableHead>
                                <TableHead class="text-right">均耗时</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.tools.length === 0}
                                <TableRow><TableCell colspan={7} class="usage-empty-cell">当前筛选范围没有工具调用</TableCell></TableRow>
                            {:else}
                                {#each traceStats.tools.slice(0, 20) as tool}
                                    <TableRow>
                                        <TableCell class="trace-id-cell">{tool.name}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(tool.calls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(tool.executedCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(tool.success)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(tool.error)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(tool.blocked)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatDuration(tool.avgDurationMs)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">模型请求排行</CardTitle>
                    <CardDescription>按 provider / model / api 聚合模型请求</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>模型</TableHead>
                                <TableHead>Provider</TableHead>
                                <TableHead>API</TableHead>
                                <TableHead class="text-right">请求</TableHead>
                                <TableHead class="text-right">输入</TableHead>
                                <TableHead class="text-right">输出</TableHead>
                                <TableHead class="text-right">缓存</TableHead>
                                <TableHead class="text-right">总 Token</TableHead>
                                <TableHead class="text-right">均耗时</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.models.length === 0}
                                <TableRow><TableCell colspan={9} class="usage-empty-cell">当前筛选范围没有模型请求</TableCell></TableRow>
                            {:else}
                                {#each traceStats.models.slice(0, 20) as model}
                                    <TableRow>
                                        <TableCell class="trace-id-cell">{model.model}</TableCell>
                                        <TableCell>{model.provider}</TableCell>
                                        <TableCell>{model.api}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(model.requests)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(model.inputTokens)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(model.outputTokens)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(model.cacheReadTokens + model.cacheWriteTokens)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(model.totalTokens)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatDuration(model.avgDurationMs)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>

        <div class="usage-detail-grid">
            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">Bot 汇总</CardTitle>
                    <CardDescription>按 usage 页同一 botId 口径聚合工具调用和模型 token</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Bot</TableHead>
                                <TableHead class="text-right">Channels</TableHead>
                                <TableHead class="text-right">Chats</TableHead>
                                <TableHead class="text-right">Sessions</TableHead>
                                <TableHead class="text-right">Runs</TableHead>
                                <TableHead class="text-right">工具</TableHead>
                                <TableHead class="text-right">模型</TableHead>
                                <TableHead class="text-right">Token</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.bots.length === 0}
                                <TableRow><TableCell colspan={8} class="usage-empty-cell">当前筛选范围没有 bot 数据</TableCell></TableRow>
                            {:else}
                                {#each traceStats.bots.slice(0, 30) as bot}
                                    <TableRow>
                                        <TableCell class="trace-id-cell" title={bot.botId}>{shortId(bot.botId)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(bot.channels)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(bot.chats)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(bot.sessions)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(bot.runs)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(bot.toolCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(bot.modelCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(bot.totalTokens)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">Session 汇总</CardTitle>
                    <CardDescription>查看某个 session 一共关联多少 run、工具调用和模型请求</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Session</TableHead>
                                <TableHead class="text-right">Runs</TableHead>
                                <TableHead class="text-right">工具</TableHead>
                                <TableHead class="text-right">模型</TableHead>
                                <TableHead class="text-right">工具种类</TableHead>
                                <TableHead class="text-right">Token</TableHead>
                                <TableHead>最后更新</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.sessions.length === 0}
                                <TableRow><TableCell colspan={7} class="usage-empty-cell">当前筛选范围没有 session 数据</TableCell></TableRow>
                            {:else}
                                {#each traceStats.sessions.slice(0, 30) as session}
                                    <TableRow>
                                        <TableCell class="trace-id-cell" title={session.sessionId}>{shortId(session.sessionId)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(session.runs)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(session.toolCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(session.modelCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(session.distinctTools)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(session.totalTokens)}</TableCell>
                                        <TableCell class="usage-cell-timestamp">{formatDateTime(session.lastAt)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">Run 汇总</CardTitle>
                    <CardDescription>查看某一轮对话调用了多少工具、发了多少模型请求</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Run</TableHead>
                                <TableHead>Session</TableHead>
                                <TableHead class="text-right">工具</TableHead>
                                <TableHead class="text-right">模型</TableHead>
                                <TableHead class="text-right">工具种类</TableHead>
                                <TableHead class="text-right">Token</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.runs.length === 0}
                                <TableRow><TableCell colspan={6} class="usage-empty-cell">当前筛选范围没有 run 数据</TableCell></TableRow>
                            {:else}
                                {#each traceStats.runs.slice(0, 30) as run}
                                    <TableRow>
                                        <TableCell class="trace-id-cell" title={run.runId}>{shortId(run.runId)}</TableCell>
                                        <TableCell class="trace-id-cell" title={run.sessionId}>{shortId(run.sessionId)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(run.toolCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(run.modelCalls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(run.distinctTools)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatCompact(run.totalTokens)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <CardTitle class="font-serif">最近 Trace Facts</CardTitle>
                <CardDescription>最多展示当前筛选结果中的最近 200 条 fact</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>时间</TableHead>
                            <TableHead>Bot</TableHead>
                            <TableHead>Channel</TableHead>
                            <TableHead>Chat</TableHead>
                            <TableHead>类型</TableHead>
                            <TableHead>名称</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>Run</TableHead>
                            <TableHead>Session</TableHead>
                            <TableHead class="text-right">耗时</TableHead>
                            <TableHead class="text-right">输入</TableHead>
                            <TableHead class="text-right">输出</TableHead>
                            <TableHead class="text-right">缓存</TableHead>
                            <TableHead class="text-right">总 Token</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {#if recentFacts.length === 0}
                            <TableRow><TableCell colspan={14} class="usage-empty-cell">当前筛选范围没有 trace fact</TableCell></TableRow>
                        {:else}
                            {#each recentFacts as fact}
                                <TableRow>
                                    <TableCell class="usage-cell-timestamp">{formatDateTime(fact.updatedAt)}</TableCell>
                                    <TableCell class="trace-id-cell" title={fact.botId ?? "unknown"}>{shortId(fact.botId ?? "unknown")}</TableCell>
                                    <TableCell>{fact.channel}</TableCell>
                                    <TableCell class="trace-id-cell" title={fact.chatId}>{shortId(fact.chatId)}</TableCell>
                                    <TableCell>{factTypeLabel(fact.factType)}</TableCell>
                                    <TableCell>
                                        <div class="trace-fact-name">
                                            <span class="trace-id-cell">{displayFactName(fact)}</span>
                                            <span class="trace-fact-subtitle">{factSubtitle(fact)}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={statusVariant(fact.status)}>{statusLabel(fact.status)}</Badge>
                                    </TableCell>
                                    <TableCell class="trace-id-cell" title={fact.runId}>{shortId(fact.runId)}</TableCell>
                                    <TableCell class="trace-id-cell" title={fact.sessionId}>{shortId(fact.sessionId)}</TableCell>
                                    <TableCell class="text-right tabular-nums">{formatDuration(fact.durationMs ?? 0)}</TableCell>
                                    <TableCell class="text-right tabular-nums">{fact.inputTokens ? formatCompact(fact.inputTokens) : "--"}</TableCell>
                                    <TableCell class="text-right tabular-nums">{fact.outputTokens ? formatCompact(fact.outputTokens) : "--"}</TableCell>
                                    <TableCell class="text-right tabular-nums">{fact.cacheReadTokens || fact.cacheWriteTokens ? formatCompact((fact.cacheReadTokens ?? 0) + (fact.cacheWriteTokens ?? 0)) : "--"}</TableCell>
                                    <TableCell class="text-right tabular-nums">{fact.totalTokens ? formatCompact(fact.totalTokens) : "--"}</TableCell>
                                </TableRow>
                            {/each}
                        {/if}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    {/if}
</div>

<footer class="settings-footbar">
    <div class="settings-footbar-status">
        {#if traceLoading}
            <span class="usage-footbar-status-line">
                <span class="usage-pulse-dot usage-pulse-dot-loading"></span>
                Trace 数据同步中...
            </span>
        {:else if traceStats}
            <span class="settings-footbar-ok usage-footbar-status-line">
                <span class="usage-pulse-dot usage-pulse-dot-ready"></span>
                Trace 数据已就绪
            </span>
        {/if}
    </div>
    <div class="usage-footbar-refresh-line">
        <Button variant="outline" size="sm" onclick={loadTrace} disabled={traceLoading} class="usage-footbar-refresh-btn">
            {#if traceLoading}
                同步中
            {:else}
                立即刷新
            {/if}
        </Button>
    </div>
</footer>
