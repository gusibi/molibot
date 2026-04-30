import type { Agent } from "./agent/interface.js";
import { notifyStart, notifyStop } from "./api/api.js";
import {
  clearAllWeixinAccounts,
  DEFAULT_BASE_URL,
  listWeixinAccountIds,
  loadWeixinAccount,
  normalizeAccountId,
  registerWeixinAccountId,
  resolveWeixinAccount,
  saveWeixinAccount,
} from "./auth/accounts.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  displayQRCode,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "./auth/login-qr.js";
import { monitorWeixinProvider } from "./monitor/monitor.js";
import { logger } from "./util/logger.js";

export type LoginOptions = {
  /** Override the API base URL. */
  baseUrl?: string;
  /** Log callback (defaults to console.log). */
  log?: (msg: string) => void;
};

export type StartOptions = {
  /** Account ID to use. Auto-selects the first registered account if omitted. */
  accountId?: string;
  /** AbortSignal to stop the bot. */
  abortSignal?: AbortSignal;
  /** Log callback (defaults to console.log). */
  log?: (msg: string) => void;
};

/**
 * Interactive QR-code login. Prints the QR code to the terminal and waits
 * for the user to scan it with WeChat.
 *
 * Returns the normalized account ID on success.
 */
export async function login(opts?: LoginOptions): Promise<string> {
  const log = opts?.log ?? console.log;
  const apiBaseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL;

  log("正在启动...");

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!startResult.qrcodeUrl) {
    throw new Error(startResult.message);
  }

  log("\n用手机微信扫描以下二维码，以继续连接：\n");
  await displayQRCode(startResult.qrcodeUrl);

  log("\n正在等待操作...\n");

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl,
    timeoutMs: 480_000,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    throw new Error(waitResult.message);
  }

  const normalizedId = normalizeAccountId(waitResult.accountId);
  saveWeixinAccount(normalizedId, {
    token: waitResult.botToken,
    baseUrl: waitResult.baseUrl,
    userId: waitResult.userId,
  });
  registerWeixinAccountId(normalizedId);

  log("\n已将此 OpenClaw 连接到微信。");
  return normalizedId;
}

/**
 * Remove all stored WeChat account credentials.
 */
export function logout(opts?: { log?: (msg: string) => void }): void {
  const log = opts?.log ?? console.log;
  const ids = listWeixinAccountIds();
  if (ids.length === 0) {
    log("当前没有已登录的账号");
    return;
  }
  clearAllWeixinAccounts();
  log("✅ 已退出登录");
}

/**
 * Check whether at least one WeChat account is logged in and configured.
 */
export function isLoggedIn(): boolean {
  const ids = listWeixinAccountIds();
  if (ids.length === 0) return false;
  const account = resolveWeixinAccount(ids[0]);
  return account.configured;
}

/**
 * Start the bot — long-polls for new messages and dispatches them to the agent.
 * Blocks until the abort signal fires or an unrecoverable error occurs.
 */
export async function start(agent: Agent, opts?: StartOptions): Promise<void> {
  const log = opts?.log ?? console.log;

  // Resolve account
  let accountId = opts?.accountId;
  if (!accountId) {
    const ids = listWeixinAccountIds();
    if (ids.length === 0) {
      throw new Error("没有已登录的账号，请先运行 login");
    }
    accountId = ids[0];
    if (ids.length > 1) {
      log(`[weixin] 检测到多个账号，使用第一个: ${accountId}`);
    }
  }

  const account = resolveWeixinAccount(accountId);
  if (!account.configured) {
    throw new Error(
      `账号 ${accountId} 未配置 (缺少 token)，请先运行 login`,
    );
  }

  log(`[weixin] 启动 bot, account=${account.accountId}`);

  try {
    const resp = await notifyStart({ baseUrl: account.baseUrl, token: account.token });
    if (resp.ret !== undefined && resp.ret !== 0) {
      log(`[weixin] notifyStart returned ret=${resp.ret} errmsg=${resp.errmsg ?? ""}`);
    }
  } catch (err) {
    log(`[weixin] notifyStart failed (ignored): ${String(err)}`);
  }

  try {
    await monitorWeixinProvider({
      baseUrl: account.baseUrl,
      cdnBaseUrl: account.cdnBaseUrl,
      token: account.token,
      accountId: account.accountId,
      agent,
      abortSignal: opts?.abortSignal,
      log,
    });
  } finally {
    try {
      const resp = await notifyStop({ baseUrl: account.baseUrl, token: account.token });
      if (resp.ret !== undefined && resp.ret !== 0) {
        log(`[weixin] notifyStop returned ret=${resp.ret} errmsg=${resp.errmsg ?? ""}`);
      }
    } catch (err) {
      log(`[weixin] notifyStop failed (ignored): ${String(err)}`);
    }
  }
}
