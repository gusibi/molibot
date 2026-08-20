import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { JsonRpcLineTransport } from "../src/jsonRpcLineTransport.js";
import { CodexAppServerWire } from "../src/providers/codex/wire.js";

test("CodexAppServerWire handles initialize, startThread, and runTurn successfully", async () => {
  const wireToApp = new PassThrough();
  const appToWire = new PassThrough();

  const wire = new CodexAppServerWire(appToWire, wireToApp, "never");
  wire.start();

  // Mock Codex app-server on the other end
  const mockServer = new JsonRpcLineTransport(wireToApp, appToWire);
  mockServer.onRequest(async (method, params) => {
    if (method === "initialize") {
      return { serverInfo: { name: "mock-codex" } };
    }
    if (method === "thread/start") {
      return { thread: { id: "th_123", ephemeral: true } };
    }
    if (method === "turn/start") {
      // Emit turn started and item completed notification asynchronously
      setImmediate(() => {
        mockServer.notify("turn/started", { threadId: "th_123", turn: { id: "turn_456" } });
        mockServer.notify("item/completed", {
          threadId: "th_123",
          turnId: "turn_456",
          item: {
            type: "agentMessage",
            phase: "final_answer",
            text: "Mock Codex result answer"
          }
        });
        mockServer.notify("turn/completed", {
          threadId: "th_123",
          turn: { id: "turn_456", status: "completed" }
        });
      });
      return { turn: { id: "turn_456" } };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
  mockServer.start();

  const signal = new AbortController().signal;
  await wire.initialize(signal);
  await wire.startThread(process.cwd(), signal);

  const result = await wire.runTurn(["Analyze this code"], signal);
  assert.equal(result.stopReason, "completed");
  assert.equal(result.output, "Mock Codex result answer");

  wire.close();
  mockServer.close();
});

test("CodexAppServerWire rejects interactive approval requests automatically in unattended mode", async () => {
  const wireToApp = new PassThrough();
  const appToWire = new PassThrough();

  const wire = new CodexAppServerWire(appToWire, wireToApp, "never");
  wire.start();

  const mockServer = new JsonRpcLineTransport(wireToApp, appToWire);
  mockServer.onRequest(async (method) => {
    if (method === "initialize") return { serverInfo: {} };
    if (method === "thread/start") return { thread: { id: "th_123", ephemeral: true } };
    if (method === "turn/start") {
      setImmediate(async () => {
        mockServer.notify("turn/started", { threadId: "th_123", turn: { id: "turn_456" } });

        // App server asks for approval
        const approvalResp = (await mockServer.request("item/commandExecution/requestApproval", {
          threadId: "th_123",
          turnId: "turn_456",
          availableDecisions: ["cancel", "decline"]
        })) as { decision: string };

        assert.equal(approvalResp.decision, "cancel");

        mockServer.notify("item/completed", {
          threadId: "th_123",
          turnId: "turn_456",
          item: {
            type: "commandExecution",
            status: "declined"
          }
        });
        mockServer.notify("item/completed", {
          threadId: "th_123",
          turnId: "turn_456",
          item: {
            type: "agentMessage",
            phase: "final_answer",
            text: "Declined execution"
          }
        });
        mockServer.notify("turn/completed", {
          threadId: "th_123",
          turn: { id: "turn_456", status: "completed" }
        });
      });
      return { turn: { id: "turn_456" } };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
  mockServer.start();

  const signal = new AbortController().signal;
  await wire.initialize(signal);
  await wire.startThread(process.cwd(), signal);

  const result = await wire.runTurn(["Run dangerous bash"], signal);
  assert.equal(result.stopReason, "completed");
  assert.equal(result.output, "Declined execution");

  const diag = wire.collectDiagnostic();
  assert.ok(diag?.includes("command execution") || diag?.includes("command approval"));

  wire.close();
  mockServer.close();
});
