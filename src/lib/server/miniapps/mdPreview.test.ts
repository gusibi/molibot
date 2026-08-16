import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import createMdPreview from "./builtin/md-preview/server/index.mjs";
import { readMiniAppManifest } from "$lib/server/miniapps/manifest.js";
import { resetMolibotVersionCache } from "$lib/server/miniapps/hostVersion.js";

/**
 * MD Preview server suite.
 *
 * The app's one contract is that upload mutates the *mapping*, never the
 * document - these tests hold that line from every direction: the stored
 * markdown before and after upload, the content-addressed key, and the
 * reuse of a prior upload across documents.
 */

// The manifest declares engines ">=2.9.26" (fileParams staging); pin the host
// version so validation is about the manifest, not the repo's current version.
process.env.MOLIBOT_VERSION = "2.9.26";
resetMolibotVersionCache();

function request(path: string, options: { method?: string; body?: unknown; query?: Record<string, string[]> } = {}) {
  return {
    method: options.method ?? "GET",
    path,
    query: options.query ?? {},
    body: options.body,
    signal: new AbortController().signal
  };
}

function contextOver(dataDir: string) {
  return {
    appId: "md-preview",
    dataDir,
    logger: { info() {}, warn() {}, error() {} },
    ai: {}
  };
}

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "md-preview-test-"));
}

/** One PNG-shaped staged file with known bytes, under `incoming/`. */
function stageFile(dataDir: string, name: string, bytes: Uint8Array): string {
  const dir = join(dataDir, "incoming");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const relative = `incoming/${name}`;
  writeFileSync(join(dataDir, relative), bytes);
  return relative;
}

const MARKDOWN = [
  "# 标题",
  "",
  "![本地图](assets/shot.png)",
  "",
  "![远程图](https://example.com/remote.png)",
  "",
  "![缺文件](assets/missing.jpg)"
].join("\n");

async function withApp<T>(run: (app: Awaited<ReturnType<typeof createMdPreview>>, dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = makeDataDir();
  const app = await createMdPreview(contextOver(dataDir));
  try {
    return await run(app, dataDir);
  } finally {
    app.dispose();
  }
}

/** Opens MARKDOWN through the tool, exactly as the host would hand it over after staging. */
async function openFixture(app: Awaited<ReturnType<typeof createMdPreview>>, dataDir: string) {
  const markdownPath = stageFile(dataDir, "doc.md", Buffer.from(MARKDOWN, "utf8"));
  const imagePath = stageFile(dataDir, "shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  return app.tools.preview(
    { markdownPath, images: [imagePath] },
    {
      stagedFiles: {
        markdownPath: [{ kind: "file", name: "doc.md", mime: "text/markdown", path: markdownPath, bytes: MARKDOWN.length }],
        images: [{ kind: "image", name: "shot.png", mime: "image/png", path: imagePath, bytes: 7 }]
      }
    }
  );
}

test("the manifest validates and stages files through fileParams", () => {
  const result = readMiniAppManifest(
    join(dirname(fileURLToPath(import.meta.url)), "builtin", "md-preview"),
    "md-preview"
  );
  assert.equal(result.ok, true, result.ok === false ? result.error : "");
  if (!result.ok) return;
  const tool = result.value.manifest.tools.find((entry) => entry.name === "preview");
  assert.ok(tool, "preview tool declared");
  assert.deepEqual(tool?.fileParams?.map((param) => param.param), ["markdownPath", "images"]);
  assert.equal(tool?.fileParams?.[1].multiple, true);
});

test("preview creates a document, matches staged images by basename, reports unresolved refs", async () => {
  await withApp(async (app, dataDir) => {
    const result = await openFixture(app, dataDir);
    assert.match(result.content[0].text, /Previewing "标题"/);
    assert.deepEqual(result.structuredContent?.unresolvedRefs, ["assets/missing.jpg"]);
    assert.match(result.card?.link ?? "", /^molibot:\/\/miniapp\/md-preview\/doc\//);
  });
});

test("assets resolve for panel + preview: local data URI, remote flag, unresolved absent", async () => {
  await withApp(async (app, dataDir) => {
    const tool = await openFixture(app, dataDir);
    const docId = tool.structuredContent.documentId as string;

    const detail = await app.handleHttp(request(`/documents/${docId}`));
    const assets = detail.body.assets;
    assert.equal(assets.length, 2); // staged local + remote; unresolved never stored
    const local = assets.find((asset: { ref: string }) => asset.ref === "assets/shot.png");
    const remote = assets.find((asset: { ref: string }) => asset.ref === "https://example.com/remote.png");
    assert.equal(local.remote, false);
    assert.equal(remote.remote, true);

    const data = await app.handleHttp(request(`/documents/${docId}/assets/${local.id}`));
    assert.match(data.body.dataUri, /^data:image\/png;base64,/);
  });
});

test("upload mutates the mapping, never the stored markdown; the key is content-addressed", async (t) => {
  await withApp(async (app, dataDir) => {
    const tool = await openFixture(app, dataDir);
    const docId = tool.structuredContent.documentId as string;
    await app.handleHttp(request("/settings", {
      method: "PUT",
      body: {
        accountId: "acct", bucket: "bucket", accessKeyId: "key-id",
        secretAccessKey: "secret", publicBaseUrl: "https://img.example.com", keyPrefix: "wechat"
      }
    }));

    const seen: Array<{ url: string; auth: string; body: Uint8Array }> = [];
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        auth: String((init?.headers as Record<string, string>)?.authorization ?? ""),
        body: init?.body as Uint8Array
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const upload = await app.handleHttp(request(`/documents/${docId}/upload`, { method: "POST", body: {} }));
    assert.equal(upload.body.failures.length, 0);
    assert.equal(seen.length, 1);

    // Object key = prefix/<sha256>.png, URL through the public base.
    const crypto = await import("node:crypto");
    const sha = crypto.createHash("sha256").update(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])).digest("hex");
    assert.equal(seen[0].url, `https://acct.r2.cloudflarestorage.com/bucket/wechat/${sha}.png`);
    assert.equal(upload.body.uploaded[0].url, `https://img.example.com/wechat/${sha}.png`);
    // SigV4 shape: deterministic credential scope + signed headers. The scope
    // carries the configured region (R2 uses "auto"), never a placeholder.
    assert.match(seen[0].auth, /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);

    // The mapping is in the DB and the markdown text is untouched by it.
    const detail = await app.handleHttp(request(`/documents/${docId}`));
    const local = detail.body.assets.find((asset: { ref: string }) => asset.ref === "assets/shot.png");
    assert.equal(local.uploadedUrl, `https://img.example.com/wechat/${sha}.png`);
    assert.match(detail.body.document.markdown, /!\[本地图\]\(assets\/shot\.png\)/);
  });
});

test("a re-opened document reuses a prior upload without touching the network", async (t) => {
  await withApp(async (app, dataDir) => {
    const tool = await openFixture(app, dataDir);
    const docId = tool.structuredContent.documentId as string;
    await app.handleHttp(request("/settings", {
      method: "PUT",
      body: { accountId: "acct", bucket: "bucket", accessKeyId: "key-id", secretAccessKey: "secret" }
    }));

    let calls = 0;
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await app.handleHttp(request(`/documents/${docId}/upload`, { method: "POST", body: {} }));
    assert.equal(calls, 1);

    // Same image opened through a second document: content-addressed reuse.
    const secondPath = stageFile(dataDir, "shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const second = await app.tools.preview(
      { markdownPath: stageFile(dataDir, "doc2.md", Buffer.from("# 二\n\n![copy](x/shot.png)", "utf8")), images: [secondPath] },
      { stagedFiles: { images: [{ kind: "image", name: "shot.png", mime: "image/png", path: secondPath, bytes: 7 }] } }
    );
    const detail = await app.handleHttp(request(`/documents/${second.structuredContent.documentId}`));
    const reused = detail.body.assets.find((asset: { ref: string }) => asset.ref === "x/shot.png");
    assert.ok(reused.uploadedUrl, "prior upload mapping carried over");
    const upload = await app.handleHttp(request(`/documents/${second.structuredContent.documentId}/upload`, { method: "POST", body: {} }));
    assert.equal(upload.body.uploaded.length, 0); // nothing pending: no second PUT
    assert.equal(calls, 1);
  });
});

test("settings round-trip masks the secret and an empty secret patch keeps the credential", async () => {
  await withApp(async (app) => {
    await app.handleHttp(request("/settings", {
      method: "PUT",
      body: { accountId: "acct", bucket: "b", accessKeyId: "k", secretAccessKey: "s3cret", theme: "vercel" }
    }));
    const saved = await app.handleHttp(request("/settings"));
    assert.equal(saved.body.settings.secretAccessKey, undefined, "secret never crosses back to the panel");
    assert.equal(saved.body.settings.secretSet, true);
    assert.equal(saved.body.settings.accountId, "acct");
    assert.equal(saved.body.settings.theme, "vercel");

    // The panel never sends the secret unless the operator typed one; a patch
    // without the key keeps the credential, and the other fields still round
    // trip. (An explicit empty string WOULD clear it - that is the API's only
    // clear path, and the UI deliberately does not offer it accidentally.)
    await app.handleHttp(request("/settings", {
      method: "PUT",
      body: { accountId: "acct", bucket: "b", accessKeyId: "k", theme: "momo-paper" }
    }));
    const kept = await app.handleHttp(request("/settings"));
    assert.equal(kept.body.settings.secretSet, true, "empty patch does not clear the credential");
    assert.equal(kept.body.settings.theme, "momo-paper");
  });
});

test("proxy-image refuses anything that is not an http(s) URL", async () => {
  await withApp(async (app) => {
    const rejected = await app.handleHttp(request("/proxy-image", { query: { url: ["file:///etc/passwd"] } }));
    assert.equal(rejected.status, 400);
  });
});
