import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BASE_URL,
  clearWeixinAccount,
  listWeixinAccountIds,
  loadWeixinAccount,
  normalizeAccountId,
  registerWeixinAccountId,
  saveWeixinAccount
} from "#weixin-agent-sdk/src/auth/accounts.js";
import {
  startWeixinLoginWithQr,
  waitForWeixinLogin
} from "#weixin-agent-sdk/src/auth/login-qr.js";

const DEFAULT_TOKEN_DIR = path.join(os.homedir(), ".weixin-agent-sdk");
const DEFAULT_TOKEN_PATH = path.join(DEFAULT_TOKEN_DIR, "credentials.json");

export interface Credentials {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
}

export interface LoginOptions {
  baseUrl?: string;
  tokenPath?: string;
  force?: boolean;
}

function resolveTokenPath(tokenPath?: string): string {
  return tokenPath ?? DEFAULT_TOKEN_PATH;
}

function log(message: string): void {
  process.stderr.write(`[weixin-agent-sdk] ${message}\n`);
}

async function saveCredentials(credentials: Credentials, tokenPath?: string): Promise<void> {
  const normalizedAccountId = normalizeAccountId(credentials.accountId);
  saveWeixinAccount(normalizedAccountId, {
    token: credentials.token,
    baseUrl: credentials.baseUrl,
    userId: credentials.userId
  });
  registerWeixinAccountId(normalizedAccountId);

  if (!tokenPath) return;
  const targetPath = resolveTokenPath(tokenPath);
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  await writeFile(targetPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(targetPath, 0o600);
}

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.token === "string" &&
    typeof candidate.baseUrl === "string" &&
    typeof candidate.accountId === "string" &&
    typeof candidate.userId === "string";
}

async function printQrInstructions(url: string): Promise<void> {
  log("在微信中打开以下链接完成登录:");
  process.stderr.write(`${url}\n`);
}

export async function loadCredentials(tokenPath?: string): Promise<Credentials | undefined> {
  if (tokenPath) {
    const targetPath = resolveTokenPath(tokenPath);
    try {
      const raw = await readFile(targetPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isCredentials(parsed)) {
        throw new Error(`Invalid credentials format in ${targetPath}`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return undefined;
    }
  }

  const accountId = listWeixinAccountIds()[0];
  if (!accountId) return undefined;
  const account = loadWeixinAccount(accountId);
  if (!account?.token) return undefined;
  return {
    token: account.token,
    baseUrl: account.baseUrl || DEFAULT_BASE_URL,
    accountId,
    userId: account.userId || accountId
  };
}

async function clearLocalCredentials(tokenPath?: string): Promise<Credentials | undefined> {
  if (!tokenPath) return undefined;
  let existing: Credentials | undefined;
  try {
    const raw = await readFile(resolveTokenPath(tokenPath), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    existing = isCredentials(parsed) ? parsed : undefined;
  } catch {
    existing = undefined;
  }
  await rm(resolveTokenPath(tokenPath), { force: true });
  return existing;
}

export async function clearCredentials(tokenPath?: string): Promise<void> {
  const existing = await clearLocalCredentials(tokenPath);
  if (existing?.accountId) {
    clearWeixinAccount(normalizeAccountId(existing.accountId));
    return;
  }

  if (!tokenPath) {
    const accountId = listWeixinAccountIds()[0];
    if (accountId) {
      clearWeixinAccount(normalizeAccountId(accountId));
    }
  }
}

export async function login(options: LoginOptions = {}): Promise<Credentials> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  if (!options.force) {
    const existing = await loadCredentials(options.tokenPath);
    if (existing) return existing;
  }

  for (;;) {
    const startResult = await startWeixinLoginWithQr({
      apiBaseUrl: baseUrl,
      force: true
    });
    if (!startResult.qrcodeUrl) {
      throw new Error(startResult.message || "Failed to start Weixin QR login");
    }
    await printQrInstructions(startResult.qrcodeUrl);

    const waitResult = await waitForWeixinLogin({
      sessionKey: startResult.sessionKey,
      apiBaseUrl: baseUrl,
      timeoutMs: 480_000
    });
    if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId || !waitResult.userId) {
      if (/过期|超时|expired/i.test(waitResult.message || "")) {
        log("QR code expired. Requesting a new one...");
        continue;
      }
      throw new Error(waitResult.message || "Weixin QR login failed");
    }

    const credentials: Credentials = {
      token: waitResult.botToken,
      baseUrl: waitResult.baseUrl ?? baseUrl,
      accountId: waitResult.accountId,
      userId: waitResult.userId
    };
    await saveCredentials(credentials, options.tokenPath);
    return credentials;
  }
}

export { DEFAULT_TOKEN_PATH };
