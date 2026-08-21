import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import dotenv from "dotenv";

dotenv.config();
process.env.MOLIBOT_APP_ROOT ||= process.cwd();

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    {
      name: "molibot-service-lease",
      async configureServer(server) {
        const { acquireServiceLease, resolveDataDir } = await import("./scripts/runtime/service-lease.mjs");
        const lease = acquireServiceLease({ dataDir: resolveDataDir() });
        // Publish the owner id the same way `start-server.mjs` does: the
        // runtime asserts ownership itself before starting live channels, and
        // without this it would treat the dev server's own lease as a conflict
        // and refuse to run any bot (prd.md §3.41).
        process.env.MOLIBOT_SERVICE_OWNER_ID = lease.ownerId;
        server.httpServer?.once("close", () => lease.release());
      }
    },
    {
      name: "molibot-runtime-bootstrap",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          setTimeout(() => {
            void server
              .ssrLoadModule("/src/lib/server/app/runtime.ts")
              .then((mod) => {
                if (typeof mod.getRuntime === "function") {
                  mod.getRuntime();
                  console.log("[dev-bootstrap] runtime initialized via ssrLoadModule");
                  return;
                }
                throw new Error("getRuntime export not found");
              })
              .catch((error) => {
                console.warn(
                  `[dev-bootstrap] runtime init failed: ${error instanceof Error ? error.message : String(error)}`
                );
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
  build: {
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      external: ["qrcode-terminal"]
    }
  },
  server: {
    port: 3000,
    fs: {
      allow: [".."]
    }
  },
  optimizeDeps: {
    include: [
      "lit"
    ]
  }
});
