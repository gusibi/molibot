import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveAuthFilePath } from "./authPath.js";

/** The OAuth installation identity survives restarts and is shared by login flows. */
export function getPiDeviceId(filePath = join(dirname(resolveAuthFilePath()), "pi-device-id")): string {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    writeFileSync(filePath, randomUUID(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const id = readFileSync(filePath, "utf8").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid Pi OAuth installation identity");
  }
  return id;
}
