import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { migrateLegacyWebTaskEvents } from "./taskScheduler";

test("migrates legacy Web scratch events into the bot-level watched directory", () => {
  const botsRoot = mkdtempSync(join(tmpdir(), "molibot-web-events-"));
  const legacyEventsDir = join(botsRoot, "default", "web:default:web-anonymous", "scratch", "events");
  const eventPath = join(legacyEventsDir, "periodic-123.json");
  const event = { type: "periodic", chatId: "web:default:web-anonymous", text: "Send summary" };
  mkdirSync(legacyEventsDir, { recursive: true });
  writeFileSync(eventPath, `${JSON.stringify(event)}\n`);

  try {
    const migrated = migrateLegacyWebTaskEvents(botsRoot);
    const destination = join(botsRoot, "default", "events", "periodic-123.json");

    assert.deepEqual(migrated, [destination]);
    assert.equal(existsSync(eventPath), false);
    assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), event);
  } finally {
    rmSync(botsRoot, { recursive: true, force: true });
  }
});
