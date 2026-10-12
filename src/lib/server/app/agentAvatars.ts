import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { agentWorkspaceDir } from "$lib/server/sessions/agentStorage.js";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
function avatarDirectory(root: string, id: string): string {
  const directory = join(agentWorkspaceDir(root, id), "avatars");
  for (let current = directory; current !== resolve(root); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Avatar directory must not contain symbolic links");
    if (relative(resolve(root), current).startsWith("..")) throw new Error("Invalid avatar directory");
  }
  return directory;
}
export function saveAgentAvatar(root: string, id: string, bytes: Buffer): string {
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw new Error("Choose a PNG, JPEG or WebP image up to 5 MB");
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpg"
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
  if (!extension) throw new Error("Choose a PNG, JPEG or WebP image");
  const directory = avatarDirectory(root, id);
  mkdirSync(directory, { recursive: true });
  const file = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  const target = join(directory, file);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Invalid avatar file");
  if (!existsSync(target)) writeFileSync(target, bytes, { flag: "wx" });
  return `/api/desktop/agent-avatar?id=${encodeURIComponent(id)}&file=${file}`;
}
export function readAgentAvatar(root: string, id: string, file: string): { bytes: Buffer; mime: string } {
  if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(file)) throw new Error("Invalid avatar file");
  const target = join(avatarDirectory(root, id), file);
  if (lstatSync(target).isSymbolicLink()) throw new Error("Invalid avatar file");
  return { bytes: readFileSync(target), mime: MIME[file.split(".")[1] as keyof typeof MIME] };
}
