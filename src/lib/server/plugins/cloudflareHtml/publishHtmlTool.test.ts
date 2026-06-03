import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCloudflareHtmlPublishTool } from "$lib/server/plugins/cloudflareHtml/publishHtmlTool.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

function createSettings(): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    plugins: {
      ...defaultRuntimeSettings.plugins,
      cloudflareHtml: {
        ...defaultRuntimeSettings.plugins.cloudflareHtml,
        enabled: true,
        accessMode: "worker",
        workerBaseHost: "https://html.example.com",
        bucketName: "bucket",
        accountId: "account123",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        objectPrefix: "html/"
      }
    }
  };
}

test("publishHtml reads HTML from file path and uploads it", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-publish-html-"));
  const filePath = join(cwd, "report.html");
  const html = "<!doctype html><html><head><title>Report</title></head><body><h1>Hello</h1></body></html>";
  writeFileSync(filePath, html, "utf8");

  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody = "";

  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const tool = createCloudflareHtmlPublishTool({
      getSettings: createSettings,
      cwd,
      workspaceDir: cwd
    });

    const result = await tool.execute("tool-1", {
      filePath: "report.html",
      title: "Report"
    });

    assert.match(requestUrl, /^https:\/\/account123\.r2\.cloudflarestorage\.com\/bucket\/html\/[a-f0-9]{20}\.html$/);
    assert.equal(requestBody, html);
    assert.match((result.content[0] as any)?.text ?? "", /^Published HTML: https:\/\/html\.example\.com\/html\/[a-f0-9]{20}\.html$/);
    assert.equal((result.details as any)?.filePath, "report.html");
    assert.equal((result.details as any)?.title, "Report");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("publishHtml rejects files that are not complete HTML documents", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-publish-html-"));
  const filePath = join(cwd, "fragment.html");
  writeFileSync(filePath, "<div>partial</div>", "utf8");

  try {
    const tool = createCloudflareHtmlPublishTool({
      getSettings: createSettings,
      cwd,
      workspaceDir: cwd
    });

    await assert.rejects(
      tool.execute("tool-1", { filePath: "fragment.html" }),
      /requires a local HTML file containing a complete document/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
