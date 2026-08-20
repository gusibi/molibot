import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { JsonRpcLineTransport } from "../src/jsonRpcLineTransport.js";

test("JsonRpcLineTransport sends requests and receives responses", async () => {
  const clientToTransport = new PassThrough();
  const transportToClient = new PassThrough();

  const transport = new JsonRpcLineTransport(clientToTransport, transportToClient);
  transport.onRequest(async (method, params) => {
    if (method === "ping") {
      return { message: `pong: ${params.text}` };
    }
    throw new Error(`Unknown method: ${method}`);
  });
  transport.start();

  // Peer client side
  const client = new JsonRpcLineTransport(transportToClient, clientToTransport);
  client.start();

  const response = (await client.request("ping", { text: "hello" })) as { message: string };
  assert.equal(response.message, "pong: hello");

  transport.close();
  client.close();
});

test("JsonRpcLineTransport sends notifications", async () => {
  const stream1 = new PassThrough();
  const stream2 = new PassThrough();

  const t1 = new JsonRpcLineTransport(stream1, stream2);
  const t2 = new JsonRpcLineTransport(stream2, stream1);

  const received = Promise.withResolvers<string>();
  t2.onNotification((method, params) => {
    if (method === "log") {
      received.resolve(String(params.msg));
    }
  });

  t1.start();
  t2.start();

  t1.notify("log", { msg: "info message" });

  const msg = await received.promise;
  assert.equal(msg, "info message");

  t1.close();
  t2.close();
});
