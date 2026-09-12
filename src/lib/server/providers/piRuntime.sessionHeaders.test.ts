import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_AFFINITY_HEADER, withSessionAffinityHeaders } from "./piRuntime.js";
import type { ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";

test("withSessionAffinityHeaders attaches x-molibot-session from sessionId", () => {
  const enhanced = withSessionAffinityHeaders({
    sessionId: "s-20260912-eqpo"
  } as ModelsSimpleStreamOptions);
  assert.equal(enhanced?.headers?.[SESSION_AFFINITY_HEADER], "s-20260912-eqpo");
});

test("withSessionAffinityHeaders preserves caller headers alongside the session header", () => {
  const enhanced = withSessionAffinityHeaders({
    sessionId: "s-20260912-eqpo",
    headers: { "x-custom": "keep-me" }
  } as ModelsSimpleStreamOptions);
  assert.equal(enhanced?.headers?.["x-custom"], "keep-me");
  assert.equal(enhanced?.headers?.[SESSION_AFFINITY_HEADER], "s-20260912-eqpo");
  assert.equal(enhanced?.sessionId, "s-20260912-eqpo");
});

test("withSessionAffinityHeaders leaves sessionless requests untouched", () => {
  const options = { maxTokens: 120 } as ModelsSimpleStreamOptions;
  const enhanced = withSessionAffinityHeaders(options);
  assert.equal(enhanced, options);
  assert.equal(withSessionAffinityHeaders(undefined), undefined);
});
