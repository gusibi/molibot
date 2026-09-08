import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";
import { projectExtractionResult, validateExtractionExecute } from "$lib/server/sessions/sessionManagedApi.js";
import { executeManagedExtraction } from "$lib/server/sessions/sessionExtractionBatch.js";

/**
 * T9 managed extraction batch: `extract` only processes, `extract-and-archive`
 * archives through the T8 gate (all eligible content processed, required
 * outputs saved, nothing pending review, source unchanged). Failed,
 * pending-review and concurrent-message items stay unarchived with an
 * explicit reason. Extraction never deletes.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  let valid;
  try {
    valid = validateExtractionExecute(body);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  const requester =
    body.userId !== undefined || body.profileId !== undefined
      ? toWebExternalUserId(
          sanitizeWebUserId(typeof body.userId === "string" ? body.userId : null),
          sanitizeWebProfileId(typeof body.profileId === "string" ? body.profileId : null)
        )
      : undefined;
  try {
    const { sessionBulk, sessionExtraction } = getRuntime();
    const result = await executeManagedExtraction(
      {
        extraction: sessionExtraction,
        selections: {
          getSelectionTargets: (selectionId: string) => sessionBulk.getSelectionTargets(selectionId)
        }
      },
      {
        mode: valid.mode,
        targets: valid.targets,
        selectionId: valid.selectionId,
        requesterExternalUserId: requester,
        idempotencyKey: valid.idempotencyKey
      }
    );
    return json({ ok: true, ...projectExtractionResult(result) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
