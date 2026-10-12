import { json, type RequestHandler } from "@sveltejs/kit";
import { MAX_AVATAR_BYTES, readAgentAvatar, saveAgentAvatar } from "$lib/server/app/agentAvatars";
import { storagePaths } from "$lib/server/infra/db/storage";
export const POST: RequestHandler = async ({ request, url }) => {
  try {
    if (Number(request.headers.get("content-length")) > MAX_AVATAR_BYTES) throw new Error("Image exceeds 5 MB");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Image is required");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_AVATAR_BYTES) { await reader.cancel(); throw new Error("Image exceeds 5 MB"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const avatar = saveAgentAvatar(storagePaths.dataDir, url.searchParams.get("id") ?? "", Buffer.concat(chunks));
    return json({ ok: true, avatar });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
};
export const GET: RequestHandler = ({ url }) => {
  try {
    const { bytes, mime } = readAgentAvatar(storagePaths.dataDir, url.searchParams.get("id") ?? "", url.searchParams.get("file") ?? "");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch { return new Response("Avatar unavailable", { status: 404 }); }
};
