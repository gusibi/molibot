import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit(),
    {
      name: "molibot-runtime-bootstrap",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          const addr = server.httpServer?.address();
          const port = typeof addr === "object" && addr ? addr.port : 3000;
          const url = `http://127.0.0.1:${port}/api/settings`;

          setTimeout(() => {
            void fetch(url)
              .then(async (res) => {
                const body = await res.text();
                console.log(`[dev-bootstrap] runtime init ping -> ${url} (${res.status})`);
                if (!res.ok) {
                  console.warn(`[dev-bootstrap] runtime init response body: ${body.slice(0, 240)}`);
                }
              })
              .catch((error) => {
                console.warn(`[dev-bootstrap] runtime init ping failed: ${error instanceof Error ? error.message : String(error)}`);
              });
          }, 200);
        });
      }
    }
  ],
  resolve: {
    // Avoid package "development" export condition in dev server for lit-based deps.
    conditions: ["browser", "module", "import", "default"]
  },
  server: {
    port: 3000,
    fs: {
      allow: [".."]
    }
  },
  optimizeDeps: {
    include: [
      "@mariozechner/pi-web-ui",
      "@mariozechner/pi-agent-core",
      "@mariozechner/pi-ai",
      "@mariozechner/mini-lit",
      "lit"
    ]
  }
});
