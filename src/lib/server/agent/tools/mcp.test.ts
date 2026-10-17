import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createMcpInvokeTool } from "./mcpInvoke.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpServerConfig } from "$lib/server/settings/schema.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_MAX_BYTES } from "$lib/server/agent/tools/truncate.js";
import { McpToolRegistry, capMcpToolContent, redactMcpError, callMcpToolWithTimeout, MCP_EXECUTION_TIMEOUT_MS } from "./mcp.js";

const fixtureCode = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const server = new McpServer({ name: 'molibot-mcp-lifecycle-fixture', version: '1.0.0' });
server.registerTool('ping', { description: 'ping' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
server.registerTool('flood', { description: 'return a payload far larger than the context' }, async () => ({
  content: [{ type: 'text', text: 'flooded line of output\\n'.repeat(200000) }]
}));
server.registerTool('hang', { description: 'never return' }, async () => new Promise(() => {}));
server.registerTool('die', { description: 'exit after responding' }, async () => {
  setTimeout(() => process.exit(0), 20);
  return { content: [{ type: 'text', text: 'bye' }] };
});
server.registerTool('rich', { description: 'every content shape' }, async () => ({ content: [
  { type: 'text', text: 'hello text' },
  { type: 'image', data: 'AAAA', mimeType: 'image/png' },
  { type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: 'embedded text body' } },
  { type: 'resource', resource: { uri: 'file:///pic.png', mimeType: 'image/png', blob: 'BBBB' } },
  { type: 'resource_link', uri: 'file:///linked.txt', name: 'linked doc' },
  { type: 'audio', data: 'CCCC', mimeType: 'audio/wav' }
] }));
server.registerTool('structured', { description: 'structured content only' }, async () => ({ structuredContent: { answer: 42 } }));
server.registerTool('mixed', { description: 'text next to structured content' }, async () => ({
  content: [{ type: 'text', text: 'visible text' }],
  structuredContent: { hidden: true }
}));
server.registerTool('boom', { description: 'report a tool error' }, async () => ({
  content: [{ type: 'text', text: 'tool blew up' }],
  isError: true
}));
server.registerTool('readonly_tool', { description: 'declares read only', annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
server.registerTool('plain_tool', { description: 'declares nothing' }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
await server.connect(new StdioServerTransport());
`;

function server(id: string): McpServerConfig {
  return {
    id,
    name: id,
    enabled: true,
    transport: "stdio",
    stdio: {
      command: process.execPath,
      args: ["--input-type=module", "-e", fixtureCode],
      cwd: "",
      env: {}
    },
    http: { url: "", headers: {} },
    toolNamePrefix: id
  };
}

function tool(tools: AgentTool<any>[], suffix: string): AgentTool<any> {
  const found = tools.find((item) => item.name.endsWith(`__${suffix}`));
  assert.ok(found, `Expected MCP tool ending in __${suffix}`);
  return found;
}

async function invoke(item: AgentTool<any>): Promise<string> {
  const result = await item.execute("fixture-call", {}, new AbortController().signal);
  return result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
}

test("reconnects an unchanged MCP config after its stdio process exits", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const config = server("recover");

  const first = await registry.getTools([config], { workspaceDir: process.cwd() });
  await invoke(tool(first, "die"));
  await new Promise((resolve) => setTimeout(resolve, 120));

  const second = await registry.getTools([config], { workspaceDir: process.cwd() });
  assert.notEqual(tool(first, "ping"), tool(second, "ping"));
  assert.equal(await invoke(tool(second, "ping")), "pong");
  assert.equal(registry.getStatuses([config], process.cwd())[0]?.state, "connected");
});

test("keeps connections isolated while returning only the caller's scoped tools", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const alpha = server("alpha");
  const beta = server("beta");

  const alphaTools = await registry.getTools([alpha], { workspaceDir: process.cwd() });
  const betaTools = await registry.getTools([beta], { workspaceDir: process.cwd() });

  assert.equal(alphaTools.every((item) => item.name.startsWith("mcp__alpha__")), true);
  assert.equal(betaTools.every((item) => item.name.startsWith("mcp__beta__")), true);
  assert.equal(await invoke(tool(alphaTools, "ping")), "pong");
  assert.equal(await invoke(tool(betaTools, "ping")), "pong");
});

test("disable closes a connection and re-enable creates a fresh client", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const enabled = server("toggle");
  const first = await registry.getTools([enabled], { workspaceDir: process.cwd() });

  await registry.reconcile([{ ...enabled, enabled: false }], {
    workspaceDir: process.cwd(),
    connectEnabled: true
  });
  assert.equal(registry.getStatuses([{ ...enabled, enabled: false }], process.cwd())[0]?.state, "disabled");

  await registry.reconcile([enabled], { workspaceDir: process.cwd(), connectEnabled: true });
  const second = await registry.getTools([enabled], { workspaceDir: process.cwd() });
  assert.notEqual(tool(first, "ping"), tool(second, "ping"));
  assert.equal(await invoke(tool(second, "ping")), "pong");
});

test("reports connection errors and force reconnect attempts a fresh connection", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const missing = {
    ...server("missing"),
    stdio: { command: "molibot-missing-mcp-command", args: [], cwd: "", env: {} }
  };

  await registry.getTools([missing], { workspaceDir: process.cwd() });
  const failed = registry.getStatuses([missing], process.cwd())[0];
  assert.equal(failed?.state, "error");
  assert.match(failed?.lastError ?? "", /ENOENT|not found|spawn/i);
  const firstAttempt = failed?.lastAttemptAt;

  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    registry.reconnect(missing, { workspaceDir: process.cwd() }),
    /ENOENT|not found|spawn/i
  );
  const retried = registry.getStatuses([missing], process.cwd())[0];
  assert.equal(retried?.state, "error");
  assert.notEqual(retried?.lastAttemptAt, firstAttempt);
});

test("redacts MCP credentials and URL query values from live errors", () => {
  const config = {
    ...server("safe-error"),
    stdio: { command: "node", args: [], cwd: "", env: { TOKEN: "stdio-secret" } },
    http: {
      url: "http://user:password@127.0.0.1:9123/mcp?token=query-secret",
      headers: { Authorization: "Bearer header-secret" }
    }
  };
  const safe = redactMcpError(
    `Failed http://user:password@127.0.0.1:9123/mcp?token=query-secret Bearer header-secret stdio-secret`,
    config
  );
  assert.equal(safe.includes("password"), false);
  assert.equal(safe.includes("query-secret"), false);
  assert.equal(safe.includes("header-secret"), false);
  assert.equal(safe.includes("stdio-secret"), false);
  assert.match(safe, /REDACTED|redacted/);
});

test("a small MCP result is passed through untouched", () => {
  const content = [{ type: "text" as const, text: "pong" }];
  assert.equal(capMcpToolContent(content), content);
});

test("an oversized MCP result is capped to the shared tool-output budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "mom-mcp-cap-"));
  const payload = `${"line of output\n".repeat(400_000)}`;

  const capped = capMcpToolContent([{ type: "text", text: payload }], { spillDir: dir });
  const text = capped.map((part) => (part.type === "text" ? part.text : "")).join("\n");

  assert.ok(
    Buffer.byteLength(text, "utf-8") < DEFAULT_MAX_BYTES * 2,
    `expected the capped result to fit the budget, got ${Buffer.byteLength(text, "utf-8")} bytes`
  );
  assert.match(text, /MCP output truncated from/);
  // The full payload stays reachable, exactly like bash's compressed output.
  const spilled = /Full output: (.+?)\]/.exec(text)?.[1];
  assert.ok(spilled, "expected a full-output path in the truncation note");
  assert.equal(readFileSync(spilled, "utf8"), payload);
  rmSync(dir, { recursive: true, force: true });
});

test("a single-line MCP payload still yields content, not just the truncation note", () => {
  // Minified JSON is one line, and `truncateHead` refuses to split a line —
  // without a byte-level fallback the model would receive nothing at all.
  const capped = capMcpToolContent([{ type: "text", text: `{"a":"${"x".repeat(2_000_000)}"}` }]);
  const body = capped.filter((part) => part.type === "text").slice(0, -1)
    .map((part) => (part.type === "text" ? part.text : "")).join("");

  assert.ok(body.length > 1000, "expected the head of the payload to survive");
  assert.ok(body.startsWith('{"a":"xxx'));
});

test("the MCP budget is shared across parts, and image parts survive capping", () => {
  const parts = [
    ...Array.from({ length: 50 }, () => ({ type: "text" as const, text: "Z".repeat(20_000) })),
    { type: "image" as const, data: "AAAA", mimeType: "image/png" }
  ];

  const capped = capMcpToolContent(parts);
  const textBytes = capped.reduce(
    (sum, part) => (part.type === "text" ? sum + Buffer.byteLength(part.text, "utf-8") : sum),
    0
  );

  assert.ok(textBytes < DEFAULT_MAX_BYTES * 2, `shared budget exceeded: ${textBytes} bytes`);
  assert.ok(capped.some((part) => part.type === "image"), "image content must not be dropped");
});

test("a real MCP server's oversized payload is capped on the way into the context", async (t) => {
  // The unit tests above prove the cap; this proves it is actually wired into
  // the tool's execute path, which is where a fix like this silently misses.
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const workspaceDir = mkdtempSync(join(tmpdir(), "mom-mcp-flood-"));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));

  // The spill lands under `workspaceDir`, but the fixture process must run
  // where the MCP SDK resolves, so the two are set independently here.
  const tools = await registry.getTools(
    [{ ...server("flooder"), stdio: { ...server("flooder").stdio, cwd: process.cwd() } }],
    { workspaceDir }
  );
  const text = await invoke(tool(tools, "flood"));

  assert.ok(
    Buffer.byteLength(text, "utf-8") < DEFAULT_MAX_BYTES * 2,
    `an MCP result reached the context at ${Buffer.byteLength(text, "utf-8")} bytes`
  );
  assert.match(text, /MCP output truncated from/);
  assert.match(text, /flooded line of output/);
});


test("MCP deadline aborts and settles a transport that ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | undefined;
  let requestOptions: any;
  const client = { callTool: async (_name: string, _args: unknown, options: any) => {
    requestOptions = options;
    requestSignal = options.signal;
    return new Promise<never>(() => {});
  } };
  const pending = callMcpToolWithTimeout(client as any, "hang", {});
  const rejected = assert.rejects(pending, /timed out after 120 seconds/);
  t.mock.timers.tick(MCP_EXECUTION_TIMEOUT_MS - 1);
  assert.equal(requestSignal?.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(requestSignal?.aborted, true);
  assert.equal(requestOptions.timeoutMs, 120_000);
});

test("MCP user cancellation settles an uncooperative transport immediately", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const client = { callTool: async (_name: string, _args: unknown, options: any) => {
    requestSignal = options.signal;
    return new Promise<never>(() => {});
  } };
  const pending = callMcpToolWithTimeout(client as any, "hang", {}, controller.signal);
  const rejected = assert.rejects(pending, /Stopped by user/);
  controller.abort(new Error("Stopped by user"));
  await rejected;
  assert.equal(requestSignal?.aborted, true);
  let called = false;
  await assert.rejects(callMcpToolWithTimeout({ callTool: async () => { called = true; } } as any, "never-start", {}, controller.signal), /Stopped by user/);
  assert.equal(called, false);
});

test("MCP completed requests remove their deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | undefined;
  const client = { callTool: async (_name: string, _args: unknown, options: any) => {
    requestSignal = options.signal;
    return { content: [{ type: "text", text: "done" }] };
  } };
  await callMcpToolWithTimeout(client as any, "done", {});
  t.mock.timers.tick(MCP_EXECUTION_TIMEOUT_MS);
  assert.equal(requestSignal?.aborted, false);
});


test("registered remote MCP tools enforce the deadline through mcpInvoke and recover for the next call", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const tools = await registry.getTools([{ ...server("deadline"), timeoutMs: 5_000 }], { workspaceDir: process.cwd() });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const invokeTool = createMcpInvokeTool({ getLoadedMcpTools: () => tools });
  const pending = invokeTool.execute("hang-call", {
    action: "call", serverId: "deadline", toolName: "hang", arguments: {}
  });
  const rejected = assert.rejects(pending, /timed out after 5 seconds/);
  t.mock.timers.tick(5_000);
  await rejected;
  t.mock.timers.reset();
  assert.equal(await invoke(tool(tools, "ping")), "pong");
});

test("text, image, embedded resources, links and audio convert into model content", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const tools = await registry.getTools([server("rich")], { workspaceDir: process.cwd() });

  const result = await tool(tools, "rich").execute("rich-call", {}, new AbortController().signal);
  const parts = result.content as Array<{ type: string; text?: string; mimeType?: string }>;
  const texts = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const images = parts.filter((part) => part.type === "image");

  assert.match(texts, /hello text/);
  assert.match(texts, /embedded text body/);
  assert.ok(texts.includes("linked doc") && texts.includes("linked.txt"), "the resource link reaches the model");
  assert.equal(parts.some((part) => part.type === "audio"), false, "audio is not handed over as a media part");
  assert.equal(images.length, 2, "the image block and the embedded image resource both survive");
  assert.ok(images.every((part) => part.mimeType === "image/png"));
});

test("a structuredContent-only result reaches the model as JSON", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const tools = await registry.getTools([server("structured")], { workspaceDir: process.cwd() });

  const text = await invoke(tool(tools, "structured"));
  assert.match(text, /"answer": 42/);
});

test("text content with a mirrored structuredContent keeps the text", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const tools = await registry.getTools([server("mixed")], { workspaceDir: process.cwd() });

  const text = await invoke(tool(tools, "mixed"));
  assert.match(text, /visible text/);
});

test("a tool-reported error is thrown instead of returned as a successful result", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const tools = await registry.getTools([server("boom")], { workspaceDir: process.cwd() });

  await assert.rejects(invoke(tool(tools, "boom")), /tool blew up/);
});

test("server annotations enter the shared permission classification, and omission stays undeclared", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const tools = await registry.getTools([server("annot")], { workspaceDir: process.cwd() });

  const readonly = (tool(tools, "readonly_tool") as { classification?: { thirdPartyHint?: string } }).classification;
  const plain = (tool(tools, "plain_tool") as { classification?: { thirdPartyHint?: string } }).classification;

  assert.equal(readonly?.thirdPartyHint, "read_only");
  assert.equal(plain?.thirdPartyHint, "undeclared", "a missing annotation must never become read_only");
});

test("an HTTP MCP server connects, lists and calls with the configured headers", async (t) => {
  const seenAuthorization: string[] = [];
  const remote = new SdkMcpServer({ name: "molibot-http-fixture", version: "1.0.0" });
  remote.registerTool("whoami", { description: "echo the connection" }, async () => ({
    content: [{ type: "text", text: "http-ok" }]
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true
  });
  await remote.connect(transport);
  const http = createServer(async (req, res) => {
    seenAuthorization.push(String(req.headers.authorization ?? ""));
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await transport.close().catch(() => undefined);
    await remote.close().catch(() => undefined);
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  const address = http.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const config: McpServerConfig = {
    ...server("remote"),
    transport: "http",
    http: { url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: "Bearer http-secret" } }
  };

  const tools = await registry.getTools([config], { workspaceDir: process.cwd() });
  assert.equal(registry.getStatuses([config], process.cwd())[0]?.state, "connected");
  assert.equal(await invoke(tool(tools, "whoami")), "http-ok");
  assert.ok(
    seenAuthorization.length > 0 && seenAuthorization.every((value) => value === "Bearer http-secret"),
    "the configured Authorization header must reach every HTTP request"
  );
});

test("Pi discovers every tool across cursor pages and reconnect preserves scoped invocation", async (t) => {
  const registry = new McpToolRegistry();
  t.after(() => registry.closeAll());
  const config = server("pages");
  config.stdio.args = ["--input-type=module", "-e", `
    import { Server } from '@modelcontextprotocol/sdk/server/index.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
    const server = new Server({name:'paged-fixture',version:'1'}, {capabilities:{tools:{}}});
    server.setRequestHandler(ListToolsRequestSchema, async request => ({
      tools: [{name: request.params?.cursor === 'second' ? 'last' : 'first', inputSchema:{type:'object',properties:{}}}],
      ...(request.params?.cursor ? {} : {nextCursor:'second'})
    }));
    server.setRequestHandler(CallToolRequestSchema, async request => ({content:[{type:'text',text:'called '+request.params.name}]}));
    await server.connect(new StdioServerTransport());
  `];
  const tools = await registry.getTools([config], { workspaceDir: process.cwd() });
  assert.deepEqual(tools.map(item => item.name).sort(), ["mcp__pages__first", "mcp__pages__last"]);
  assert.equal(await invoke(tool(tools, "first")), "called first");
  assert.equal(await invoke(tool(tools, "last")), "called last");
  await registry.closeAll();
  assert.equal(registry.getStatuses([config], process.cwd())[0].state, "disconnected");
  const reloaded = await registry.getTools([config], { workspaceDir: process.cwd() });
  assert.equal(await invoke(tool(reloaded, "last")), "called last");
  assert.deepEqual(await registry.getTools([], { workspaceDir: process.cwd() }), []);
});
