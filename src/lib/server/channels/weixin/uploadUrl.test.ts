import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWeixinAccountId, saveWeixinAccount } from "#weixin-agent-sdk/src/auth/accounts.js";
import { sendWeixinFile } from "./outbound.js";

for (const extension of ["mp3", "png"]) {
  for (const mode of ["full", "both", "param", "missing", "rejected", "network"] as const) {
    test(`Weixin ${extension} upload handles ${mode} upload address`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "weixin-upload-test-"));
      const previousState = process.env.OPENCLAW_STATE_DIR;
      const originalFetch = globalThis.fetch;
      const originalWarn = console.warn;
      const diagnostics: string[] = [];
      console.warn = (line) => { diagnostics.push(String(line)); };
      process.env.OPENCLAW_STATE_DIR = dir;
      registerWeixinAccountId("test-account");
      saveWeixinAccount("test-account", { token: "test-token", baseUrl: "https://api.example.test" });
      const filePath = join(dir, `reply.${extension}`);
      writeFileSync(filePath, extension === "mp3" ? Buffer.from("ID3-test-audio") : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
      const fullUrl = "https://upload.example.test/signed-upload?signature=a%2Bb&region=1";
      let uploads = 0;
      const sent: Array<{ msg: { item_list: Array<{ type: number; file_item?: { file_name: string; media: { encrypt_query_param: string } }; image_item?: { media: { encrypt_query_param: string } } }> } }> = [];
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/ilink/bot/getuploadurl")) {
          assert.equal(JSON.parse(String(init?.body)).media_type, extension === "mp3" ? 3 : 1);
          return Response.json({
            ...(mode === "full" || mode === "both" || mode === "rejected" || mode === "network" ? { upload_full_url: fullUrl } : {}),
            ...(mode === "param" || mode === "both" ? { upload_param: "upload-param" } : {})
          });
        }
        if (url === fullUrl || url.startsWith("https://cdn.example.test/upload?")) {
          assert.equal(mode === "param" ? new URL(url).searchParams.get("encrypted_query_param") : url, mode === "param" ? "upload-param" : fullUrl);
          assert.equal(init?.method, "POST");
          assert.ok(init?.body instanceof Uint8Array);
          assert.equal(init.body.length % 16, 0);
          uploads++;
          if (mode === "network") throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }) });
          if (mode === "rejected") return new Response("upload denied", { status: 403 });
          return new Response("", { headers: { "x-encrypted-param": "download-param" } });
        }
        if (url.endsWith("/ilink/bot/sendmessage")) {
          sent.push(JSON.parse(String(init?.body)));
          return Response.json({ ret: 0 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      };
      try {
        const send = () => sendWeixinFile({ filePath, toUserId: "test-user", contextToken: "test-context", cdnBaseUrl: "https://cdn.example.test" });
        if (mode === "missing") {
          await assert.rejects(send, /no upload URL/);
          assert.equal(uploads, 0);
          assert.equal(sent.length, 0);
        } else if (mode === "network") {
          await assert.rejects(send, /ECONNREFUSED/);
          assert.equal(uploads, extension === "png" ? 3 : 1);
          assert.equal(sent.length, 0);
          if (extension === "mp3") {
            const log = diagnostics.find((line) => line.includes("cdn_upload_failed"));
            assert.ok(log, "network failure must be recorded in the channel log");
            for (const field of ["ECONNREFUSED", "errorDetails", "elapsedMs", "runtime", "diagnosticVersion", "fileKey", "stage"]) {
              assert.ok(log.includes(field), `missing diagnostic ${field}`);
            }
          }
        } else if (mode === "rejected") {
          await assert.rejects(send, /(?:CDN upload failed 403|CDN upload client error 403)/);
          assert.equal(uploads, 1);
          assert.equal(sent.length, 0);
        } else {
          assert.equal(await send(), extension === "mp3" ? "file" : "image");
          assert.equal(uploads, 1);
          assert.equal(sent.length, 1);
          const item = sent[0].msg.item_list[0];
          assert.equal(item.type, extension === "mp3" ? 4 : 2);
          assert.equal((item.file_item ?? item.image_item)?.media.encrypt_query_param, "download-param");
          if (extension === "mp3") assert.equal(item.file_item?.file_name, "reply.mp3");
        }
        const output = diagnostics.join("\n");
        for (const secret of ["test-token", "upload-param", "download-param", "a%2Bb"]) {
          assert.ok(!output.includes(secret), `diagnostic leaked ${secret}`);
        }
      } finally {
        console.warn = originalWarn;
        globalThis.fetch = originalFetch;
        if (previousState === undefined) delete process.env.OPENCLAW_STATE_DIR;
        else process.env.OPENCLAW_STATE_DIR = previousState;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

test("Weixin audio upload works with native fetch and an Undici 8 global dispatcher", async () => {
  const { createServer } = await import("node:http");
  const { Agent, getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
  const dir = mkdtempSync(join(tmpdir(), "weixin-dispatcher-test-"));
  const previousState = process.env.OPENCLAW_STATE_DIR;
  const originalFetch = globalThis.fetch;
  const originalDispatcher = getGlobalDispatcher();
  const agent = new Agent();
  let receivedBytes = 0;
  let receivedLength: string | undefined;
  const sent: unknown[] = [];
  const server = createServer(async (request, response) => {
    receivedLength = request.headers["content-length"];
    for await (const chunk of request) receivedBytes += chunk.length;
    response.writeHead(200, { "x-encrypted-param": "download-param" });
    response.end();
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    process.env.OPENCLAW_STATE_DIR = dir;
    registerWeixinAccountId("test-account");
    saveWeixinAccount("test-account", { token: "test-token", baseUrl: "https://api.example.test" });
    const filePath = join(dir, "reply.mp3");
    writeFileSync(filePath, Buffer.from("ID3-test-audio"));
    setGlobalDispatcher(agent);
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/ilink/bot/getuploadurl")) {
        return Response.json({ upload_full_url: `http://127.0.0.1:${address.port}/upload` });
      }
      if (String(input).endsWith("/ilink/bot/sendmessage")) {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ ret: 0 });
      }
      return originalFetch(input, init);
    };
    assert.equal(await sendWeixinFile({ filePath, toUserId: "test-user", contextToken: "test-context" }), "file");
    assert.equal(receivedBytes, 16);
    assert.equal(receivedLength, "16");
    assert.deepEqual(sent.map((value: any) => value.msg.item_list[0].file_item.file_name), ["reply.mp3"]);
  } finally {
    globalThis.fetch = originalFetch;
    setGlobalDispatcher(originalDispatcher);
    if (previousState === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previousState;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await agent.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
