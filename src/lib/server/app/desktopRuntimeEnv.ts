import { spawnSync } from "node:child_process";
import type {
  DesktopRuntimeDependency,
  DesktopRuntimeEnvSummary,
  DesktopRuntimeDepStatus
} from "$lib/shared/desktop";

/**
 * A declared optional runtime dependency (plan §10). The Desktop Runtime
 * environment page surfaces these read-only; installation is a separate
 * per-item authorized action, not part of this contract.
 */
export interface RuntimeDependencySpec {
  id: string;
  name: string;
  purpose: string;
  /** `brew install` formula name, or null when not Homebrew-installable. */
  brewFormula: string | null;
  /** Approximate installed size for display. */
  estimatedSize: string;
  /** How this dependency would be installed (controls the install command). */
  installSource: "homebrew" | "tooling" | "system";
  /** A `--version` style arg to probe the resolved binary. */
  versionArg: string;
}

/**
 * The optional tools the plan calls out (§10): ffmpeg for media, Git for
 * version control / skills, Python for skill dependencies, Node is bundled.
 * Node is intentionally omitted from detection because the bundled sidecar
 * already satisfies it — the page only lists tools the user may need to add.
 */
export const DESKTOP_RUNTIME_DEPENDENCIES: readonly RuntimeDependencySpec[] = [
  {
    id: "ffmpeg",
    name: "ffmpeg",
    purpose: "Media encoding/decoding for audio and video features",
    brewFormula: "ffmpeg",
    estimatedSize: "~90 MB",
    installSource: "homebrew",
    versionArg: "-version"
  },
  {
    id: "git",
    name: "git",
    purpose: "Version control and skill workflows",
    brewFormula: "git",
    estimatedSize: "~60 MB",
    installSource: "homebrew",
    versionArg: "--version"
  },
  {
    id: "python3",
    name: "python3",
    purpose: "Python skill dependencies and tooling",
    brewFormula: "python@3.12",
    estimatedSize: "~120 MB",
    installSource: "homebrew",
    versionArg: "--version"
  }
];

/**
 * Result of probing one dependency on disk. Injectable so the pure mapper can
 * be unit-tested without spawning processes.
 */
export interface RuntimeDependencyDetection {
  id: string;
  status: DesktopRuntimeDepStatus;
  /** First-line version output, trimmed; empty when not installed. */
  version: string;
  /** "homebrew" when resolved under a Homebrew prefix, else "system". */
  source: string;
}

/**
 * Looks up a binary on PATH without throwing. Returns the resolved path or null.
 * Split out so detection is testable with an injected resolver.
 */
export type WhichResolver = (binary: string) => string | null;

/**
 * Default resolver: `command -v <binary>` via a login-less shell. Returns null
 * on any error so a missing tool is reported as "missing", never as a crash.
 */
export function defaultWhichResolver(): WhichResolver {
  return (binary: string) => {
    const result = spawnSync("sh", ["-c", `command -v ${JSON.stringify(binary)}`], {
      encoding: "utf8",
      timeout: 4000
    });
    if (result.error || result.status !== 0) return null;
    const resolved = (result.stdout ?? "").trim();
    return resolved || null;
  };
}

/**
 * Probes a single dependency: resolves it on PATH, runs its version arg, and
 * classifies the source. Never throws — a failed probe yields "missing".
 */
export function detectRuntimeDependency(
  spec: RuntimeDependencySpec,
  resolve: WhichResolver = defaultWhichResolver()
): RuntimeDependencyDetection {
  const resolved = resolve(spec.name);
  if (!resolved) {
    return { id: spec.id, status: "missing", version: "", source: "" };
  }
  const source = resolved.includes("/homebrew/") || resolved.includes("/opt/homebrew/")
    ? "homebrew"
    : "system";

  let version = "";
  try {
    const result = spawnSync(spec.name, [spec.versionArg], {
      encoding: "utf8",
      timeout: 4000
    });
    const firstLine = (result.stdout || result.stderr || "").split("\n")[0] ?? "";
    version = firstLine.trim();
  } catch {
    version = "";
  }

  return {
    id: spec.id,
    status: version ? "installed" : "unknown",
    version,
    source
  };
}

/**
 * Formats the exact install command a user would run for a spec. Homebrew
 * deps use `brew install <formula>`; tooling deps install under
 * `~/.molibot/tooling`. Never includes `sudo`, global `npm -g`, or system
 * Python modification (plan §10).
 */
export function formatRuntimeInstallCommand(spec: RuntimeDependencySpec): string {
  if (spec.installSource === "homebrew" && spec.brewFormula) {
    return `brew install ${spec.brewFormula}`;
  }
  if (spec.installSource === "tooling") {
    return `pip install --target ~/.molibot/tooling ${spec.name}`;
  }
  return "";
}

/**
 * Pure mapper: projects a detection + spec into a credential/path-safe Desktop
 * view. The resolved binary path is dropped — only the source category
 * ("homebrew"/"system") survives. Build field-by-field, never spread the
 * detection (§11 invariant).
 */
export function buildDesktopRuntimeDependency(
  spec: RuntimeDependencySpec,
  detection: RuntimeDependencyDetection
): DesktopRuntimeDependency {
  return {
    id: spec.id,
    name: spec.name,
    purpose: spec.purpose,
    status: detection.status,
    version: detection.version,
    source: detection.source || "system",
    estimatedSize: spec.estimatedSize,
    installCommand: formatRuntimeInstallCommand(spec),
    installSource: spec.installSource
  };
}

/**
 * Builds the read-only Runtime environment summary from the declared specs and
 * their detections. Pure given the detections — the route injects live
 * detections at request time.
 */
export function buildDesktopRuntimeEnvSummary(
  specs: readonly RuntimeDependencySpec[],
  detections: readonly RuntimeDependencyDetection[]
): DesktopRuntimeEnvSummary {
  const byId = new Map(detections.map((d) => [d.id, d]));
  const dependencies = specs.map((spec) =>
    buildDesktopRuntimeDependency(spec, byId.get(spec.id) ?? { id: spec.id, status: "unknown", version: "", source: "" })
  );
  const installed = dependencies.filter((d) => d.status === "installed").length;
  const missing = dependencies.filter((d) => d.status === "missing").length;
  return {
    dependencies,
    counts: { total: dependencies.length, installed, missing }
  };
}
