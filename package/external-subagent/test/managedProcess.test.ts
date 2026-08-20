import assert from "node:assert/strict";
import test from "node:test";
import { spawnManagedProcess } from "../src/managedProcess.js";

test("spawnManagedProcess spawns a command and captures outcome on exit", async () => {
  const child = spawnManagedProcess({
    argv: [process.execPath, "-e", "process.stdout.write('hello'); process.exit(0);"],
    cwd: process.cwd(),
    stdio: { stdout: "pipe" }
  });

  assert.ok(child.pid > 0);
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });

  const outcome = await child.done;
  assert.equal(outcome.exitCode, 0);
  assert.equal(stdout, "hello");
});

test("spawnManagedProcess aborts before spawn when signal is already aborted", () => {
  const controller = new AbortController();
  controller.abort(new Error("Pre-aborted"));

  assert.throws(
    () => {
      spawnManagedProcess({
        argv: [process.execPath, "-e", "process.exit(0)"],
        cwd: process.cwd(),
        signal: controller.signal
      });
    },
    { message: /aborted before spawn/i }
  );
});

test("spawnManagedProcess terminate kills child and waits for exit", async () => {
  const child = spawnManagedProcess({
    argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    graceMs: 200
  });

  assert.ok(child.pid > 0);
  child.terminate();
  const exited = await child.waitForExit();
  assert.equal(exited, true);

  const outcome = await child.done;
  assert.ok(outcome.signal === "SIGTERM" || outcome.signal === "SIGKILL" || outcome.exitCode !== 0);

  // Terminate again is idempotent
  child.terminate();
});
