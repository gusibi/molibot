import test from "node:test";
import assert from "node:assert/strict";
import { describeNetworkError, networkRuntimeInfo } from "./network-diagnostics.js";

test("network diagnostics retain nested socket errors and redact credentials", () => {
  const socket = Object.assign(new Error('request https://cdn.example.test/upload?signature=SIGNED_SECRET {"aeskey":"AES_SECRET","upload_param":"UPLOAD_SECRET","token":"TOKEN_SECRET"} Bearer BEARER_SECRET'), {
    code: "ECONNREFUSED", errno: -61, syscall: "connect", address: "127.0.0.1", port: 443
  });
  const result = describeNetworkError(new TypeError("fetch failed", { cause: new AggregateError([socket], "connect failed") }));
  const nested = ((result.cause as Record<string, unknown>).errors as Record<string, unknown>[])[0];
  assert.equal(nested.code, "ECONNREFUSED");
  assert.equal(nested.errno, -61);
  assert.equal(nested.syscall, "connect");
  assert.equal(nested.address, "127.0.0.1");
  assert.equal(nested.port, 443);
  assert.match(String(nested.stack), /ECONNREFUSED|request/);
  for (const secret of ["SIGNED_SECRET", "AES_SECRET", "UPLOAD_SECRET", "TOKEN_SECRET", "BEARER_SECRET"]) {
    assert.ok(!JSON.stringify(result).includes(secret), `leaked ${secret}`);
  }
});

test("network diagnostics bound cycles and identify the running process", () => {
  const error = new Error("loop");
  error.cause = error;
  assert.deepEqual(describeNetworkError(error).cause, { truncated: true });
  assert.equal(networkRuntimeInfo().pid, process.pid);
  assert.equal(networkRuntimeInfo().nodeVersion, process.version);
});
