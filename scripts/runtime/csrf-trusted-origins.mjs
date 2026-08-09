/**
 * Origins whose cross-site POSTs (multipart `/api/chat` attachment sends) the
 * SvelteKit CSRF check must accept.
 *
 * The desktop WebView is never same-origin with this loopback server, so every
 * attachment send is a "cross-site form submission" from SvelteKit's point of
 * view. There are two WebView origins, and forgetting either one produces the
 * same user-visible failure ("Cross-site POST form submissions are forbidden"):
 *
 * - packaged app: `tauri://localhost` (custom protocol)
 * - `pnpm desktop:dev`: the Tauri dev server, `http://127.0.0.1:1420`
 *   (`apps/desktop/vite.config.ts`), or `http://$TAURI_DEV_HOST:1420` when
 *   testing from another device on the LAN.
 *
 * Only these fixed loopback/dev origins are trusted, so the web deployment
 * keeps full CSRF protection: no remote page can carry one of these origins.
 */

/** Port the desktop shell's Vite dev server binds (`apps/desktop/vite.config.ts`). */
export const DESKTOP_DEV_PORT = 1420;

/**
 * The origin the service should believe it is serving.
 *
 * `adapter-node` derives its own origin from the request headers when `ORIGIN`
 * is unset, and **defaults the scheme to `https`** (`get_origin` in
 * `build/handler.js`). The service listens on plain HTTP, so its computed
 * origin was `https://127.0.0.1:<port>` while a browser at
 * `http://localhost:3000` sends `Origin: http://localhost:3000` — the two never
 * match, and SvelteKit rejects every same-origin multipart POST with
 * "Cross-site POST form submissions are forbidden".
 *
 * That is the same failure as the two WebView origins above (CLAUDE.md pitfall
 * 25), which is why it hid for so long: `tauri://localhost` is explicitly
 * trusted, so the packaged desktop app worked and only the *plain Web* surface
 * was broken. Trusting more origins cannot fix it — the origin is legitimate
 * and same-site; what was wrong is the scheme the server assumed about itself.
 *
 * Left alone when the operator has said something about the deployment: an
 * explicit `ORIGIN`, or a `PROTOCOL_HEADER` naming the header a TLS-terminating
 * proxy sets.
 */
export function resolveServiceOrigin(env = process.env) {
  if (String(env.ORIGIN ?? "").trim()) return null;
  if (String(env.PROTOCOL_HEADER ?? "").trim()) return null;
  const host = String(env.HOST ?? "").trim() || "127.0.0.1";
  const port = String(env.PORT ?? "").trim();
  if (!/^\d+$/.test(port)) return null;
  // Only for a loopback bind. A service reachable from the network may well be
  // fronted by TLS, and guessing `http` there would be the wrong assumption in
  // the more dangerous direction.
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return null;
  const authority = host === "::1" ? "[::1]" : host;
  return `http://${authority}:${port}`;
}

/**
 * @param {{ tauriDevHost?: string }} [options]
 * @returns {string[]}
 */
export function csrfTrustedOrigins(options = {}) {
  const origins = [
    "tauri://localhost",
    `http://127.0.0.1:${DESKTOP_DEV_PORT}`,
    `http://localhost:${DESKTOP_DEV_PORT}`
  ];
  const devHost = options.tauriDevHost?.trim();
  if (devHost) {
    const origin = `http://${devHost}:${DESKTOP_DEV_PORT}`;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}
