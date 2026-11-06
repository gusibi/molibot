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
