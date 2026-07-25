import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createFileSearchTools } from "$lib/server/agent/tools/fileSearch.js";

function hasBinary(...names: string[]): boolean {
  return names.some((name) => spawnSync("which", [name], { stdio: "ignore" }).status === 0);
}

async function withWorkspace(run: (workspace: string) => Promise<void> | void): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "molibot-file-search-"));
  mkdirSync(join(workspace, "sub"), { recursive: true });
  writeFileSync(join(workspace, "alpha.txt"), "hello needle here\nsecond line\n");
  writeFileSync(join(workspace, "sub", "beta.md"), "nothing to see\n");
  try {
    await run(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function textOf(result: AgentToolResult<any>): string {
  const first = result.content?.[0];
  if (first && typeof first === "object" && "text" in first && typeof first.text === "string") {
    return first.text;
  }
  return "";
}

test("registers grep, find and ls", async () => {
  await withWorkspace((workspace) => {
    const tools = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    assert.deepEqual(tools.map((tool) => tool.name), ["grep", "find", "ls"]);
  });
});

test("ls lists workspace entries", async () => {
  await withWorkspace(async (workspace) => {
    const [, , ls] = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    const output = textOf(await ls.execute("call-1", {}, undefined, undefined));
    assert.match(output, /alpha\.txt/);
    assert.match(output, /sub/);
  });
});

test("grep finds file contents", { skip: hasBinary("rg") ? false : "ripgrep not installed" }, async () => {
  await withWorkspace(async (workspace) => {
    const [grep] = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    const output = textOf(await grep.execute("call-2", { pattern: "needle" }, undefined, undefined));
    assert.match(output, /alpha\.txt/);
    assert.match(output, /needle/);
  });
});

test("find matches a glob", { skip: hasBinary("fd", "fdfind") ? false : "fd not installed" }, async () => {
  await withWorkspace(async (workspace) => {
    const [, find] = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    const output = textOf(await find.execute("call-3", { pattern: "*.md" }, undefined, undefined));
    assert.match(output, /beta\.md/);
  });
});

test("rejects a path outside the workspace roots", async () => {
  await withWorkspace(async (workspace) => {
    const [grep, find, ls] = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    for (const [name, tool] of [["grep", grep], ["find", find], ["ls", ls]] as const) {
      await assert.rejects(
        () => tool.execute("call-4", { pattern: "x", path: "/etc" }, undefined, undefined),
        /outside allowed workspace roots/,
        `${name} must not search outside the workspace`
      );
    }
  });
});

test("rejects a traversal escape from the workspace", async () => {
  await withWorkspace(async (workspace) => {
    const [, , ls] = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    await assert.rejects(
      () => ls.execute("call-5", { path: "../.." }, undefined, undefined),
      /outside allowed workspace roots/
    );
  });
});

test("memory paths stay reserved for the memory gateway", async () => {
  await withWorkspace(async (workspace) => {
    const [, , ls] = createFileSearchTools({ cwd: workspace, workspaceDir: workspace });
    await assert.rejects(
      () => ls.execute("call-6", { path: "memory" }, undefined, undefined),
      /memory gateway/
    );
  });
});
