import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMiniAppDeepLink,
  isMiniAppDeepLinkFor,
  parseMiniAppDeepLink,
  MINIAPP_DEEP_LINK_MAX_PATH_LENGTH
} from "$lib/shared/miniappDeepLink.js";

test("a deep link round-trips through format and parse", () => {
  const link = formatMiniAppDeepLink("favorites", "entry/42");
  assert.equal(link, "molibot://miniapp/favorites/entry/42");
  assert.deepEqual(parseMiniAppDeepLink(link), { appId: "favorites", path: "entry/42" });
});

test("an app id with no path opens the panel with an empty locator", () => {
  assert.equal(formatMiniAppDeepLink("todo"), "molibot://miniapp/todo");
  assert.deepEqual(parseMiniAppDeepLink("molibot://miniapp/todo"), { appId: "todo", path: "" });
  // A trailing slash is the same intent, not a path of one empty segment.
  assert.deepEqual(parseMiniAppDeepLink("molibot://miniapp/todo/"), { appId: "todo", path: "" });
});

test("locator segments survive spaces and CJK through encoding", () => {
  const link = formatMiniAppDeepLink("notes", "会议 纪要/2026");
  // Encoded on the wire...
  assert.ok(!link.includes(" "));
  // ...and identical after parsing, so the App sees what it wrote.
  assert.deepEqual(parseMiniAppDeepLink(link), { appId: "notes", path: "会议 纪要/2026" });
});

test("a traversal segment is rejected rather than normalized away", () => {
  // The App panel resolves this against its own data; a `..` must never reach
  // it in a form that could be joined onto a path.
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/notes/../../etc/passwd"), null);
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/notes/%2e%2e/secret"), null);
});

test("only the molibot scheme and the miniapp host are accepted", () => {
  assert.equal(parseMiniAppDeepLink("https://miniapp/todo"), null);
  assert.equal(parseMiniAppDeepLink("molibot://project/todo"), null);
  assert.equal(parseMiniAppDeepLink("molibot-miniapp://todo/index.html"), null);
});

test("a malformed value is null rather than a throw", () => {
  for (const value of [null, undefined, 42, {}, "", "not a url", "molibot://miniapp/"]) {
    assert.equal(parseMiniAppDeepLink(value), null);
  }
});

test("an app id outside the allowed shape is rejected", () => {
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/Not_Valid/x"), null);
  assert.equal(parseMiniAppDeepLink(`molibot://miniapp/${"a".repeat(100)}`), null);
});

test("an over-long locator is rejected instead of silently truncated", () => {
  const long = "x".repeat(MINIAPP_DEEP_LINK_MAX_PATH_LENGTH + 1);
  assert.equal(parseMiniAppDeepLink(`molibot://miniapp/notes/${long}`), null);
});

test("a malformed percent escape does not become a guessed path", () => {
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/notes/%E0%A4%A"), null);
});

test("an encoded separator cannot smuggle extra segments into one segment", () => {
  // `%2F` would decode into a separator, turning one segment into two — and
  // `%2F..%2F` would read as traversal to whatever the App does with it.
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/notes/a%2Fb"), null);
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/notes/x%2F..%2Fy"), null);
  assert.equal(parseMiniAppDeepLink("molibot://miniapp/notes/a%5Cb"), null);
});

test("link ownership is checked against the exact app id", () => {
  const link = formatMiniAppDeepLink("favorites", "entry/1");
  assert.equal(isMiniAppDeepLinkFor(link, "favorites"), true);
  assert.equal(isMiniAppDeepLinkFor(link, "todo"), false);
  // A prefix must not pass as the same app.
  assert.equal(isMiniAppDeepLinkFor(link, "fav"), false);
  assert.equal(isMiniAppDeepLinkFor("not a link", "favorites"), false);
});
