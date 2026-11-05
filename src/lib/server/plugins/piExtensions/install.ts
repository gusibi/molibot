import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import { extensionInstallDir, piExtensionsRootDir } from "$lib/server/plugins/piExtensions/paths.js";

export type PiExtensionSource = "npm" | "git";

export interface InstallPiExtensionRequest {
  source: PiExtensionSource;
  /** npm package spec (`name` / `name@version`) or a git clone URL. */
  spec: string;
  /** Install directory name; defaults to a name derived from the spec. */
  id?: string;
  /** Path inside the repository holding the extension (monorepo installs). */
  subdir?: string;
  /** Branch or tag to clone. */
  ref?: string;
}

export interface InstallPiExtensionResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** Command output on failure, so the settings page can show what went wrong. */
  log?: string;
}

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const NPM_SPEC_PATTERN = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.^~>=<|* -]+)?$/i;
// `file://` is allowed on purpose: it is how the owner installs an extension
// they are developing locally. It reads a repository the owner can already read,
// so it grants no access they did not have.
const GIT_URL_PATTERN = /^(?:https:\/\/|git@|file:\/\/)[\w.@:/~-]+?(?:\.git)?$/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/** Directory name for an install, derived from the spec when not given. */
export function deriveExtensionId(request: InstallPiExtensionRequest): string | null {
  if (request.id) return ID_PATTERN.test(request.id) ? request.id : null;

  if (request.source === "npm") {
    // Strip a scope and a trailing version range: `@scope/name@1.2.3` -> `name`.
    const withoutVersion = request.spec.replace(/^(@[^/]+\/)?([^@]+).*$/, "$2");
    const id = withoutVersion.split("/").pop() ?? "";
    return ID_PATTERN.test(id) ? id : null;
  }

  // For a monorepo install the extension's own directory names it better than
  // the repository does (`fff` vs `pi-fff`).
  const source = request.subdir
    ? request.subdir.split("/").filter(Boolean).pop() ?? ""
    : request.spec.replace(/\.git$/i, "").split(/[/:]/).pop() ?? "";
  return ID_PATTERN.test(source) ? source : null;
}

const SUBDIR_SEGMENT = /^[\w.-]+$/;
const GIT_REF_PATTERN = /^[\w.\/-]+$/;

function validateSpec(request: InstallPiExtensionRequest): string | null {
  const spec = request.spec.trim();
  if (!spec) return "Package or repository is required";
  if (request.source === "npm" && !NPM_SPEC_PATTERN.test(spec)) {
    return `Not a valid npm package spec: ${spec}`;
  }
  if (request.source === "git" && !GIT_URL_PATTERN.test(spec)) {
    return `Not a valid git URL: ${spec}`;
  }
  // These reach `git` argv and a path join, so validate them here too even
  // though resolveExtensionInput already checked the shapes it produces.
  if (request.ref !== undefined) {
    if (!GIT_REF_PATTERN.test(request.ref) || request.ref.startsWith("-")) {
      return `Not a valid git branch or tag: ${request.ref}`;
    }
  }
  if (request.subdir !== undefined) {
    const parts = request.subdir.split("/").filter(Boolean);
    if (parts.length === 0 || !parts.every((part) => SUBDIR_SEGMENT.test(part) && part !== "." && part !== "..")) {
      return `Not a valid subdirectory: ${request.subdir}`;
    }
  }
  return null;
}

interface CommandResult {
  ok: boolean;
  output: string;
}

/**
 * Run one install step. `shell: false` and an explicit argv keep the user's spec
 * from being interpreted by a shell even though it reached us over HTTP.
 */
function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, npm_config_yes: "true" }
    });

    const chunks: string[] = [];
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, output: chunks.join("").slice(-4000) });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      chunks.push(`\n${command} timed out after ${COMMAND_TIMEOUT_MS}ms`);
      finish(false);
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on("data", (data) => chunks.push(String(data)));
    child.stderr?.on("data", (data) => chunks.push(String(data)));
    child.on("error", (error) => {
      chunks.push(`\n${command} failed to start: ${error.message}`);
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });
}

/**
 * Entry points pi's loader would use for this directory: a `pi.extensions` list
 * in package.json, otherwise `index.ts` / `index.js`.
 */
function resolveEntries(dir: string): string[] {
  const packageJsonPath = join(dir, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { pi?: { extensions?: unknown } };
      const declared = parsed.pi?.extensions;
      if (Array.isArray(declared) && declared.length > 0) return [dir];
    } catch {
      // fall through to the index checks
    }
  }
  if (existsSync(join(dir, "extensions"))) return [dir];
  for (const candidate of ["index.ts", "index.js"]) {
    const entry = join(dir, candidate);
    if (existsSync(entry)) return [entry];
  }
  return [];
}

/**
 * Is the staged package actually a pi extension?
 *
 * A file check is not enough — almost every npm package ships an `index.js`, so
 * `is-odd` would pass. The only reliable test is the one pi itself applies:
 * load the entry point and see whether it exports an extension factory that
 * registers something. The factory runs here, which is the same code that would
 * run on the next load anyway.
 */
export async function validatePiExtensionDir(dir: string): Promise<{ ok: boolean; error?: string }> {
  const entries = resolveEntries(dir);
  if (entries.length === 0) {
    return {
      ok: false,
      error: "No pi extension entry point found (expected index.ts, index.js, or a package.json \"pi.extensions\" list)"
    };
  }

  // Validation executes third-party factories, so use the same bounded child
  // process as runtime loading. An absent agent dir excludes installed plugins.
  let loaded: Awaited<ReturnType<typeof loadPiExtensionsInProcess>> | undefined;
  try {
    loaded = await loadPiExtensionsInProcess({ cwd: dir, agentDir: join(dir, ".no-agent-dir"), extensionPaths: entries });
    if (loaded.errors.length > 0) return { ok: false, error: `Not a loadable pi extension: ${loaded.errors[0].error}` };
    const registersSomething = loaded.extensions.some((extension) =>
      extension.toolNames.length > 0 || extension.eventNames.length > 0
      || extension.commandNames.length > 0 || extension.flagNames.length > 0 || extension.unsupported.length > 0 || (extension.registrationCount ?? 0) > 0
    );
    return registersSomething ? { ok: true } : {
      ok: false, error: "This package loads but registers no tools, events or commands, so it is not a pi extension"
    };
  } catch (error) {
    return { ok: false, error: `Not a loadable pi extension: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    loaded?.client.dispose();
  }
}

/** The single directory npm unpacked into a staging dir (`node_modules/<name>`). */
function resolveNpmPackageDir(stagingDir: string, spec: string): string | null {
  const modulesDir = join(stagingDir, "node_modules");
  if (!existsSync(modulesDir)) return null;

  const packageName = spec.startsWith("@")
    ? spec.split("@").slice(0, 2).join("@").replace(/^@/, "@")
    : spec.split("@")[0];
  const direct = join(modulesDir, packageName);
  if (existsSync(direct) && statSync(direct).isDirectory()) return direct;

  // Fall back to the first non-scope directory npm created.
  for (const name of readdirSync(modulesDir)) {
    if (name.startsWith(".")) continue;
    const candidate = join(modulesDir, name);
    if (statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

/** Keep dependencies at their installed depth and point discovery at the selected package. */
function writeResourceManifest(layoutDir: string, packageDir: string, manifest: any, rootManifest = {}) {
  writeFileSync(join(layoutDir, "package.json"), JSON.stringify({
    ...rootManifest,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    pi: Object.fromEntries(["extensions", "skills", "prompts", "themes"].map((kind) => {
      const declared = manifest.pi?.[kind];
      const patterns = Array.isArray(declared) ? declared : kind === "extensions"
        ? (existsSync(join(packageDir, "extensions")) ? ["extensions"] : ["index.ts", "index.js"].filter((name) => existsSync(join(packageDir, name))))
        : existsSync(join(packageDir, kind)) ? [kind] : [];
      const prefix = relative(layoutDir, packageDir).split(sep).join("/");
      return [kind, patterns.map((pattern: string) => {
        const modifier = /^[!+-]/.test(pattern) ? pattern[0] : "";
        return `${modifier}${prefix}/${pattern.slice(modifier.length).replace(/^\.\//, "")}`;
      })];
    }))
  }));
}

/**
 * Install a third-party pi extension into `${DATA_DIR}/extensions/<id>`.
 *
 * Everything happens in a staging directory first: a failed download, a failed
 * dependency install, or a package with no loadable entry point leaves the
 * existing installation untouched. The move into place is the last step.
 */
export async function installPiExtension(
  request: InstallPiExtensionRequest
): Promise<InstallPiExtensionResult> {
  const specError = validateSpec(request);
  if (specError) return { ok: false, error: specError };

  const id = deriveExtensionId(request);
  if (!id) return { ok: false, error: "Could not derive a safe extension id; pass an explicit id" };

  const target = extensionInstallDir(id);
  if (!target) return { ok: false, error: `Unsafe extension id: ${id}` };

  const root = piExtensionsRootDir();
  mkdirSync(root, { recursive: true });
  const stagingDir = mkdtempSync(join(root, `.staging-${id}-`));

  try {
    let sourceDir = stagingDir;

    if (request.source === "npm") {
      const install = await run("npm", ["install", "--no-save", "--omit=dev", request.spec], stagingDir);
      if (!install.ok) return { ok: false, error: `npm install failed for ${request.spec}`, log: install.output };
      const packageDir = resolveNpmPackageDir(stagingDir, request.spec);
      if (!packageDir) return { ok: false, error: "npm install produced no package directory", log: install.output };
      // Keep npm's complete node_modules layout: dependencies can be hoisted
      // beside the package. Moving only the package loses them during cleanup.
      const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
      const entries = resolveEntries(packageDir);
      if (entries.length === 0) return { ok: false, error: "The npm package has no pi extension entry point" };
      writeResourceManifest(stagingDir, packageDir, manifest);
      sourceDir = stagingDir;
    } else {
      const cloneArgs = ["clone", "--depth", "1"];
      // `--` before the URL so a spec starting with `-` can never be read as a
      // git flag, even though validateSpec already rejects that shape.
      if (request.ref) cloneArgs.push("--branch", request.ref);
      cloneArgs.push("--", request.spec, "repo");

      const clone = await run("git", cloneArgs, stagingDir);
      if (!clone.ok) {
        return {
          ok: false,
          error: request.ref
            ? `git clone failed for ${request.spec} (branch ${request.ref})`
            : `git clone failed for ${request.spec}`,
          log: clone.output
        };
      }

      const repoDir = join(stagingDir, "repo");
      rmSync(join(repoDir, ".git"), { recursive: true, force: true });

      // Monorepo link: the extension is one directory inside the clone.
      sourceDir = request.subdir ? join(repoDir, request.subdir) : repoDir;
      if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
        return {
          ok: false,
          error: `The repository has no directory "${request.subdir}"`,
          log: clone.output
        };
      }

      const hasOwnManifest = existsSync(join(sourceDir, "package.json"));
      const manifestDir = hasOwnManifest ? sourceDir : existsSync(join(repoDir, "package.json")) ? repoDir : null;
      if (manifestDir) {
        const deps = await run("npm", ["install", "--omit=dev"], manifestDir);
        if (!deps.ok) {
          momWarn("plugins", "pi_extension_install_deps_failed", { id, spec: request.spec });
          return { ok: false, error: "Dependency install failed for the cloned repository", log: deps.output };
        }
      }
      if (sourceDir !== repoDir) {
        let borrowsDependencies = false;
        for (let parent = dirname(sourceDir); parent !== dirname(repoDir); parent = dirname(parent)) {
          if (existsSync(join(parent, "node_modules"))) { borrowsDependencies = true; break; }
        }
        if ((!hasOwnManifest && manifestDir === repoDir) || borrowsDependencies) {
          // npm workspaces may hoist dependencies even when the child has its
          // own manifest. Preserve their installed depth, not just the child.
          if (!resolveEntries(sourceDir).length) return { ok: false, error: "The repository subdirectory has no pi extension entry point" };
          const rootManifest = existsSync(join(repoDir, "package.json")) ? JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8")) : {};
          const manifest = hasOwnManifest ? JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8")) : { name: id, version: rootManifest.version, description: rootManifest.description };
          writeResourceManifest(repoDir, sourceDir, manifest, rootManifest);
          sourceDir = repoDir;
        }
      }
    }

    const validation = await validatePiExtensionDir(sourceDir);
    if (!validation.ok) return { ok: false, error: validation.error };

    // Replace atomically enough for a restartless reload: the old directory is
    // only removed once the new one is fully staged and validated.
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(sourceDir, target);

    momLog("plugins", "pi_extension_installed", {
      id,
      source: request.source,
      spec: request.spec,
      ref: request.ref,
      subdir: request.subdir
    });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function uninstallPiExtension(id: string): InstallPiExtensionResult {
  const target = extensionInstallDir(id);
  if (!target) return { ok: false, error: `Unsafe extension id: ${id}` };
  if (!existsSync(target)) return { ok: false, error: `Extension is not installed: ${id}` };

  rmSync(target, { recursive: true, force: true });
  momLog("plugins", "pi_extension_uninstalled", { id });
  return { ok: true, id };
}
