import assert from "node:assert/strict";
import test from "node:test";
import { _createFeishuTestResponse } from "./test/+server.js";

async function readJson(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

test("createFeishuTestResponse returns 400 when credentials are missing", async () => {
  const response = await _createFeishuTestResponse({ appId: "cli_a" });

  assert.equal(response.status, 400);
  assert.deepEqual(await readJson(response), {
    ok: false,
    error: "appId and appSecret are required"
  });
});

test("createFeishuTestResponse returns SDK code and msg for Feishu API errors", async () => {
  const response = await _createFeishuTestResponse({
    appId: "cli_a",
    appSecret: "secret"
  }, () => ({
    request: async () => ({ code: 99991663, msg: "invalid app secret" })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    ok: false,
    appId: "cli_a",
    code: 99991663,
    msg: "invalid app secret",
    error: "invalid app secret"
  });
});

test("createFeishuTestResponse returns bot identity for successful probe", async () => {
  const response = await _createFeishuTestResponse({
    appId: "cli_a",
    appSecret: "secret"
  }, () => ({
    request: async () => ({
      code: 0,
      msg: "ok",
      data: { name: "Moli", open_id: "ou_bot" }
    })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    ok: true,
    appId: "cli_a",
    botName: "Moli",
    botOpenId: "ou_bot"
  });
});
