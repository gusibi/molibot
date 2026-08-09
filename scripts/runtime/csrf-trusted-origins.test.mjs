import assert from "node:assert/strict";
import test from "node:test";

import { csrfTrustedOrigins, resolveServiceOrigin } from "./csrf-trusted-origins.mjs";
import svelteConfig from "../../svelte.config.js";

test("every desktop WebView origin is trusted for multipart POSTs", () => {
  const origins = csrfTrustedOrigins();
  // Packaged app (regression: attachment send failed in the release build).
  assert.ok(origins.includes("tauri://localhost"));
  // `pnpm desktop:dev` — the Tauri dev server origin, both host spellings.
  assert.ok(origins.includes("http://127.0.0.1:1420"));
  assert.ok(origins.includes("http://localhost:1420"));
});

test("TAURI_DEV_HOST adds the LAN dev origin without duplicating", () => {
  const origins = csrfTrustedOrigins({ tauriDevHost: "192.168.1.20" });
  assert.ok(origins.includes("http://192.168.1.20:1420"));
  assert.equal(new Set(origins).size, origins.length);
  assert.deepEqual(csrfTrustedOrigins({ tauriDevHost: "127.0.0.1" }), csrfTrustedOrigins());
  assert.deepEqual(csrfTrustedOrigins({ tauriDevHost: "  " }), csrfTrustedOrigins());
});

test("no remote origin is trusted", () => {
  for (const origin of csrfTrustedOrigins({ tauriDevHost: "192.168.1.20" })) {
    assert.match(origin, /^(tauri:\/\/localhost|http:\/\/(127\.0\.0\.1|localhost|\d+\.\d+\.\d+\.\d+):1420)$/);
  }
});

test("svelte.config.js wires the shared list into kit.csrf.trustedOrigins", () => {
  assert.deepEqual(
    svelteConfig.kit.csrf.trustedOrigins,
    csrfTrustedOrigins({ tauriDevHost: process.env.TAURI_DEV_HOST })
  );
});

/**
 * The plain Web surface's version of pitfall 25, hidden behind the desktop fix.
 *
 * adapter-node assumes `https` when nothing tells it otherwise, so the service
 * computed `https://127.0.0.1:<port>` for itself while a browser on
 * `http://localhost:3000` sent an `http` origin. Same-origin uploads were
 * rejected; only `tauri://localhost` worked, because it is on the trusted list.
 */
test("a loopback service declares its own http origin", () => {
  assert.equal(
    resolveServiceOrigin({ HOST: "127.0.0.1", PORT: "3000" }),
    "http://127.0.0.1:3000"
  );
  assert.equal(resolveServiceOrigin({ PORT: "3000" }), "http://127.0.0.1:3000");
  assert.equal(resolveServiceOrigin({ HOST: "::1", PORT: "3000" }), "http://[::1]:3000");
});

test("an operator's own deployment decision is never overwritten", () => {
  assert.equal(
    resolveServiceOrigin({ HOST: "127.0.0.1", PORT: "3000", ORIGIN: "https://molibot.example" }),
    null
  );
  // A TLS-terminating proxy names the header that carries the real scheme.
  assert.equal(
    resolveServiceOrigin({ HOST: "127.0.0.1", PORT: "3000", PROTOCOL_HEADER: "x-forwarded-proto" }),
    null
  );
});

/**
 * Guessing `http` for a network-reachable bind would be the wrong assumption in
 * the dangerous direction — that host may well be behind TLS.
 */
test("a non-loopback bind is left to derive its own origin", () => {
  assert.equal(resolveServiceOrigin({ HOST: "0.0.0.0", PORT: "3000" }), null);
  assert.equal(resolveServiceOrigin({ HOST: "192.168.1.20", PORT: "3000" }), null);
  assert.equal(resolveServiceOrigin({ HOST: "127.0.0.1", PORT: "" }), null);
});
