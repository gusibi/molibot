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
