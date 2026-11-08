import { test, expect } from './support/fixtures';

test('plan detail and rework keep long content readable and preserve draft through preview @plans', async ({ page }, testInfo) => {
  const title = 'Verify acceptance files and review the delivery';
  const stamp = new Date().toISOString();
  const tasks = [{ id: 'task-1', title: 'Read and verify the requested files', description: 'Confirm the contents before accepting the result.', steps: [
    { id: 'step-1', title: 'Read the source file', description: 'Keep the original contents.', status: 'completed', outputSummary: 'Source contents verified.' },
    { id: 'step-2', title: 'Verify output at acceptance/' + 'long-path/'.repeat(18) + 'result.txt', description: 'Check the resulting file.', status: 'pending' }
  ] }];
  const item = { execution: { id: 'detail-fixture', shortHandle: '#8', status: 'paused', version: 1, currentPlanVersion: 1, updatedAt: stamp, waitingReason: 'Review the remaining step before continuing.' }, meta: { title, summary: 'Read the source, verify the output, then review the evidence.' }, tasks, projection: { progress: { completed: 1, total: 2 }, nextStep: tasks[0].steps[1] }, acceptanceCriteria: [{ id: 'criterion-1', planVersion: 1, description: 'The output matches the requested contents.', required: true, result: 'unproven' }], approvals: [{ id: 'approval-1', title: 'Confirm file access', summary: 'Review the requested action before continuing.', status: 'pending' }], decisions: [], attempts: [], steps: [], plans: [], sideEffects: [], evidenceRefs: [] };
  await page.route('**/api/desktop/plans?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (route.request().method() === 'GET' && params.has('view')) {
      const stamp = new Date().toISOString();
      await route.fulfill({ json: { ok: true, total: 1, counts: { all: 1, todo: 0, doing: 1, done: 0, cancelled: 0 }, projectIds: [], items: [{ executionId: 'detail-fixture', shortHandle: '#8', kind: 'legacy-plan', stage: 'doing', doingSubState: 'paused', title, goal: 'Read the source, verify the output.', waitingReason: 'Review the remaining step before continuing.', progress: { completed: 1, total: 2 }, version: 1, createdAt: stamp, updatedAt: stamp }] } });
      return;
    }
    const detail = params.has('id');
    await route.fulfill({ json: detail ? { ok: true, item } : { ok: true, total: 1, counts: { all: 1, needs_attention: 1 }, projectIds: [], items: [{ planId: 'detail-fixture', shortHandle: '#8', title, planStatus: 'needs_attention', progress: { completed: 1, total: 2 } }] } });
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  const openPlans = () => page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await openPlans();
  await page.locator('.kanban-card').click();
  await expect(page.locator('.plans-detail h2')).toHaveText(title);
  await expect(page.locator('.plans-attention')).toContainText('Confirm file access');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: testInfo.outputPath('plan-detail.png') });
  await page.locator('.plans-actions-leading button').click();
  const editor = page.locator('.plans-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.plans-editor-step').first().locator('input')).toBeDisabled();
  await editor.locator('input').first().fill('Updated acceptance plan');
  await editor.locator('.plans-editor-footer button').last().click();
  await expect(editor.locator('.plans-diff')).toContainText('Updated acceptance plan');
  const assertFooterLayout = async () => {
    const geometry = await editor.evaluate(el => {
      const body = el.querySelector('.plans-editor-body');
      const footer = el.querySelector('.plans-editor-footer')!;
      return { body: body?.getBoundingClientRect().bottom, footerTop: footer.getBoundingClientRect().top, footerBottom: footer.getBoundingClientRect().bottom, editorBottom: el.getBoundingClientRect().bottom };
    });
    expect(geometry.body).toBeDefined();
    expect(geometry.body!).toBeLessThanOrEqual(geometry.footerTop + 1);
    expect(Math.abs(geometry.footerBottom - geometry.editorBottom)).toBeLessThanOrEqual(2);
  };
  await assertFooterLayout();
  await editor.locator('.plans-editor-body').evaluate(el => el.scrollTop = el.scrollHeight);
  await assertFooterLayout();
  await page.screenshot({ path: testInfo.outputPath('plan-preview.png') });
  await editor.locator('.plans-editor-footer button').first().click();
  await page.locator('.plans-actions-leading button').click();
  await expect(editor.locator('input').first()).toHaveValue('Updated acceptance plan');
  await page.setViewportSize({ width: 860, height: 620 });
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('.plans-detail').evaluate(el => el.clientWidth)).toBeGreaterThan(500);
  await assertFooterLayout();
  await page.screenshot({ path: testInfo.outputPath('plan-editor-narrow.png') });
  await page.locator('.plans-back').click();
  await expect(page.locator('.kanban-card')).toBeVisible();
  item.execution.status = 'completed';
  item.approvals = [];
  await page.locator('.kanban-card').click();
  await expect(page.locator('.plans-actions').getByRole('button', { name: 'Plan execution permissions' })).toHaveCount(0);
  await expect(page.locator('.plans-actions-trailing button')).toHaveCount(1);
  await page.locator('.plans-criteria').scrollIntoViewIfNeeded();
  await expect(page.locator('.plans-criteria')).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute('data-resolved-appearance', 'dark'));
  await page.screenshot({ path: testInfo.outputPath('plan-acceptance-dark.png') });
});
