import fs from "node:fs";
import path from "node:path";

/**
 * The shape of a built-in Mini App and the two pure operations performed on it.
 *
 * Deliberately separate from `bootstrap.ts`: that module embeds the app sources
 * with Vite's `?raw`, and the host must be able to compare versions and write a
 * package without pulling every built-in's source text into its own import
 * graph. `bootstrap.ts` owns *which* apps ship; this owns *what a package is*.
 */
export interface BuiltinMiniApp {
  id: string;
  /** Relative path inside the app directory → file content. */
  files: Record<string, string>;
  /**
   * Whether an empty workspace gets this app without being asked.
   *
   * Off by default: a built-in is an *offer*, not something an upgrade pushes
   * onto an owner who never asked for it. The Mini Apps manager lists every
   * built-in with its install state so the owner chooses.
   */
  autoInstall?: boolean;
}

/**
 * What the manager can show about a built-in *before* it is installed.
 *
 * Read out of the embedded files rather than off disk, because the whole point
 * is describing an app the owner does not have yet. A malformed embedded
 * manifest degrades to the id alone — a catalog read must never throw.
 */
export interface BuiltinMiniAppMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  /** The app's icon inlined as a `data:` URI, or empty. Same contract as the host catalog. */
  iconDataUri: string;
  toolNames: string[];
}

interface EmbeddedManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  ui?: { icon?: unknown };
  tools?: unknown;
}

function parseEmbeddedManifest(app: BuiltinMiniApp): EmbeddedManifest | null {
  try {
    const parsed = JSON.parse(app.files["manifest.json"] ?? "") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as EmbeddedManifest) : null;
  } catch {
    return null;
  }
}

export function builtinMiniAppMeta(app: BuiltinMiniApp): BuiltinMiniAppMeta {
  const manifest = parseEmbeddedManifest(app);
  const iconPath = typeof manifest?.ui?.icon === "string" ? manifest.ui.icon : "";
  const iconSource = iconPath ? app.files[iconPath] : undefined;
  return {
    id: app.id,
    name: typeof manifest?.name === "string" && manifest.name ? manifest.name : app.id,
    version: typeof manifest?.version === "string" ? manifest.version : "",
    description: typeof manifest?.description === "string" ? manifest.description : "",
    iconDataUri: iconSource
      ? `data:${iconPath.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${Buffer.from(iconSource, "utf8").toString("base64")}`
      : "",
    toolNames: Array.isArray(manifest?.tools)
      ? manifest.tools
          .map((tool) => (tool && typeof tool === "object" ? (tool as { name?: unknown }).name : null))
          .filter((name): name is string => typeof name === "string")
      : []
  };
}

/**
 * The version the *bundle* carries, read out of the embedded manifest.
 *
 * This is what an installed copy is compared against to decide whether an
 * update is on offer, so a malformed embedded manifest degrades to "no update
 * available" rather than throwing during a catalog read.
 */
export function builtinMiniAppVersion(app: BuiltinMiniApp): string {
  try {
    const parsed = JSON.parse(app.files["manifest.json"] ?? "") as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "";
  } catch {
    return "";
  }
}

/**
 * Writes a built-in's bundled files into `<codeRoot>/<id>`, replacing whatever
 * is there.
 *
 * Staged under a dot-prefixed sibling and renamed into place: a crash mid-write
 * must never leave a half-written app, and discovery skips dotted entries, so
 * the staging directory can never surface as a broken catalog row.
 *
 * Code only. The app's data lives under a different root and is never touched
 * here — that is the whole contract of an update.
 */
export function materializeBuiltinMiniApp(codeRoot: string, app: BuiltinMiniApp): void {
  const appDir = path.join(codeRoot, app.id);
  const stagingDir = path.join(codeRoot, `.${app.id}.installing`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  try {
    for (const [relativePath, content] of Object.entries(app.files)) {
      const target = path.join(stagingDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, appDir);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}
