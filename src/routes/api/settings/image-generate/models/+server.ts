import { json } from "@sveltejs/kit";
import { getPiModels } from "$lib/server/providers/piRegistry.js";
import { listPiImageModels } from "$lib/server/agent/imageGenerate/piProvider.js";

export const GET = () => json({ ok: true, models: listPiImageModels(getPiModels()) }, {
  headers: { "Cache-Control": "no-store" }
});
