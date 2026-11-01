import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDeliveryDisplay, normalizeDeliveryReceipt, taskResultWithDelivery } from "./taskDelivery.js";

test("the completion path stamps the delivery and keeps the declared reading surface", () => {
  const result = taskResultWithDelivery({
    result: "The briefing went out to Feishu.",
    display: {
      type: "briefing",
      title: "Morning briefing",
      highlights: [{ title: "Invoices", takeaway: "Three are due today.", sources: [{ label: "Ledger", url: "https://example.com/ledger" }] }]
    },
    channel: "feishu",
    finishedAt: "2026-10-22T07:01:00.000Z"
  }) as { text: string; display?: { type: string; highlights: unknown[] }; delivery?: { status: string } };

  assert.equal(result.text, "The briefing went out to Feishu.");
  assert.equal(result.display?.type, "briefing");
  assert.equal(result.display?.highlights.length, 1);
  assert.equal(result.delivery?.status, "delivered", "a completed channel send is a delivery, not a generation claim");
});

test("an in-app result is not reported as an external delivery", () => {
  const result = taskResultWithDelivery({
    result: { text: "Read it here." },
    channel: "web",
    finishedAt: "2026-10-22T07:01:00.000Z"
  }) as { text: string; delivery?: { status: string } };

  assert.equal(result.text, "Read it here.");
  assert.equal(result.delivery?.status, "not_required");
});

test("display validation bounds collections and rejects unsafe links without losing the text", () => {
  const display = normalizeDeliveryDisplay({
    type: "topic-proposals",
    title: "What to write next",
    recommendedCandidateId: "missing",
    candidates: [
      {
        id: "a",
        title: "A",
        angle: "Angle A",
        outline: ["one", "two", "three", "four", "five", "six"],
        sources: [{ label: "Bad", url: "javascript:alert(1)" }]
      },
      { id: "a", title: "Duplicate", angle: "Dropped" },
      { id: "b", title: "B", angle: "Angle B" }
    ]
  });

  assert.equal(display?.type, "topic-proposals");
  if (display?.type !== "topic-proposals") return;
  assert.equal(display.candidates.length, 2, "duplicate ids are dropped");
  assert.equal(display.recommendedCandidateId, undefined, "a recommendation must reference a real candidate");
  assert.equal(display.candidates[0]?.outline?.length, 4, "outline stays bounded");
  assert.deepEqual(display.candidates[0]?.sources, [{ label: "Bad" }], "unsafe URLs stay as a label");
});

test("a receipt with an unknown status is ignored instead of shown as delivered", () => {
  assert.equal(normalizeDeliveryReceipt({ status: "probably" }), undefined);
  assert.deepEqual(normalizeDeliveryReceipt({ status: "failed", detail: "channel rejected the message" }), {
    status: "failed",
    detail: "channel rejected the message"
  });
});
