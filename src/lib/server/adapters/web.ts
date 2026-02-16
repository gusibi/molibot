import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Express } from "express";
import { config } from "../config.js";
import { MessageRouter } from "../core/messageRouter.js";

interface ChatBody {
  userId?: string;
  message?: string;
}

function registerWebAssets(app: Express): void {
  const distDir = path.join(process.cwd(), "build");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("/", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
    return;
  }

  app.get("/", (_req, res) => {
    res
      .status(503)
      .type("text/plain")
      .send(
        [
          "Web UI is not built yet.",
          "Run one of these:",
          "- npm run dev   (for local development)",
          "- npm run build (then restart backend)",
        ].join("\n")
      );
  });
}

export function createWebApp(router: MessageRouter): Express {
  const app = express();

  app.use(express.json({ limit: "64kb" }));
  registerWebAssets(app);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "molibot", ts: new Date().toISOString() });
  });

  app.post("/api/chat", async (req, res) => {
    const body = req.body as ChatBody;
    const userId = body.userId?.trim() || "web-anonymous";
    const message = body.message?.trim() || "";

    const result = await router.handle({ channel: "web", externalUserId: userId, content: message });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }

    res.json({ ok: true, response: result.response });
  });

  app.get("/api/stream", async (req, res) => {
    const userId = String(req.query.userId || "web-anonymous");
    const message = String(req.query.message || "");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const result = await router.handle({ channel: "web", externalUserId: userId, content: message });
    if (!result.ok) {
      res.write(`event: error\\ndata: ${JSON.stringify(result)}\\n\\n`);
      res.end();
      return;
    }

    const response = result.response ?? "";
    for (const token of response.split(" ")) {
      res.write(`event: token\\ndata: ${JSON.stringify({ token })}\\n\\n`);
    }

    res.write(`event: done\\ndata: ${JSON.stringify({ ok: true })}\\n\\n`);
    res.end();
  });

  return app;
}

export function startWeb(app: Express): void {
  const server = app.listen(config.port, () => {
    console.log(`[web] listening on http://localhost:${config.port}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[web] port ${config.port} is already in use. Stop the existing process or set a different PORT in .env.`
      );
      return;
    }

    console.error("[web] failed to start server", error);
  });
}
