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
    import { locale } from "$lib/ui/i18n";

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
        skillUsages: number;
        executedSkills: number;
        distinctSkills: number;
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

    interface SkillSummary {
        name: string;
        scope: string;
        calls: number;
        triggered: number;
        loaded: number;
        executed: number;
        runs: number;
        avgDurationMs: number;
        lastAt: string;
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
        skills: SkillSummary[];
        models: ModelSummary[];
        bots: BotSummary[];
        chats: ChatSummary[];
        sessions: SessionSummary[];
        runs: RunSummary[];
    }

    const COPY = {
        "zh-CN": {
            eyebrow: "Agent Trace Observatory",
            title: "Trace 分析",
            desc: "基于 agent_trace_facts 汇总工具调用、模型请求、session 和 run 维度的执行数据；原始 agent_trace_events 仍作为审计事件保留。",
            rangeTitles: {
                today: "今天",
                yesterday: "昨天",
                last7Days: "最近 7 天",
                last30Days: "最近 30 天",
            },
            factTypes: {
                all: "全部类型",
                run: "运行",
                tool_call: "工具调用",
                model_call: "模型请求",
                skill_usage: "技能使用",
                subagent_task: "Sub Agent",
                runtime_notice: "运行提示",
                approval: "审批",
                input_enrichment: "输入增强",
            },
            statuses: {
                started: "进行中",
                success: "成功",
                error: "失败",
                blocked: "已阻止",
                waiting: "等待中",
                aborted: "已中止",
                info: "信息",
                warning: "警告",
            },
            filters: {
                factType: "调用类型",
                botId: "Bot",
                botPlaceholder: "按 botId 精确筛选",
                channel: "Channel",
                channelPlaceholder: "telegram / feishu / web",
                chatId: "Chat ID",
                chatPlaceholder: "按 chatId 精确筛选",
                sessionId: "Session ID",
                sessionPlaceholder: "按 session 精确筛选",
                runId: "Run ID",
                runPlaceholder: "按 run 精确筛选",
                limit: "读取上限",
                limitOptions: {
                    "1000": "最近 1,000 条",
                    "5000": "最近 5,000 条",
                    "10000": "最近 10,000 条",
                },
                apply: "应用筛选",
                reset: "清空",
            },
            updatedAt: "更新于",
            toolCalls: {
                title: "工具调用",
                desc: "包含成功、失败、已阻止和进行中的工具 fact",
                actual: "实际执行 {executed} · 已阻止 {blocked} · 失败 {failed}"
            },
            modelCalls: {
                title: "模型请求",
                desc: "来自 model_call fact 的请求数 and token 汇总",
                tokens: "Token {tokens} · 平均耗时 {duration}"
            },
            skillCalls: {
                title: "Skill 调用",
                desc: "来自 skill_usage fact 的技能命中与执行统计",
                actual: "实际执行 {executed} · 技能种类 {distinct}"
            },
            connectedBots: "关联 Bots",
            connectedBotsDesc: "口径与 Usage 页 botId 一致",
            connectedChats: "关联 Chats",
            connectedChatsDesc: "按 channel + chatId 去重",
            distinctTools: "工具种类",
            distinctToolsDesc: "按工具 name 去重",
            connectedSessions: "关联 Sessions",
            connectedSessionsDesc: "当前筛选范围内的 session 数",
            sections: {
                chats: {
                    title: "Channel / Chat 汇总",
                    desc: "按 channel + chatId 聚合，定位某个渠道会话的工具和模型调用",
                    empty: "当前筛选范围没有 channel/chat 数据",
                },
                tools: {
                    title: "工具调用排行",
                    desc: "按工具 name 聚合调用次数、成功/失败/阻止次数",
                    empty: "当前筛选范围没有工具调用",
                },
                skills: {
                    title: "技能使用排行",
                    desc: "按技能 name 聚合命中（triggered）、加载（loaded）、执行（executed）次数",
                    empty: "当前筛选范围没有技能使用",
                },
                models: {
                    title: "模型请求排行",
                    desc: "按 provider / model / api 聚合模型请求",
                    empty: "当前筛选范围没有模型请求",
                },
                bots: {
                    title: "Bot 汇总",
                    desc: "按 usage 页同一 botId 口径聚合工具调用和模型 token",
                    empty: "当前筛选范围没有 bot 数据",
                },
                sessions: {
                    title: "Session 汇总",
                    desc: "查看某个 session 一共关联多少 run、工具调用和模型请求",
                    empty: "当前筛选范围没有 session 数据",
                },
                runs: {
                    title: "Run 汇总",
                    desc: "查看某一轮对话调用了多少工具、发了多少模型请求",
                    empty: "当前筛选范围没有 run 数据",
                },
                recent: {
                    title: "最近 Trace Facts",
                    desc: "基于筛选范围的 trace fact 列表",
                    empty: "当前筛选范围没有 trace fact",
                }
            },
            table: {
                channel: "Channel",
                chatId: "Chat ID",
                sessions: "Sessions",
                runs: "Runs",
                tools: "工具",
                models: "模型",
                distinctTools: "工具种类",
                tokens: "Token",
                avgDuration: "均耗时",
                provider: "Provider",
                api: "API",
                requests: "请求",
                input: "输入",
                output: "输出",
                cache: "缓存",
                totalTokens: "总 Token",
                lastUpdate: "最后更新",
                time: "时间",
                bot: "Bot",
                type: "类型",
                name: "名称",
                status: "状态",
                run: "Run",
                session: "Session",
                duration: "耗时",
                skill: "技能",
                scope: "范围",
                triggered: "命中",
                loaded: "加载",
                executed: "执行",
            },
            footbar: {
                syncing: "Trace 数据同步中...",
                ready: "Trace 数据已就绪",
                btnSyncing: "同步中",
                btnRefresh: "立即刷新",
            },
            paginationInfo: "第 {page} / {pages} 页 (共 {total} 条记录)",
            pageSizeLabel: "每页条数",
            prevPage: "上一页",
            nextPage: "下一页"
        },
        "en-US": {
            eyebrow: "Agent Trace Observatory",
            title: "Trace Analysis",
            desc: "Aggregated execution data for tool calls, model requests, sessions, and runs based on agent_trace_facts; original agent_trace_events are retained as audit events.",
            rangeTitles: {
                today: "Today",
                yesterday: "Yesterday",
                last7Days: "Last 7 Days",
                last30Days: "Last 30 Days",
            },
            factTypes: {
                all: "All Types",
                run: "Run",
                tool_call: "Tool Call",
                model_call: "Model Request",
                skill_usage: "Skill Usage",
                subagent_task: "Sub Agent",
                runtime_notice: "Runtime Notice",
                approval: "Approval",
                input_enrichment: "Input Enrichment",
            },
            statuses: {
                started: "Running",
                success: "Success",
                error: "Failed",
                blocked: "Blocked",
                waiting: "Waiting",
                aborted: "Aborted",
                info: "Info",
                warning: "Warning",
            },
            filters: {
                factType: "Fact Type",
                botId: "Bot",
                botPlaceholder: "Exact filter by botId",
                channel: "Channel",
                channelPlaceholder: "telegram / feishu / web",
                chatId: "Chat ID",
                chatPlaceholder: "Exact filter by chatId",
                sessionId: "Session ID",
                sessionPlaceholder: "Exact filter by session",
                runId: "Run ID",
                runPlaceholder: "Exact filter by run",
                limit: "Fetch Limit",
                limitOptions: {
                    "1000": "Last 1,000 facts",
                    "5000": "Last 5,000 facts",
                    "10000": "Last 10,000 facts",
                },
                apply: "Apply Filters",
                reset: "Reset",
            },
            updatedAt: "Updated at",
            toolCalls: {
                title: "Tool Calls",
                desc: "Includes successful, failed, blocked, and active tool facts",
                actual: "Executed {executed} · Blocked {blocked} · Failed {failed}"
            },
            modelCalls: {
                title: "Model Requests",
                desc: "Summary of requests and tokens from model_call facts",
                tokens: "Tokens {tokens} · Avg Duration {duration}"
            },
            skillCalls: {
                title: "Skill Usage",
                desc: "Skill hits and executions from skill_usage facts",
                actual: "Executed {executed} · Distinct {distinct}"
            },
            connectedBots: "Connected Bots",
            connectedBotsDesc: "Matches Usage page botId logic",
            connectedChats: "Connected Chats",
            connectedChatsDesc: "Unique channel + chatId pairs",
            distinctTools: "Distinct Tools",
            distinctToolsDesc: "Deduplicated by tool name",
            connectedSessions: "Connected Sessions",
            connectedSessionsDesc: "Sessions in current filter range",
            sections: {
                chats: {
                    title: "Channel / Chat Summary",
                    desc: "Aggregated by channel + chatId to track tool and model calls",
                    empty: "No channel/chat data in the selected range",
                },
                tools: {
                    title: "Tool Call Rankings",
                    desc: "Aggregated calls, successes, failures, and block counts by tool name",
                    empty: "No tool calls in the selected range",
                },
                skills: {
                    title: "Skill Usage Rankings",
                    desc: "Aggregated triggered / loaded / executed counts by skill name",
                    empty: "No skill usage in the selected range",
                },
                models: {
                    title: "Model Request Rankings",
                    desc: "Aggregated model requests by provider / model / api",
                    empty: "No model requests in the selected range",
                },
                bots: {
                    title: "Bot Summary",
                    desc: "Aggregated tool calls and model tokens matching the usage page botId",
                    empty: "No bot data in the selected range",
                },
                sessions: {
                    title: "Session Summary",
                    desc: "Total runs, tool calls, and model requests for each session",
                    empty: "No session data in the selected range",
                },
                runs: {
                    title: "Run Summary",
                    desc: "Tool and model call counts for each interaction run",
                    empty: "No run data in the selected range",
                },
                recent: {
                    title: "Recent Trace Facts",
                    desc: "Recent trace facts matching filters",
                    empty: "No trace facts in the selected range",
                }
            },
            table: {
                channel: "Channel",
                chatId: "Chat ID",
                sessions: "Sessions",
                runs: "Runs",
                tools: "Tools",
                models: "Models",
                distinctTools: "Distinct Tools",
                tokens: "Tokens",
                avgDuration: "Avg Dur",
                provider: "Provider",
                api: "API",
                requests: "Reqs",
                input: "Input",
                output: "Output",
                cache: "Cache",
                totalTokens: "Total Tokens",
                lastUpdate: "Last Update",
                time: "Time",
                bot: "Bot",
                type: "Type",
                name: "Name",
                status: "Status",
                run: "Run",
                session: "Session",
                duration: "Duration",
                skill: "Skill",
                scope: "Scope",
                triggered: "Triggered",
                loaded: "Loaded",
                executed: "Executed",
            },
            footbar: {
                syncing: "Syncing Trace data...",
                ready: "Trace data ready",
                btnSyncing: "Syncing",
                btnRefresh: "Refresh",
            },
            paginationInfo: "Page {page} of {pages} ({total} records)",
            pageSizeLabel: "Page size",
            prevPage: "Previous",
            nextPage: "Next"
        }
    };

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

    let currentPage = 1;
    let pageSize = 20;

    let paginatedFacts: TraceFact[] = [];
    let totalFactsCount = 0;
    let factsLoading = false;

    async function loadPaginatedFacts() {
        factsLoading = true;
        try {
            const params = new URLSearchParams({
                range: selectedRange,
                factType: selectedFactType,
                botId: botFilter.trim(),
                channel: channelFilter.trim(),
                chatId: chatFilter.trim(),
                sessionId: sessionFilter.trim(),
                runId: runFilter.trim(),
                page: String(currentPage),
                pageSize: String(pageSize),
            });
            const res = await fetch(`/api/settings/trace/facts?${params.toString()}`);
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            if (data.ok) {
                paginatedFacts = data.data;
                totalFactsCount = data.total;
            }
        } catch (e) {
            console.error(e);
        } finally {
            factsLoading = false;
        }
    }

    $: {
        selectedRange;
        selectedFactType;
        botFilter;
        channelFilter;
        chatFilter;
        sessionFilter;
        runFilter;
        sourceLimit;
        currentPage = 1;
    }

    $: {
        if (traceStats) {
            currentPage;
            pageSize;
            selectedRange;
            selectedFactType;
            botFilter;
            channelFilter;
            chatFilter;
            sessionFilter;
            runFilter;
            void loadPaginatedFacts();
        }
    }

    $: copy = COPY[$locale] ?? COPY["en-US"];

    function windowTitle(range: TimeRange): string {
        return copy.rangeTitles[range] || range;
    }

    function factTypeLabel(type: FactType | TraceFact["factType"]): string {
        return copy.factTypes[type] || type;
    }

    function statusLabel(status: TraceFact["status"]): string {
        return copy.statuses[status] || status;
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
        return new Intl.DateTimeFormat($locale === "zh-CN" ? "zh-CN" : "en-US", {
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
    $: totalPages = Math.ceil(totalFactsCount / pageSize) || 1;
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
            <div class="usage-range-buttons" aria-label="Time range / 时间范围">
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
                    <Label for="trace-fact-type" class="usage-filter-label">{copy.filters.factType}</Label>
                    <NativeSelect id="trace-fact-type" class="w-full" bind:value={selectedFactType}>
                        <NativeSelectOption value="all">{copy.factTypes.all}</NativeSelectOption>
                        <NativeSelectOption value="run">{copy.factTypes.run}</NativeSelectOption>
                        <NativeSelectOption value="tool_call">{copy.factTypes.tool_call}</NativeSelectOption>
                        <NativeSelectOption value="model_call">{copy.factTypes.model_call}</NativeSelectOption>
                        <NativeSelectOption value="skill_usage">{copy.factTypes.skill_usage}</NativeSelectOption>
                        <NativeSelectOption value="subagent_task">{copy.factTypes.subagent_task}</NativeSelectOption>
                        <NativeSelectOption value="runtime_notice">{copy.factTypes.runtime_notice}</NativeSelectOption>
                        <NativeSelectOption value="approval">{copy.factTypes.approval}</NativeSelectOption>
                        <NativeSelectOption value="input_enrichment">{copy.factTypes.input_enrichment}</NativeSelectOption>
                    </NativeSelect>
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-bot-id" class="usage-filter-label">{copy.filters.botId}</Label>
                    <Input id="trace-bot-id" placeholder={copy.filters.botPlaceholder} bind:value={botFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-channel" class="usage-filter-label">{copy.filters.channel}</Label>
                    <Input id="trace-channel" placeholder={copy.filters.channelPlaceholder} bind:value={channelFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-chat-id" class="usage-filter-label">{copy.filters.chatId}</Label>
                    <Input id="trace-chat-id" placeholder={copy.filters.chatPlaceholder} bind:value={chatFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-session-id" class="usage-filter-label">{copy.filters.sessionId}</Label>
                    <Input id="trace-session-id" placeholder={copy.filters.sessionPlaceholder} bind:value={sessionFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-run-id" class="usage-filter-label">{copy.filters.runId}</Label>
                    <Input id="trace-run-id" placeholder={copy.filters.runPlaceholder} bind:value={runFilter} />
                </div>
                <div class="usage-filter-group">
                    <Label for="trace-source-limit" class="usage-filter-label">{copy.filters.limit}</Label>
                    <NativeSelect id="trace-source-limit" class="w-full" bind:value={sourceLimit}>
                        <NativeSelectOption value="1000">{copy.filters.limitOptions["1000"]}</NativeSelectOption>
                        <NativeSelectOption value="5000">{copy.filters.limitOptions["5000"]}</NativeSelectOption>
                        <NativeSelectOption value="10000">{copy.filters.limitOptions["10000"]}</NativeSelectOption>
                    </NativeSelect>
                </div>
                <div class="usage-filter-reset trace-filter-actions">
                    <Button variant="default" type="button" onclick={loadTrace} disabled={traceLoading}>{copy.filters.apply}</Button>
                    <Button variant="outline" type="button" onclick={resetFilters} disabled={traceLoading}>{copy.filters.reset}</Button>
                </div>
                <div class="usage-filter-meta trace-filter-meta">
                    <span>{traceStats.window.startDate} → {traceStats.window.endDate}</span>
                    <span>{copy.updatedAt} {formatDateTime(traceStats.generatedAt)}</span>
                </div>
            </CardContent>
        </Card>

        <div class="usage-metrics">
            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">{copy.toolCalls.title}</CardTitle>
                        <Badge variant="secondary" class="usage-badge-requests">Tools</Badge>
                    </div>
                    <CardDescription>{copy.toolCalls.desc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    <strong class="usage-metric-value">{formatNumber(totals.toolCalls)}</strong>
                    <span class="usage-card-subtext">
                        {copy.toolCalls.actual.replace("{executed}", formatNumber(totals.executedToolCalls)).replace("{blocked}", formatNumber(totals.blockedTools)).replace("{failed}", formatNumber(totals.failedTools))}
                    </span>
                </CardContent>
            </Card>

            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">{copy.modelCalls.title}</CardTitle>
                        <Badge variant="secondary" class="usage-badge-tokens">Model</Badge>
                    </div>
                    <CardDescription>{copy.modelCalls.desc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    <strong class="usage-metric-value">{formatNumber(totals.modelCalls)}</strong>
                    <span class="usage-card-subtext">
                        {copy.modelCalls.tokens.replace("{tokens}", formatCompact(totals.totalTokens)).replace("{duration}", formatDuration(totals.avgModelDurationMs))}
                    </span>
                </CardContent>
            </Card>

            <Card class="usage-metric-wide">
                <CardHeader>
                    <div class="usage-metric-header">
                        <CardTitle class="font-serif text-lg">{copy.skillCalls.title}</CardTitle>
                        <Badge variant="secondary" class="usage-badge-requests">Skill</Badge>
                    </div>
                    <CardDescription>{copy.skillCalls.desc}</CardDescription>
                </CardHeader>
                <CardContent class="flex flex-col gap-2">
                    <strong class="usage-metric-value">{formatNumber(totals.skillUsages)}</strong>
                    <span class="usage-card-subtext">
                        {copy.skillCalls.actual.replace("{executed}", formatNumber(totals.executedSkills)).replace("{distinct}", formatNumber(totals.distinctSkills))}
                    </span>
                </CardContent>
            </Card>

            <Card class="usage-metric-accent-1">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.connectedBots}</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.bots)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">{copy.connectedBotsDesc}</CardContent>
            </Card>
            <Card class="usage-metric-accent-2">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.connectedChats}</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.chats)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">{copy.connectedChatsDesc}</CardContent>
            </Card>
            <Card class="usage-metric-accent-3">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.distinctTools}</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.distinctTools)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">{copy.distinctToolsDesc}</CardContent>
            </Card>
            <Card class="usage-metric-accent-4">
                <CardHeader>
                    <CardDescription class="usage-label-uppercase">{copy.connectedSessions}</CardDescription>
                    <CardTitle class="tabular-nums">{formatNumber(totals.sessions)}</CardTitle>
                </CardHeader>
                <CardContent class="usage-card-subtext">{copy.connectedSessionsDesc}</CardContent>
            </Card>
        </div>

        <div class="usage-detail-grid">
            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.sections.chats.title}</CardTitle>
                    <CardDescription>{copy.sections.chats.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.channel}</TableHead>
                                <TableHead>{copy.table.chatId}</TableHead>
                                <TableHead class="text-right">{copy.table.sessions}</TableHead>
                                <TableHead class="text-right">{copy.table.runs}</TableHead>
                                <TableHead class="text-right">{copy.table.tools}</TableHead>
                                <TableHead class="text-right">{copy.table.models}</TableHead>
                                <TableHead class="text-right">{copy.table.distinctTools}</TableHead>
                                <TableHead class="text-right">{copy.table.tokens}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.chats.length === 0}
                                <TableRow><TableCell colspan={8} class="usage-empty-cell">{copy.sections.chats.empty}</TableCell></TableRow>
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
                    <CardTitle class="font-serif">{copy.sections.tools.title}</CardTitle>
                    <CardDescription>{copy.sections.tools.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.tools}</TableHead>
                                <TableHead class="text-right">{copy.table.requests}</TableHead>
                                <TableHead class="text-right">{copy.table.run}</TableHead>
                                <TableHead class="text-right">{copy.table.status}</TableHead>
                                <TableHead class="text-right">{copy.table.duration}</TableHead>
                                <TableHead class="text-right">{copy.table.cache}</TableHead>
                                <TableHead class="text-right">{copy.table.avgDuration}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.tools.length === 0}
                                <TableRow><TableCell colspan={7} class="usage-empty-cell">{copy.sections.tools.empty}</TableCell></TableRow>
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
                    <CardTitle class="font-serif">{copy.sections.skills.title}</CardTitle>
                    <CardDescription>{copy.sections.skills.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.skill}</TableHead>
                                <TableHead>{copy.table.scope}</TableHead>
                                <TableHead class="text-right">{copy.table.requests}</TableHead>
                                <TableHead class="text-right">{copy.table.triggered}</TableHead>
                                <TableHead class="text-right">{copy.table.loaded}</TableHead>
                                <TableHead class="text-right">{copy.table.executed}</TableHead>
                                <TableHead class="text-right">{copy.table.run}</TableHead>
                                <TableHead class="text-right">{copy.table.avgDuration}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.skills.length === 0}
                                <TableRow><TableCell colspan={8} class="usage-empty-cell">{copy.sections.skills.empty}</TableCell></TableRow>
                            {:else}
                                {#each traceStats.skills.slice(0, 20) as skill}
                                    <TableRow>
                                        <TableCell class="trace-id-cell" title={skill.name}>{skill.name}</TableCell>
                                        <TableCell>{skill.scope}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(skill.calls)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(skill.triggered)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(skill.loaded)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(skill.executed)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatNumber(skill.runs)}</TableCell>
                                        <TableCell class="text-right tabular-nums">{formatDuration(skill.avgDurationMs)}</TableCell>
                                    </TableRow>
                                {/each}
                            {/if}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="font-serif">{copy.sections.models.title}</CardTitle>
                    <CardDescription>{copy.sections.models.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.models}</TableHead>
                                <TableHead>{copy.table.provider}</TableHead>
                                <TableHead>{copy.table.api}</TableHead>
                                <TableHead class="text-right">{copy.table.requests}</TableHead>
                                <TableHead class="text-right">{copy.table.input}</TableHead>
                                <TableHead class="text-right">{copy.table.output}</TableHead>
                                <TableHead class="text-right">{copy.table.cache}</TableHead>
                                <TableHead class="text-right">{copy.table.totalTokens}</TableHead>
                                <TableHead class="text-right">{copy.table.avgDuration}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.models.length === 0}
                                <TableRow><TableCell colspan={9} class="usage-empty-cell">{copy.sections.models.empty}</TableCell></TableRow>
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
                    <CardTitle class="font-serif">{copy.sections.bots.title}</CardTitle>
                    <CardDescription>{copy.sections.bots.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.bot}</TableHead>
                                <TableHead class="text-right">Channels</TableHead>
                                <TableHead class="text-right">Chats</TableHead>
                                <TableHead class="text-right">{copy.table.sessions}</TableHead>
                                <TableHead class="text-right">{copy.table.runs}</TableHead>
                                <TableHead class="text-right">{copy.table.tools}</TableHead>
                                <TableHead class="text-right">{copy.table.models}</TableHead>
                                <TableHead class="text-right">{copy.table.tokens}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.bots.length === 0}
                                <TableRow><TableCell colspan={8} class="usage-empty-cell">{copy.sections.bots.empty}</TableCell></TableRow>
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
                    <CardTitle class="font-serif">{copy.sections.sessions.title}</CardTitle>
                    <CardDescription>{copy.sections.sessions.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.session}</TableHead>
                                <TableHead class="text-right">{copy.table.runs}</TableHead>
                                <TableHead class="text-right">{copy.table.tools}</TableHead>
                                <TableHead class="text-right">{copy.table.models}</TableHead>
                                <TableHead class="text-right">{copy.table.distinctTools}</TableHead>
                                <TableHead class="text-right">{copy.table.tokens}</TableHead>
                                <TableHead>{copy.table.lastUpdate}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.sessions.length === 0}
                                <TableRow><TableCell colspan={7} class="usage-empty-cell">{copy.sections.sessions.empty}</TableCell></TableRow>
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
                    <CardTitle class="font-serif">{copy.sections.runs.title}</CardTitle>
                    <CardDescription>{copy.sections.runs.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{copy.table.run}</TableHead>
                                <TableHead>{copy.table.session}</TableHead>
                                <TableHead class="text-right">{copy.table.tools}</TableHead>
                                <TableHead class="text-right">{copy.table.models}</TableHead>
                                <TableHead class="text-right">{copy.table.distinctTools}</TableHead>
                                <TableHead class="text-right">{copy.table.tokens}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#if traceStats.runs.length === 0}
                                <TableRow><TableCell colspan={6} class="usage-empty-cell">{copy.sections.runs.empty}</TableCell></TableRow>
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
                <CardTitle class="font-serif">{copy.sections.recent.title}</CardTitle>
                <CardDescription>{copy.sections.recent.desc}</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{copy.table.time}</TableHead>
                            <TableHead>{copy.table.bot}</TableHead>
                            <TableHead>{copy.table.channel}</TableHead>
                            <TableHead>{copy.table.chatId}</TableHead>
                            <TableHead>{copy.table.type}</TableHead>
                            <TableHead>{copy.table.name}</TableHead>
                            <TableHead>{copy.table.status}</TableHead>
                            <TableHead>{copy.table.run}</TableHead>
                            <TableHead>{copy.table.session}</TableHead>
                            <TableHead class="text-right">{copy.table.duration}</TableHead>
                            <TableHead class="text-right">{copy.table.input}</TableHead>
                            <TableHead class="text-right">{copy.table.output}</TableHead>
                            <TableHead class="text-right">{copy.table.cache}</TableHead>
                            <TableHead class="text-right">{copy.table.totalTokens}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody class={factsLoading ? "opacity-50 transition-opacity" : "transition-opacity"}>
                        {#if paginatedFacts.length === 0}
                            <TableRow><TableCell colspan={14} class="usage-empty-cell">{copy.sections.recent.empty}</TableCell></TableRow>
                        {:else}
                            {#each paginatedFacts as fact}
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

                {#if totalFactsCount > 0}
                    <div class="pagination-container">
                        <div class="pagination-info">
                            {copy.paginationInfo.replace("{page}", String(currentPage)).replace("{pages}", String(totalPages)).replace("{total}", String(totalFactsCount))}
                        </div>
                        <div class="pagination-controls">
                            <div class="pagination-size">
                                <label for="trace-page-size">{copy.pageSizeLabel}</label>
                                <select id="trace-page-size" bind:value={pageSize} onchange={() => currentPage = 1}>
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
        {#if traceLoading}
            <span class="usage-footbar-status-line">
                <span class="usage-pulse-dot usage-pulse-dot-loading"></span>
                {copy.footbar.syncing}
            </span>
        {:else if traceStats}
            <span class="settings-footbar-ok usage-footbar-status-line">
                <span class="usage-pulse-dot usage-pulse-dot-ready"></span>
                {copy.footbar.ready}
            </span>
        {/if}
    </div>
    <div class="usage-footbar-refresh-line">
        <Button variant="outline" size="sm" onclick={loadTrace} disabled={traceLoading} class="usage-footbar-refresh-btn">
            {#if traceLoading}
                {copy.footbar.btnSyncing}
            {:else}
                {copy.footbar.btnRefresh}
            {/if}
        </Button>
    </div>
</footer>
