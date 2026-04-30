/**
 * 启动问候语系统：首次安装/版本更新 vs 普通重启
 */

import * as fs from "node:fs";
import path from "node:path";
import { getQQBotDataDir } from "./utils/platform.js";
import { getPluginVersion } from "./slash-commands.js";

const STARTUP_GREETING_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 按 accountId+appId 区分的 marker 文件路径 */
function getMarkerFile(accountId: string, appId: string): string {
  return path.join(getQQBotDataDir("data"), `startup-marker-${safeName(accountId)}-${safeName(appId)}.json`);
}

/** 旧版全局 marker 路径（兼容迁移） */
const LEGACY_MARKER_FILE = path.join(getQQBotDataDir("data"), "startup-marker.json");

export function getFirstLaunchGreetingText(): string {
  return `Haha，我的'灵魂'已上线，随时等你吩咐。`;
}

export function getUpgradeGreetingText(version: string): string {
  return `🎉 QQBot 插件已更新至 v${version}，在线等候你的吩咐。`;
}

export type StartupMarkerData = {
  version?: string;
  startedAt?: string;
  greetedAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastFailureVersion?: string;
};

export function readStartupMarker(accountId: string, appId: string): StartupMarkerData {
  try {
    // 1. 新版 per-bot 路径优先
    const file = getMarkerFile(accountId, appId);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as StartupMarkerData;
      return data || {};
    }
    // 2. fallback 旧版全局 marker（兼容迁移）
    if (fs.existsSync(LEGACY_MARKER_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEGACY_MARKER_FILE, "utf8")) as StartupMarkerData;
      if (data) {
        // 自动迁移：写到新路径
        writeStartupMarker(accountId, appId, data);
        return data;
      }
    }
  } catch {
    // 文件损坏或不存在，视为无 marker
  }
  return {};
}

export function writeStartupMarker(accountId: string, appId: string, data: StartupMarkerData): void {
  try {
    fs.writeFileSync(getMarkerFile(accountId, appId), JSON.stringify(data) + "\n");
  } catch {
    // ignore
  }
}

/**
 * 判断是否需要发送启动问候：
 * - 首次启动（无 marker）→ "灵魂已上线"
 * - 版本变更 → "已更新至 vX.Y.Z"
 * - 同版本 → 不发送
 * - 同版本近期失败 → 冷却期内不重试
 */
export function getStartupGreetingPlan(accountId: string, appId: string): { shouldSend: boolean; greeting?: string; version: string; reason?: string } {
  const currentVersion = getPluginVersion();
  const marker = readStartupMarker(accountId, appId);

  if (marker.version === currentVersion) {
    return { shouldSend: false, version: currentVersion, reason: "same-version" };
  }

  if (marker.lastFailureVersion === currentVersion && marker.lastFailureAt) {
    const lastFailureAtMs = new Date(marker.lastFailureAt).getTime();
    if (!Number.isNaN(lastFailureAtMs) && Date.now() - lastFailureAtMs < STARTUP_GREETING_RETRY_COOLDOWN_MS) {
      return { shouldSend: false, version: currentVersion, reason: "cooldown" };
    }
  }

  const isFirstLaunch = !marker.version;
  const greeting = isFirstLaunch
    ? getFirstLaunchGreetingText()
    : getUpgradeGreetingText(currentVersion);

  return { shouldSend: true, greeting, version: currentVersion };
}

export function markStartupGreetingSent(accountId: string, appId: string, version: string): void {
  writeStartupMarker(accountId, appId, {
    version,
    startedAt: new Date().toISOString(),
    greetedAt: new Date().toISOString(),
  });
}

export function markStartupGreetingFailed(accountId: string, appId: string, version: string, reason: string): void {
  const marker = readStartupMarker(accountId, appId);
  // 同版本已有失败记录时，不覆盖 lastFailureAt，避免冷却期被无限续期
  const shouldPreserveTimestamp = marker.lastFailureVersion === version && marker.lastFailureAt;
  writeStartupMarker(accountId, appId, {
    ...marker,
    lastFailureVersion: version,
    lastFailureAt: shouldPreserveTimestamp ? marker.lastFailureAt! : new Date().toISOString(),
    lastFailureReason: reason,
  });
}
