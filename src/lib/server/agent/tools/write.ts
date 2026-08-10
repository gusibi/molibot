import { dirname, isAbsolute, relative, resolve } from "node:path";
import fs from "node:fs";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { toolDefToAgentTool } from "$lib/server/agent/tools/helpers.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import {
  assertWriteAllowedByFilesystemPolicy,
  type FilesystemPolicy
} from "$lib/server/agent/tools/filesystemPolicy.js";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";
import type { RunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";

function isWithinRoot(root: string, filePath: string): boolean {
  const rel = relative(root, filePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const writeSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  content: Type.String(),
  target: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("scratch")]))
});

function routeDefaultArtifactPath(inputPath: string, artifactDir?: string): { requestedPath: string; path: string; routed: boolean } {
  const requestedPath = inputPath.trim();
  const normalizedArtifactDir = artifactDir?.trim();
  if (!normalizedArtifactDir || !requestedPath || isAbsolute(requestedPath)) {
    return { requestedPath, path: requestedPath, routed: false };
  }

  const normalizedPath = requestedPath.replaceAll("\\", "/").replace(/^\.\//, "");
  const isPlainFileName =
    normalizedPath &&
    !normalizedPath.includes("/") &&
    !normalizedPath.startsWith(".") &&
    normalizedPath !== "..";
  if (!isPlainFileName) {
    return { requestedPath, path: requestedPath, routed: false };
  }

  return {
    requestedPath,
    path: `${normalizedArtifactDir}/${normalizedPath}`,
    routed: true
  };
}

export function getWriteToolDefinition(options: { cwd: string; workspaceDir: string; chatId: string; artifactDir?: string; outputLayout?: RunOutputLayout; filesystemPolicy?: FilesystemPolicy }): ToolDefinition {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    id: "write",
    name: "write",
    description: "Create or overwrite a file. Parent directories are created automatically. Plain file names for ordinary scratch artifacts are routed to the current dated artifact folder; explicit directories and absolute paths are left unchanged.",
    inputSchema: writeSchema,
    risk: "medium",
    source: "builtin",
    sideEffectClass: "idempotent",
    handler: async (params: any, ctx) => {
      const requestedPath = String(params.path ?? "").trim();
      const requestedTarget = params.target === "project" || params.target === "scratch" ? params.target : undefined;
      const defaultTarget = options.outputLayout?.projectRoot ? "project" : "scratch";
      let rootKind: "project" | "scratch" = requestedTarget ?? defaultTarget;
      if (rootKind === "project" && !options.outputLayout?.projectRoot) {
        return { ok: false, error: "The project output target is only available in a Project Session." };
      }

      let baseRoot = rootKind === "project"
        ? options.outputLayout!.projectRoot!
        : options.outputLayout?.scratchRoot;
      const legacyTarget = options.outputLayout
        ? { requestedPath, path: requestedPath, routed: false }
        : routeDefaultArtifactPath(requestedPath, options.artifactDir);
      const filePath = isAbsolute(requestedPath)
        ? resolve(requestedPath)
        : baseRoot
          ? resolve(baseRoot, requestedPath)
          : resolveToolPath(ctx.cwd, legacyTarget.path);
      ensureAllowedPath(filePath);
      if (options.outputLayout && isAbsolute(requestedPath)) {
        if (isWithinRoot(options.outputLayout.scratchRoot, filePath)) {
          rootKind = "scratch";
          baseRoot = options.outputLayout.scratchRoot;
        } else if (options.outputLayout.projectRoot && isWithinRoot(options.outputLayout.projectRoot, filePath)) {
          rootKind = "project";
          baseRoot = options.outputLayout.projectRoot;
        } else {
          return { ok: false, error: "Absolute output paths must stay inside the Project root or runtime scratch root." };
        }
      }

      // The operator's deny list is checked before a single byte is written —
      // a side effect that precedes its own validation is worse than a crash
      // (CLAUDE.md pitfall 26d).
      assertWriteAllowedByFilesystemPolicy(filePath, options.filesystemPolicy, options.workspaceDir);

      // Share the edit tool's per-file lock so a write cannot land in the middle
      // of a concurrent edit's read-modify-write cycle.
      const dir = dirname(filePath);
      await withFileMutationQueue(filePath, async () => {
        await fs.promises.mkdir(dir, { recursive: true });
        await ctx.fs.writeText(filePath, params.content);
      });

      const writtenBytes = Buffer.byteLength(params.content, "utf-8");
      // Report where the file actually is, not the path that was asked for.
      // Writes are rooted at the scratch/project output root while `bash` runs
      // in the run's cwd, so echoing the requested path back hands the agent a
      // string that resolves to nothing — which is exactly how a release ended
      // up running `gh release create --notes-file <path that did not exist>`.
      const reportedPath = filePath === resolveToolPath(ctx.cwd, requestedPath)
        ? requestedPath
        : filePath;
      return {
        ok: true,
        content: [{
          type: "text",
          text: legacyTarget.routed
            ? `Wrote ${writtenBytes} bytes to ${legacyTarget.path} (default artifact path for ${legacyTarget.requestedPath})`
            : `Wrote ${writtenBytes} bytes to ${reportedPath}`
        }],
        details: baseRoot ? {
          requestedPath,
          relativePath: relative(baseRoot, filePath).replaceAll("\\", "/"),
          rootKind,
          action: "created",
          sizeBytes: writtenBytes
        } : undefined
      };
    }
  };
}

export function createWriteTool(options: { cwd: string; workspaceDir: string; chatId: string; artifactDir?: string; outputLayout?: RunOutputLayout; filesystemPolicy?: FilesystemPolicy }): AgentTool<typeof writeSchema> {
  const def = getWriteToolDefinition(options);
  return toolDefToAgentTool(def, options.cwd);
}
