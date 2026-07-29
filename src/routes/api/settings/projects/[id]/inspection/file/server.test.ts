import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage";
import { getProjectStore } from "$lib/server/projects/store";
import { GET } from "./+server";

test("raw Project file route returns media bytes instead of an HTML 404", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-project-file-route-"));
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  try {
    storagePaths.settingsDbFile = path.join(root, "db", "settings.sqlite");
    const projectRoot = path.join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(path.join(projectRoot, "preview.png"), bytes);
    const project = getProjectStore().create({ name: "Route Test", rootPath: projectRoot });

    const rawUrl = `http://localhost/api/settings/projects/${project.id}/inspection/file?path=preview.png&raw=true`;
    const response = await GET({
      params: { id: project.id },
      url: new URL(rawUrl),
      request: new Request(rawUrl)
    } as never);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);

    // A media element seeking into the file must get 206 with just that slice,
    // otherwise the WebView downloads the whole thing before it can play.
    const ranged = await GET({
      params: { id: project.id },
      url: new URL(rawUrl),
      request: new Request(rawUrl, { headers: { range: "bytes=2-5" } })
    } as never);

    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), `bytes 2-5/${bytes.length}`);
    assert.equal(ranged.headers.get("content-length"), "4");
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(2, 6));

    const unsatisfiable = await GET({
      params: { id: project.id },
      url: new URL(rawUrl),
      request: new Request(rawUrl, { headers: { range: `bytes=${bytes.length}-` } })
    } as never);
    assert.equal(unsatisfiable.status, 416);
  } finally {
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
