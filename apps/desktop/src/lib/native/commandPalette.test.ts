import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_USAGE_STORAGE_KEY,
  loadCommandUsage,
  rankCommands,
  recordCommandSuccess,
  saveCommandUsage
} from "./commandPalette";
import type { CommandSnapshot } from "./commandSystem";
import { settingsDestinations } from "./commandSystem";

const commands: CommandSnapshot[] = [
  { id: "settings.memory", label: "Memory", keywords: ["memory", "记忆"], scope: "settings", recommendedRank: 3, enabled: true },
  { id: "app.open-settings", label: "Open Settings", keywords: ["preferences", "settings"], scope: "application", recommendedRank: 2, enabled: true },
  { id: "service.restart", label: "Restart Service", keywords: ["restart", "service"], scope: "application", recommendedRank: 1, enabled: false, disabledReason: "Unavailable" }
];

function storage(initial: string | null = null): { getItem(key: string): string | null; setItem(key: string, value: string): void; value(): string | null } {
  let saved = initial;
  return {
    getItem: () => saved,
    setItem: (_key, value) => { saved = value; },
    value: () => saved
  };
}

test("rankCommands matches labels and bilingual keywords deterministically", () => {
  assert.deepEqual(rankCommands(commands, "settings").map((command) => command.id), ["app.open-settings"]);
  assert.deepEqual(rankCommands(commands, "记忆").map((command) => command.id), ["settings.memory"]);
  assert.deepEqual(rankCommands(commands, "service").map((command) => command.id), ["service.restart"]);
});

test("rankCommands keeps disabled commands discoverable and prioritizes recent then recommended empty queries", () => {
  assert.equal(rankCommands(commands, "restart")[0]?.enabled, false);
  assert.deepEqual(
    rankCommands(commands, "", [{ id: "settings.memory", lastSucceededAt: 100, successfulRuns: 1 }]).map((command) => command.id),
    ["settings.memory", "service.restart", "app.open-settings"]
  );
});

test("rankCommands preserves query relevance before recent history and has deterministic ties", () => {
  const usage = [{ id: "service.restart" as const, lastSucceededAt: 100, successfulRuns: 3 }];
  assert.deepEqual(rankCommands(commands, "settings", usage).map((command) => command.id), ["app.open-settings"]);
  assert.deepEqual(rankCommands(commands, "", []).map((command) => command.id), ["service.restart", "app.open-settings", "settings.memory"]);
});

test("command usage ignores malformed, obsolete, duplicate, and expired values", () => {
  const now = 100 * 24 * 60 * 60 * 1000;
  const persisted = storage(JSON.stringify({
    version: 1,
    entries: [
      { id: "settings.memory", lastSucceededAt: now - 1, successfulRuns: 2 },
      { id: "settings.memory", lastSucceededAt: now - 2, successfulRuns: 9 },
      { id: "app.open-settings", lastSucceededAt: now - 91 * 24 * 60 * 60 * 1000, successfulRuns: 1 },
      { id: "unknown.command", lastSucceededAt: now - 1, successfulRuns: 1 },
      { id: "service.restart", lastSucceededAt: "now", successfulRuns: 1 }
    ]
  }));
  assert.deepEqual(loadCommandUsage(persisted, commands, now), [{ id: "settings.memory", lastSucceededAt: now - 1, successfulRuns: 2 }]);
  assert.deepEqual(loadCommandUsage(storage("not json"), commands, now), []);
  assert.deepEqual(loadCommandUsage(storage(JSON.stringify({ version: 2, entries: [] })), commands, now), []);
});

test("command usage records only stable command success fields and caps retained history", () => {
  const now = 1_000;
  const initial = recordCommandSuccess([], "app.open-settings", commands, now);
  const updated = recordCommandSuccess(initial, "app.open-settings", commands, now + 1);
  assert.deepEqual(updated, [{ id: "app.open-settings", lastSucceededAt: now + 1, successfulRuns: 2 }]);

  const manyCommands = settingsDestinations.slice(0, 21).map((destination, index): CommandSnapshot => ({
    id: `settings.${destination}`,
    label: `Synthetic ${index}`,
    keywords: [],
    scope: "settings",
    recommendedRank: 4,
    enabled: true
  }));
  const capped = manyCommands.reduce(
    (usage, command, index) => recordCommandSuccess(usage, command.id, manyCommands, now + index),
    [] as ReturnType<typeof recordCommandSuccess>
  );
  assert.equal(capped.length, 20);
  assert.equal(capped.some((entry) => entry.id === `settings.${settingsDestinations[0]}`), false);

  const persisted = storage();
  saveCommandUsage(persisted, updated);
  assert.deepEqual(JSON.parse(persisted.value() ?? "{}"), {
    version: 1,
    entries: [{ id: "app.open-settings", lastSucceededAt: now + 1, successfulRuns: 2 }]
  });
  assert.equal(COMMAND_USAGE_STORAGE_KEY, "molibot-desktop-command-usage-v1");
});
