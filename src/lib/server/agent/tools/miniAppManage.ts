import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { createMiniAppHost, type MiniAppHost } from "$lib/server/miniapps/host.js";
import type { MiniAppInstaller } from "$lib/server/miniapps/install.js";
import { readMiniAppManifest } from "$lib/server/miniapps/manifest.js";
import { isValidMiniAppId } from "$lib/server/miniapps/paths.js";
import { getMiniAppHost, getMiniAppInstaller } from "$lib/server/miniapps/registry.js";
import { MiniAppError, type MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";

const miniAppManageSchema = Type.Object({
  action: Type.Union([
    Type.Literal("validate"),
    Type.Literal("install"),
    Type.Literal("inspect")
  ], {
    description: "Validate a build directory, atomically install/update it, or inspect the installed receipt."
  }),
  path: Type.Optional(Type.String({
    description: "Build directory for validate/install. Build in the session scratch directory, not inside the live Mini App install root."
  })),
  appId: Type.Optional(Type.String({
    description: "Installed Mini App id for inspect."
  }))
});

interface MiniAppManageOptions {
  cwd: string;
  workspaceDir: string;
  codeRoot?: string;
  installer?: Pick<MiniAppInstaller, "install">;
  host?: Pick<MiniAppHost, "refresh" | "listCatalog">;
}

interface ValidationReceipt {
  appId: string;
  version: string;
  schemaVersion: number;
  toolNames: string[];
  manifestHash: string;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function validateBuild(sourceDir: string): Promise<ValidationReceipt> {
  const appId = path.basename(sourceDir);
  const manifestResult = readMiniAppManifest(sourceDir, appId);
  if (!manifestResult.ok) {
    throw new MiniAppError(`Mini App validation failed: ${manifestResult.error}`, "bad_request");
  }

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-miniapp-validate-"));
  const host = createMiniAppHost({
    codeRoot: path.dirname(sourceDir),
    dataRoot,
    getEnablement: () => ({}),
    setEnablement: () => undefined,
    importModule: (entryPath) => import(
      /* @vite-ignore */ `${pathToFileURL(entryPath).href}?miniapp_validate=${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
  });
  try {
    await host.smokeTest(appId);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }

  const manifest = manifestResult.value.manifest;
  return {
    appId,
    version: manifest.version,
    schemaVersion: manifest.data.schemaVersion,
    toolNames: manifest.tools.map((tool) => tool.name),
    manifestHash: hashFile(path.join(sourceDir, "manifest.json"))
  };
}

function installedReceipt(
  codeRoot: string,
  appId: string,
  catalogEntry?: MiniAppCatalogEntry
): ValidationReceipt & { status: string; error?: string } {
  if (!isValidMiniAppId(appId)) {
    throw new MiniAppError("Invalid Mini App id.", "bad_request");
  }
  const appDir = path.join(codeRoot, appId);
  const manifestResult = readMiniAppManifest(appDir, appId);
  if (!manifestResult.ok) {
    throw new MiniAppError(`Installed Mini App is invalid: ${manifestResult.error}`, "load_failed");
  }
  const manifest = manifestResult.value.manifest;
  return {
    appId,
    version: manifest.version,
    schemaVersion: manifest.data.schemaVersion,
    toolNames: manifest.tools.map((tool) => tool.name),
    manifestHash: hashFile(path.join(appDir, "manifest.json")),
    status: catalogEntry?.status ?? "installed",
    ...(catalogEntry?.error ? { error: catalogEntry.error } : {})
  };
}

/**
 * Evidence-producing Mini App authoring seam.
 *
 * Generic file tools create the build; this tool owns the trust-sensitive
 * boundary from a scratch build into the live install root. It reuses the same
 * staged, validated, atomic installer as the Desktop manager and returns a
 * receipt read back from the installed directory.
 */
export function createMiniAppManageTool(options: MiniAppManageOptions): AgentTool<typeof miniAppManageSchema> {
  const guardPath = createPathGuard(options.cwd, options.workspaceDir);
  const guardRealPath = createPathGuard(
    fs.realpathSync(options.cwd),
    fs.realpathSync(options.workspaceDir)
  );
  const codeRoot = options.codeRoot ?? storagePaths.miniAppCodeDir;

  return {
    name: "miniAppManage",
    label: "miniAppManage",
    description: [
      "Validate, install/update, or inspect a Molibot Mini App.",
      "For creation and upgrades, build in session scratch, validate it, then install it atomically.",
      "Only a successful install receipt proves that the live app directory changed.",
      "Validate/install load owner-selected server code in-process and require owner approval; inspect is read-only."
    ].join(" "),
    parameters: miniAppManageSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      if (params.action === "inspect") {
        const appId = String(params.appId ?? "").trim();
        if (!appId) throw new Error("appId is required for inspect");
        const host = options.host ?? getMiniAppHost();
        host.refresh();
        const entry = host.listCatalog().find((item) => item.id === appId);
        const receipt = installedReceipt(codeRoot, appId, entry);
        return {
          content: [{ type: "text" as const, text: `Installed Mini App receipt: ${receipt.appId} v${receipt.version}, status=${receipt.status}, manifest=${receipt.manifestHash}.` }],
          details: { action: "inspect", ...receipt }
        };
      }

      const requestedPath = String(params.path ?? "").trim();
      if (!requestedPath) throw new Error(`path is required for ${params.action}`);
      const requestedSourceDir = resolveToolPath(options.cwd, requestedPath);
      guardPath(requestedSourceDir);
      let sourceDir: string;
      try {
        sourceDir = fs.realpathSync(requestedSourceDir);
      } catch {
        throw new Error("Mini App build path does not exist.");
      }
      // Guard again after following every parent symlink. A lexically safe path
      // inside scratch must not become an arbitrary host directory at runtime.
      guardRealPath(sourceDir);
      if (!fs.statSync(sourceDir).isDirectory()) throw new Error("Mini App build path must be a directory.");

      const validation = await validateBuild(sourceDir);
      if (params.action === "validate") {
        return {
          content: [{ type: "text" as const, text: `Validated Mini App build: ${validation.appId} v${validation.version}; runtime smoke passed; manifest=${validation.manifestHash}.` }],
          details: { action: "validate", ...validation, runtimeSmoke: "passed" }
        };
      }

      const installer = options.installer ?? getMiniAppInstaller();
      const result = await installer.install({ source: "directory", path: sourceDir });
      const host = options.host ?? getMiniAppHost();
      await host.activateInstalled(result.appId);
      const entry = host.listCatalog().find((item) => item.id === result.appId);
      const receipt = installedReceipt(codeRoot, result.appId, entry);
      return {
        content: [{
          type: "text" as const,
          text: `Installed and activated Mini App receipt: ${receipt.appId} v${receipt.version}; replaced=${result.replaced}; manifest=${receipt.manifestHash}.`
        }],
        details: {
          action: "install",
          ...receipt,
          replaced: result.replaced,
          activated: true,
          validatedManifestHash: validation.manifestHash
        }
      };
    }
  };
}
