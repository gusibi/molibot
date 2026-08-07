import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeMiniAppResultCard,
  MINIAPP_CARD_MAX_FIELDS,
  MINIAPP_CARD_MAX_TITLE_LENGTH
} from "$lib/shared/miniappCard.js";
import { formatMiniAppDeepLink } from "$lib/shared/miniappDeepLink.js";

test("a well-formed card survives sanitization intact", () => {
  const card = sanitizeMiniAppResultCard(
    {
      title: "已收藏",
      subtitle: "来自今天的对话",
      fields: [{ label: "标签", value: "架构" }],
      icon: "star",
      link: formatMiniAppDeepLink("favorites", "entry/7")
    },
    "favorites"
  );
  assert.deepEqual(card, {
    title: "已收藏",
    subtitle: "来自今天的对话",
    fields: [{ label: "标签", value: "架构" }],
    icon: "star",
    link: "molibot://miniapp/favorites/entry/7"
  });
});

test("a card with no title is dropped rather than rendered empty", () => {
  assert.equal(sanitizeMiniAppResultCard({ fields: [{ label: "a", value: "b" }] }, "todo"), null);
  assert.equal(sanitizeMiniAppResultCard({ title: "   " }, "todo"), null);
});

test("a non-object is dropped rather than throwing", () => {
  for (const value of [null, undefined, "card", 42, ["title"]]) {
    assert.equal(sanitizeMiniAppResultCard(value, "todo"), null);
  }
});

test("a link addressing another app is dropped but the card still renders", () => {
  // A card must never become a way to steer the owner into a different app.
  const card = sanitizeMiniAppResultCard(
    { title: "Saved", link: formatMiniAppDeepLink("other-app", "entry/1") },
    "favorites"
  );
  assert.equal(card?.title, "Saved");
  assert.equal(card?.link, undefined);
});

test("a non-deep-link URL is never accepted as a link", () => {
  for (const link of ["https://example.com", "javascript:alert(1)", "molibot-miniapp://favorites/x"]) {
    assert.equal(sanitizeMiniAppResultCard({ title: "Saved", link }, "favorites")?.link, undefined);
  }
});

test("over-long text is truncated instead of failing the already-completed call", () => {
  const card = sanitizeMiniAppResultCard({ title: "x".repeat(500) }, "todo");
  assert.equal(card?.title.length, MINIAPP_CARD_MAX_TITLE_LENGTH);
});

test("fields beyond the cap are dropped, keeping the earliest", () => {
  const fields = Array.from({ length: MINIAPP_CARD_MAX_FIELDS + 4 }, (_, index) => ({
    label: `l${index}`,
    value: `v${index}`
  }));
  const card = sanitizeMiniAppResultCard({ title: "Saved", fields }, "todo");
  assert.equal(card?.fields.length, MINIAPP_CARD_MAX_FIELDS);
  assert.equal(card?.fields[0].label, "l0");
});

test("control characters cannot break the row a card renders into", () => {
  const card = sanitizeMiniAppResultCard(
    { title: "one\ntwo\tthree", fields: [{ label: "a\r\nb", value: "c" }] },
    "todo"
  );
  assert.equal(card?.title, "one two three");
  assert.equal(card?.fields[0].label, "a b");
});

test("a field with neither label nor value is noise and is skipped", () => {
  const card = sanitizeMiniAppResultCard(
    { title: "Saved", fields: [{ label: "", value: "" }, { label: "kept", value: "" }, "nope"] },
    "todo"
  );
  assert.deepEqual(card?.fields, [{ label: "kept", value: "" }]);
});

test("an icon outside the allowed shape is dropped, not passed to the class name", () => {
  assert.equal(sanitizeMiniAppResultCard({ title: "S", icon: "star" }, "todo")?.icon, "star");
  for (const icon of ["Star", "star lg", "star\"><script>", "../x"]) {
    assert.equal(sanitizeMiniAppResultCard({ title: "S", icon }, "todo")?.icon, undefined);
  }
});
