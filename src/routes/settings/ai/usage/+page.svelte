<script lang="ts">
    import { onMount } from "svelte";
    import PageShell from "$lib/ui/PageShell.svelte";

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

<PageShell widthClass="max-w-[1500px]" gapClass="space-y-6">
    <section class="usage-board">
        <header class="usage-header">
            <div>
                <p class="eyebrow">AI Usage Observatory</p>
                <h1>使用统计</h1>
                <p class="header-copy">
                    基于现有 token usage 记录展示请求量、Token 消耗、模型/API 分布和最近事件；没有记录的成本、延迟、成功率不在本页伪造。
                </p>
            </div>
            <div class="header-actions">
                <div class="range-tabs" aria-label="时间范围">
                    {#each ["today", "yesterday", "last7Days", "last30Days"] as range}
                        <button
                            type="button"
                            class:active={selectedRange === range}
                            on:click={() => selectRange(range as TimeRange)}
                        >
                            {windowTitle(range as TimeRange)}
                        </button>
                    {/each}
                </div>
                <button class="refresh-button" type="button" on:click={loadUsage} disabled={usageLoading}>
                    <span aria-hidden="true">↻</span>
                    {usageLoading ? "同步中" : "刷新"}
                </button>
            </div>
        </header>

        {#if usageError}
            <div class="state-card error">Error: {usageError}</div>
        {:else if usageLoading && !usageStats}
            <div class="state-card">正在加载 usage 记录...</div>
        {:else if usageStats}
            <div class="filter-bar">
                <div class="filter-item">
                    <label for="usage-model">模型</label>
                    <select id="usage-model" bind:value={selectedModelId}>
                        <option value="all">全部模型</option>
                        {#each availableModels as model}
                            <option value={model.id}>{model.label}</option>
                        {/each}
                    </select>
                </div>
                <div class="filter-item">
                    <label for="usage-bot">Bot</label>
                    <select id="usage-bot" bind:value={selectedBotId}>
                        <option value="all">全部 Bot</option>
                        {#each availableBots as bot}
                            <option value={bot.id}>{bot.label}</option>
                        {/each}
                    </select>
                </div>
                <div class="filter-item">
                    <label for="usage-channel">渠道</label>
                    <select id="usage-channel" bind:value={selectedChannel}>
                        <option value="all">全部渠道</option>
                        {#each availableChannels as channel}
                            <option value={channel}>{channel}</option>
                        {/each}
                    </select>
                </div>
                <button class="ghost-button" type="button" on:click={resetFilters}>清空筛选</button>
                <div class="generated-at">
                    {#if selectedWindow}
                        {selectedWindow.startDate} → {selectedWindow.endDate}
                    {/if}
                    <span>更新于 {formatDateTime(usageStats.generatedAt)}</span>
                </div>
            </div>

            <div class="metric-grid">
                <article class="metric-card primary-card">
                    <div class="card-topline">
                        <span>总请求数</span>
                        <span class="badge green">Requests</span>
                    </div>
                    <strong>{formatNumber(totals.requests)}</strong>
                    <p>当前筛选范围内的 AI 调用记录数</p>
                    <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                        <polygon points={areaPoints(trend.map((point) => point.totals.requests))}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.requests))}></polyline>
                    </svg>
                </article>

                <article class="metric-card primary-card purple">
                    <div class="card-topline">
                        <span>总 Token 数</span>
                        <span class="badge violet">Tokens</span>
                    </div>
                    <strong>{formatCompact(totals.totalTokens)}</strong>
                    <p>
                        输入 {formatCompact(totals.inputTokens)} · 输出 {formatCompact(totals.outputTokens)} · 缓存 {formatCompact(cacheTokens)}
                    </p>
                    <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
                        <polygon points={areaPoints(trend.map((point) => point.totals.totalTokens))}></polygon>
                        <polyline points={linePoints(trend.map((point) => point.totals.totalTokens))}></polyline>
                    </svg>
                </article>

                <article class="metric-card small-card cyan">
                    <span>输入 Tokens</span>
                    <strong>{formatCompact(totals.inputTokens)}</strong>
                    <p>{pct(totals.inputTokens, totals.totalTokens).toFixed(1)}% of total</p>
                </article>
                <article class="metric-card small-card amber">
                    <span>输出 Tokens</span>
                    <strong>{formatCompact(totals.outputTokens)}</strong>
                    <p>{pct(totals.outputTokens, totals.totalTokens).toFixed(1)}% of total</p>
                </article>
                <article class="metric-card small-card lime">
                    <span>缓存 Tokens</span>
                    <strong>{formatCompact(cacheTokens)}</strong>
                    <p>Read {formatCompact(totals.cacheReadTokens)} · Write {formatCompact(totals.cacheWriteTokens)}</p>
                </article>
                <article class="metric-card small-card teal">
                    <span>缓存命中比例</span>
                    <strong>{formatPercent(cacheHitRatio)}</strong>
                    <p>
                        {#if cachePromptBase > 0}
                            按 cache read / (input + cache read) 计算
                        {:else}
                            当前范围没有可计算的 prompt cache 基数
                        {/if}
                    </p>
                </article>
            </div>

            <div class="chart-grid">
                <article class="panel">
                    <div class="panel-heading">
                        <div>
                            <h2>请求趋势</h2>
                            <p>{selectedRange === "today" || selectedRange === "yesterday" ? "按小时聚合" : "按天聚合"}</p>
                        </div>
                        <span class="legend-dot neutral">requests</span>
                    </div>
                    <div class="line-chart">
                        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="请求趋势折线图">
                            <g class="grid-lines">
                                <line x1="0" y1="8" x2="100" y2="8"></line>
                                <line x1="0" y1="20" x2="100" y2="20"></line>
                                <line x1="0" y1="32" x2="100" y2="32"></line>
                            </g>
                            <polygon points={areaPoints(trend.map((point) => point.totals.requests), 100, 40)}></polygon>
                            <polyline points={linePoints(trend.map((point) => point.totals.requests), 100, 40)}></polyline>
                        </svg>
                    </div>
                    <div class="axis-labels">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>{trend[Math.floor(trend.length / 2)]?.label ?? "--"}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </article>

                <article class="panel">
                    <div class="panel-heading">
                        <div>
                            <h2>Token 使用趋势</h2>
                            <p>总 Token 数随时间变化</p>
                        </div>
                        <span class="legend-dot violet">tokens</span>
                    </div>
                    <div class="line-chart token-chart">
                        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Token 趋势折线图">
                            <g class="grid-lines">
                                <line x1="0" y1="8" x2="100" y2="8"></line>
                                <line x1="0" y1="20" x2="100" y2="20"></line>
                                <line x1="0" y1="32" x2="100" y2="32"></line>
                            </g>
                            <polygon points={areaPoints(trend.map((point) => point.totals.totalTokens), 100, 40)}></polygon>
                            <polyline points={linePoints(trend.map((point) => point.totals.totalTokens), 100, 40)}></polyline>
                        </svg>
                    </div>
                    <div class="axis-labels">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>峰值 {formatCompact(maxTokens)}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </article>

                <article class="panel">
                    <div class="panel-heading">
                        <div>
                            <h2>缓存命中比例趋势</h2>
                            <p>按 cache read / (input + cache read) 计算，不含 output / cache write</p>
                        </div>
                        <span class="legend-dot hit-rate">cache hit</span>
                    </div>
                    <div class="line-chart cache-hit-chart">
                        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="缓存命中比例趋势折线图">
                            <g class="grid-lines">
                                <line x1="0" y1="8" x2="100" y2="8"></line>
                                <line x1="0" y1="20" x2="100" y2="20"></line>
                                <line x1="0" y1="32" x2="100" y2="32"></line>
                            </g>
                            <polygon points={areaPoints(cacheHitTrend, 100, 40, 100)}></polygon>
                            <polyline points={linePoints(cacheHitTrend, 100, 40, 100)}></polyline>
                        </svg>
                    </div>
                    <div class="axis-labels">
                        <span>{trend[0]?.label ?? "--"}</span>
                        <span>峰值 {formatPercent(maxCacheHitRatio)}</span>
                        <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                    </div>
                </article>
            </div>

            <article class="panel wide-panel">
                <div class="panel-heading">
                    <div>
                        <h2>Token 类型分布</h2>
                        <p>仅展示已记录的 input / output / cache read / cache write 字段</p>
                    </div>
                    <div class="legend-row">
                        <span class="legend-dot input">输入</span>
                        <span class="legend-dot output">输出</span>
                        <span class="legend-dot cache">缓存</span>
                    </div>
                </div>
                <div class="stack-chart">
                    {#each trend as point}
                        {@const pointCache = point.totals.cacheReadTokens + point.totals.cacheWriteTokens}
                        <div class="stack-column" title={`${point.label}: ${formatNumber(point.totals.totalTokens)} tokens`}>
                            <span class="bar input" style={`height:${Math.max(1, pct(point.totals.inputTokens, maxTokens))}%`}></span>
                            <span class="bar output" style={`height:${Math.max(1, pct(point.totals.outputTokens, maxTokens))}%`}></span>
                            <span class="bar cache" style={`height:${Math.max(1, pct(pointCache, maxTokens))}%`}></span>
                        </div>
                    {/each}
                </div>
                <div class="axis-labels">
                    <span>{trend[0]?.label ?? "--"}</span>
                    <span>{windowTitle(selectedRange)}</span>
                    <span>{trend[trend.length - 1]?.label ?? "--"}</span>
                </div>
            </article>

            <div class="summary-grid">
                <article class="panel">
                    <div class="panel-heading">
                        <div>
                            <h2>API 详细统计</h2>
                            <p>按 usage 记录中的 api 字段聚合</p>
                        </div>
                    </div>
                    <div class="rank-list">
                        {#if apiRows.length === 0}
                            <p class="empty-copy">当前范围没有 API 记录。</p>
                        {:else}
                            {#each apiRows.slice(0, 8) as row}
                                <div class="rank-row">
                                    <div>
                                        <strong>{row.label}</strong>
                                        <span>{formatNumber(row.requests)} 请求</span>
                                    </div>
                                    <em>{formatCompact(row.totalTokens)}</em>
                                </div>
                            {/each}
                        {/if}
                    </div>
                </article>

                <article class="panel">
                    <div class="panel-heading">
                        <div>
                            <h2>模型统计</h2>
                            <p>按 provider / model 聚合</p>
                        </div>
                    </div>
                    <div class="table-wrap compact-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>模型名称</th>
                                    <th>请求次数</th>
                                    <th>Token 数量</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#if modelRows.length === 0}
                                    <tr><td colspan="3">当前范围没有模型记录。</td></tr>
                                {:else}
                                    {#each modelRows.slice(0, 8) as row}
                                        <tr>
                                            <td>
                                                <strong>{row.label}</strong>
                                                <span>{row.sublabel}</span>
                                            </td>
                                            <td>{formatNumber(row.requests)}</td>
                                            <td>{formatCompact(row.totalTokens)}</td>
                                        </tr>
                                    {/each}
                                {/if}
                            </tbody>
                        </table>
                    </div>
                </article>
            </div>

            {#if botRows.length > 0 || channelRows.length > 0}
                <div class="summary-grid">
                    <article class="panel">
                        <div class="panel-heading">
                            <div>
                                <h2>Bot 分布</h2>
                                <p>基于现有 botId 字段</p>
                            </div>
                        </div>
                        <div class="rank-list">
                            {#each botRows.slice(0, 8) as row}
                                <div class="rank-row">
                                    <div>
                                        <strong>{row.label}</strong>
                                        <span>{formatNumber(row.requests)} 请求</span>
                                    </div>
                                    <em>{formatCompact(row.totalTokens)}</em>
                                </div>
                            {/each}
                        </div>
                    </article>

                    <article class="panel">
                        <div class="panel-heading">
                            <div>
                                <h2>渠道分布</h2>
                                <p>基于现有 channel 字段</p>
                            </div>
                        </div>
                        <div class="rank-list">
                            {#each channelRows.slice(0, 8) as row}
                                <div class="rank-row">
                                    <div>
                                        <strong>{row.label}</strong>
                                        <span>{formatNumber(row.requests)} 请求</span>
                                    </div>
                                    <em>{formatCompact(row.totalTokens)}</em>
                                </div>
                            {/each}
                        </div>
                    </article>
                </div>
            {/if}

            <article class="panel wide-panel">
                <div class="panel-heading">
                    <div>
                        <h2>请求事件明细</h2>
                        <p>最近 {recentRecords.length} 条匹配记录；本系统暂未记录结果、延迟、认证索引和费用。</p>
                    </div>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>时间</th>
                                <th>模型名称</th>
                                <th>渠道</th>
                                <th>Bot</th>
                                <th>API</th>
                                <th>输入</th>
                                <th>输出</th>
                                <th>缓存</th>
                                <th>总 Token</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#if recentRecords.length === 0}
                                <tr><td colspan="9">当前筛选范围没有 usage 记录。</td></tr>
                            {:else}
                                {#each recentRecords as record}
                                    <tr>
                                        <td>{formatDateTime(record.ts)}</td>
                                        <td>
                                            <strong>{record.model}</strong>
                                            <span>{record.provider}</span>
                                        </td>
                                        <td>{record.channel}</td>
                                        <td>{record.botId}</td>
                                        <td>{record.api}</td>
                                        <td>{formatNumber(record.inputTokens)}</td>
                                        <td>{formatNumber(record.outputTokens)}</td>
                                        <td>{formatNumber(record.cacheReadTokens + record.cacheWriteTokens)}</td>
                                        <td>{formatNumber(record.totalTokens)}</td>
                                    </tr>
                                {/each}
                            {/if}
                        </tbody>
                    </table>
                </div>
            </article>
        {/if}
    </section>
</PageShell>
