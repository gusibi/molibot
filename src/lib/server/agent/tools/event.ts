import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EventStatus, MomEvent } from "../events.js";

const eventSchema = Type.Object({
    type: Type.Union([
        Type.Literal("one-shot"),
        Type.Literal("periodic"),
        Type.Literal("immediate")
    ]),
    text: Type.String({ description: "The message text to deliver when the event fires." }),
    at: Type.Optional(
        Type.String({
            description: "ISO 8601 datetime string with timezone offset, e.g. 2026-03-01T09:00:00+08:00. Required for one-shot events."
        })
    ),
    schedule: Type.Optional(
        Type.String({ description: "Cron expression (5 fields). Required for periodic events." })
    ),
    timezone: Type.Optional(
        Type.String({ description: "IANA timezone name for periodic events, e.g. 'Asia/Shanghai'." })
    ),
    delivery: Type.Optional(
        Type.Union([Type.Literal("text"), Type.Literal("agent")], {
            description: "text: deliver message directly. agent: run through AI first. Defaults to 'text' for one-shot/immediate, 'agent' for periodic."
        })
    )
});

function formatLocalTime(date: Date, tz: string): string {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const offsetStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    const iso = local.toISOString().slice(0, 19) + offsetStr;
    return iso;
}

function formatRelativeTime(targetMs: number, nowMs: number): string {
    const diffMs = targetMs - nowMs;
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `约 ${diffMin} 分钟后`;
    const diffH = Math.floor(diffMin / 60);
    const remMin = diffMin % 60;
    if (remMin === 0) return `约 ${diffH} 小时后`;
    return `约 ${diffH} 小时 ${remMin} 分钟后`;
}

function formatScheduledTime(atIso: string, tz: string): { display: string; relative: string } {
    const target = new Date(atIso);
    const now = new Date();
    const relative = formatRelativeTime(target.getTime(), now.getTime());

    const fmt = new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });

    const todayFmt = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" });
    const nowDate = todayFmt.format(now);
    const targetDate = todayFmt.format(target);

    const hourMin = new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(target);

    let dayLabel: string;
    if (nowDate === targetDate) {
        dayLabel = `今天 ${hourMin}`;
    } else {
        const tomorrowDate = todayFmt.format(new Date(now.getTime() + 86400000));
        dayLabel = tomorrowDate === targetDate ? `明天 ${hourMin}` : fmt.format(target);
    }

    return { display: dayLabel, relative };
}

export function createEventTool(options: {
    workspaceDir: string;
    chatId: string;
    timezone: string;
    name?: string;
    label?: string;
    descriptionPrefix?: string;
}): AgentTool<typeof eventSchema> {
    const eventsDir = resolve(options.workspaceDir, "events");

    return {
        name: options.name ?? "createEvent",
        label: options.label ?? options.name ?? "createEvent",
        description: [
            options.descriptionPrefix,
            "Schedule a message to be sent at a specific time or on a recurring schedule. Use this tool for reminders, timers, scheduled messages, recurring summaries, and immediate watched-event tasks.",
            "Never create event JSON files manually with bash/write/edit. Never implement delays with shell sleep, crontab, at, launchctl, schtasks, or memory.",
            "For periodic events, calling this again with the same chatId + schedule + timezone will update the existing task instead of creating duplicates.",
            "",
            "Types:",
            "- one-shot: fires once at the given 'at' datetime (ISO 8601 with timezone offset, e.g. 2026-03-01T09:00:00+08:00)",
            "- periodic: fires repeatedly on a cron 'schedule' (5 fields: min hour day month weekday)",
            "- immediate: fires as soon as the event file is processed",
            "",
            "Delivery:",
            "- text: send the text directly to the user. Use for plain reminders.",
            "- agent: run AI with the text as the task instruction. Use for recurring summaries or actions.",
            "- Defaults: one-shot/immediate -> text; periodic -> agent.",
            "",
            "Cron format:",
            "- schedule is 'minute hour day-of-month month day-of-week'.",
            "- 0 9 * * * = daily at 09:00.",
            "- 0 9 * * 1-5 = weekdays at 09:00.",
            "- 30 14 * * 1 = Mondays at 14:30.",
            "",
            "Rules:",
            "- Any relative or absolute reminder request should use type=one-shot with a future 'at' timestamp that includes a timezone offset.",
            "- Any recurring request should use type=periodic with schedule and timezone.",
            "- If a one-shot call fails because 'at' is not in the future, recompute using the current local time shown in the error and retry once.",
            "- When this tool succeeds, reply to the user using exactly the confirmation text returned by the tool, with no modifications, translations, or summaries.",
            "- If this tool fails, say scheduling failed. Do not claim the reminder is set.",
            "- For periodic events with nothing actionable when they fire, respond with exactly [SILENT].",
            "- When automations may emit many immediate events, debounce and summarize into one event rather than flooding.",
            "",
            "Examples:",
            `  type=one-shot, at="2026-03-01T09:00:00+08:00", text="Morning standup reminder"`,
            `  type=periodic, schedule="0 9 * * 1-5", timezone="${options.timezone}", text="Daily standup"`
        ].filter(Boolean).join("\n"),
        parameters: eventSchema,
        execute: async (_toolCallId, params) => {
            const tz = options.timezone;
            const nowIso = new Date().toISOString();

            // Validate type-specific required fields
            if (params.type === "one-shot") {
                if (!params.at) {
                    throw new Error("one-shot events require an 'at' datetime string.");
                }
                const atMs = new Date(params.at).getTime();
                if (!Number.isFinite(atMs)) {
                    throw new Error(`Invalid 'at' datetime: ${params.at}`);
                }
                if (atMs <= Date.now()) {
                    const nowLocal = formatLocalTime(new Date(), tz);
                    throw new Error(
                        `'at' must be in the future. You passed: ${params.at} (parsed as ${new Date(atMs).toISOString()}). ` +
                        `Current local time: ${nowLocal} (${tz}). Please recompute 'at' using this time and include the timezone offset.`
                    );
                }
            }

            if (params.type === "periodic") {
                if (!params.schedule) {
                    throw new Error("periodic events require a 'schedule' cron expression.");
                }
                const parts = params.schedule.trim().split(/\s+/);
                if (parts.length !== 5) {
                    throw new Error(
                        `Invalid cron schedule '${params.schedule}': expected 5 fields (min hour day month weekday).`
                    );
                }
            }

            const delivery: "text" | "agent" =
                params.delivery ?? (params.type === "periodic" ? "agent" : "text");

            let event: MomEvent;
            let atIso: string | undefined;
            let filename: string;
            let operation: "created" | "updated" = "created";

            if (params.type === "one-shot") {
                atIso = new Date(params.at!).toISOString();
                event = {
                    type: "one-shot",
                    chatId: options.chatId,
                    text: params.text,
                    delivery,
                    at: atIso
                };
            } else if (params.type === "periodic") {
                event = {
                    type: "periodic",
                    chatId: options.chatId,
                    text: params.text,
                    delivery,
                    schedule: params.schedule!,
                    timezone: params.timezone ?? tz
                };
            } else {
                event = {
                    type: "immediate",
                    chatId: options.chatId,
                    text: params.text,
                    delivery
                };
            }

            mkdirSync(eventsDir, { recursive: true });
            if (event.type === "periodic") {
                const periodicMatches = findPeriodicMatches(
                    eventsDir,
                    options.chatId,
                    event.schedule,
                    event.timezone
                );
                if (periodicMatches.length > 0) {
                    periodicMatches.sort((a, b) => b.mtimeMs - a.mtimeMs);
                    const primary = periodicMatches[0];
                    const nextStatus: EventStatus = {
                        ...(primary.event.status ?? {}),
                        state: "pending",
                        completedAt: undefined,
                        reason: "updated",
                        lastError: undefined
                    };
                    const mergedEvent: MomEvent = {
                        ...event,
                        status: nextStatus
                    };
                    writeFileSync(primary.path, `${JSON.stringify(mergedEvent, null, 2)}\n`, "utf8");

                    for (const duplicate of periodicMatches.slice(1)) {
                        const duplicateStatus: EventStatus = {
                            ...(duplicate.event.status ?? {}),
                            state: "completed",
                            completedAt: nowIso,
                            reason: "superseded_by_update",
                            lastError: undefined
                        };
                        const supersededEvent: MomEvent = {
                            ...duplicate.event,
                            delivery: duplicate.event.delivery ?? "agent",
                            status: duplicateStatus
                        };
                        writeFileSync(duplicate.path, `${JSON.stringify(supersededEvent, null, 2)}\n`, "utf8");
                    }

                    filename = primary.filename;
                    operation = "updated";
                } else {
                    filename = `event-${Date.now()}.json`;
                    const filePath = join(eventsDir, filename);
                    writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
                }
            } else {
                filename = `event-${Date.now()}.json`;
                const filePath = join(eventsDir, filename);
                writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
            }

            // Build rich confirmation message
            let timeInfo: string;
            if (params.type === "one-shot" && atIso) {
                const { display, relative } = formatScheduledTime(atIso, tz);
                timeInfo = `${display}（${relative}）`;
            } else if (params.type === "periodic") {
                timeInfo = `cron: ${params.schedule}`;
            } else {
                timeInfo = "立即触发";
            }

            const lines = [
                `已设置提醒。`,
                ``,
                `提醒详情：`
            ];

            if (params.type === "periodic") {
                lines.push(`• 类型：周期性任务`);
            }

            lines.push(
                `• 操作：${operation === "updated" ? "更新已有任务" : "创建新任务"}`,
                `• 触发时间：${timeInfo}`,
                `• 内容：${params.text}`,
                `• 文件名：${filename}`
            );

            return {
                content: [{
                    type: "text",
                    text: `Success. Relay EXACTLY the following text to the user, do not translate, summarize, or rewrite it:\n\n${lines.join("\n")}`
                }],
                details: undefined
            };
        }
    };
}

interface EventFileRow {
    filename: string;
    path: string;
    mtimeMs: number;
    event: MomEvent;
}

function findPeriodicMatches(
    eventsDir: string,
    chatId: string,
    schedule: string,
    timezone: string
): EventFileRow[] {
    const files = readdirSync(eventsDir).filter((name) => name.endsWith(".json"));
    const out: EventFileRow[] = [];
    for (const filename of files) {
        const path = join(eventsDir, filename);
        try {
            const raw = readFileSync(path, "utf8");
            const parsed = JSON.parse(raw) as Partial<MomEvent>;
            if (!parsed || parsed.type !== "periodic") continue;
            if (parsed.chatId !== chatId) continue;
            if (String(parsed.schedule ?? "").trim() !== schedule.trim()) continue;
            if (String(parsed.timezone ?? "").trim() !== timezone.trim()) continue;
            const mtimeMs = statSync(path).mtimeMs;
            out.push({
                filename,
                path,
                mtimeMs,
                event: parsed as MomEvent
            });
        } catch {
            // Ignore malformed files; watcher/error path handles them separately.
        }
    }
    return out;
}
