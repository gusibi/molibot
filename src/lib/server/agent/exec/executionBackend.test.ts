import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HOST_BACKEND_ID,
  SANDBOX_BACKEND_ID,
  bindExecutionEnvironment,
  getExecutionBackend,
  setExecutionBackend,
  type CommandExecutionRequest,
  type CommandExecutionResult,
  type ExecutionBackend
} from "$lib/server/agent/exec/executionBackend.js";
import { defaultToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";

function scriptedBackend(overrides: Partial<ExecutionBackend> = {}): ExecutionBackend {
  const seen: Array<{ request: CommandExecutionRequest; workspaceDir: string }> = [];
  const base: ExecutionBackend = {
    capabilities: {
      id: "test-backend",
      displayName: "Test Backend",
      executionTarget: "host",
      supportsNetworkDomainRestrictions: false,
      supportsFilesystemRestrictions: false,
      supportsEnvInjection: false
    },
    checkAvailability: () => ({ supportedPlatform: true, dependenciesAvailable: true }),
    bindEnvironment: (bind) => ({
      backend: base.capabilities,
      workspaceDir: bind.workspaceDir,
      execute: async (request) => {
        seen.push({ request, workspaceDir: bind.workspaceDir });
        return {
          code: 0,
          stdout: `ran:${request.command}@${request.cwd}`,
          stderr: "",
          sandboxApplied: false
        } satisfies CommandExecutionResult;
      }
    })
  };
  return Object.assign(base, overrides, { _seen: seen }) as ExecutionBackend & { _seen: typeof seen };
}

function tempWorkspace(): { root: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-exec-backend-"));
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("plan mode binds an explicit no-execution environment, not a silent host fallback", async () => {
  const environment = bindExecutionEnvironment({
    executionTarget: "none",
    workspaceDir: "/ws",
    sandboxSettings: defaultToolSandboxSettings
  });
  await assert.rejects(
    environment.execute({ command: "echo hi", cwd: "/ws" }),
    /Plan mode is read-only/
  );
});

test("the shared entry owns execution: output, status and workspace identity flow through", async () => {
  const workspace = tempWorkspace();
  const backend = scriptedBackend();
  const previous = setExecutionBackend("host", backend);
  try {
    const environment = bindExecutionEnvironment({
      executionTarget: "host",
      workspaceDir: workspace.root,
      sandboxSettings: defaultToolSandboxSettings
    });
    const result = await environment.execute({ command: "echo hello", cwd: workspace.root });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^ran:echo hello@/);
    assert.equal(environment.workspaceDir, workspace.root);
    assert.equal(backend.capabilities.id, "test-backend");
  } finally {
    setExecutionBackend("host", previous);
    workspace.dispose();
  }
});

test("each attempt binds its own environment; concurrent attempts do not exchange configuration", async () => {
  const workspaceA = tempWorkspace();
  const workspaceB = tempWorkspace();
  const backend = scriptedBackend();
  const previous = setExecutionBackend("host", backend);
  try {
    const envA = bindExecutionEnvironment({ executionTarget: "host", workspaceDir: workspaceA.root, sandboxSettings: defaultToolSandboxSettings });
    const envB = bindExecutionEnvironment({ executionTarget: "host", workspaceDir: workspaceB.root, sandboxSettings: defaultToolSandboxSettings });
    const [resultA, resultB] = await Promise.all([
      envA.execute({ command: "a", cwd: workspaceA.root }),
      envB.execute({ command: "b", cwd: workspaceB.root })
    ]);
    assert.equal(envA.workspaceDir, workspaceA.root);
    assert.equal(envB.workspaceDir, workspaceB.root);
    assert.match(resultA.stdout, /ran:a@/);
    assert.match(resultB.stdout, /ran:b@/);
    // The backend saw each request with the workspace it was bound to.
    const seen = (backend as ExecutionBackend & { _seen: Array<{ request: CommandExecutionRequest; workspaceDir: string }> })._seen;
    assert.deepEqual(seen.map((entry) => entry.workspaceDir).sort(), [workspaceA.root, workspaceB.root].sort());
  } finally {
    setExecutionBackend("host", previous);
    workspaceA.dispose();
    workspaceB.dispose();
  }
});

test("cancellation propagates into a running host command", async () => {
  const workspace = tempWorkspace();
  try {
    const environment = bindExecutionEnvironment({
      executionTarget: "host",
      workspaceDir: workspace.root,
      sandboxSettings: defaultToolSandboxSettings
    });
    const controller = new AbortController();
    const running = environment.execute({
      command: "sleep 30",
      cwd: workspace.root,
      signal: controller.signal,
      timeoutSeconds: 60
    });
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(running, /aborted/i);
  } finally {
    workspace.dispose();
  }
});

test("the host backend reports a failed command's real status instead of an approval request", async () => {
  const workspace = tempWorkspace();
  try {
    const environment = bindExecutionEnvironment({
      executionTarget: "host",
      workspaceDir: workspace.root,
      sandboxSettings: defaultToolSandboxSettings
    });
    const result = await environment.execute({ command: "exit 7", cwd: workspace.root });
    assert.equal(result.code, 7);
    assert.equal(result.sandboxApplied, false);
  } finally {
    workspace.dispose();
  }
});

test("backend capabilities decide which advanced restrictions exist", () => {
  const sandbox = getExecutionBackend("sandbox");
  const host = getExecutionBackend("host");
  assert.equal(sandbox.capabilities.id, SANDBOX_BACKEND_ID);
  assert.equal(sandbox.capabilities.supportsNetworkDomainRestrictions, true);
  assert.equal(host.capabilities.id, HOST_BACKEND_ID);
  assert.equal(host.capabilities.supportsNetworkDomainRestrictions, false);
  // An unsupported restriction cannot report successful enforcement: the host
  // backend simply has none to apply.
  assert.equal(host.capabilities.supportsFilesystemRestrictions, false);
  assert.equal(host.capabilities.supportsEnvInjection, true);
});
