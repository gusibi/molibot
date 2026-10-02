import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { saveRoomFile, getRoomService, getRoomStore } from "$lib/server/rooms/runtime.js";
export const POST: RequestHandler = async ({ request }) => {
  try {
    const form = await request.formData();
    const roomId = String(form.get("roomId") ?? "");
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) throw new Error("Files are required");
    const attachments = [];
    for (const file of files) attachments.push(await saveRoomFile(roomId, file));
    return json({ ok: true, attachments });
  } catch (error) { return json({ ok: false, error: String(error) }, { status: 400 }); }
};

export const GET: RequestHandler = ({ url }) => {
  try {
    const roomId = url.searchParams.get("roomId") ?? "";
    getRoomService().view(roomId);
    const attachment = getRoomStore().fileByLocal(roomId, url.searchParams.get("local") ?? "");
    if (!attachment) return new Response("Attachment unavailable", { status: 404 });
    const bytes = readFileSync(path.join(storagePaths.webWorkspaceDir, "rooms", roomId, "runtime", attachment.local));
    return new Response(bytes, { headers: { "Content-Type": attachment.mimeType ?? "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.original)}`, "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Attachment unavailable", { status: 404 }); }
};
