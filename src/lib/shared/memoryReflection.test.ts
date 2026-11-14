import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMemoryReflectionSummary } from './memoryReflection';
import { formatOwnerMemoryReflectionNotification } from '$lib/server/agent/ownerMemoryReflection';

test('channel notice and home summary share all counts, including earlier pending candidates', () => {
  const result = { completedTargets: 29, failedTargets: 0, localDate: '2026-11-03', pendingReviewCandidateIds: ['old-1', 'old-2'], scannedConversations: 495, scannedMessages: 0, createdCandidates: 0, committedMemories: 0 };
  const review = { pendingReviewCount: 2, skillDraftCount: 1 };
  const summary = formatMemoryReflectionSummary({ ...result, ...review });
  assert.ok(formatOwnerMemoryReflectionNotification(result, review).includes(summary));
  assert.match(summary, /本次新增 0 条候选/);
  assert.match(summary, /截至本次整理，待确认记忆 2 条/);
  assert.match(summary, /技能草稿 1 条/);
  assert.match(formatMemoryReflectionSummary({ ...result, ...review }, false), /2 memories pending review at the end of this run/);
});

test('historical results do not manufacture a zero pending count', () => {
  const summary = formatMemoryReflectionSummary({ scannedConversations: 1, scannedMessages: 0, createdCandidates: 0 });
  assert.match(summary, /未记录待确认数量/);
  assert.doesNotMatch(summary, /待确认记忆 0 条/);
});

test('24-hour summary presents total conversations, daytime extraction and fallback memory breakdown', () => {
  const result = {
    completedTargets: 29,
    failedTargets: 0,
    localDate: '2026-11-14',
    pendingReviewCandidateIds: [],
    totalConversations: 505,
    scannedConversations: 4,
    idleExtractedConversations: 3,
    fallbackExtractedConversations: 1,
    scannedMessages: 26,
    idleScannedMessages: 20,
    fallbackScannedMessages: 6,
    createdCandidates: 2,
    committedMemories: 5,
    idleCommittedMemories: 4,
    fallbackCommittedMemories: 1
  };
  const review = { pendingReviewCount: 0, skillDraftCount: 0 };
  const zhSummary = formatMemoryReflectionSummary({ ...result, ...review });
  assert.match(zhSummary, /总会话 505 段，今日整理 4 段（白天抽取 3 段）、扫描 26 条消息/);
  assert.match(zhSummary, /本次新增 2 条候选/);
  assert.match(zhSummary, /保存 5 条记忆（白天抽取 4 条，本次兜底抽取 1 条）/);
  assert.ok(formatOwnerMemoryReflectionNotification(result, review).includes(zhSummary));

  const enSummary = formatMemoryReflectionSummary({ ...result, ...review }, false);
  assert.match(enSummary, /505 total conversations, organized 4 today \(3 extracted during the day\) and scanned 26 messages/);
  assert.match(enSummary, /5 memories saved \(4 extracted during the day, 1 in fallback\)/);
});
