import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageToolFileParams } from "$lib/server/miniapps/toolFileStaging.js";
import type { MiniAppToolFileParamManifest } from "$lib/server/miniapps/types.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "molibot-tool-staging-"));
  const workspaceDir = join(root, "data", "moli-t", "demo", "scratch");
  const dataRoot = join(root, "miniapp-data");
  const outside = mkdtempSync(join(tmpdir(), "molibot-tool-staging-out-"));
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  return { root, workspaceDir, dataRoot, outside, cleanup: () => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  } };
}

function fileParam(overrides: Partial<MiniAppToolFileParamManifest>): MiniAppToolFileParamManifest {
  return { param: "docPath", accepts: ["file"], maxBytes: 1024 * 1024, ...overrides };
}

test("staging rewrites a relative path to the dataDir-relative staged path", () => {
  const env = setup();
  try {
    writeFileSync(join(env.workspaceDir, "draft.md"), "# hello");
    const result = stageToolFileParams({
      input: { docPath: "draft.md", template: "momo" },
      fileParams: [fileParam({})],
      staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
      dataRoot: env.dataRoot,
      appId: "docrender"
    });

    assert.match(result.input.docPath as string, /^incoming\/[0-9a-f-]+\.md$/);
    assert.equal(result.input.template, "momo");
    const staged = result.stagedFiles.docPath![0];
    assert.equal(staged.name, "draft.md");
    assert.equal(staged.kind, "file");
    assert.equal(readFileSync(join(env.dataRoot, "docrender", staged.path), "utf8"), "# hello");
  } finally {
    env.cleanup();
  }
});

test("staging a multiple param rewrites an array and groups metadata per param", () => {
  const env = setup();
  try {
    writeFileSync(join(env.workspaceDir, "a.png"), "png");
    writeFileSync(join(env.workspaceDir, "b.png"), "png2");
    const result = stageToolFileParams({
      input: { imagePaths: ["a.png", "b.png"] },
      fileParams: [fileParam({ param: "imagePaths", accepts: ["image"], multiple: true })],
      staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
      dataRoot: env.dataRoot,
      appId: "docrender"
    });

    const paths = result.input.imagePaths as string[];
    assert.equal(paths.length, 2);
    for (const path of paths) assert.match(path, /^incoming\/[0-9a-f-]+\.png$/);
    assert.deepEqual(result.stagedFiles.imagePaths!.map((resource) => resource.name), ["a.png", "b.png"]);
    assert.ok(result.stagedFiles.imagePaths!.every((resource) => resource.kind === "image"));
  } finally {
    env.cleanup();
  }
});

test("paths outside the agent's allowed roots are refused before any copy", () => {
  const env = setup();
  try {
    writeFileSync(join(env.outside, "secret.txt"), "nope");
    assert.throws(
      () => stageToolFileParams({
        input: { docPath: join(env.outside, "secret.txt") },
        fileParams: [fileParam({})],
        staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
        dataRoot: env.dataRoot,
        appId: "docrender"
      }),
      /outside allowed workspace roots/
    );
    // Guard ran before staging: nothing landed in the data directory.
    assert.equal(existsSync(join(env.dataRoot, "docrender", "incoming")), false);
  } finally {
    env.cleanup();
  }
});

test("a home prefix expands against the real home, not the cwd", () => {
  const env = setup();
  try {
    // Correct behaviour: `~/x` expands to <home>/x, which the guard rejects
    // because home is not an allowed root. The pitfall-6 failure mode resolved
    // it to <cwd>/~/x - inside cwd - and would have passed the guard.
    assert.throws(
      () => stageToolFileParams({
        input: { docPath: "~/molibot-staging-probe.md" },
        fileParams: [fileParam({})],
        staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
        dataRoot: env.dataRoot,
        appId: "docrender"
      }),
      /outside allowed workspace roots/
    );
    assert.notEqual(homedir(), env.workspaceDir);
  } finally {
    env.cleanup();
  }
});

test("kind and size are checked against the declaration before staging", () => {
  const env = setup();
  try {
    writeFileSync(join(env.workspaceDir, "pic.png"), "image");
    writeFileSync(join(env.workspaceDir, "big.bin"), "x".repeat(2048));

    assert.throws(
      () => stageToolFileParams({
        input: { docPath: "pic.png" },
        fileParams: [fileParam({ accepts: ["file"] })],
        staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
        dataRoot: env.dataRoot,
        appId: "docrender"
      }),
      /only accepts file files, but "pic\.png" is an image/
    );

    assert.throws(
      () => stageToolFileParams({
        input: { docPath: "big.bin" },
        fileParams: [fileParam({ maxBytes: 1024 })],
        staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
        dataRoot: env.dataRoot,
        appId: "docrender"
      }),
      /exceeds the 0 MiB limit/
    );
  } finally {
    env.cleanup();
  }
});

test("a missing file and an omitted optional param behave differently", () => {
  const env = setup();
  try {
    assert.throws(
      () => stageToolFileParams({
        input: { docPath: "nope.md" },
        fileParams: [fileParam({})],
        staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
        dataRoot: env.dataRoot,
        appId: "docrender"
      }),
      /was not found/
    );

    const result = stageToolFileParams({
      input: { template: "momo" },
      fileParams: [fileParam({})],
      staging: { cwd: env.workspaceDir, workspaceDir: env.workspaceDir },
      dataRoot: env.dataRoot,
      appId: "docrender"
    });
    assert.deepEqual(result.input, { template: "momo" });
    assert.deepEqual(result.stagedFiles, {});
  } finally {
    env.cleanup();
  }
});
