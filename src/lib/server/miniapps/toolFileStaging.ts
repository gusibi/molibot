import { statSync } from "node:fs";
import { basename } from "node:path";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { resolveWebInboundFileMeta } from "$lib/server/web/attachments.js";
import { stageIncomingResource } from "$lib/server/miniapps/incomingResources.js";
import {
  MiniAppError,
  type MessageCaptureResource,
  type MiniAppToolFileParamManifest
} from "$lib/server/miniapps/types.js";

/** Matches the per-call attachment cap the message-action path enforces. */
export const MAX_STAGED_FILES_PER_CALL = 20;

/** Host-side scope the agent surface provides so staging resolves paths exactly like the file tools. */
export interface ToolFileStagingScope {
  cwd: string;
  workspaceDir: string;
}

export interface StageToolFileParamsInput {
  /** Already Ajv-validated tool input; the result is a copy, never the caller's object. */
  input: Record<string, unknown>;
  fileParams: MiniAppToolFileParamManifest[];
  staging: ToolFileStagingScope;
  dataRoot: string;
  appId: string;
  warn?: (event: string, detail: Record<string, unknown>) => void;
}

export interface StageToolFileParamsResult {
  input: Record<string, unknown>;
  stagedFiles: Record<string, MessageCaptureResource[]>;
}

/** `resolveWebInboundFileMeta` also classifies audio/video; staging's vocabulary is binary. */
function stagedKindOf(fileName: string): "image" | "file" {
  const { mediaType } = resolveWebInboundFileMeta({ name: fileName });
  return mediaType === "image" ? "image" : "file";
}

/**
 * Stages every declared `fileParams` value into `dataDir/incoming/` and rewrites
 * the parameter in place to the staged dataDir-relative path.
 *
 * Path resolution is deliberately the agent file tools' own (`resolveToolPath`
 * plus the shared allowed-roots guard): the same `~/x` must mean the same file
 * here as it does to `read`/`bash` (CLAUDE.md pitfall 6), and anything the file
 * tools may not read may not be staged either. Every check - guard, existence,
 * size, kind - runs before the first byte is copied, so a rejected input leaves
 * no partial staging behind (pitfall 26d).
 */
export function stageToolFileParams(input: StageToolFileParamsInput): StageToolFileParamsResult {
  const { fileParams, staging, dataRoot, appId } = input;
  const ensureAllowedPath = createPathGuard(staging.cwd, staging.workspaceDir);

  const stagedFiles: Record<string, MessageCaptureResource[]> = {};
  const rewritten: Record<string, unknown> = { ...input.input };
  let stagedCount = 0;

  for (const declaration of fileParams) {
    const value = input.input[declaration.param];
    if (value === undefined || value === null) continue;

    const paths = declaration.multiple === true ? value : [value];
    if (!Array.isArray(paths) || paths.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new MiniAppError(
        `Parameter "${declaration.param}" must be ${declaration.multiple === true ? "an array of file paths" : "a file path"}.`,
        "invalid_input"
      );
    }

    const stagedPaths: string[] = [];
    const resources: MessageCaptureResource[] = [];
    for (const requested of paths) {
      stagedCount += 1;
      if (stagedCount > MAX_STAGED_FILES_PER_CALL) {
        throw new MiniAppError(
          `Too many files in one call: at most ${MAX_STAGED_FILES_PER_CALL} may be staged.`,
          "invalid_input"
        );
      }

      const resolved = resolveToolPath(staging.cwd, requested);
      ensureAllowedPath(resolved);

      let bytes = 0;
      try {
        bytes = statSync(resolved).size;
      } catch {
        throw new MiniAppError(`File "${requested}" was not found.`, "invalid_input");
      }

      const original = basename(resolved);
      const kind = stagedKindOf(original);
      if (!declaration.accepts.includes(kind)) {
        // kind is only ever "image" or "file", so the mismatch sentence names
        // the one thing the file is or is not - written for the model to
        // self-correct on retry.
        throw new MiniAppError(
          `Parameter "${declaration.param}" only accepts ${declaration.accepts.join("/")} files, but "${requested}" is ${kind === "image" ? "an image" : "not an image"}.`,
          "invalid_input"
        );
      }

      const maxBytes = declaration.maxBytes ?? Number.MAX_SAFE_INTEGER;
      if (bytes > maxBytes) {
        throw new MiniAppError(
          `File "${requested}" exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit for parameter "${declaration.param}".`,
          "invalid_input"
        );
      }

      const staged = stageIncomingResource({
        dataRoot,
        appId,
        sourcePath: resolved,
        original,
        mediaType: kind,
        warn: input.warn
      });
      stagedPaths.push(staged.path);
      resources.push(staged);
    }

    if (resources.length > 0) {
      rewritten[declaration.param] = declaration.multiple === true ? stagedPaths : stagedPaths[0];
      stagedFiles[declaration.param] = resources;
    }
  }

  return { input: rewritten, stagedFiles };
}
