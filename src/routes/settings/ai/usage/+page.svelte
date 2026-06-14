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
    import { locale } from "$lib/ui/i18n";

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

    const COPY = {
        "zh-CN": {
            eyebrow: "AI 使用观测台",
            title: "使用统计",
            desc: "基于现有 token usage 记录展示请求量、Token 消耗、模型/API 分布和最近事件；没有记录的成本、延迟、成功率不在本页伪造。",
            timeRange: "时间范围",
            modelLabel: "模型",
            allModels: "全部模型",
            botLabel: "Bot",
            allBots: "全部 Bot",
            channelLabel: "渠道",
            allChannels: "全部渠道",
            clearFilters: "清空筛选",
            updatedAt: "更新于",
            totalRequests: "总请求数",
            totalRequestsDesc: "当前筛选范围内的 AI 调用记录数",
            totalTokens: "总 Token 数",
            totalTokensDesc: "输入 {input} · 输出 {output} · 缓存 {cache}",
            inputTokensLabel: "输入 Tokens",
            percentOfTotal: "占总量的 {percent}%",
            outputTokensLabel: "输出 Tokens",
            cacheTokensLabel: "缓存 Tokens",
            cacheReadWrite: "读取 {read} · 写入 {write}",
            cacheHitRatioLabel: "缓存命中比例",
            noCachePromptBase: "当前范围没有可计算的 prompt cache 基数",
            requestTrend: "请求趋势",
            hourlyAggregation: "按小时聚合",
            dailyAggregation: "按天聚合",
            peak: "峰值",
            tokenTrend: "Token 使用趋势",
            tokenTrendDesc: "总 Token 数随时间变化",
            cacheHitTrendTitle: "缓存命中比例趋势",
            cacheHitTrendDesc: "不含 output / cache write",
            tokenDistribution: "Token 类型分布",
            tokenDistributionDesc: "仅展示已记录的 input / output / cache read / cache write 字段",
            legendInput: "输入",
            legendOutput: "输出",
            legendCache: "缓存",
            apiStatsTitle: "API 详细统计",
            apiStatsDesc: "按 usage 记录中的 api 字段聚合",
            noApiRecords: "当前范围没有 API 记录。",
            requestsCount: "请求",
            modelStatsTitle: "模型统计",
            modelStatsDesc: "按 provider / model 聚合",
            colModelName: "模型名称",
            colRequests: "请求次数",
            colTokens: "Token 数量",
            noModelRecords: "当前范围没有模型记录。",
            botDistribution: "Bot 分布",
            botDistributionDesc: "基于现有 botId 字段",
            channelDistribution: "渠道分布",
            channelDistributionDesc: "基于现有 channel 字段",
            eventDetailsTitle: "请求事件明细",
            eventDetailsDesc: "按所选条件筛选的 AI 调用记录；本系统暂未记录结果、延迟、认证索引和费用。",
            colTime: "时间",
            colChannel: "渠道",
            colBot: "Bot",
            colApi: "API",
            colInput: "输入",
            colOutput: "输出",
            colCache: "缓存",
            colTotalTokens: "总 Token",
            noEventRecords: "当前筛选范围没有 usage 记录。",
            statusSyncing: "数据同步中...",
            statusReady: "数据已就绪",
            refreshBtn: "立即刷新",
            syncingBtn: "同步中",
            errorPrefix: "错误：",
            paginationInfo: "第 {page} / {pages} 页 (共 {total} 条记录)",
            pageSizeLabel: "每页条数",
            prevPage: "上一页",
            nextPage: "下一页"
        },
        "en-US": {
            eyebrow: "AI Usage Observatory",
            title: "AI Usage Stats",
            desc: "Requests, Token consumption, model/API distribution and recent events based on actual token usage logs. Unrecorded costs, latency, or success rates are not simulated.",
            timeRange: "Time Range",
            modelLabel: "Model",
            allModels: "All Models",
            botLabel: "Bot",
            allBots: "All Bots",
            channelLabel: "Channel",
            allChannels: "All Channels",
            clearFilters: "Clear Filters",
            updatedAt: "Updated at",
            totalRequests: "Total Requests",
            totalRequestsDesc: "AI call count in the current filtered scope",
            totalTokens: "Total Tokens",
            totalTokensDesc: "Input {input} · Output {output} · Cache {cache}",
            inputTokensLabel: "Input Tokens",
            percentOfTotal: "{percent}% of total",
            outputTokensLabel: "Output Tokens",
            cacheTokensLabel: "Cache Tokens",
            cacheReadWrite: "Read {read} · Write {write}",
            cacheHitRatioLabel: "Cache Hit Ratio",
            noCachePromptBase: "No prompts cache base available in the current range",
            requestTrend: "Request Trend",
            hourlyAggregation: "Hourly aggregation",
            dailyAggregation: "Daily aggregation",
            peak: "Peak",
            tokenTrend: "Token Usage Trend",
            tokenTrendDesc: "Total tokens over time",
            cacheHitTrendTitle: "Cache Hit Ratio Trend",
            cacheHitTrendDesc: "Excludes output / cache write",
            tokenDistribution: "Token Type Distribution",
            tokenDistributionDesc: "Only showing logged input / output / cache read / cache write",
            legendInput: "Input",
            legendOutput: "Output",
            legendCache: "Cache",
            apiStatsTitle: "API Statistics",
            apiStatsDesc: "Aggregated by the API field in usage records",
            noApiRecords: "No API records in the current scope.",
            requestsCount: "requests",
            modelStatsTitle: "Model Statistics",
            modelStatsDesc: "Aggregated by provider / model",
            colModelName: "Model Name",
            colRequests: "Requests",
            colTokens: "Tokens",
            noModelRecords: "No model records in the current scope.",
            botDistribution: "Bot Distribution",
            botDistributionDesc: "Based on the botId field",
            channelDistribution: "Channel Distribution",
            channelDistributionDesc: "Based on the channel field",
            eventDetailsTitle: "Request Event Details",
            eventDetailsDesc: "AI call records in the filtered scope; results, latency, auth indexes, and costs are not recorded.",
            colTime: "Time",
            colChannel: "Channel",
            colBot: "Bot",
            colApi: "API",
            colInput: "Input",
            colOutput: "Output",
            colCache: "Cache",
            colTotalTokens: "Total Tokens",
            noEventRecords: "No usage records in the current filtered scope.",
            statusSyncing: "Syncing data...",
            statusReady: "Data ready",
            refreshBtn: "Refresh Now",
            syncingBtn: "Syncing",
            errorPrefix: "Error: ",
            paginationInfo: "Page {page} of {pages} ({total} records)",
            pageSizeLabel: "Page size",
            prevPage: "Previous",
            nextPage: "Next"
        }
    } as const;

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

    let currentPage = 1;
    let pageSize = 20;

    let paginatedRecords: AiUsageRecord[] = [];
    let totalRecordsCount = 0;
    let recordsLoading = false;

    async function loadPaginatedRecords() {
        recordsLoading = true;
        try {
            const params = new URLSearchParams({
                range: selectedRange,
                modelId: selectedModelId,
                botId: selectedBotId,
                channel: selectedChannel,
                page: String(currentPage),
                pageSize: String(pageSize),
            });
            const res = await fetch(`/api/settings/usage/records?${params.toString()}`);
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            if (data.ok) {
                paginatedRecords = data.data;
                totalRecordsCount = data.total;
            }
        } catch (e) {
            console.error(e);
        } finally {
            recordsLoading = false;
        }
    }

    $: {
        selectedRange;
        selectedModelId;
        selectedBotId;
        selectedChannel;
        currentPage = 1;
    }

    $: {
        if (usageStats) {
            currentPage;
            pageSize;
            selectedRange;
            selectedModelId;
            selectedBotId;
            selectedChannel;
            void loadPaginatedRecords();
        }
    }

    $: copy = COPY[$locale] ?? COPY["en-US"];

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
            today: $locale === "zh-CN" ? "今天" : "Today",
            yesterday: $locale === "zh-CN" ? "昨天" : "Yesterday",
            last7Days: $locale === "zh-CN" ? "最近 7 天" : "Last 7 Days",
            last30Days: $locale === "zh-CN" ? "最近 30 天" : "Last 30 Days",
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
    $: totalPages = Math.ceil(totalRecordsCount / pageSize) || 1;
    $: cacheTokens = totals.cacheReadTokens + totals.cacheWriteTokens;
    $: cachePromptBase = totals.inputTokens + totals.cacheReadTokens;
    $: cacheHitRatio = cacheHitRate(totals);
    $: cacheHitTrend = trend.map((point) => cacheHitRate(point.totals));
    $: maxCacheHitRatio = Math.max(0, ...cacheHitTrend);
    $: selectedWindow = usageStats?.windows[selectedRange];
</script>

<div class="usage-page">
    <header class="usage-header">
        <div class="usage-header-left">
            <div class="usage-header-badges">
                <Badge variant="secondary" class="usage-badge-medium">{copy.eyebrow}</Badge>
                <Badge variant="outline" class="usage-badge-medium">{windowTitle(selectedRange)}</Badge>
            </div>
            <div class="usage-header-text">
                <h1 class="usage-header-title">{copy.title}</h1>
                <p class="usage-header-desc">
                    {copy.desc}
                </p>
            </div>
        </div>
        <div class="usage-header-right">
            <div class="usage-range-buttons" aria-label={copy.timeRange}>
                {#each ["today", "yesterday", "last7Days", "last30Days"] as range}
                    <Button
                        type="button"
                        variant={selectedRange === range ? "default" : "outline"}
                        size="sm"
                        onclick={() => selectRange(range as TimeRange)}
                        class={selectedRange === range ? "usage-range-active" : ""}
                    >
                        {windowTitle(range as TimeRange)}
                    </Button>
                {/each}
            </div>
        </div>
    </header>

    {#if usageError}
        <Alert variant="destructive">
            <AlertDescription>{copy.errorPrefix}{usageError}</AlertDescription>
        </Alert>
    {:else if usageLoading && !usageStats}
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
    {:else if usageStats}
        <Card>
            <CardContent class="usage-filters">
                <div class="usage-filter-group">
                    <Label for="usage-model" class="usage-filter-label">{copy.modelLabel}</Label>
                    <NativeSelect id="usage-model" class="w-full" bind:value={selectedModelId}>
                        <NativeSelectOption value="all">{copy.allModels}</NativeSelectOption>
                        {#each availableModels as model}
                            <NativeSelectOption value={model.id}>{model.label}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
                <div class="usage-filter-group">
                    <Label for="usage-bot" class="usage-filter-label">{copy.botLabel}</Label>
                    <NativeSelect id="usage-bot" class="w-full" bind:value={selectedBotId}>
                        <NativeSelectOption value="all">{copy.allBots}</NativeSelectOption>
                        {#each availableBots as bot}
                            <NativeSelectOption value={bot.id}>{bot.label}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
                <div class="usage-filter-group">
                    <Label for="usage-channel" class="usage-filter-label">{copy.channelLabel}</Label>
                    <NativeSelect id="usage-channel" class="w-full" bind:value={selectedChannel}>
                        <NativeSelectOption value="all">{copy.allChannels}</NativeSelectOption>
                        {#each availableChannels as channel}
                            <NativeSelectOption value={channel}>{channel}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
                <div class="usage-filter-reset">
                    <Button variant="outline" type="button" onclick={resetFilters} class="usage-filter-reset-btn">{copy.clearFilters}</Button>
                </div>
                <div class="usage-filter-meta">
                    {#if selectedWindow}
                        <span>{selectedWindow.startDate} → {selectedWindow.endDate}</span>
                    {/if}
                    <span>{copy.updatedAt} {formatDateTime(usageStats.generatedAt)}</span>
                </div>
            </CardContent>
        </Card>

        <div class="usage-metrics">
            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">{copy.totalRequests}</CardTitle>
                        <Badge variant="secondary" class="usage-badge-requests">Requests</Badge>
                    </div>
                    <CardDescription>{copy.totalRequestsDesc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-4">
                    <strong class="usage-metric-value">{formatNumber(totals.requests)}</strong>
                    <svg class="usage-spark usage-spark-area" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                        <polygon points={areaPoints(trend.map((point) => point.totals.requests))}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.requests))} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                </CardContent>
            </Card>

            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">{copy.totalTokens}</CardTitle>
                        <Badge variant="secondary" class="usage-badge-tokens">Tokens</Badge>
                    </div>
                    <CardDescription class="tabular-nums">
                        {copy.totalTokensDesc.replace("{input}", formatCompact(totals.inputTokens)).replace("{output}", formatCompact(totals.outputTokens)).replace("{cache}", formatCompact(cacheTokens))}
                    </CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-4">
                    <strong class="usage-metric-value">{formatCompact(totals.totalTokens)}</strong>
                    <svg class="usage-spark usage-spark-area-token" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                        <polygon points={areaPoints(trend.map((point) => point.totals.totalTokens))}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.totalTokens))} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                </CardContent>
            </Card>

            <Card class="usage-metric-accent-1">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.inputTokensLabel}</CardDescription>
                    <CardTitle class="tabular-nums">{formatCompact(totals.inputTokens)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">
                    {copy.percentOfTotal.replace("{percent}", pct(totals.inputTokens, totals.totalTokens).toFixed(1))}
                </CardContent>
            </Card>
            <Card class="usage-metric-accent-2">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.outputTokensLabel}</CardDescription>
                    <CardTitle class="tabular-nums">{formatCompact(totals.outputTokens)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">
                    {copy.percentOfTotal.replace("{percent}", pct(totals.outputTokens, totals.totalTokens).toFixed(1))}
                </CardContent>
            </Card>
            <Card class="usage-metric-accent-3">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.cacheTokensLabel}</CardDescription>
                    <CardTitle class="tabular-nums">{formatCompact(cacheTokens)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">
                    {copy.cacheReadWrite.replace("{read}", formatCompact(totals.cacheReadTokens)).replace("{write}", formatCompact(totals.cacheWriteTokens))}
                </CardContent>
            </Card>
            <Card class="usage-metric-accent-4">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.cacheHitRatioLabel}</CardDescription>
                    <CardTitle class="tabular-nums">{formatPercent(cacheHitRatio)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">
                    {#if cachePromptBase > 0}
                        cache read / (input + cache read)
                    {:else}
                        {copy.noCachePromptBase}
                    {/if}
                </CardContent>
            </Card>
        </div>

        <div class="usage-detail-grid">
            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.requestTrend}</CardTitle>
                    <CardDescription>{selectedRange === "today" || selectedRange === "yesterday" ? copy.hourlyAggregation : copy.dailyAggregation}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-3">
                    <svg class="usage-trend-chart usage-trend-chart-area" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Request trend line chart">
                        <g class="usage-trend-grid">
                            <line x1="0" y1="8" x2="100" y2="8"></line>
                            <line x1="0" y1="20" x2="100" y2="20"></line>
                            <line x1="0" y1="32" x2="100" y2="32"></line>
                        </g>
                        <polygon points={areaPoints(trend.map((point) => point.totals.requests), 100, 40)}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.requests), 100, 40)} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                    <div class="usage-trend-labels">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>{trend[Math.floor(trend.length / 2)]?.label ?? "--"}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.tokenTrend}</CardTitle>
                    <CardDescription>{copy.tokenTrendDesc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-3">
                    <svg class="usage-trend-chart usage-trend-chart-area-token" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Token trend line chart">
                        <g class="usage-trend-grid">
                            <line x1="0" y1="8" x2="100" y2="8"></line>
                            <line x1="0" y1="20" x2="100" y2="20"></line>
                            <line x1="0" y1="32" x2="100" y2="32"></line>
                        </g>
                        <polygon points={areaPoints(trend.map((point) => point.totals.totalTokens), 100, 40)}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.totalTokens), 100, 40)} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                    <div class="usage-trend-labels">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>{copy.peak} {formatCompact(maxTokens)}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.cacheHitTrendTitle}</CardTitle>
                    <CardDescription>{copy.cacheHitTrendDesc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-3">
                    <svg class="usage-trend-chart usage-trend-chart-area-cache" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Cache hit ratio trend line chart">
                        <g class="usage-trend-grid">
                            <line x1="0" y1="8" x2="100" y2="8"></line>
                            <line x1="0" y1="20" x2="100" y2="20"></line>
                            <line x1="0" y1="32" x2="100" y2="32"></line>
                        </g>
                        <polygon points={areaPoints(cacheHitTrend, 100, 40, 100)}></polygon>
                        <polyline points={linePoints(cacheHitTrend, 100, 40, 100)} fill="none" stroke-width="1.5"></polyline>
                    </svg>
                    <div class="usage-trend-labels">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>{copy.peak} {formatPercent(maxCacheHitRatio)}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <div class="usage-metric-header">
                    <div>
                        <CardTitle class="font-serif">{copy.tokenDistribution}</CardTitle>
                        <CardDescription>{copy.tokenDistributionDesc}</CardDescription>
                    </div>
                    <div class="usage-legend-badges">
                        <Badge variant="outline" class="usage-legend-input">{copy.legendInput}</Badge>
                        <Badge variant="outline" class="usage-legend-output">{copy.legendOutput}</Badge>
                        <Badge variant="outline" class="usage-legend-cache">{copy.legendCache}</Badge>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="flex flex-col gap-3">
                <div class="usage-distribution">
                    {#each trend as point}
                        {@const pointCache = point.totals.cacheReadTokens + point.totals.cacheWriteTokens}
                        <div class="usage-bar-group" title={`${point.label}: ${formatNumber(point.totals.totalTokens)} tokens`}>
                            <span class="usage-bar-input" style={`height:${Math.max(1, pct(point.totals.inputTokens, maxTokens))}%`}></span>
                            <span class="usage-bar-output" style={`height:${Math.max(1, pct(point.totals.outputTokens, maxTokens))}%`}></span>
                            <span class="usage-bar-cache" style={`height:${Math.max(1, pct(pointCache, maxTokens))}%`}></span>
                        </div>
                    {/each}
                </div>
                <div class="usage-trend-labels">
                    <span>{trend[0]?.label ?? "--"}</span>
                    <span>{windowTitle(selectedRange)}</span>
                    <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                </div>
            </CardContent>
        </Card>

        <div class="usage-detail-grid">
            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.apiStatsTitle}</CardTitle>
                    <CardDescription>{copy.apiStatsDesc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    {#if apiRows.length === 0}
                        <p class="usage-empty-text">{copy.noApiRecords}</p>
                    {:else}
                        {#each apiRows.slice(0, 8) as row}
                            <div class="usage-detail-row">
                                <div class="usage-detail-label">
                                    <p class="usage-detail-label-text">{row.label}</p>
                                    <p class="usage-detail-label-sub">{formatNumber(row.requests)} {copy.requestsCount}</p>
                                </div>
                                <Badge variant="secondary" class="usage-detail-badge">{formatCompact(row.totalTokens)}</Badge>
                            </div>
                        {/each}
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.modelStatsTitle}</CardTitle>
                    <CardDescription>{copy.modelStatsDesc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead class="usage-table-head">{copy.colModelName}</TableHead>
                                <TableHead class="usage-table-head">{copy.colRequests}</TableHead>
                                <TableHead class="usage-table-head">{copy.colTokens}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if modelRows.length === 0}
                                <TableRow><TableCell colspan="3" class="usage-empty-text">{copy.noModelRecords}</TableCell></TableRow>
                            {:else}
                                {#each modelRows.slice(0, 8) as row}
                                    <TableRow>
                                        <TableCell>
                                            <div class="flex flex-col">
                                                <span class="usage-cell-model-name">{row.label}</span>
                                                <span class="usage-cell-model-provider">{row.sublabel}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell class="tabular-nums">{formatNumber(row.requests)}</TableCell>
                                        <TableCell class="tabular-nums usage-cell-model-name">{formatCompact(row.totalTokens)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>

        {#if botRows.length > 0 || channelRows.length > 0}
            <div class="usage-detail-grid">
                <Card>
                    <CardHeader>
                        <CardTitle class="font-serif">{copy.botDistribution}</CardTitle>
                        <CardDescription>{copy.botDistributionDesc}</CardDescription>
                    </CardHeader>
                    <CardContent class="flex flex-col gap-2">
                        {#each botRows.slice(0, 8) as row}
                            <div class="usage-detail-row">
                                <div class="usage-detail-label">
                                    <p class="usage-detail-label-text">{row.label}</p>
                                    <p class="usage-detail-label-sub">{formatNumber(row.requests)} {copy.requestsCount}</p>
                                </div>
                                <Badge variant="secondary" class="usage-detail-badge">{formatCompact(row.totalTokens)}</Badge>
                            </div>
                        {/each}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="font-serif">{copy.channelDistribution}</CardTitle>
                        <CardDescription>{copy.channelDistributionDesc}</CardDescription>
                    </CardHeader>
                    <CardContent class="flex flex-col gap-2">
                        {#each channelRows.slice(0, 8) as row}
                            <div class="usage-detail-row">
                                <div class="usage-detail-label">
                                    <p class="usage-detail-label-text">{row.label}</p>
                                    <p class="usage-detail-label-sub">{formatNumber(row.requests)} {copy.requestsCount}</p>
                                </div>
                                <Badge variant="secondary" class="usage-detail-badge">{formatCompact(row.totalTokens)}</Badge>
                            </div>
                        {/each}
                    </CardContent>
                </Card>
            </div>
        {/if}

        <Card>
            <CardHeader>
                <CardTitle class="font-serif">{copy.eventDetailsTitle}</CardTitle>
                <CardDescription>{copy.eventDetailsDesc}</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead class="usage-table-head">{copy.colTime}</TableHead>
                            <TableHead class="usage-table-head">{copy.colModelName}</TableHead>
                            <TableHead class="usage-table-head">{copy.colChannel}</TableHead>
                            <TableHead class="usage-table-head">{copy.colBot}</TableHead>
                            <TableHead class="usage-table-head">{copy.colApi}</TableHead>
                            <TableHead class="usage-table-head">{copy.colInput}</TableHead>
                            <TableHead class="usage-table-head">{copy.colOutput}</TableHead>
                            <TableHead class="usage-table-head">{copy.colCache}</TableHead>
                            <TableHead class="usage-table-head">{copy.colTotalTokens}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody class={recordsLoading ? "opacity-50 transition-opacity" : "transition-opacity"}>
                        {#if paginatedRecords.length === 0}
                            <TableRow><TableCell colspan="9" class="usage-empty-text">{copy.noEventRecords}</TableCell></TableRow>
                        {:else}
                            {#each paginatedRecords as record}
                                <TableRow>
                                    <TableCell class="usage-cell-timestamp">{formatDateTime(record.ts)}</TableCell>
                                    <TableCell>
                                        <div class="flex flex-col">
                                            <span class="usage-cell-model-name">{record.model}</span>
                                            <span class="usage-cell-model-provider">{record.provider}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell class="usage-cell-channel">{record.channel}</TableCell>
                                    <TableCell class="usage-cell-channel">{record.botId}</TableCell>
                                    <TableCell class="usage-cell-api">{record.api}</TableCell>
                                    <TableCell class="tabular-nums">{formatNumber(record.inputTokens)}</TableCell>
                                    <TableCell class="tabular-nums">{formatNumber(record.outputTokens)}</TableCell>
                                    <TableCell class="tabular-nums">{formatNumber(record.cacheReadTokens + record.cacheWriteTokens)}</TableCell>
                                    <TableCell class="tabular-nums usage-cell-model-name">{formatNumber(record.totalTokens)}</TableCell>
                                </TableRow>
                            {/each}
                        {/if}
                    </TableBody>
                </Table>

                {#if totalRecordsCount > 0}
                    <div class="pagination-container">
                        <div class="pagination-info">
                            {copy.paginationInfo.replace("{page}", String(currentPage)).replace("{pages}", String(totalPages)).replace("{total}", String(totalRecordsCount))}
                        </div>
                        <div class="pagination-controls">
                            <div class="pagination-size">
                                <label for="usage-page-size">{copy.pageSizeLabel}</label>
                                <select id="usage-page-size" bind:value={pageSize} onchange={() => currentPage = 1}>
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={30}>30</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                            </div>
                            <div class="pagination-buttons">
                                <Button variant="outline" size="sm" onclick={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1}>
                                    {copy.prevPage}
                                </Button>
                                <Button variant="outline" size="sm" onclick={() => currentPage = Math.min(totalPages, currentPage + 1)} disabled={currentPage === totalPages}>
                                    {copy.nextPage}
                                </Button>
                            </div>
                        </div>
                    </div>
                {/if}
            </CardContent>
        </Card>
    {/if}
</div>

<footer class="settings-footbar">
    <div class="settings-footbar-status">
        {#if usageLoading}
            <span class="usage-footbar-status-line">
                <span class="usage-pulse-dot usage-pulse-dot-loading"></span>
                {copy.statusSyncing}
            </span>
        {:else if usageStats}
            <span class="settings-footbar-ok usage-footbar-status-line">
                <span class="usage-pulse-dot usage-pulse-dot-ready"></span>
                {copy.statusReady}
            </span>
        {/if}
    </div>
    <div class="usage-footbar-refresh-line">
        <Button variant="outline" size="sm" onclick={loadUsage} disabled={usageLoading} class="usage-footbar-refresh-btn">
            {#if usageLoading}
                {copy.syncingBtn}
            {:else}
                {copy.refreshBtn}
            {/if}
        </Button>
    </div>
</footer>
