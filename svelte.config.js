import adapter from "./scripts/svelte-adapter-node-sqlite.js";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      out: "build"
    }),
    csrf: {
      // The packaged macOS desktop app loads the UI from the `tauri://localhost`
      // WebView origin and talks to this loopback server. Its multipart POSTs
      // (e.g. sending a recorded voice attachment to /api/chat) would otherwise
      // be rejected as "cross-site form submissions". Trusting this single
      // fixed origin keeps full CSRF protection for the web deployment.
      trustedOrigins: ["tauri://localhost"]
    }
  }
};

export default config;
