import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage";
import { SessionStore } from "$lib/server/sessions/store";
import { getProjectStore } from "$lib/server/projects/store";
import { getOrCreateProjectRuntimeHandle } from "$lib/server/projects/runtimeCache";
import { MomRuntimeStore } from "$lib/server/agent/session/store";
import { RunnerPool } from "$lib/server/agent/core/runnerPool";
import type { RuntimeSettings } from "$lib/server/settings";
import type { MemoryGateway } from "$lib/server/memory/gateway";
import type { AiUsageTracker } from "$lib/server/usage/tracker";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker";
import type { HookManager } from "$lib/server/agent/hooks";
import { ProjectAwareRunnerPool } from "./projectRunnerRouter";

test("Project-bound channel scopes share the project runtime with the Desktop router", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-project-router-"));
  const original = {
    projectsDir: storagePaths.projectsDir,
    settingsDbFile: storagePaths.settingsDbFile
  };

  try {
    storagePaths.projectsDir = path.join(root, "projects");
    storagePaths.settingsDbFile = path.join(root, "db", "settings.sqlite");

    const projectRoot = path.join(root, "workspace-repo");
    mkdirSync(projectRoot, { recursive: true });
    const project = getProjectStore().create({ name: "Router Test", rootPath: projectRoot });
    getProjectStore().setChannelBinding("feishu", "feishu-test", "oc_bound", project.id);

    const poolDeps = [
      () => ({}) as RuntimeSettings,
      (patch: Partial<RuntimeSettings>) => patch as RuntimeSettings,
      {} as AiUsageTracker,
      {} as ModelErrorTracker,
      {} as MemoryGateway,
      {} as HookManager
    ] as const;
    const botStore = new MomRuntimeStore(path.join(root, "bot-workspace"));
    const botPool = new RunnerPool("feishu", botStore, ...poolDeps);
    const sessions = new SessionStore();
    const router = new ProjectAwareRunnerPool(botPool, {
      channel: "feishu",
      instanceId: "feishu-test",
      sessions,
      botStore,
      getSettings: poolDeps[0],
      updateSettings: poolDeps[1],
      usageTracker: poolDeps[2],
      modelErrorTracker: poolDeps[3],
      memory: poolDeps[4],
      hookManager: poolDeps[5]
    });

    // Bound scope routes to the project runtime and materializes a project conversation.
    const target = router.resolveTarget("oc_bound", "default");
    assert.equal(target.project?.id, project.id);
    assert.equal(target.conversationKey, "bot:feishu-test:chat:oc_bound:default");
    assert.equal(target.chatId, target.conversationKey);
    assert.ok(target.conversationId);
    assert.equal(target.sessionId, target.conversationId);
    assert.equal(
      target.store.getWorkspaceDir(),
      path.join(storagePaths.projectsDir, project.id, "runtime")
    );
    assert.ok(
      existsSync(path.join(storagePaths.projectsDir, project.id, "sessions", `${target.conversationId}.json`))
    );

    // The mapping is stable across turns: same conversation, same runner keys.
    const again = router.resolveTarget("oc_bound", "default");
    assert.equal(again.conversationId, target.conversationId);

    // Desktop resolves the exact same pool through the shared runtime cache;
    // identical pool + identical (chatId, sessionId) keys means both surfaces
    // drive the same MomRunner instance (= same agent context).
    const desktopHandle = getOrCreateProjectRuntimeHandle(project.id, () => {
      throw new Error("cache miss: desktop built a second pool for the same project");
    });
    assert.equal(desktopHandle.pool, target.pool);
    assert.equal(desktopHandle.store, target.store);

    // Desktop can open the channel-originated conversation by id despite its
    // own (different) web externalUserId.
    const reopened = sessions.getOrCreateConversation(
      "web",
      "web:personal:web-anonymous",
      target.conversationId ?? undefined,
      { projectId: project.id }
    );
    assert.equal(reopened.id, target.conversationId);
    assert.equal(reopened.externalUserId, target.conversationKey);

    // Automation task sessions and unbound scopes stay on the bot pool.
    assert.equal(router.resolveTarget("oc_bound", "task-123").project, null);
    assert.equal(router.resolveTarget("oc_other", "default").project, null);
    assert.equal(router.resolveTarget("oc_other", "default").pool, botPool);
  } finally {
    storagePaths.projectsDir = original.projectsDir;
    storagePaths.settingsDbFile = original.settingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
