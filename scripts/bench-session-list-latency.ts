/**
 * Reproducible latency harness for the "App session list lightweight query"
 * spec. It builds an isolated temp data dir (never touching real user data) and
 * measures the shared list-collection boundary for both the former heavy path
 * (transcript projection) and the new metadata-only path.
 *
 * Run:
 *   node --import ./scripts/register-loader.js --import tsx scripts/bench-session-list-latency.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import type { ConversationMessage } from "$lib/shared/types/message.js";
import {
  buildExternalItems,
  buildWebItems,
  listDesktopConversations,
  queryConversations,
  type BotNameResolver,
  type DesktopConversationQueryContext
} from "$lib/server/app/desktopConversations.js";
import {
  listExternalSessionsFromContexts,
  listExternalSessionMetaFromContexts,
  rebuildExternalSessionMetadata
} from "$lib/server/app/externalSessionsFromContexts.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { parseSessionEntries } from "$lib/server/agent/session/session.js";
import type { SessionMessageEntry } from "$lib/server/agent/session/session.js";

const WEB_SESSIONS = 60;
const MESSAGES_PER_SESSION = 120;
const EXTERNAL_SESSIONS = 40;
const EXTERNAL_MESSAGES = 120;

const resolver: BotNameResolver = {
  webName: (profileId) => ({ name: `Bot-${profileId}`, deleted: false }),
  externalName: (_channel, botId) => ({ name: `Bot-${botId}`, deleted: false })
};

const settings = {
  agents: [],
  channels: {
    web: { instances: [{ id: "personal", name: "Personal", enabled: true, agentId: "", credentials: {}, allowedChatIds: [] }] },
    telegram: { instances: [{ id: "mybot", name: "My Bot", enabled: true, agentId: "", credentials: {}, allowedChatIds: [] }] }
  }
} as unknown as RuntimeSettings;

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

function stats(samples: number[]): { median: number; min: number; max: number; first: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    first: samples[0]
  };
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

async function measure(label: string, iterations: number, run: () => void): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  const result = stats(samples);
  console.log(
    `${label.padEnd(46)} first=${ms(result.first).padStart(10)}  median=${ms(result.median).padStart(10)}  min=${ms(result.min).padStart(10)}  max=${ms(result.max).padStart(10)}`
  );
  await new Promise((resolve) => setImmediate(resolve));
}

function seedAgentContext(file: string, sessionId: string, messages: number): void {
  const lines = [JSON.stringify({ type: "session", version: 1, id: sessionId, timestamp: "2026-07-01T00:00:00.000Z" })];
  for (let i = 0; i < messages; i += 1) {
    lines.push(JSON.stringify({
      type: "message",
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      timestamp: `2026-07-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
      message: {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i} ${"filler ".repeat(400)}`
      }
    }));
  }
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-list-bench-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile,
    projectsDir: storagePaths.projectsDir
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  storagePaths.projectsDir = path.join(root, "projects");

  try {
    // --- Web: UI session metadata plus a big synthesized Agent context. ---
    const store = new SessionStore();
    const contextFileByConversation = new Map<string, string>();
    for (let i = 0; i < WEB_SESSIONS; i += 1) {
      const conversation = store.createWebConversation("web:personal:web-anonymous");
      for (let m = 0; m < MESSAGES_PER_SESSION; m += 1) {
        store.appendMessage(conversation.id, m % 2 === 0 ? "user" : "assistant", `message ${m} ${"filler ".repeat(40)}`);
      }
      const dir = path.join(root, "agent-contexts");
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${conversation.id}.jsonl`);
      seedAgentContext(file, conversation.id, MESSAGES_PER_SESSION);
      contextFileByConversation.set(conversation.id, file);
    }

    // The simulator emulates the runtime's chat-body projection cost: parse the
    // Agent Context transcript for the requested conversation.
    store.setMessageProjector((conversationId) => {
      const file = contextFileByConversation.get(conversationId);
      if (!file) return [];
      return parseSessionEntries(readFileSync(file, "utf8"))
        .filter((entry): entry is SessionMessageEntry => entry.type === "message")
        .map((entry, index): ConversationMessage => ({
          id: `m${index}`,
          conversationId,
          role: entry.message.role as ConversationMessage["role"],
          content: String(entry.message.content),
          createdAt: entry.timestamp
        }));
    });

    const webCtx: DesktopConversationQueryContext = {
      sessions: store,
      settings,
      dataRoot: root,
      isActive: () => true
    };

    console.log(`\nWeb list (${WEB_SESSIONS} sessions x ${MESSAGES_PER_SESSION} messages)`);
    await measure("  heavy: listAllWebConversations + project", 12, () => {
      const entries = store.listAllWebConversations();
      queryConversations(buildWebItems(entries, resolver), { limit: 10 });
    });
    await measure("  light: metadata list (ordinary)", 12, () => {
      listDesktopConversations({ channel: "web", limit: 10 }, webCtx);
    });
    await measure("  search: metadata + preview (query path)", 12, () => {
      listDesktopConversations({ channel: "web", limit: 10, query: "message 1" }, webCtx);
    });

    // --- External: raw Agent Context transcripts plus derived metadata. ---
    for (let i = 0; i < EXTERNAL_SESSIONS; i += 1) {
      const dir = path.join(root, "moli-t", "bots", "mybot", "111", "contexts");
      mkdirSync(dir, { recursive: true });
      seedAgentContext(path.join(dir, `s-${String(i).padStart(2, "0")}.jsonl`), `s-${String(i).padStart(2, "0")}`, EXTERNAL_MESSAGES);
      writeFileSync(path.join(dir, `s-${String(i).padStart(2, "0")}.json`), "[]\n", "utf8");
    }
    rebuildExternalSessionMetadata(root);

    const externalCtx: DesktopConversationQueryContext = {
      sessions: {} as DesktopConversationQueryContext["sessions"],
      settings,
      dataRoot: root,
      isActive: () => true
    };

    console.log(`\nExternal list (${EXTERNAL_SESSIONS} sessions x ${EXTERNAL_MESSAGES} messages)`);
    await measure("  heavy: listExternalSessionsFromContexts", 12, () => {
      queryConversations(buildExternalItems(listExternalSessionsFromContexts(root), resolver), { limit: 10 });
    });
    await measure("  light: metadata list (ordinary)", 12, () => {
      listDesktopConversations({ channel: "telegram", limit: 10 }, externalCtx);
    });
    await measure("  light: metadata projection only", 12, () => {
      listExternalSessionMetaFromContexts(root);
    });
    console.log("");
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
}

void main();
