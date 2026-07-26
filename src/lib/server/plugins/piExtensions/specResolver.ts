/**
 * Turns whatever the user pasted into a concrete install instruction.
 *
 * People do not carry install specs around — they carry the link they were
 * looking at. That is an npm package page, a GitHub repo, or (very often for pi
 * extensions, which frequently live in monorepos) a GitHub subdirectory URL.
 * Requiring them to translate that into "source = git, spec = clone URL" pushes
 * a mechanical step onto the user that the code can do.
 */

export interface ResolvedExtensionSpec {
  source: "npm" | "git";
  /** npm package spec, or a clone URL for git. */
  spec: string;
  /** Path inside the repository holding the extension (monorepo links). */
  subdir?: string;
  /** Branch or tag to clone, when the link named one. */
  ref?: string;
  /** Install directory name. */
  id: string;
  /** How the input was understood, for showing the user what will happen. */
  kind: "npm-name" | "npm-url" | "git-url" | "git-subdir" | "git-ssh";
}

export type ResolveExtensionInputResult =
  | { ok: true; resolved: ResolvedExtensionSpec }
  | { ok: false; error: string; hint?: string };

const NPM_NAME = /^(?:(@[a-z0-9][\w.-]*)\/)?([a-z0-9][\w.-]*)(@[\w.^~>=<|*+-]+)?$/i;
const ID_SAFE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Package name without a scope or version range, used as the directory name. */
function idFromPackageName(name: string): string | null {
  const bare = name.replace(/^@[^/]+\//, "").replace(/@[^@]*$/, "");
  return ID_SAFE.test(bare) ? bare : null;
}

function idFromPath(segment: string): string | null {
  const bare = segment.replace(/\.git$/i, "");
  return ID_SAFE.test(bare) ? bare : null;
}

export function resolveExtensionInput(rawInput: string): ResolveExtensionInputResult {
  const input = rawInput.trim().replace(/\/+$/, "");
  if (!input) return { ok: false, error: "Nothing to install" };

  // file:///path/to/repo — installing a locally developed extension.
  if (input.startsWith("file://")) {
    const path = input.slice("file://".length);
    const tail = path.split("/").filter(Boolean).pop() ?? "";
    const id = idFromPath(tail);
    if (!id) return { ok: false, error: `Could not read a repository name from: ${input}` };
    return { ok: true, resolved: { source: "git", spec: input, id, kind: "git-url" } };
  }

  // git@host:owner/repo.git
  if (input.startsWith("git@")) {
    const tail = input.split(/[/:]/).pop() ?? "";
    const id = idFromPath(tail);
    if (!id) return { ok: false, error: `Could not read a repository name from: ${input}` };
    return { ok: true, resolved: { source: "git", spec: input, id, kind: "git-ssh" } };
  }

  // Bare package name (with or without scope/version). Checked before URL
  // parsing so `pi-subagents` is never mistaken for a host name.
  if (!input.includes("://") && NPM_NAME.test(input)) {
    const id = idFromPackageName(input);
    if (!id) return { ok: false, error: `Could not derive a safe directory name from: ${input}` };
    return { ok: true, resolved: { source: "npm", spec: input, id, kind: "npm-name" } };
  }

  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return {
      ok: false,
      error: `Not a package name or a URL: ${input}`,
      hint: "Use an npm package name (pi-subagents), an npm page URL, or a GitHub/GitLab repository URL."
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: `Unsupported URL scheme: ${url.protocol}` };
  }

  const segments = url.pathname.split("/").filter(Boolean);

  // npmjs.com/package/<name> or npmjs.com/package/@scope/<name>
  if (/(^|\.)npmjs\.com$/i.test(url.hostname)) {
    const packageIndex = segments.indexOf("package");
    const nameParts = packageIndex >= 0 ? segments.slice(packageIndex + 1) : [];
    // A `/v/1.2.3` suffix on the page URL is version navigation, not part of the name.
    const versionIndex = nameParts.indexOf("v");
    const cleaned = versionIndex >= 0 ? nameParts.slice(0, versionIndex) : nameParts;
    const version = versionIndex >= 0 ? nameParts[versionIndex + 1] : undefined;
    const name = cleaned.join("/");
    if (!name) {
      return {
        ok: false,
        error: `Could not read a package name from: ${input}`,
        hint: "An npm link should look like https://www.npmjs.com/package/<name>."
      };
    }
    const id = idFromPackageName(name);
    if (!id) return { ok: false, error: `Could not derive a safe directory name from: ${name}` };
    return {
      ok: true,
      resolved: {
        source: "npm",
        spec: version ? `${name}@${version}` : name,
        id,
        kind: "npm-url"
      }
    };
  }

  if (segments.length < 2) {
    return {
      ok: false,
      error: `Not a repository URL: ${input}`,
      hint: "A repository link should include an owner and a repository name."
    };
  }

  const [owner, repoRaw, ...rest] = segments;
  const repo = repoRaw.replace(/\.git$/i, "");
  const cloneUrl = `${url.protocol}//${url.hostname}/${owner}/${repo}.git`;

  // GitHub/GitLab deep links: /tree/<ref>/<path>, /blob/<ref>/<path>,
  // and GitLab's /-/tree/<ref>/<path>.
  const deepLink = rest[0] === "-" ? rest.slice(1) : rest;
  if (deepLink.length > 0 && (deepLink[0] === "tree" || deepLink[0] === "blob")) {
    const ref = deepLink[1];
    const pathParts = deepLink.slice(2);
    if (!ref) {
      return { ok: false, error: `Could not read a branch from: ${input}` };
    }
    if (pathParts.length === 0) {
      // Repo root at a specific branch.
      const id = idFromPath(repo);
      if (!id) return { ok: false, error: `Could not derive a safe directory name from: ${repo}` };
      return { ok: true, resolved: { source: "git", spec: cloneUrl, ref, id, kind: "git-url" } };
    }
    // `new URL` collapses literal `..`, but leaves percent-encoded traversal
    // (`%2e%2e`) alone, so decode before validating and whitelist the shape of
    // each segment rather than blacklisting known-bad ones.
    let decodedParts: string[];
    try {
      decodedParts = pathParts.map((part) => decodeURIComponent(part));
    } catch {
      return { ok: false, error: `Unreadable path in link: ${pathParts.join("/")}` };
    }
    if (!decodedParts.every((part) => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) {
      return { ok: false, error: `Unsafe path in link: ${decodedParts.join("/")}` };
    }
    const subdir = decodedParts.join("/");
    // The extension's own directory name is a better id than the monorepo's.
    const id = idFromPath(decodedParts[decodedParts.length - 1]);
    if (!id) return { ok: false, error: `Could not derive a safe directory name from: ${subdir}` };
    return { ok: true, resolved: { source: "git", spec: cloneUrl, subdir, ref, id, kind: "git-subdir" } };
  }

  if (rest.length > 0) {
    return {
      ok: false,
      error: `Could not tell which part of this URL is the extension: ${input}`,
      hint: "Use the repository root, or a /tree/<branch>/<path> link pointing at the extension directory."
    };
  }

  const id = idFromPath(repo);
  if (!id) return { ok: false, error: `Could not derive a safe directory name from: ${repo}` };
  return { ok: true, resolved: { source: "git", spec: cloneUrl, id, kind: "git-url" } };
}

/** One-line description of what an install will do, for confirmation UI. */
export function describeResolvedSpec(resolved: ResolvedExtensionSpec): string {
  if (resolved.source === "npm") return `npm package ${resolved.spec}`;
  const parts = [`git ${resolved.spec}`];
  if (resolved.ref) parts.push(`branch ${resolved.ref}`);
  if (resolved.subdir) parts.push(`subdirectory ${resolved.subdir}`);
  return parts.join(", ");
}
