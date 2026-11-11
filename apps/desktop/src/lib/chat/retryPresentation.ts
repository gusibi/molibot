import type { DesktopConversationActivity } from "@molibot/desktop-contract";
import type { Translation } from "../i18n";

export function retryActivityLabel(activity: DesktopConversationActivity, copy: Translation): string {
  const retry = activity.retry;
  if (!retry) return activity.label;
  return (retry.phase === "recovered" ? copy.appRetryRecovered : retry.phase === "cancelled" ? copy.appRetryStopped : retry.phase === "failed" ? copy.appRetryFailed
    : retry.phase === "attempt_start" ? copy.appRetryAttempt : copy.appRetryCountdown)
    .replace("{seconds}", String(retry.remainingSeconds)).replace("{attempt}", String(retry.attempt)).replace("{max}", String(retry.maxRetries));
}
