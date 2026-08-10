import { isAbsolute, relative, resolve, sep } from "node:path";
import ignore from "ignore";

export interface FilesystemPolicy {
  /** Paths/globs the operator denied writes to. Takes precedence over allowWrite. */
  denyWrite?: string[];
  /** Present for symmetry with the sandbox config; see the note below. */
  allowWrite?: string[];
}

/**
 * Does the operator's filesystem policy deny writing this path?
 *
 * `toolSandbox.filesystem.denyWrite` was enforced for `bash` only, because bash
 * runs inside the sandbox that consumes the config. `write` and `edit` go
 * through `createPathGuard`, which answers a different question — "is this
 * inside an allowed root" — and knew nothing about the policy. An operator who
 * denied `*.key` still had two tools that would write `*.key` on request
 * (Permission Modes PRD, slice 0).
 *
 * ## Why this re-implements the check instead of calling the sandbox
 *
 * The sandbox hands `denyWrite` to `@anthropic-ai/sandbox-runtime`, which
 * enforces it in the OS (Seatbelt / bwrap) around a *process*. There is no
 * process here and nothing to wrap: the file tools write through `fs` in the
 * service. So this is necessarily a second enforcement point, and the honest
 * thing is to say so rather than to imply the two are one mechanism.
 *
 * What is shared is the *semantics*: the provider documents gitignore-style
 * globs (`*` does not cross `/`), and this uses the `ignore` package, the same
 * gitignore implementation the Project file surfaces already use — not a
 * hand-rolled matcher that would drift from it.
 *
 * Two deliberate differences from the provider, both in the safe direction:
 *
 * - A bare pattern with no slash (`.env`, `*.key`) matches at **any depth**,
 *   which is gitignore's own rule and what an operator writing `.env` means.
 * - `allowWrite` is accepted but never used to *grant*. Containment stays with
 *   `createPathGuard`; this predicate only ever denies. Letting a policy string
 *   widen where the file tools may write would make `allowWrite` a second,
 *   weaker path guard — exactly the "one path string, two meanings" failure in
 *   CLAUDE.md pitfall 6.
 *
 * Absence of a policy means no policy, never "deny everything": every existing
 * construction site passes nothing and must keep behaving as it did.
 */
export function isWriteDeniedByFilesystemPolicy(
  filePath: string,
  policy: FilesystemPolicy | undefined,
  root: string
): boolean {
  const patterns = (policy?.denyWrite ?? []).map((p) => String(p ?? "").trim()).filter(Boolean);
  if (patterns.length === 0) return false;

  const resolved = resolve(filePath);
  const matcher = ignore().add(patterns);

  // `ignore` refuses absolute paths, so test the path relative to the root. A
  // target outside the root has no meaningful relative form for the policy —
  // containment is `createPathGuard`'s job, so fall back to the basename, which
  // is what a bare `.env` / `*.key` pattern is about anyway.
  const rel = relative(resolve(root), resolved);
  const candidate = rel && !rel.startsWith("..") && !isAbsolute(rel)
    ? rel.split(sep).join("/")
    : resolved.split(sep).pop() ?? "";
  if (!candidate) return false;

  return matcher.ignores(candidate);
}

/**
 * Throws the error the file tools surface when the policy denies a write.
 * One message for both tools, naming the setting so the operator knows which
 * knob produced it.
 */
export function assertWriteAllowedByFilesystemPolicy(
  filePath: string,
  policy: FilesystemPolicy | undefined,
  root: string
): void {
  if (!isWriteDeniedByFilesystemPolicy(filePath, policy, root)) return;
  throw new Error(
    `Blocked by the sandbox filesystem policy (toolSandbox.filesystem.denyWrite): ${filePath}`
  );
}
