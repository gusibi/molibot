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

    interface UsageTotals {
        requests: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
    }

    interface AiUsageRecord {
        ts: string;
        channel: string;
        botId: string;
        provider: string;
        model: string;
        api: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
    }

    interface ModelUsageSummary extends UsageTotals {
        provider: string;
        model: string;
        api: string;
    }

    interface BotUsageSummary extends UsageTotals {
        botId: string;
    }

    interface WindowSummary {
        startDate: string;
        endDate: string;
        totals: UsageTotals;
        models: ModelUsageSummary[];
        bots: BotUsageSummary[];
    }

    interface BucketSummary {
        bucket: string;
        startDate?: string;
        endDate?: string;
        totals: UsageTotals;
        models: ModelUsageSummary[];
        bots: BotUsageSummary[];
    }

    interface UsageStatsResponse {
        timezone: string;
        generatedAt: string;
        records: AiUsageRecord[];
        totals: UsageTotals;
        windows: {
            today: WindowSummary;
            yesterday: WindowSummary;
            last7Days: WindowSummary;
            last30Days: WindowSummary;
        };
        breakdowns: {
            daily: BucketSummary[];
            weekly: BucketSummary[];
            monthly: BucketSummary[];
        };
    }

    interface TrendPoint {
        key: string;
        label: string;
        totals: UsageTotals;
    }

    interface RankedRow extends UsageTotals {
        id: string;
        label: string;
        sublabel?: string;
    }

    const emptyTotals = (): UsageTotals => ({
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
    });

    let usageLoading = true;
    let usageError = "";
    let usageStats: UsageStatsResponse | null = null;

    let selectedRange: TimeRange = "today";
    let selectedModelId: "all" | string = "all";
    let selectedBotId: "all" | string = "all";
    let selectedChannel: "all" | string = "all";

    async function loadUsage() {
        usageLoading = true;
        usageError = "";
        try {
            const res = await fetch("/api/settings/usage");
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || res.statusText);
            }
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Failed to fetch usage");
            usageStats = data.stats as UsageStatsResponse;
        } catch (e) {
            usageError = e instanceof Error ? e.message : String(e);
        } finally {
            usageLoading = false;
        }
    }

    onMount(loadUsage);

    function addTotals(target: UsageTotals, record: AiUsageRecord): void {
        target.requests += 1;
        target.inputTokens += record.inputTokens;
        target.outputTokens += record.outputTokens;
        target.cacheReadTokens += record.cacheReadTokens;
        target.cacheWriteTokens += record.cacheWriteTokens;
        target.totalTokens += record.totalTokens;
    }

    function formatNumber(value: number): string {
        return new Intl.NumberFormat("en-US").format(value ?? 0);
    }

    function formatCompact(value: number): string {
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
        if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
        return formatNumber(value);
    }

    function formatPercent(value: number): string {
        return `${value.toFixed(1)}%`;
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

    function localDateKey(value: string | Date, timeZone: string): string {
        const date = typeof value === "string" ? new Date(value) : value;
        return new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(date);
    }

    function localHour(value: string, timeZone: string): string {
        return new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour: "2-digit",
            hourCycle: "h23",
            hour12: false,
        }).format(new Date(value));
    }

    function shiftDateKey(dateKey: string, deltaDays: number): string {
        const [year, month, day] = dateKey.split("-").map(Number);
        const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
        return shifted.toISOString().slice(0, 10);
    }

    function dateRange(startDate: string, endDate: string): string[] {
        const out: string[] = [];
        let cursor = startDate;
        while (cursor <= endDate) {
            out.push(cursor);
            cursor = shiftDateKey(cursor, 1);
        }
        return out;
    }

    function windowTitle(range: TimeRange): string {
        const titles: Record<TimeRange, string> = {
            today: "今天",
            yesterday: "昨天",
            last7Days: "最近 7 天",
            last30Days: "最近 30 天",
        };
        return titles[range];
    }

    function modelId(record: AiUsageRecord): string {
        return `${record.provider}::${record.model}`;
    }

    function passesFilters(record: AiUsageRecord): boolean {
        if (selectedModelId !== "all" && modelId(record) !== selectedModelId) return false;
        if (selectedBotId !== "all" && record.botId !== selectedBotId) return false;
        if (selectedChannel !== "all" && record.channel !== selectedChannel) return false;
        return true;
    }

    function recordsForWindow(stats: UsageStatsResponse | null): AiUsageRecord[] {
        if (!stats) return [];
        const win = stats.windows[selectedRange];
        return stats.records.filter((record) => {
            const day = localDateKey(record.ts, stats.timezone);
            return day >= win.startDate && day <= win.endDate && passesFilters(record);
        });
    }

    function summarize(records: AiUsageRecord[]): UsageTotals {
        const totals = emptyTotals();
        for (const record of records) addTotals(totals, record);
        return totals;
    }

    function rankedBy(records: AiUsageRecord[], key: (record: AiUsageRecord) => RankedRow): RankedRow[] {
        const rows = new Map<string, RankedRow>();
        for (const record of records) {
            const seed = key(record);
            const row = rows.get(seed.id) ?? { ...seed, ...emptyTotals() };
            addTotals(row, record);
            rows.set(seed.id, row);
        }
        return Array.from(rows.values()).sort((a, b) => {
            if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
            return a.label.localeCompare(b.label);
        });
    }

    function buildTrend(records: AiUsageRecord[], stats: UsageStatsResponse | null): TrendPoint[] {
        if (!stats) return [];
        const win = stats.windows[selectedRange];
        const hourly = selectedRange === "today" || selectedRange === "yesterday";
        const points = new Map<string, TrendPoint>();

        if (hourly) {
            for (let hour = 0; hour < 24; hour += 1) {
                const hh = String(hour).padStart(2, "0");
                const key = `${win.startDate} ${hh}`;
                points.set(key, { key, label: `${hh}:00`, totals: emptyTotals() });
            }
        } else {
            for (const day of dateRange(win.startDate, win.endDate)) {
                points.set(day, { key: day, label: day.slice(5), totals: emptyTotals() });
            }
        }

        for (const record of records) {
            const day = localDateKey(record.ts, stats.timezone);
            const key = hourly ? `${day} ${localHour(record.ts, stats.timezone)}` : day;
            const point = points.get(key);
            if (point) addTotals(point.totals, record);
        }

        return Array.from(points.values());
    }

    function linePoints(values: number[], width = 100, height = 34, maxOverride?: number): string {
        if (values.length === 0) return "";
        const max = Math.max(1, maxOverride ?? 0, ...values);
        const step = values.length === 1 ? width : width / (values.length - 1);
        return values
            .map((value, index) => {
                const x = index * step;
                const y = height - (value / max) * (height - 4) - 2;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ");
    }

    function areaPoints(values: number[], width = 100, height = 34, maxOverride?: number): string {
        const top = linePoints(values, width, height, maxOverride);
        if (!top) return "";
        return `0,${height} ${top} ${width},${height}`;
    }

    function pct(value: number, total: number): number {
        if (total <= 0) return 0;
        return Math.max(0, Math.min(100, (value / total) * 100));
    }

    function cacheHitRate(input: Pick<UsageTotals, "inputTokens" | "cacheReadTokens">): number {
        const promptSideTokens = input.inputTokens + input.cacheReadTokens;
        if (promptSideTokens <= 0) return 0;
        return pct(input.cacheReadTokens, promptSideTokens);
    }

    function selectRange(range: TimeRange): void {
        selectedRange = range;
        void loadUsage();
    }

    function resetFilters() {
        selectedModelId = "all";
        selectedBotId = "all";
        selectedChannel = "all";
    }

    $: availableModels = usageStats
        ? Array.from(new Map(usageStats.records.map((record) => [modelId(record), `${record.provider} / ${record.model}`])).entries())
              .map(([id, label]) => ({ id, label }))
              .sort((a, b) => a.label.localeCompare(b.label))
        : [];
    $: availableBots = usageStats
        ? Array.from(new Set(usageStats.records.map((record) => record.botId || "unknown")))
              .map((id) => ({ id, label: id }))
              .sort((a, b) => a.label.localeCompare(b.label))
        : [];
    $: availableChannels = usageStats
        ? Array.from(new Set(usageStats.records.map((record) => record.channel || "unknown"))).sort()
        : [];
    $: visibleRecords = recordsForWindow(usageStats);
    $: totals = summarize(visibleRecords);
    $: trend = buildTrend(visibleRecords, usageStats);
    $: maxRequests = Math.max(1, ...trend.map((point) => point.totals.requests));
    $: maxTokens = Math.max(1, ...trend.map((point) => point.totals.totalTokens));
    $: modelRows = rankedBy(visibleRecords, (record) => ({
        id: modelId(record),
        label: record.model,
        sublabel: record.provider,
        ...emptyTotals(),
    }));
    $: apiRows = rankedBy(visibleRecords, (record) => ({
        id: record.api,
        label: record.api,
        sublabel: "API endpoint",
        ...emptyTotals(),
    }));
    $: channelRows = rankedBy(visibleRecords, (record) => ({
        id: record.channel,
        label: record.channel,
        sublabel: "channel",
        ...emptyTotals(),
    }));
    $: botRows = rankedBy(visibleRecords, (record) => ({
        id: record.botId,
        label: record.botId,
        sublabel: "bot",
        ...emptyTotals(),
    }));
    $: recentRecords = [...visibleRecords].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 80);
    $: cacheTokens = totals.cacheReadTokens + totals.cacheWriteTokens;
    $: cachePromptBase = totals.inputTokens + totals.cacheReadTokens;
    $: cacheHitRatio = cacheHitRate(totals);
    $: cacheHitTrend = trend.map((point) => cacheHitRate(point.totals));
    $: maxCacheHitRatio = Math.max(0, ...cacheHitTrend);
    $: selectedWindow = usageStats?.windows[selectedRange];
</script>

<div class="mx-auto flex max-w-[1500px] flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
    <header class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="flex max-w-3xl flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" class="font-medium">AI Usage Observatory</Badge>
                <Badge variant="outline" class="font-medium">{windowTitle(selectedRange)}</Badge>
            </div>
            <div class="flex flex-col gap-2">
                <h1 class="font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">使用统计</h1>
                <p class="text-sm leading-6 text-muted-foreground">
                    基于现有 token usage 记录展示请求量、Token 消耗、模型/API 分布和最近事件；没有记录的成本、延迟、成功率不在本页伪造。
                </p>
            </div>
        </div>
        <div class="flex flex-col gap-3 lg:items-end">
            <div class="flex flex-wrap gap-2" aria-label="时间范围">
                {#each ["today", "yesterday", "last7Days", "last30Days"] as range}
                    <Button
                        type="button"
                        variant={selectedRange === range ? "default" : "outline"}
                        size="sm"
                        onclick={() => selectRange(range as TimeRange)}
                        class={selectedRange === range ? "bg-[#A36A5E] hover:bg-[#A36A5E]/90" : ""}
                    >
                        {windowTitle(range as TimeRange)}
                    </Button>
                {/each}
            </div>
        </div>
    </header>

    {#if usageError}
        <Alert variant="destructive">
            <AlertDescription>Error: {usageError}</AlertDescription>
        </Alert>
    {:else if usageLoading && !usageStats}
        <Card class="border-border/50 shadow-sm">
            <CardHeader>
                <Skeleton class="h-5 w-40" />
                <Skeleton class="h-4 w-80 max-w-full" />
            </CardHeader>
            <CardContent class="grid gap-4 md:grid-cols-3">
                <Skeleton class="h-28 w-full" />
                <Skeleton class="h-28 w-full" />
                <Skeleton class="h-28 w-full" />
            </CardContent>
        </Card>
    {:else if usageStats}
        <Card class="border-border/50 shadow-sm">
            <CardContent class="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto_1.4fr]">
                <div class="flex flex-col gap-2">
                    <Label for="usage-model" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">模型</Label>
                    <NativeSelect id="usage-model" class="w-full" bind:value={selectedModelId}>
                        <NativeSelectOption value="all">全部模型</NativeSelectOption>
                        {#each availableModels as model}
                            <NativeSelectOption value={model.id}>{model.label}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
                <div class="flex flex-col gap-2">
                    <Label for="usage-bot" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bot</Label>
                    <NativeSelect id="usage-bot" class="w-full" bind:value={selectedBotId}>
                        <NativeSelectOption value="all">全部 Bot</NativeSelectOption>
                        {#each availableBots as bot}
                            <NativeSelectOption value={bot.id}>{bot.label}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
                <div class="flex flex-col gap-2">
                    <Label for="usage-channel" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">渠道</Label>
                    <NativeSelect id="usage-channel" class="w-full" bind:value={selectedChannel}>
                        <NativeSelectOption value="all">全部渠道</NativeSelectOption>
                        {#each availableChannels as channel}
                            <NativeSelectOption value={channel}>{channel}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
                <div class="flex items-end">
                    <Button variant="outline" type="button" onclick={resetFilters} class="text-xs">清空筛选</Button>
                </div>
                <div class="flex flex-col justify-end gap-1 text-sm text-muted-foreground tabular-nums">
                    {#if selectedWindow}
                        <span>{selectedWindow.startDate} → {selectedWindow.endDate}</span>
                    {/if}
                    <span>更新于 {formatDateTime(usageStats.generatedAt)}</span>
                </div>
            </CardContent>
        </Card>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <Card class="xl:col-span-2 border-border/50 shadow-sm">
                <CardHeader>
                    <div class="flex items-center justify-between gap-3">
                        <CardTitle class="font-serif text-lg">总请求数</CardTitle>
                        <Badge variant="secondary" class="bg-[#A36A5E]/10 text-[#A36A5E] border-transparent font-semibold">Requests</Badge>
                    </div>
                    <CardDescription>当前筛选范围内的 AI 调用记录数</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-4">
                    <strong class="text-3xl font-bold tracking-tight tabular-nums">{formatNumber(totals.requests)}</strong>
                    <svg class="h-16 w-full fill-[#A36A5E]/5 stroke-[#A36A5E]" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                        <polygon points={areaPoints(trend.map((point) => point.totals.requests))}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.requests))} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                </CardContent>
            </Card>

            <Card class="xl:col-span-2 border-border/50 shadow-sm">
                <CardHeader>
                    <div class="flex items-center justify-between gap-3">
                        <CardTitle class="font-serif text-lg">总 Token 数</CardTitle>
                        <Badge variant="secondary" class="bg-[#8B9A6D]/10 text-[#8B9A6D] border-transparent font-semibold">Tokens</Badge>
                    </div>
                    <CardDescription class="tabular-nums">
                        输入 {formatCompact(totals.inputTokens)} · 输出 {formatCompact(totals.outputTokens)} · 缓存 {formatCompact(cacheTokens)}
                    </CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-4">
                    <strong class="text-3xl font-bold tracking-tight tabular-nums">{formatCompact(totals.totalTokens)}</strong>
                    <svg class="h-16 w-full fill-[#8B9A6D]/5 stroke-[#8B9A6D]" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                        <polygon points={areaPoints(trend.map((point) => point.totals.totalTokens))}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.totalTokens))} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                </CardContent>
            </Card>

            <Card class="border-l-4 border-l-[#A36A5E] border-border/50 shadow-sm">
                <CardHeader>
                    <CardDescription class="text-xs font-semibold uppercase tracking-wider">输入 Tokens</CardDescription>
                    <CardTitle class="tabular-nums">{formatCompact(totals.inputTokens)}</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground tabular-nums">
                    {pct(totals.inputTokens, totals.totalTokens).toFixed(1)}% of total
                </CardContent>
            </Card>
            <Card class="border-l-4 border-l-[#8B9A6D] border-border/50 shadow-sm">
                <CardHeader>
                    <CardDescription class="text-xs font-semibold uppercase tracking-wider">输出 Tokens</CardDescription>
                    <CardTitle class="tabular-nums">{formatCompact(totals.outputTokens)}</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground tabular-nums">
                    {pct(totals.outputTokens, totals.totalTokens).toFixed(1)}% of total
                </CardContent>
            </Card>
            <Card class="border-l-4 border-l-[#C2A182] border-border/50 shadow-sm">
                <CardHeader>
                    <CardDescription class="text-xs font-semibold uppercase tracking-wider">缓存 Tokens</CardDescription>
                    <CardTitle class="tabular-nums">{formatCompact(cacheTokens)}</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground tabular-nums">
                    Read {formatCompact(totals.cacheReadTokens)} · Write {formatCompact(totals.cacheWriteTokens)}
                </CardContent>
            </Card>
            <Card class="border-l-4 border-l-[#7A8A99] border-border/50 shadow-sm">
                <CardHeader>
                    <CardDescription class="text-xs font-semibold uppercase tracking-wider">缓存命中比例</CardDescription>
                    <CardTitle class="tabular-nums">{formatPercent(cacheHitRatio)}</CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground tabular-nums">
                    {#if cachePromptBase > 0}
                        cache read / (input + cache read)
                    {:else}
                        当前范围没有可计算的 prompt cache 基数
                    {/if}
                </CardContent>
            </Card>
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
            <Card class="border-border/50 shadow-sm">
                <CardHeader>
                    <CardTitle class="font-serif">请求趋势</CardTitle>
                    <CardDescription>{selectedRange === "today" || selectedRange === "yesterday" ? "按小时聚合" : "按天聚合"}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-3">
                    <svg class="h-44 w-full fill-[#A36A5E]/5 stroke-[#A36A5E]" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="请求趋势折线图">
                        <g class="stroke-border/30">
                            <line x1="0" y1="8" x2="100" y2="8"></line>
                            <line x1="0" y1="20" x2="100" y2="20"></line>
                            <line x1="0" y1="32" x2="100" y2="32"></line>
                        </g>
                        <polygon points={areaPoints(trend.map((point) => point.totals.requests), 100, 40)}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.requests), 100, 40)} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                    <div class="flex justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>{trend[Math.floor(trend.length / 2)]?.label ?? "--"}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </CardContent>
            </Card>

            <Card class="border-border/50 shadow-sm">
                <CardHeader>
                    <CardTitle class="font-serif">Token 使用趋势</CardTitle>
                    <CardDescription>总 Token 数随时间变化</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-3">
                    <svg class="h-44 w-full fill-[#8B9A6D]/5 stroke-[#8B9A6D]" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Token 趋势折线图">
                        <g class="stroke-border/30">
                            <line x1="0" y1="8" x2="100" y2="8"></line>
                            <line x1="0" y1="20" x2="100" y2="20"></line>
                            <line x1="0" y1="32" x2="100" y2="32"></line>
                        </g>
                        <polygon points={areaPoints(trend.map((point) => point.totals.totalTokens), 100, 40)}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.totalTokens), 100, 40)} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                    <div class="flex justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>峰值 {formatCompact(maxTokens)}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </CardContent>
            </Card>

            <Card class="border-border/50 shadow-sm">
                <CardHeader>
                    <CardTitle class="font-serif">缓存命中比例趋势</CardTitle>
                    <CardDescription>不含 output / cache write</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-3">
                    <svg class="h-44 w-full fill-[#C2A182]/5 stroke-[#C2A182]" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="缓存命中比例趋势折线图">
                        <g class="stroke-border/30">
                            <line x1="0" y1="8" x2="100" y2="8"></line>
                            <line x1="0" y1="20" x2="100" y2="20"></line>
                            <line x1="0" y1="32" x2="100" y2="32"></line>
                        </g>
                        <polygon points={areaPoints(cacheHitTrend, 100, 40, 100)}></polygon>
                        <polyline points={linePoints(cacheHitTrend, 100, 40, 100)} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                    <div class="flex justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>峰值 {formatPercent(maxCacheHitRatio)}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </CardContent>
            </Card>
        </div>

        <Card class="border-border/50 shadow-sm">
            <CardHeader>
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <CardTitle class="font-serif">Token 类型分布</CardTitle>
                        <CardDescription>仅展示已记录的 input / output / cache read / cache write 字段</CardDescription>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <Badge variant="outline" class="border-[#A36A5E]/40 text-[#A36A5E] bg-[#A36A5E]/5 font-semibold">输入</Badge>
                        <Badge variant="outline" class="border-[#8B9A6D]/40 text-[#8B9A6D] bg-[#8B9A6D]/5 font-semibold">输出</Badge>
                        <Badge variant="outline" class="border-[#C2A182]/40 text-[#C2A182] bg-[#C2A182]/5 font-semibold">缓存</Badge>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="flex flex-col gap-3">
                <div class="flex h-44 items-end gap-1 rounded-lg border border-border/50 bg-muted/10 p-3">
                    {#each trend as point}
                        {@const pointCache = point.totals.cacheReadTokens + point.totals.cacheWriteTokens}
                        <div class="flex h-full min-w-1 flex-1 items-end gap-px" title={`${point.label}: ${formatNumber(point.totals.totalTokens)} tokens`}>
                            <span class="w-full rounded-t-sm bg-[#A36A5E]/70" style={`height:${Math.max(1, pct(point.totals.inputTokens, maxTokens))}%`}></span>
                            <span class="w-full rounded-t-sm bg-[#8B9A6D]/80" style={`height:${Math.max(1, pct(point.totals.outputTokens, maxTokens))}%`}></span>
                            <span class="w-full rounded-t-sm bg-[#C2A182]/60" style={`height:${Math.max(1, pct(pointCache, maxTokens))}%`}></span>
                        </div>
                    {/each}
                </div>
                <div class="flex justify-between text-xs text-muted-foreground tabular-nums">
                    <span>{trend[0]?.label ?? "--"}</span>
                    <span>{windowTitle(selectedRange)}</span>
                    <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                </div>
            </CardContent>
        </Card>

        <div class="grid gap-4 xl:grid-cols-2">
            <Card class="border-border/50 shadow-sm">
                <CardHeader>
                    <CardTitle class="font-serif">API 详细统计</CardTitle>
                    <CardDescription>按 usage 记录中的 api 字段聚合</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    {#if apiRows.length === 0}
                        <p class="text-sm text-muted-foreground">当前范围没有 API 记录。</p>
                    {:else}
                        {#each apiRows.slice(0, 8) as row}
                            <div class="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3 hover:bg-muted/5 transition-colors">
                                <div class="min-w-0">
                                    <p class="truncate text-sm font-semibold">{row.label}</p>
                                    <p class="text-xs text-muted-foreground tabular-nums">{formatNumber(row.requests)} 请求</p>
                                </div>
                                <Badge variant="secondary" class="font-mono tabular-nums bg-muted/20">{formatCompact(row.totalTokens)}</Badge>
                            </div>
                        {/each}
                    {/if}
                </CardContent>
            </Card>

            <Card class="border-border/50 shadow-sm">
                <CardHeader>
                    <CardTitle class="font-serif">模型统计</CardTitle>
                    <CardDescription>按 provider / model 聚合</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow class="hover:bg-transparent">
                                <TableHead class="text-xs font-semibold uppercase tracking-wider">模型名称</TableHead>
                                <TableHead class="text-xs font-semibold uppercase tracking-wider">请求次数</TableHead>
                                <TableHead class="text-xs font-semibold uppercase tracking-wider">Token 数量</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if modelRows.length === 0}
                                <TableRow><TableCell colspan="3" class="text-muted-foreground">当前范围没有模型记录。</TableCell></TableRow>
                            {:else}
                                {#each modelRows.slice(0, 8) as row}
                                    <TableRow class="hover:bg-muted/5 transition-colors">
                                        <TableCell>
                                            <div class="flex flex-col">
                                                <span class="font-semibold">{row.label}</span>
                                                <span class="text-xs text-muted-foreground">{row.sublabel}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell class="tabular-nums">{formatNumber(row.requests)}</TableCell>
                                        <TableCell class="tabular-nums font-medium">{formatCompact(row.totalTokens)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>

        {#if botRows.length > 0 || channelRows.length > 0}
            <div class="grid gap-4 xl:grid-cols-2">
                <Card class="border-border/50 shadow-sm">
                    <CardHeader>
                        <CardTitle class="font-serif">Bot 分布</CardTitle>
                        <CardDescription>基于现有 botId 字段</CardDescription>
                    </CardHeader>
                    <CardContent class="flex flex-col gap-2">
                        {#each botRows.slice(0, 8) as row}
                            <div class="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3 hover:bg-muted/5 transition-colors">
                                <div class="min-w-0">
                                    <p class="truncate text-sm font-semibold">{row.label}</p>
                                    <p class="text-xs text-muted-foreground tabular-nums">{formatNumber(row.requests)} 请求</p>
                                </div>
                                <Badge variant="secondary" class="font-mono tabular-nums bg-muted/20">{formatCompact(row.totalTokens)}</Badge>
                            </div>
                        {/each}
                    </CardContent>
                </Card>

                <Card class="border-border/50 shadow-sm">
                    <CardHeader>
                        <CardTitle class="font-serif">渠道分布</CardTitle>
                        <CardDescription>基于现有 channel 字段</CardDescription>
                    </CardHeader>
                    <CardContent class="flex flex-col gap-2">
                        {#each channelRows.slice(0, 8) as row}
                            <div class="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3 hover:bg-muted/5 transition-colors">
                                <div class="min-w-0">
                                    <p class="truncate text-sm font-semibold">{row.label}</p>
                                    <p class="text-xs text-muted-foreground tabular-nums">{formatNumber(row.requests)} 请求</p>
                                </div>
                                <Badge variant="secondary" class="font-mono tabular-nums bg-muted/20">{formatCompact(row.totalTokens)}</Badge>
                            </div>
                        {/each}
                    </CardContent>
                </Card>
            </div>
        {/if}

        <Card class="border-border/50 shadow-sm">
            <CardHeader>
                <CardTitle class="font-serif">请求事件明细</CardTitle>
                <CardDescription>最近 {recentRecords.length} 条匹配记录；本系统暂未记录结果、延迟、认证索引和费用。</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow class="hover:bg-transparent">
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">时间</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">模型名称</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">渠道</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">Bot</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">API</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">输入</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">输出</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">缓存</TableHead>
                            <TableHead class="text-xs font-semibold uppercase tracking-wider">总 Token</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {#if recentRecords.length === 0}
                            <TableRow><TableCell colspan="9" class="text-muted-foreground">当前筛选范围没有 usage 记录。</TableCell></TableRow>
                        {:else}
                            {#each recentRecords as record}
                                <TableRow class="hover:bg-muted/5 transition-colors">
                                    <TableCell class="tabular-nums text-xs">{formatDateTime(record.ts)}</TableCell>
                                    <TableCell>
                                        <div class="flex flex-col">
                                            <span class="font-semibold">{record.model}</span>
                                            <span class="text-xs text-muted-foreground">{record.provider}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell class="text-xs font-medium">{record.channel}</TableCell>
                                    <TableCell class="text-xs font-medium">{record.botId}</TableCell>
                                    <TableCell class="text-xs font-mono">{record.api}</TableCell>
                                    <TableCell class="tabular-nums">{formatNumber(record.inputTokens)}</TableCell>
                                    <TableCell class="tabular-nums">{formatNumber(record.outputTokens)}</TableCell>
                                    <TableCell class="tabular-nums">{formatNumber(record.cacheReadTokens + record.cacheWriteTokens)}</TableCell>
                                    <TableCell class="tabular-nums font-semibold">{formatNumber(record.totalTokens)}</TableCell>
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
        {#if usageLoading}
            <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span class="h-2 w-2 animate-pulse rounded-full bg-[#A36A5E]"></span>
                数据同步中...
            </span>
        {:else if usageStats}
            <span class="settings-footbar-ok flex items-center gap-2 text-xs font-medium">
                <span class="h-2 w-2 rounded-full bg-[#8B9A6D]"></span>
                数据已就绪
            </span>
        {/if}
    </div>
    <div class="flex items-center gap-3">
        <Button variant="outline" size="sm" onclick={loadUsage} disabled={usageLoading} class="h-9 px-4 text-xs font-bold">
            {#if usageLoading}
                同步中
            {:else}
                立即刷新
            {/if}
        </Button>
    </div>
</footer>

<style>
    :global(.tabular-nums) {
        font-variant-numeric: tabular-nums;
    }
</style>

