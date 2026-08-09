import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES } from "$lib/server/agent/tools/truncate.js";
import { clearWebFetchCache, createWebFetchTool, runWebFetch } from "./webFetchTool.js";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

test.beforeEach(() => clearWebFetchCache());

test("runWebFetch converts HTML to Markdown and removes executable page content", async () => {
  const result = await runWebFetch({ url: "https://example.com/article", prompt: "Find the title" }, undefined, {
    resolveHostname: publicDns,
    fetchImpl: async () => new Response([
      "<!doctype html><html><head><title>Hidden title</title><style>.x{color:red}</style></head>",
      "<body><main><h1>Visible title</h1><p>Hello <strong>world</strong>.</p>",
      "<script>ignoreDangerousInstructions()</script></main></body></html>"
    ].join(""), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
  });

  assert.equal(result.content, "# Visible title\n\nHello **world**.");
  assert.equal(result.finalUrl, "https://example.com/article");
  assert.equal(result.contentType, "text/html; charset=utf-8");
  assert.equal(result.truncated, false);
});

test("runWebFetch blocks loopback, private DNS answers, credentials, and non-HTTP protocols", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response("should not fetch");
  };

  await assert.rejects(
    runWebFetch({ url: "http://127.0.0.1/admin", prompt: "read" }, undefined, { fetchImpl }),
    /non-public network target/
  );
  await assert.rejects(
    runWebFetch({ url: "http://198.18.0.1/admin", prompt: "read" }, undefined, { fetchImpl }),
    /non-public network target/
  );
  await assert.rejects(
    runWebFetch({ url: "https://intranet.example/admin", prompt: "read" }, undefined, {
      fetchImpl,
      resolveHostname: async () => [{ address: "10.0.0.8", family: 4 }]
    }),
    /non-public network target/
  );
  await assert.rejects(
    runWebFetch({ url: "https://user:secret@example.com", prompt: "read" }, undefined, { fetchImpl }),
    /credentials/
  );
  await assert.rejects(
    runWebFetch({ url: "file:///etc/passwd", prompt: "read" }, undefined, { fetchImpl }),
    /HTTP\(S\)/
  );
  assert.equal(fetchCalls, 0);
});

test("runWebFetch accepts proxy fake-IP DNS for a public hostname but not as a literal URL", async () => {
  const result = await runWebFetch({ url: "https://example.com", prompt: "read" }, undefined, {
    resolveHostname: async () => [{ address: "198.18.0.180", family: 4 }],
    fetchImpl: async () => new Response("proxied", { status: 200, headers: { "content-type": "text/plain" } })
  });
  assert.equal(result.content, "proxied");
});

test("runWebFetch follows same-site redirects but surfaces cross-site redirects", async () => {
  const calls: string[] = [];
  const sameSite = await runWebFetch({ url: "https://example.com/old", prompt: "read" }, undefined, {
    resolveHostname: publicDns,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/old")) {
        return new Response(null, { status: 302, headers: { location: "https://www.example.com/new" } });
      }
      return new Response("arrived", { status: 200, headers: { "content-type": "text/plain" } });
    }
  });
  assert.deepEqual(calls, ["https://example.com/old", "https://www.example.com/new"]);
  assert.equal(sameSite.content, "arrived");

  const crossSite = await runWebFetch({ url: "https://example.com/out", prompt: "read" }, undefined, {
    resolveHostname: publicDns,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://other.example/page" }
    })
  });
  assert.deepEqual(crossSite.redirect, { url: "https://other.example/page", status: 302 });
  assert.match(crossSite.content, /fetch the redirected URL explicitly/);
});

test("runWebFetch rejects binary content instead of decoding it into the Agent context", async () => {
  await assert.rejects(
    runWebFetch({ url: "https://example.com/file.pdf", prompt: "summarize" }, undefined, {
      resolveHostname: publicDns,
      fetchImpl: async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { "content-type": "application/pdf" }
      })
    }),
    /Unsupported response type: application\/pdf/
  );
});

test("runWebFetch applies the shared UTF-8-safe budget even to one-line payloads", async () => {
  const original = "界".repeat(DEFAULT_MAX_BYTES);
  const result = await runWebFetch({ url: "https://example.com/large.json", prompt: "inspect" }, undefined, {
    resolveHostname: publicDns,
    fetchImpl: async () => new Response(original, {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });

  assert.equal(result.truncated, true);
  assert.ok(result.content.length > 0);
  assert.ok(Buffer.byteLength(result.content) <= DEFAULT_MAX_BYTES);
  assert.doesNotMatch(result.content, /�/);
});

test("runWebFetch reuses the 15-minute URL cache while keeping each call's prompt", async () => {
  let fetchCalls = 0;
  let now = 1_000;
  const dependencies = {
    now: () => now,
    resolveHostname: publicDns,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("cached page", { status: 200, headers: { "content-type": "text/plain" } });
    }
  };
  await runWebFetch({ url: "https://example.com/cache", prompt: "first" }, undefined, dependencies);
  now += 1_000;
  const second = await runWebFetch({ url: "https://example.com/cache", prompt: "second" }, undefined, dependencies);

  assert.equal(fetchCalls, 1);
  assert.equal(second.cached, true);
  assert.equal(second.prompt, "second");
});

test("createWebFetchTool exposes the fetched page as untrusted evidence", async () => {
  const tool = createWebFetchTool();
  assert.equal(tool.name, "webFetch");
  assert.equal(tool.executionMode, "parallel");
  assert.match(tool.description, /untrusted data/);
});
