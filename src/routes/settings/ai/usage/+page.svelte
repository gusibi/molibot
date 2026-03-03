<script lang="ts">
    import { onMount } from "svelte";

    type TimeRange = "today" | "yesterday" | "last7Days" | "last30Days";
    type ViewMode = "chart" | "list";

    interface UsageTotals {
        requests: number;
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

    interface WindowSummary {
        startDate: string;
        endDate: string;
        totals: UsageTotals;
        models: ModelUsageSummary[];
    }

    interface BucketSummary {
        bucket: string;
        startDate?: string;
        endDate?: string;
        totals: UsageTotals;
        models: ModelUsageSummary[];
    }

    interface UsageStatsResponse {
        timezone: string;
        generatedAt: string;
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

    let usageLoading = true;
    let usageError = "";
    let usageStats: UsageStatsResponse | null = null;

    let selectedRange: TimeRange = "last30Days";
    let viewMode: ViewMode = "chart";
    let selectedModelId: "all" | string = "all";

    function formatNumber(value: number): string {
        return new Intl.NumberFormat("en-US").format(value ?? 0);
    }

    function topModels(
        models: ModelUsageSummary[],
        limit = 5,
    ): ModelUsageSummary[] {
        return models.slice(0, limit);
    }

    function windowTitle(range: TimeRange): string {
        switch (range) {
            case "today":
                return "Today";
            case "yesterday":
                return "Yesterday";
            case "last7Days":
                return "Last 7 Days";
            case "last30Days":
                return "Last 30 Days";
            default:
                return "Selected Period";
        }
    }

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
            if (!data.ok)
                throw new Error(data.error || "Failed to fetch usage");
            usageStats = data.stats as UsageStatsResponse;
        } catch (e) {
            usageError = e instanceof Error ? e.message : String(e);
        } finally {
            usageLoading = false;
        }
    }

    onMount(loadUsage);

    $: availableModels = getAvailableModels(usageStats);

    function getAvailableModels(
        stats: UsageStatsResponse | null,
    ): { id: string; label: string }[] {
        if (!stats) return [];
        const unique = new Map<string, string>();
        for (const m of stats.windows.last30Days.models) {
            const id = `${m.provider}::${m.model}`;
            unique.set(id, `${m.provider} / ${m.model}`);
        }
        return Array.from(unique.entries())
            .map(([id, label]) => ({ id, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    $: currentWindow = computeWindow(
        usageStats,
        selectedRange,
        selectedModelId,
    );

    function computeWindow(
        stats: UsageStatsResponse | null,
        range: TimeRange,
        modelId: "all" | string,
    ): WindowSummary | null {
        if (!stats) return null;
        const win = stats.windows[range];
        if (modelId === "all") return win;

        const [provider, modelName] = modelId.split("::");
        const modelStats = win.models.find(
            (m) => m.provider === provider && m.model === modelName,
        );
        if (modelStats) {
            return {
                ...win,
                totals: { ...modelStats },
                models: [modelStats],
            };
        }
        return {
            ...win,
            totals: {
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 0,
            },
            models: [],
        };
    }

    $: chartData = computeChartData(usageStats, selectedRange, selectedModelId);
    $: maxTokens = Math.max(1, ...chartData.map((d) => d.totals.totalTokens));
    // $: maxRequests = Math.max(1, ...chartData.map((d) => d.totals.requests)); // Removed since it isn't used

    function computeChartData(
        stats: UsageStatsResponse | null,
        range: TimeRange,
        modelId: "all" | string,
    ): BucketSummary[] {
        if (!stats) return [];
        const daily = stats.breakdowns.daily || [];
        let data: BucketSummary[] = [];
        switch (range) {
            case "last30Days":
                data = daily.slice(-30);
                break;
            case "last7Days":
                data = daily.slice(-7);
                break;
            case "yesterday":
                data = daily.slice(-2, -1);
                break;
            case "today":
                data = daily.slice(-1);
                break;
        }

        if (modelId === "all") return data;

        const [provider, modelName] = modelId.split("::");

        return data.map((bucket) => {
            const mStat = bucket.models.find(
                (m) => m.provider === provider && m.model === modelName,
            );
            if (mStat) {
                return {
                    ...bucket,
                    totals: { ...mStat },
                    models: [mStat],
                };
            }
            return {
                ...bucket,
                totals: {
                    requests: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 0,
                },
                models: [],
            };
        });
    }

    function setRange(range: TimeRange) {
        selectedRange = range;
    }

    function setView(mode: ViewMode) {
        viewMode = mode;
    }
</script>

<div class="mx-auto max-w-6xl space-y-8 px-6 py-8 sm:px-10 sm:py-12">
    <!-- Header -->
    <header
        class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    >
        <div>
            <h1
                class="text-3xl font-bold tracking-tight text-white drop-shadow-sm"
            >
                Token Usage Analytics
            </h1>
            <p class="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                Monitor your AI token consumption, cache hits, and request
                volume over time. Selected data bounds define the visible
                reports below.
            </p>
        </div>
        <button
            type="button"
            class="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/10 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            on:click={loadUsage}
            disabled={usageLoading}
        >
            <svg
                class="h-4 w-4 text-slate-400 transition-transform group-hover:rotate-180 group-hover:text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {usageLoading ? "Syncing..." : "Refresh"}
        </button>
    </header>

    {#if usageError}
        <div
            class="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-300 backdrop-blur-md"
        >
            <span class="font-bold">Error:</span>
            {usageError}
        </div>
    {:else if usageStats && currentWindow}
        <!-- Controls & Range Selection -->
        <div
            class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
        >
            <div class="flex flex-wrap items-center gap-3">
                <div
                    class="inline-flex rounded-xl border border-white/10 bg-black/40 p-1 backdrop-blur-md"
                >
                    <button
                        class={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-all ${selectedRange === "today" ? "bg-white/10 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                        on:click={() => setRange("today")}
                    >
                        Today
                    </button>
                    <button
                        class={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-all ${selectedRange === "yesterday" ? "bg-white/10 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                        on:click={() => setRange("yesterday")}
                    >
                        Yesterday
                    </button>
                    <button
                        class={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-all ${selectedRange === "last7Days" ? "bg-white/10 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                        on:click={() => setRange("last7Days")}
                    >
                        Last 7 Days
                    </button>
                    <button
                        class={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-all ${selectedRange === "last30Days" ? "bg-white/10 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                        on:click={() => setRange("last30Days")}
                    >
                        Last 30 Days
                    </button>
                </div>

                <div class="relative inline-flex">
                    <select
                        bind:value={selectedModelId}
                        class="cursor-pointer appearance-none rounded-xl border border-white/10 bg-black/40 py-2.5 pl-4 pr-10 text-sm font-medium text-slate-300 backdrop-blur-md outline-none transition-all hover:bg-black/60 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                    >
                        <option value="all">All Models</option>
                        {#each availableModels as { id, label }}
                            <option value={id}>{label}</option>
                        {/each}
                    </select>
                    <div
                        class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400"
                    >
                        <svg
                            class="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="2"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M19 9l-7 7-7-7"
                            /></svg
                        >
                    </div>
                </div>
            </div>

            <div
                class="inline-flex rounded-xl border border-white/10 bg-black/40 p-1 backdrop-blur-md"
            >
                <button
                    class={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${viewMode === "chart" ? "bg-emerald-500/20 text-emerald-400 shadow ring-1 ring-inset ring-emerald-500/30" : "text-slate-400 hover:text-slate-200"}`}
                    on:click={() => setView("chart")}
                >
                    <svg
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        /></svg
                    >
                    Chart
                </button>
                <button
                    class={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${viewMode === "list" ? "bg-white/10 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                    on:click={() => setView("list")}
                >
                    <svg
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M4 6h16M4 10h16M4 14h16M4 18h16"
                        /></svg
                    >
                    List
                </button>
            </div>
        </div>

        <!-- Highlight Key Metrics -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div
                class="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-6 shadow-xl"
            >
                <div class="relative z-10">
                    <p
                        class="text-sm font-medium text-emerald-400/80 uppercase tracking-wider"
                    >
                        Total Tokens
                    </p>
                    <p
                        class="mt-2 text-4xl font-black tracking-tighter text-white"
                    >
                        {formatNumber(currentWindow.totals.totalTokens)}
                    </p>
                </div>
                <div
                    class="absolute -bottom-6 -right-6 h-32 w-32 rounded-full bg-emerald-500/20 blur-3xl transition-transform duration-700 group-hover:scale-150"
                ></div>
            </div>

            <div
                class="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
            >
                <p
                    class="text-sm font-medium text-slate-400 uppercase tracking-wider"
                >
                    Input Tokens
                </p>
                <p class="mt-2 text-2xl font-bold tracking-tight text-white">
                    {formatNumber(currentWindow.totals.inputTokens)}
                </p>
                <div
                    class="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-blue-500/10 blur-2xl transition-transform duration-700 group-hover:scale-150"
                ></div>
            </div>

            <div
                class="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
            >
                <p
                    class="text-sm font-medium text-slate-400 uppercase tracking-wider"
                >
                    Output Tokens
                </p>
                <p class="mt-2 text-2xl font-bold tracking-tight text-white">
                    {formatNumber(currentWindow.totals.outputTokens)}
                </p>
                <div
                    class="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-purple-500/10 blur-2xl transition-transform duration-700 group-hover:scale-150"
                ></div>
            </div>

            <div
                class="group relative overflow-hidden rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02] p-6 shadow-sm"
            >
                <p
                    class="text-sm font-medium text-emerald-500/70 uppercase tracking-wider flex items-center gap-2"
                >
                    <svg
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        /></svg
                    >
                    Cache Saved
                </p>
                <p
                    class="mt-2 text-2xl font-bold tracking-tight text-emerald-400"
                >
                    {formatNumber(currentWindow.totals.cacheReadTokens)}
                </p>
                <div
                    class="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl transition-transform duration-700 group-hover:scale-150"
                ></div>
            </div>
        </div>

        <!-- Main Content Area -->
        <main
            class="rounded-3xl border border-white/[0.08] bg-[#1a1a1a]/60 shadow-2xl backdrop-blur-2xl"
        >
            <div class="border-b border-white/5 px-6 py-5">
                <h2 class="text-lg font-semibold text-white">
                    Usage Timeline
                    <span
                        class="ml-2 text-xs font-normal text-slate-500 hidden sm:inline-block"
                        >({currentWindow.startDate} to {currentWindow.endDate})</span
                    >
                </h2>
            </div>

            <div class="p-6">
                {#if chartData.length === 0}
                    <div
                        class="flex h-48 items-center justify-center text-sm text-slate-500"
                    >
                        No temporal data points strictly matched the chosen
                        span.
                    </div>
                {:else if viewMode === "chart"}
                    <!-- SVG-Style Premium Native Bar Chart -->
                    <div
                        class="relative flex h-64 w-full items-end gap-1.5 sm:gap-3 px-2"
                    >
                        {#each chartData as data}
                            {@const pct = Math.max(
                                0.5,
                                (data.totals.totalTokens / maxTokens) * 100,
                            )}
                            <div
                                class="group relative flex h-full flex-1 flex-col justify-end"
                            >
                                <!-- Bar -->
                                <div
                                    class="w-full rounded-t-sm bg-emerald-500/20 transition-all duration-300 group-hover:bg-emerald-400 group-hover:shadow-[0_0_15px_rgba(52,211,153,0.4)]"
                                    style={`height: ${pct}%`}
                                ></div>

                                <!-- Tooltip Overlay -->
                                <div
                                    class="pointer-events-none absolute bottom-full left-1/2 mb-3 hidden -translate-x-1/2 flex-col items-center group-hover:flex z-10 w-48"
                                >
                                    <div
                                        class="w-full rounded-xl border border-white/10 bg-[#1f1f1f]/95 p-3 text-xs shadow-2xl backdrop-blur-xl"
                                    >
                                        <div
                                            class="mb-2 font-medium text-slate-300 border-b border-white/10 pb-2"
                                        >
                                            {data.bucket}
                                        </div>
                                        <div
                                            class="flex items-center justify-between mt-1"
                                        >
                                            <span class="text-slate-500"
                                                >Tokens</span
                                            >
                                            <span
                                                class="font-bold text-emerald-400"
                                                >{formatNumber(
                                                    data.totals.totalTokens,
                                                )}</span
                                            >
                                        </div>
                                        <div
                                            class="flex items-center justify-between mt-1"
                                        >
                                            <span class="text-slate-500"
                                                >Hits</span
                                            >
                                            <span class="font-medium text-white"
                                                >{formatNumber(
                                                    data.totals.requests,
                                                )} req</span
                                            >
                                        </div>
                                    </div>
                                    <div
                                        class="h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-white/10 bg-[#1f1f1f]/95"
                                    ></div>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- X Axis Labels -->
                    <div
                        class="mt-4 flex w-full justify-between px-2 text-[10px] font-medium text-slate-500"
                    >
                        <span>{chartData[0].bucket}</span>
                        {#if chartData.length > 2}
                            <span
                                >{chartData[Math.floor(chartData.length / 2)]
                                    .bucket}</span
                            >
                        {/if}
                        {#if chartData.length > 1}
                            <span>{chartData[chartData.length - 1].bucket}</span
                            >
                        {/if}
                    </div>
                {:else}
                    <!-- List View Fallback -->
                    <div class="space-y-3">
                        <!-- Table definition headers -->
                        <div
                            class="hidden grid-cols-[1fr_120px_120px] gap-4 px-4 pb-2 text-xs font-medium uppercase tracking-wider text-slate-500 sm:grid"
                        >
                            <div>Date Bracket</div>
                            <div class="text-right">Requests</div>
                            <div class="text-right">Total Tokens</div>
                        </div>
                        {#each chartData as bucket}
                            <div
                                class="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.01] px-4 py-3 transition-colors hover:bg-white/[0.03] sm:grid sm:grid-cols-[1fr_120px_120px] sm:items-center sm:gap-4"
                            >
                                <div class="text-sm font-medium text-slate-300">
                                    {bucket.bucket}
                                </div>
                                <div
                                    class="text-sm font-medium text-slate-400 sm:text-right"
                                >
                                    {formatNumber(bucket.totals.requests)}
                                    <span class="text-xs sm:hidden">reqs</span>
                                </div>
                                <div
                                    class="text-sm font-bold text-emerald-400 sm:text-right"
                                >
                                    {formatNumber(bucket.totals.totalTokens)}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </main>

        <!-- Top Models Segment (Responsive specifically to the current Window) -->
        <section
            class="rounded-3xl border border-white/[0.08] bg-[#1a1a1a]/60 pt-1 shadow-xl backdrop-blur-xl"
        >
            <div class="border-b border-white/5 px-6 py-5">
                <h3 class="text-base font-semibold text-white">
                    Models Used ({windowTitle(selectedRange)})
                </h3>
                <p class="text-xs text-slate-500 mt-1">
                    Ranking of targeted AI models within the currently selected
                    timeframe.
                </p>
            </div>

            {#if currentWindow.models.length === 0}
                <div
                    class="flex h-32 items-center justify-center text-sm text-slate-500"
                >
                    No models tracked during this timeframe.
                </div>
            {:else}
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm whitespace-nowrap">
                        <thead
                            class="bg-black/20 text-[10px] font-medium uppercase tracking-wider text-slate-500"
                        >
                            <tr>
                                <th class="px-6 py-4">Integration ID</th>
                                <th class="px-6 py-4 text-right">Hit Count</th>
                                <th
                                    class="px-6 py-4 text-right hidden sm:table-cell"
                                    >Inputs</th
                                >
                                <th
                                    class="px-6 py-4 text-right hidden sm:table-cell"
                                    >Outputs</th
                                >
                                <th class="px-6 py-4 text-right">Tokens Used</th
                                >
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            {#each topModels(currentWindow.models, 15) as row}
                                <tr
                                    class="transition-colors hover:bg-white/[0.02]"
                                >
                                    <td class="px-6 py-3">
                                        <div class="font-bold text-slate-200">
                                            {row.model}
                                        </div>
                                        <div class="text-xs text-slate-500">
                                            {row.provider}
                                        </div>
                                    </td>
                                    <td
                                        class="px-6 py-3 text-right text-slate-300"
                                        >{formatNumber(row.requests)}</td
                                    >
                                    <td
                                        class="px-6 py-3 text-right text-slate-400 hidden sm:table-cell"
                                        >{formatNumber(row.inputTokens)}</td
                                    >
                                    <td
                                        class="px-6 py-3 text-right text-slate-400 hidden sm:table-cell"
                                        >{formatNumber(row.outputTokens)}</td
                                    >
                                    <td class="px-6 py-3 text-right">
                                        <span
                                            class="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20"
                                        >
                                            {formatNumber(row.totalTokens)}
                                        </span>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {/if}
        </section>
    {:else}
        <div
            class="flex h-64 items-center justify-center rounded-3xl border border-white/5 bg-white/[0.01]"
        >
            <div class="flex items-center gap-3 text-emerald-400">
                <svg
                    class="h-5 w-5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    ><circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                        class="opacity-25"
                    /><path
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        class="opacity-75"
                    /></svg
                >
                <span class="text-sm font-semibold tracking-wider uppercase"
                    >Loading Analytics...</span
                >
            </div>
        </div>
    {/if}
</div>
