import adapter from "./scripts/svelte-adapter-node-sqlite.js";
import { csrfTrustedOrigins } from "./scripts/runtime/csrf-trusted-origins.mjs";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      out: "build"
    }),
    csrf: {
      // The desktop WebView is never same-origin with this loopback server, so
      // its multipart POSTs (e.g. sending an attachment to /api/chat) would be
      // rejected as "cross-site form submissions". Trusting only the fixed
      // packaged + dev WebView origins keeps full CSRF protection for the web
      // deployment. See scripts/runtime/csrf-trusted-origins.mjs.
      trustedOrigins: csrfTrustedOrigins({ tauriDevHost: process.env.TAURI_DEV_HOST })
    },
    alias: {
      "@molibot/shared": "./src/lib/shared"
    }
  }
};

export default config;
