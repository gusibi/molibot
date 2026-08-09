import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getPythonToolingDir, getSandboxVenvDir, getToolingDir, wrapCommandWithVenv } from "$lib/server/agent/tools/helpers.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("python tooling defaults to data-dir tooling/python", () => {
  withEnv({
    MOLIBOT_TOOLING_DIR: undefined,
    MOLIBOT_PYTHON_TOOLING_DIR: undefined,
    MOLIBOT_VENV_DIR: undefined
  }, () => {
    assert.match(getPythonToolingDir(), /\/\.molibot\/tooling\/python$/);
    assert.match(getSandboxVenvDir(), /\/\.molibot\/tooling\/python\/venv$/);
  });
});

/**
 * The default is taken from `storagePaths`, not spelled out again here, so the
 * bootstrap that creates the directory and the code that hands it to the Agent
 * cannot drift. The second assertion is the same separation `storage.test.ts`
 * guards, checked on the value the Agent actually receives.
 */
test("the default tooling root is the bootstrapped one, outside the service runtime", () => {
  withEnv({
    MOLIBOT_TOOLING_DIR: undefined,
    MOLIBOT_PYTHON_TOOLING_DIR: undefined,
    MOLIBOT_VENV_DIR: undefined
  }, () => {
    assert.equal(getToolingDir(), storagePaths.toolingDir);
    assert.equal(getPythonToolingDir(), storagePaths.toolingPythonDir);
    assert.equal(getPythonToolingDir().startsWith(`${storagePaths.runtimeDir}/`), false);
  });
});

/**
 * Go isolation used to be conditional on MOLIBOT_TOOLING_DIR being set, so the
 * default install let `go install` write into the owner's ~/go — the exact
 * pollution the tooling directory exists to prevent.
 */
test("Go caches are isolated even without MOLIBOT_TOOLING_DIR", () => {
  withEnv({
    MOLIBOT_TOOLING_DIR: undefined,
    MOLIBOT_PYTHON_TOOLING_DIR: undefined,
    MOLIBOT_VENV_DIR: undefined
  }, () => {
    const wrapped = wrapCommandWithVenv("go version");
    assert.equal(wrapped.includes(`export GOPATH='${join(storagePaths.toolingDir, "go")}'`), true);
    assert.equal(wrapped.includes(`export GOCACHE='${join(storagePaths.toolingDir, "go-cache")}'`), true);
  });
});

test("MOLIBOT_TOOLING_DIR is treated as the shared tooling root", () => {
  const toolingRoot = join(tmpdir(), "molibot-tooling-root");
  withEnv({
    MOLIBOT_TOOLING_DIR: toolingRoot,
    MOLIBOT_PYTHON_TOOLING_DIR: undefined,
    MOLIBOT_VENV_DIR: undefined
  }, () => {
    assert.equal(getPythonToolingDir(), join(toolingRoot, "python"));
    assert.equal(getSandboxVenvDir(), join(toolingRoot, "python", "venv"));
  });
});

test("MOLIBOT_VENV_DIR overrides only the venv path", () => {
  const pythonTooling = join(tmpdir(), "molibot-python-tooling");
  const venv = join(tmpdir(), "molibot-custom-venv");
  withEnv({
    MOLIBOT_TOOLING_DIR: undefined,
    MOLIBOT_PYTHON_TOOLING_DIR: pythonTooling,
    MOLIBOT_VENV_DIR: venv
  }, () => {
    assert.equal(getPythonToolingDir(), pythonTooling);
    assert.equal(getSandboxVenvDir(), venv);
  });
});

test("wrapCommandWithVenv routes Python caches and temp files into tooling/python", () => {
  const pythonTooling = join(tmpdir(), "molibot-python-tooling");
  withEnv({
    MOLIBOT_TOOLING_DIR: undefined,
    MOLIBOT_PYTHON_TOOLING_DIR: pythonTooling,
    MOLIBOT_VENV_DIR: undefined
  }, () => {
    const wrapped = wrapCommandWithVenv("python -V");
    assert.equal(wrapped.includes(`export VIRTUAL_ENV='${join(pythonTooling, "venv")}'`), true);
    assert.equal(wrapped.includes(`export PIP_CACHE_DIR='${join(pythonTooling, "pip-cache")}'`), true);
    assert.equal(wrapped.includes(`export UV_CACHE_DIR='${join(pythonTooling, "uv-cache")}'`), true);
    assert.equal(wrapped.includes(`export TMPDIR='${join(pythonTooling, "tmp")}'`), true);
    assert.match(wrapped, /export PYTHONNOUSERSITE=1/);
  });
});
