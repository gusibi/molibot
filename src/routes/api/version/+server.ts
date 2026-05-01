import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import { join, resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

interface PackageInfo {
  version?: string;
}

interface RemoteVersionResult {
  version: string;
  source: "release" | "package";
  url?: string;
}

const DEFAULT_GITHUB_REPO = "https://github.com/gusibi/molibot";
const DEFAULT_GITHUB_REF = "master";

function expandHomePath(input: string): string {
  if (!input.startsWith("~")) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return join(os.homedir(), input.slice(2));
  return input;
}

function resolveDataDir(): string {
  const raw = String(process.env.DATA_DIR || join(os.homedir(), ".molibot")).trim();
  return resolve(expandHomePath(raw || join(os.homedir(), ".molibot")));
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

function readDeployConfig(): Record<string, string> {
  const configPath = process.env.MOLIBOT_DEPLOY_CONFIG
    ? resolve(expandHomePath(process.env.MOLIBOT_DEPLOY_CONFIG))
    : join(resolveDataDir(), "deploy.env");
  if (!existsSync(configPath)) return {};

  const out: Record<string, string> = {};
  for (const line of readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = parseEnvValue(trimmed.slice(eq + 1));
  }
  return out;
}

function readCurrentVersion(): string {
  try {
    const packagePath = join(process.cwd(), "package.json");
    const info = JSON.parse(readFileSync(packagePath, "utf8")) as PackageInfo;
    return String(info.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function parseGitHubRepo(raw: string): { owner: string; repo: string } | null {
  const source = raw.trim();
  if (!source) return null;

  const ssh = source.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, "") };

  try {
    const url = new URL(source);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = Number.isFinite(left[i]) ? left[i] : 0;
    const r = Number.isFinite(right[i]) ? right[i] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "molibot-version-check"
  };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      headers: githubHeaders(),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteVersion(owner: string, repo: string, ref: string): Promise<RemoteVersionResult | null> {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`) as {
      tag_name?: string;
      html_url?: string;
    };
    if (release.tag_name) {
      return {
        version: normalizeVersion(release.tag_name),
        source: "release",
        url: release.html_url
      };
    }
  } catch {
    // Some repos do not publish GitHub releases. Fall back to package.json on the configured branch.
  }

  const encodedRef = encodeURIComponent(ref || DEFAULT_GITHUB_REF);
  const pkg = await fetchJson(`https://raw.githubusercontent.com/${owner}/${repo}/${encodedRef}/package.json`) as PackageInfo;
  if (!pkg.version) return null;
  return {
    version: normalizeVersion(pkg.version),
    source: "package",
    url: `https://github.com/${owner}/${repo}/blob/${encodedRef}/package.json`
  };
}

export const GET: RequestHandler = async () => {
  const deployConfig = readDeployConfig();
  const repoUrl = String(process.env.MOLIBOT_GIT_REPO || deployConfig.MOLIBOT_GIT_REPO || DEFAULT_GITHUB_REPO).trim();
  const ref = String(process.env.MOLIBOT_GIT_REF || deployConfig.MOLIBOT_GIT_REF || DEFAULT_GITHUB_REF).trim() || DEFAULT_GITHUB_REF;
  const currentVersion = normalizeVersion(readCurrentVersion());
  const repo = parseGitHubRepo(repoUrl);

  if (!repo) {
    return json({
      ok: true,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      remoteConfigured: false,
      repositoryUrl: repoUrl || null,
      error: repoUrl ? "Configured repository is not a GitHub URL." : "GitHub repository is not configured."
    });
  }

  try {
    const remote = await fetchRemoteVersion(repo.owner, repo.repo, ref);
    if (!remote) {
      throw new Error("Remote version not found.");
    }

    return json({
      ok: true,
      currentVersion,
      latestVersion: remote.version,
      updateAvailable: compareVersions(remote.version, currentVersion) > 0,
      checkedAt: new Date().toISOString(),
      remoteConfigured: true,
      remoteSource: remote.source,
      remoteUrl: remote.url,
      repositoryUrl: repoUrl,
      repository: `${repo.owner}/${repo.repo}`,
      ref
    });
  } catch (error) {
    return json({
      ok: false,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      remoteConfigured: true,
      repositoryUrl: repoUrl,
      repository: `${repo.owner}/${repo.repo}`,
      ref,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 502 });
  }
};
