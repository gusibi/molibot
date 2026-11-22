import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { detectTextEncoding, isInside, looksBinary } from "$lib/server/projects/inspection.js";
import type { DurableExecutionDetail, FollowUpObservation, FollowUpSourceRef, ObservationStatus } from "./types.js";

export const FOLLOW_UP_MAX_PROJECT_FILES = 3;
export const FOLLOW_UP_MAX_PLANS = 1;
export const FOLLOW_UP_MAX_EXECUTIONS = 1;
export const FOLLOW_UP_MAX_FILE_BYTES = 64 * 1024;

export interface ObservedSource {
  kind: FollowUpSourceRef["kind"];
  sourceKey: string;
  status: ObservationStatus;
  contentHash?: string;
  errorCode?: string;
  textContent?: string;
  readAt: string;
}

export function sourceKeyFor(source: FollowUpSourceRef): string {
  if (source.kind === "project_file") return source.relativePath.replace(/\\/g, "/").trim();
  if (source.kind === "plan") return source.planId.trim();
  return source.executionId.trim();
}

export function observeFollowUpSources(input: {
  ownerId?: string;
  projectId?: string;
  workDir?: string;
  sources: FollowUpSourceRef[];
  previousObservations: Map<string, FollowUpObservation>;
  readExecutionDetail?: (executionId: string) => DurableExecutionDetail | null;
  now?: Date;
}): { observations: ObservedSource[]; fingerprint: string } {
  const readAt = (input.now ?? new Date()).toISOString();
  const observations: ObservedSource[] = [];
  let fileCount = 0;
  let planCount = 0;
  let executionCount = 0;

  for (const source of input.sources) {
    const key = sourceKeyFor(source);
    const prev = input.previousObservations.get(`${source.kind}:${key}`);
    if (source.kind === "project_file") {
      fileCount += 1;
      if (fileCount > FOLLOW_UP_MAX_PROJECT_FILES) {
        observations.push({
          kind: "project_file",
          sourceKey: key,
          status: "unavailable",
          errorCode: "file_limit_exceeded",
          readAt
        });
        continue;
      }
      observations.push(observeProjectFile(input.workDir, key, prev, readAt));
      continue;
    }

    if (source.kind === "plan") {
      planCount += 1;
      if (planCount > FOLLOW_UP_MAX_PLANS) {
        observations.push({ kind: "plan", sourceKey: key, status: "unavailable", errorCode: "plan_limit_exceeded", readAt });
        continue;
      }
      observations.push(observeDurableTarget("plan", key, input.ownerId, input.projectId, input.readExecutionDetail, prev, readAt));
      continue;
    }

    executionCount += 1;
    if (executionCount > FOLLOW_UP_MAX_EXECUTIONS) {
      observations.push({ kind: "execution", sourceKey: key, status: "unavailable", errorCode: "execution_limit_exceeded", readAt });
      continue;
    }
    observations.push(observeDurableTarget("execution", key, input.ownerId, input.projectId, input.readExecutionDetail, prev, readAt));
  }

  const fingerprint = computeEvidenceFingerprint(observations);
  return { observations, fingerprint };
}

function observeDurableTarget(
  kind: "plan" | "execution",
  targetId: string,
  ownerId: string | undefined,
  projectId: string | undefined,
  readExecutionDetail: ((executionId: string) => DurableExecutionDetail | null) | undefined,
  prev: FollowUpObservation | undefined,
  readAt: string
): ObservedSource {
  if (!readExecutionDetail) {
    return { kind, sourceKey: targetId, status: "unavailable", errorCode: "reader_unavailable", readAt };
  }
  const detail = readExecutionDetail(targetId);
  if (!detail) {
    return { kind, sourceKey: targetId, status: "unavailable", errorCode: "source_not_found", readAt };
  }
  if (ownerId && detail.execution.ownerId !== ownerId) {
    return { kind, sourceKey: targetId, status: "unavailable", errorCode: "owner_mismatch", readAt };
  }
  if (projectId && detail.execution.sourceProjectId && detail.execution.sourceProjectId !== projectId) {
    return { kind, sourceKey: targetId, status: "unavailable", errorCode: "project_mismatch", readAt };
  }

  const currentSteps = detail.steps
    .filter(s => s.planVersion === detail.execution.currentPlanVersion)
    .map(s => ({ title: s.title, status: s.status }));
  const currentCriteria = detail.acceptanceCriteria
    .filter(c => c.planVersion === detail.execution.currentPlanVersion)
    .map(c => ({ description: c.description, required: c.required, result: c.result }));

  const snapshot = {
    id: detail.execution.id,
    status: detail.execution.status,
    version: detail.execution.version,
    goal: detail.execution.goal,
    waitingReason: detail.execution.waitingReason ?? null,
    lastError: detail.execution.lastError ?? null,
    steps: currentSteps,
    criteria: currentCriteria
  };

  const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const unchanged = Boolean(
    prev
    && (prev.status === "available" || prev.status === "unchanged")
    && prev.contentHash === contentHash
  );

  const lines = [
    `${kind === "plan" ? "计划" : "执行"} ${detail.execution.id}（状态：${detail.execution.status}，版本：${detail.execution.version}）`,
    `目标：${detail.execution.goal}`
  ];
  if (detail.execution.waitingReason) lines.push(`等待原因：${detail.execution.waitingReason}`);
  if (detail.execution.lastError) lines.push(`最近错误：${detail.execution.lastError}`);
  if (currentSteps.length > 0) {
    lines.push("步骤：", ...currentSteps.map(s => `- [${s.status}] ${s.title}`));
  }
  if (currentCriteria.length > 0) {
    lines.push("完成条件：", ...currentCriteria.map(c => `- [${c.result}] ${c.description}`));
  }

  return {
    kind,
    sourceKey: targetId,
    status: unchanged ? "unchanged" : "available",
    contentHash,
    textContent: lines.join("\n"),
    readAt
  };
}

function observeProjectFile(
  workDir: string | undefined,
  relPath: string,
  prev: FollowUpObservation | undefined,
  readAt: string
): ObservedSource {
  const normalizedRoot = String(workDir ?? "").trim();
  if (!normalizedRoot) {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "work_dir_missing", readAt };
  }
  if (!relPath || isAbsolute(relPath) || relPath.split("/").includes("..")) {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "path_outside_project", readAt };
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(normalizedRoot));
  } catch {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "work_dir_unavailable", readAt };
  }

  const candidate = resolve(realRoot, relPath);
  if (!isInside(realRoot, candidate)) {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "path_outside_project", readAt };
  }

  let realCandidate: string;
  try {
    const lstat = lstatSync(candidate);
    realCandidate = lstat.isSymbolicLink() ? realpathSync(candidate) : candidate;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return {
      kind: "project_file",
      sourceKey: relPath,
      status: "unavailable",
      errorCode: code === "ENOENT" ? "file_not_found" : "file_unreadable",
      readAt
    };
  }

  if (!isInside(realRoot, realCandidate)) {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "symlink_outside_project", readAt };
  }

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(realCandidate);
  } catch {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "file_unreadable", readAt };
  }

  if (!stat.isFile()) {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "not_a_file", readAt };
  }
  if (stat.size > FOLLOW_UP_MAX_FILE_BYTES) {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "file_too_large", readAt };
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(realCandidate);
  } catch {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "file_unreadable", readAt };
  }

  if (looksBinary(buffer) || detectTextEncoding(buffer) !== "utf8") {
    return { kind: "project_file", sourceKey: relPath, status: "unavailable", errorCode: "binary_or_non_utf8", readAt };
  }

  const textContent = buffer.toString("utf8");
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const unchanged = Boolean(
    prev
    && (prev.status === "available" || prev.status === "unchanged")
    && prev.contentHash === contentHash
  );

  return {
    kind: "project_file",
    sourceKey: relPath,
    status: unchanged ? "unchanged" : "available",
    contentHash,
    textContent,
    readAt
  };
}

/**
 * Deterministic fingerprint over sorted source states. Both content hash and
 * availability/error code participate so recovery from `unavailable` produces
 * a fresh fingerprint while unchanged content stays identical.
 */
export function computeEvidenceFingerprint(observations: ObservedSource[]): string {
  const canonical = observations
    .map(item => ({
      kind: item.kind,
      sourceKey: item.sourceKey,
      availability: item.status === "unchanged" ? "available" : item.status,
      contentHash: item.contentHash ?? "",
      errorCode: item.errorCode ?? ""
    }))
    .sort((a, b) => `${a.kind}:${a.sourceKey}`.localeCompare(`${b.kind}:${b.sourceKey}`));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
