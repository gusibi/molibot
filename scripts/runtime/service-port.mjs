import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

export const DEFAULT_SERVICE_PORT = 3000;

export function normalizeServicePort(value, fallback = DEFAULT_SERVICE_PORT) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}

export function readConfiguredServicePort(dataDir, fallback = DEFAULT_SERVICE_PORT) {
  try {
    const settings = JSON.parse(readFileSync(path.join(dataDir, "settings.json"), "utf8"));
    return normalizeServicePort(settings.serverPort, fallback);
  } catch {
    return fallback;
  }
}

function isServicePortAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function findAvailableServicePort(preferred, host = "127.0.0.1") {
  const start = normalizeServicePort(preferred);
  for (let port = start; port <= 65535; port += 1) {
    if (await isServicePortAvailable(port, host)) return port;
  }
  throw new Error(`No available service port from ${start} through 65535`);
}
