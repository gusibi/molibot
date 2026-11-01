import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowHomeTask, readHomeReceipts, markHomeReceipt, hasUnreadCrossChannel } from './homeWork';
import type { DesktopTaskItem } from '@molibot/desktop-contract';
const task = (status = 'completed', extra = {}) => ({ taskId: 'daily', active: false, executions: [{ id: 'run-1', status }], ...extra }) as unknown as DesktopTaskItem;
test('read outcomes stay hidden but a new execution and active work appear', () => {
  const receipts = markHomeReceipt({}, 'daily', 'run-1');
  assert.equal(shouldShowHomeTask(task(), receipts), false);
  assert.equal(shouldShowHomeTask(task('completed', { executions: [{ id: 'run-2', status: 'completed' }] }), receipts), true);
  assert.equal(shouldShowHomeTask(task('running', { active: true }), receipts), true);
  assert.equal(shouldShowHomeTask(task('waiting_approval'), receipts), true);
});
test('normal maintenance is quiet while failed maintenance remains visible', () => {
  assert.equal(shouldShowHomeTask(task('completed', { maintenance: true }), {}), false);
  assert.equal(shouldShowHomeTask(task('failed', { maintenance: true }), {}), true);
});
test('receipt parsing tolerates corrupt storage and keeps only bounded string entries', () => {
  assert.deepEqual(readHomeReceipts('broken'), {});
  assert.deepEqual(readHomeReceipts('{"daily":"run-1","bad":12}'), { daily: 'run-1' });
  let receipts = {};
  for (let i = 0; i < 600; i++) receipts = markHomeReceipt(receipts, `task-${i}`, `run-${i}`);
  assert.equal(Object.keys(receipts).length, 512);
  assert.equal(readHomeReceipts(JSON.stringify(receipts))['task-599'], 'run-599');
});

test('cross-channel read watermark survives a shrinking window and admits only newer replies', () => {
  const seen = '2026-11-01T09:00:00Z';
  assert.equal(hasUnreadCrossChannel({ latestAt: seen }, seen), false);
  assert.equal(hasUnreadCrossChannel({ latestAt: '2026-10-31T09:00:00Z' }, seen), false);
  assert.equal(hasUnreadCrossChannel({ latestAt: '2026-11-01T09:01:00Z' }, seen), true);
  assert.equal(hasUnreadCrossChannel({ latestAt: seen }, undefined), true);
});
