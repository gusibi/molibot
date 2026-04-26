import assert from "node:assert/strict";
import test from "node:test";
import { formatIsoInTimeZone, isValidTimeZone, localDateKeyInTimeZone, normalizeTimeZone } from "./time.js";

test("formatIsoInTimeZone renders local timestamp with IANA offset", () => {
  const date = new Date("2026-04-26T02:59:24Z");
  assert.equal(formatIsoInTimeZone(date, "Asia/Shanghai"), "2026-04-26T10:59:24+08:00");
  assert.equal(localDateKeyInTimeZone(date, "Asia/Shanghai"), "2026-04-26");
});

test("normalizeTimeZone falls back when input is invalid", () => {
  assert.equal(isValidTimeZone("Asia/Shanghai"), true);
  assert.equal(isValidTimeZone("Mars/Base"), false);
  assert.equal(normalizeTimeZone("Mars/Base", "Asia/Shanghai"), "Asia/Shanghai");
});
