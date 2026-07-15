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

    const response = await GET({
      params: { id: project.id },
      url: new URL(`http://localhost/api/settings/projects/${project.id}/inspection/file?path=preview.png&raw=true`)
    } as never);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
