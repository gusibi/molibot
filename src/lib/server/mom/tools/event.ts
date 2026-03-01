import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MomEvent } from "../events.js";

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
}): AgentTool<typeof eventSchema> {
    const eventsDir = resolve(options.workspaceDir, "events");

    return {
        name: "create_event",
        label: "create_event",
        description: [
            "Schedule a message to be sent at a specific time or on a recurring schedule.",
            "",
            "Types:",
            "- one-shot: fires once at the given 'at' datetime (ISO 8601 with timezone offset, e.g. 2026-03-01T09:00:00+08:00)",
            "- periodic: fires repeatedly on a cron 'schedule' (5 fields: min hour day month weekday)",
            "- immediate: fires as soon as the event file is processed",
            "",
            "Use 'text' delivery for simple reminders. Use 'agent' to let the AI elaborate on the message.",
            "",
            "Examples:",
            `  type=one-shot, at="2026-03-01T09:00:00+08:00", text="Morning standup reminder"`,
            `  type=periodic, schedule="0 9 * * 1-5", timezone="${options.timezone}", text="Daily standup"`
        ].join("\n"),
        parameters: eventSchema,
        execute: async (_toolCallId, params) => {
            const tz = options.timezone;

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
            const filename = `event-${Date.now()}.json`;
            const filePath = join(eventsDir, filename);
            writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");

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
