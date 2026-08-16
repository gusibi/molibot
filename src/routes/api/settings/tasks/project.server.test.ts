import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("Project automation CRUD and manual trigger stay in the Project watched-event runtime", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-project-task-data-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "molibot-project-task-root-"));
  process.env.DATA_DIR = dataDir;
  process.env.MOLIBOT_DISABLE_LIVE_CHANNELS = "1";

  try {
    mkdirSync(projectRoot, { recursive: true });
    const [{ getProjectStore }, { getRuntime }, route] = await Promise.all([
      import("$lib/server/projects/store.js"),
      import("$lib/server/app/runtime.js"),
      import("./+server.js")
    ]);
    const project = getProjectStore().create({ name: "Work", rootPath: projectRoot });

    const create = await route.POST({
      request: new Request("http://localhost/api/settings/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          task: {
            kind: "project",
            channel: "project",
            projectId: project.id,
            text: "Summarize today's work",
            delivery: "agent",
            schedule: "0 18 * * *",
            timezone: "Asia/Shanghai",
            sessionMode: "fresh"
          }
        })
      })
    } as never);
    const created = await create.json() as { ok: boolean; created: string };
    assert.equal(created.ok, true);
    assert.equal(created.created.startsWith(join(dataDir, "projects", project.id, "events")), true);
    const persisted = JSON.parse(readFileSync(created.created, "utf8"));
    assert.deepEqual(persisted.target, { kind: "project", projectId: project.id });
    assert.equal(persisted.delivery, "agent");
    assert.equal(persisted.sessionMode, "fresh");

    const listedResponse = await route.GET({} as never);
    const listed = await listedResponse.json() as { items: Array<Record<string, unknown>> };
    const item = listed.items.find((entry) => entry.filePath === created.created);
    if (!item) throw new Error(`Project task not listed: ${JSON.stringify(listed)}`);
    assert.equal(item.channel, "project");
    assert.equal(item?.projectId, project.id);
    assert.equal(item?.projectName, "Work");

    const dispatched: unknown[] = [];
    const runtime = getRuntime();
    runtime.channelManagers.set("web", new Map([["default", {
      triggerProjectTask: async (event: unknown, filename: string) => { dispatched.push({ event, filename }); }
    } as any]]));
    const trigger = await route.POST({
      request: new Request("http://localhost/api/settings/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "trigger", filePaths: [created.created] })
      })
    } as never);
    assert.equal((await trigger.json() as { ok: boolean }).ok, true);
    assert.equal(dispatched.length, 1);
    assert.equal((dispatched[0] as { event: { target: { projectId: string } } }).event.target.projectId, project.id);

    const invalidMode = await route.POST({
      request: new Request("http://localhost/api/settings/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", filePath: created.created, patch: { sessionMode: "chat" } })
      })
    } as never);
    assert.equal(invalidMode.status, 400);

    const update = await route.POST({
      request: new Request("http://localhost/api/settings/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", filePath: created.created, patch: { schedule: "30 18 * * *" } })
      })
    } as never);
    assert.equal((await update.json() as { ok: boolean }).ok, true);
    assert.equal(JSON.parse(readFileSync(created.created, "utf8")).schedule, "30 18 * * *");

    const remove = await route.POST({
      request: new Request("http://localhost/api/settings/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", filePaths: [created.created] })
      })
    } as never);
    assert.equal((await remove.json() as { ok: boolean }).ok, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
