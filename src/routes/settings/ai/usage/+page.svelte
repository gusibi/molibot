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

    function linePoints(values: number[], width = 100, height = 34): string {
        if (values.length === 0) return "";
        const max = Math.max(1, ...values);
        const step = values.length === 1 ? width : width / (values.length - 1);
        return values
            .map((value, index) => {
                const x = index * step;
                const y = height - (value / max) * (height - 4) - 2;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ");
    }

    function areaPoints(values: number[], width = 100, height = 34): string {
        const top = linePoints(values, width, height);
        if (!top) return "";
        return `0,${height} ${top} ${width},${height}`;
    }

    function pct(value: number, total: number): number {
        if (total <= 0) return 0;
        return Math.max(0, Math.min(100, (value / total) * 100));
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
                            on:click={() => (selectedRange = range as TimeRange)}
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

<style>
    .usage-board {
        color: var(--foreground);
    }

    .usage-header,
    .filter-bar,
    .panel,
    .metric-card,
    .state-card {
        border: 1px solid color-mix(in oklab, var(--border) 78%, transparent);
        background:
            linear-gradient(180deg, color-mix(in oklab, var(--card) 94%, white 3%), var(--card)),
            var(--card);
        box-shadow: var(--shadow);
    }

    .usage-header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 28px;
        border-radius: 24px;
    }

    .eyebrow {
        margin: 0 0 10px;
        color: color-mix(in oklab, var(--primary) 74%, var(--foreground));
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
    }

    h1,
    h2 {
        margin: 0;
        letter-spacing: 0;
    }

    h1 {
        font-size: clamp(2rem, 4vw, 4.4rem);
        line-height: 0.95;
        font-weight: 900;
    }

    h2 {
        font-size: 1.08rem;
        font-weight: 850;
    }

    .header-copy,
    .panel-heading p,
    .metric-card p,
    .empty-copy,
    .generated-at {
        color: var(--muted-foreground);
    }

    .header-copy {
        max-width: 680px;
        margin: 14px 0 0;
        font-size: 0.95rem;
        line-height: 1.7;
    }

    .header-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 12px;
    }

    .range-tabs,
    .refresh-button,
    .ghost-button {
        border: 1px solid var(--border);
        background: color-mix(in oklab, var(--muted) 64%, transparent);
    }

    .range-tabs {
        display: flex;
        padding: 4px;
        border-radius: 14px;
        gap: 4px;
    }

    .range-tabs button,
    .refresh-button,
    .ghost-button {
        cursor: pointer;
        border-radius: 10px;
        color: var(--foreground);
        font-weight: 750;
        transition: transform 0.16s ease, background-color 0.16s ease, border-color 0.16s ease;
    }

    .range-tabs button {
        border: 0;
        background: transparent;
        padding: 9px 12px;
        white-space: nowrap;
    }

    .range-tabs button.active {
        background: var(--foreground);
        color: var(--background);
    }

    .refresh-button,
    .ghost-button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
    }

    .filter-bar {
        display: grid;
        grid-template-columns: repeat(3, minmax(170px, 1fr)) auto minmax(220px, 1.1fr);
        gap: 14px;
        align-items: end;
        margin-top: 18px;
        padding: 18px;
        border-radius: 18px;
    }

    .filter-item {
        display: grid;
        gap: 7px;
    }

    .filter-item label {
        color: var(--muted-foreground);
        font-size: 0.78rem;
        font-weight: 800;
    }

    select {
        width: 100%;
        min-height: 42px;
        border-radius: 12px;
        border: 1px solid var(--input);
        background: color-mix(in oklab, var(--background) 46%, var(--card));
        color: var(--foreground);
        padding: 0 12px;
        font-weight: 700;
    }

    .generated-at {
        justify-self: end;
        font-size: 0.82rem;
        text-align: right;
    }

    .generated-at span {
        display: block;
        margin-top: 4px;
    }

    .metric-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 16px;
        margin-top: 18px;
    }

    .metric-card {
        position: relative;
        overflow: hidden;
        min-height: 168px;
        padding: 22px;
        border-radius: 20px;
        border-top: 4px solid color-mix(in oklab, #20c997 72%, var(--border));
    }

    .primary-card {
        grid-column: span 3;
    }

    .small-card {
        grid-column: span 2;
        min-height: 132px;
    }

    .metric-card.purple {
        border-top-color: #7c5cff;
    }

    .metric-card.cyan {
        border-top-color: #14b8d4;
    }

    .metric-card.amber {
        border-top-color: #f59e0b;
    }

    .metric-card.lime {
        border-top-color: #22c55e;
    }

    .card-topline,
    .panel-heading,
    .rank-row,
    .legend-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
    }

    .card-topline,
    .metric-card > span {
        color: var(--muted-foreground);
        font-size: 0.82rem;
        font-weight: 900;
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .metric-card strong {
        display: block;
        margin-top: 24px;
        color: var(--foreground);
        font-size: clamp(2rem, 4vw, 3.6rem);
        line-height: 0.9;
        font-weight: 950;
    }

    .small-card strong {
        font-size: 2.15rem;
    }

    .metric-card svg {
        position: absolute;
        inset: auto 18px 16px;
        width: calc(100% - 36px);
        height: 46px;
    }

    .metric-card polyline,
    .line-chart polyline {
        fill: none;
        stroke: #20c997;
        stroke-width: 2.4;
        vector-effect: non-scaling-stroke;
    }

    .metric-card polygon,
    .line-chart polygon {
        fill: color-mix(in oklab, #20c997 22%, transparent);
    }

    .metric-card.purple polyline,
    .token-chart polyline {
        stroke: #7c5cff;
    }

    .metric-card.purple polygon,
    .token-chart polygon {
        fill: color-mix(in oklab, #7c5cff 22%, transparent);
    }

    .badge,
    .legend-dot {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        white-space: nowrap;
        border-radius: 999px;
        border: 1px solid var(--border);
        padding: 5px 9px;
        color: var(--muted-foreground);
        font-size: 0.76rem;
        font-weight: 850;
    }

    .badge.green {
        color: #14a86f;
        border-color: color-mix(in oklab, #20c997 34%, var(--border));
    }

    .badge.violet {
        color: #7c5cff;
        border-color: color-mix(in oklab, #7c5cff 34%, var(--border));
    }

    .chart-grid,
    .summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 16px;
    }

    .panel {
        padding: 24px;
        border-radius: 22px;
    }

    .wide-panel {
        margin-top: 16px;
    }

    .panel-heading {
        margin-bottom: 22px;
    }

    .panel-heading p {
        margin: 6px 0 0;
        font-size: 0.86rem;
    }

    .line-chart {
        height: 330px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background:
            linear-gradient(color-mix(in oklab, var(--border) 30%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in oklab, var(--border) 24%, transparent) 1px, transparent 1px);
        background-size: 100% 25%, 12.5% 100%;
        padding: 22px;
    }

    .line-chart svg {
        width: 100%;
        height: 100%;
    }

    .grid-lines line {
        stroke: color-mix(in oklab, var(--border) 58%, transparent);
        stroke-width: 0.35;
    }

    .axis-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 12px;
        color: var(--muted-foreground);
        font-size: 0.78rem;
        font-weight: 750;
    }

    .legend-dot::before {
        width: 9px;
        height: 9px;
        content: "";
        border-radius: 999px;
        background: currentColor;
    }

    .legend-dot.violet {
        color: #7c5cff;
    }

    .legend-dot.input {
        color: #94a3b8;
    }

    .legend-dot.output {
        color: #20c997;
    }

    .legend-dot.cache {
        color: #f59e0b;
    }

    .stack-chart {
        display: flex;
        align-items: flex-end;
        gap: 5px;
        height: 360px;
        padding: 20px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background:
            linear-gradient(color-mix(in oklab, var(--border) 28%, transparent) 1px, transparent 1px),
            color-mix(in oklab, var(--background) 42%, transparent);
        background-size: 100% 20%;
    }

    .stack-column {
        display: flex;
        align-items: flex-end;
        flex: 1;
        min-width: 6px;
        height: 100%;
        gap: 1px;
    }

    .bar {
        flex: 1;
        min-height: 1px;
        border-radius: 3px 3px 0 0;
        opacity: 0.9;
    }

    .bar.input {
        background: #94a3b8;
    }

    .bar.output {
        background: #20c997;
    }

    .bar.cache {
        background: #f59e0b;
    }

    .rank-list {
        display: grid;
        gap: 10px;
    }

    .rank-row {
        padding: 13px 0;
        border-bottom: 1px solid color-mix(in oklab, var(--border) 64%, transparent);
    }

    .rank-row strong,
    table strong {
        display: block;
        color: var(--foreground);
        font-weight: 850;
    }

    .rank-row span,
    table span {
        display: block;
        margin-top: 4px;
        color: var(--muted-foreground);
        font-size: 0.8rem;
    }

    .rank-row em {
        color: var(--foreground);
        font-style: normal;
        font-weight: 900;
    }

    .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--border);
        border-radius: 16px;
    }

    table {
        width: 100%;
        min-width: 920px;
        border-collapse: collapse;
        font-size: 0.88rem;
    }

    .compact-table table {
        min-width: 540px;
    }

    th,
    td {
        border-bottom: 1px solid color-mix(in oklab, var(--border) 68%, transparent);
        padding: 14px 16px;
        text-align: left;
        vertical-align: middle;
    }

    th {
        color: var(--muted-foreground);
        font-size: 0.78rem;
        font-weight: 900;
        text-transform: uppercase;
    }

    td {
        color: var(--foreground);
        font-weight: 650;
    }

    tr:last-child td {
        border-bottom: 0;
    }

    .state-card {
        margin-top: 18px;
        padding: 32px;
        border-radius: 20px;
        color: var(--muted-foreground);
        font-weight: 800;
    }

    .state-card.error {
        color: var(--destructive);
        border-color: color-mix(in oklab, var(--destructive) 40%, var(--border));
    }

    @media (max-width: 1100px) {
        .usage-header,
        .header-actions {
            align-items: stretch;
        }

        .usage-header {
            flex-direction: column;
        }

        .filter-bar {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .generated-at {
            justify-self: start;
            text-align: left;
        }

        .chart-grid,
        .summary-grid {
            grid-template-columns: 1fr;
        }

        .primary-card,
        .small-card {
            grid-column: span 6;
        }
    }

    @media (max-width: 720px) {
        .usage-header,
        .panel,
        .metric-card {
            padding: 18px;
            border-radius: 18px;
        }

        .range-tabs {
            overflow-x: auto;
        }

        .filter-bar {
            grid-template-columns: 1fr;
        }

        .metric-grid {
            grid-template-columns: 1fr;
        }

        .primary-card,
        .small-card {
            grid-column: auto;
        }

        .line-chart,
        .stack-chart {
            height: 250px;
        }
    }
</style>
