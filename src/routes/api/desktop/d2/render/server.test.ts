import assert from "node:assert/strict";
import test from "node:test";
import {
  _D2_RENDER_TIMEOUT_MS,
  _MAX_D2_OUTPUT_BYTES,
  _MAX_D2_SOURCE_BYTES,
  _handleD2RenderRequest
} from "./+server.js";

function d2Request(body: unknown): Request {
  return new Request("http://localhost/api/desktop/d2/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("D2 route sends source and theme to the server renderer", async () => {
  let asked: { url: string; body: Record<string, unknown>; signal: AbortSignal } | null = null;
  const response = await _handleD2RenderRequest(
    d2Request({ source: "direction: right\nA -> B", theme: "dark" }),
    {
      endpoint: "https://d2.example.test",
      fetchImpl: async (input, init) => {
        asked = {
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          signal: init?.signal as AbortSignal
        };
        return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\"><path/></svg>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" }
        });
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"><path/></svg>"
  });
  assert.equal(asked?.url, "https://d2.example.test/d2/svg");
  assert.deepEqual(asked?.body, {
    diagram_source: "direction: right\nA -> B",
    diagram_options: { layout: "elk", theme: "200" }
  });
  assert.equal(asked?.signal.aborted, false);
});

test("D2 route refuses oversized source before contacting the renderer", async () => {
  let called = false;
  const response = await _handleD2RenderRequest(
    d2Request({ source: "x".repeat(_MAX_D2_SOURCE_BYTES + 1) }),
    {
      fetchImpl: async () => {
        called = true;
        return new Response("should not be called");
      }
    }
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "source_too_large");
  assert.equal(called, false);
});

test("D2 route rejects non-SVG and oversized upstream output", async () => {
  const cases = [
    { source: "invalid-html", body: "<!doctype html><html>not an svg</html>" },
    { source: "oversized-output", body: `<svg>${"x".repeat(_MAX_D2_OUTPUT_BYTES + 1)}</svg>` }
  ];
  for (const testCase of cases) {
    const response = await _handleD2RenderRequest(
      d2Request({ source: testCase.source }),
      {
        fetchImpl: async () => new Response(testCase.body, {
          status: 200,
          headers: { "content-type": "image/svg+xml" }
        })
      }
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "invalid_renderer_output");
  }
});

test("D2 route maps renderer failures and timeouts without leaking upstream details", async () => {
  const response = await _handleD2RenderRequest(
    d2Request({ source: "A -> B" }),
    {
      timeoutMs: _D2_RENDER_TIMEOUT_MS,
      fetchImpl: async () => {
        throw new Error("upstream secret response from renderer");
      }
    }
  );

  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: "D2 rendering failed.",
    code: "upstream_failed"
  });
  assert.equal(JSON.stringify(body).includes("upstream secret"), false);
});

test("D2 route validates JSON and theme values", async () => {
  const fetchImpl = async () => new Response("<svg></svg>", {
    headers: { "content-type": "image/svg+xml" }
  });
  for (const body of [
    "not json",
    {},
    { source: "A -> B", theme: "midnight" },
    { source: 42 }
  ]) {
    const response = await _handleD2RenderRequest(d2Request(body), { fetchImpl });
    assert.equal(response.status, 400, `expected ${JSON.stringify(body)} to be refused`);
  }
});
