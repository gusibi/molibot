import { test, expect } from './support/fixtures';

const stamp = () => new Date().toISOString();

function boardItem(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'kanban-fixture',
    shortHandle: '#12',
    kind: 'kanban',
    stage: 'doing',
    doingSubState: 'waiting_user',
    title: '整理本周数据周报',
    goal: '产出数据周报并核对来源数字。',
    form: 'single',
    executorLabel: 'agent-a',
    waitingReason: '用哪种格式？',
    checklist: { doneChecked: 1, checkedTotal: 2 },
    budgetTokensUsed: 1200,
    budgetTokenLimit: 2_000_000,
    handoffCount: 0,
    handoffLimit: 8,
    version: 5,
    createdAt: stamp(),
    updatedAt: stamp(),
    ...overrides
  };
}

test('kanban board renders stages, waiting hints and the collapsed cancelled area @plans @kanban', async ({ page }, testInfo) => {
  await page.route('**/api/desktop/plans?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (route.request().method() === 'GET' && params.has('view')) {
      await route.fulfill({ json: { ok: true, total: 3, counts: { all: 3, todo: 1, doing: 1, done: 0, cancelled: 1 }, projectIds: [], items: [
        boardItem(),
        boardItem({ executionId: 'kanban-todo', shortHandle: '#13', stage: 'todo', doingSubState: undefined, title: '待办任务', goal: '等待开始。', waitingReason: undefined, checklist: undefined, budgetTokenLimit: undefined }),
        boardItem({ executionId: 'kanban-dead', shortHandle: '#11', stage: 'cancelled', doingSubState: undefined, title: '已取消任务', goal: '不再推进。', waitingReason: undefined, checklist: undefined, budgetTokenLimit: undefined, version: 9 })
      ] } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.locator('.kanban-column')).toHaveCount(3);
  await expect(page.locator('.kanban-card')).toHaveCount(2);
  // Doing card shows the waiting reason and the checklist progress.
  const doingCard = page.locator('.kanban-card', { hasText: '整理本周数据周报' });
  await expect(doingCard).toContainText('用哪种格式？');
  await expect(doingCard).toContainText('1/2');
  // Cancelled tasks collapse into their own area.
  await expect(page.locator('.kanban-cancelled-toggle')).toContainText(/已取消|Cancelled/);
  await expect(page.locator('.kanban-card-cancelled')).toHaveCount(0);
  await page.locator('.kanban-cancelled-toggle').click();
  await expect(page.locator('.kanban-card-cancelled')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('kanban-board.png') });
});

test('kanban task detail shows the conversation feed, checklist and answer composer @plans @kanban', async ({ page }, testInfo) => {
  const now = stamp();
  await page.route('**/api/desktop/plans?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (route.request().method() === 'GET' && params.has('view')) {
      await route.fulfill({ json: { ok: true, total: 1, counts: { all: 1, todo: 0, doing: 1, done: 0, cancelled: 0 }, projectIds: [], items: [boardItem()] } });
      return;
    }
    if (route.request().method() === 'GET' && params.get('kanban') === 'true') {
      await route.fulfill({ json: { ok: true, task: {
        executionId: 'kanban-fixture', form: 'single', title: '整理本周数据周报', goal: '产出数据周报并核对来源数字。', members: [], completionSource: 'user', budgetTokenLimit: 2_000_000, handoffLimit: 8, approvalPolicy: 'suspend', humanAcceptance: false, autoStart: true, handoffCount: 0, currentAgentId: 'agent-a', roundCount: 2, retryCount: 1, usageGapCount: 0, createdAt: now, updatedAt: now
      }, detail: {
        execution: { id: 'kanban-fixture', shortHandle: '#12', status: 'waiting_for_user', version: 7, currentPlanVersion: 1, updatedAt: now, waitingReason: '用哪种格式？', tokensUsed: 1200 },
        meta: { title: '整理本周数据周报', summary: '', updatedAt: now },
        tasks: [], projection: { progress: { completed: 0, total: 0 } },
        acceptanceCriteria: [{ id: 'c1', planVersion: 1, description: '周报定稿并附数据来源', required: true, result: 'unproven' }],
        approvals: [], decisions: [], attempts: [], steps: [], plans: [], sideEffects: [], evidenceRefs: []
      }, receipts: [
        { receiptId: 'r1', round: 1, actorAgentId: 'agent-a', actions: { conclusion: '已收集数据并起草第一节。', evidence: ['data/week.csv'], continueWork: true }, createdAt: new Date(Date.parse(now) - 60_000).toISOString() },
        { receiptId: 'r2', round: 2, actorAgentId: 'agent-a', actions: { conclusion: '需要确认输出格式。', question: { text: '用哪种格式？', options: ['Markdown', 'PDF'] } }, createdAt: now }
      ], checklist: [
        { itemId: 'i1', text: '收集数据', done: true, updatedRound: 1 },
        { itemId: 'i2', text: '核对来源数字', done: false, updatedRound: 2 }
      ], inputs: [{ inputId: 'in1', text: '改用万元单位。', createdAt: now, consumedRound: 2 }], handoffs: [] } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.kanban-card', { hasText: '整理本周数据周报' }).click();
  await expect(page.locator('.plans-detail h2')).toHaveText('整理本周数据周报');
  // Conversation projection: user input, both receipts, ordered by time.
  await expect(page.locator('.kanban-feed-user')).toContainText('改用万元单位。');
  await expect(page.locator('.kanban-feed-receipt')).toHaveCount(2);
  await expect(page.locator('.kanban-feed-receipt', { hasText: '需要确认输出格式' })).toContainText('用哪种格式？');
  await expect(page.locator('.kanban-feed-receipt', { hasText: '已收集数据' })).toContainText('data/week.csv');
  // Waiting question is surfaced as an attention card.
  await expect(page.locator('.plans-attention').first()).toContainText('用哪种格式？');
  // Checklist progress.
  await expect(page.locator('.kanban-checklist-item')).toHaveCount(2);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  // Answering sends the kanban_answer action.
  const answerPost = page.waitForRequest(request =>
    request.method() === 'POST' && request.url().includes('/api/desktop/plans')
    && request.postDataJSON()?.action === 'kanban_answer');
  await page.locator('.kanban-answer textarea').fill('用 Markdown。');
  await page.locator('.kanban-answer button').last().click();
  const answer = await answerPost;
  expect(answer.postDataJSON()).toMatchObject({ action: 'kanban_answer', text: '用 Markdown。' });
  await page.screenshot({ path: testInfo.outputPath('kanban-detail.png') });
});

test('kanban create dialog submits the structured task form @plans @kanban', async ({ page }, testInfo) => {
  await page.route('**/api/desktop/plans?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (route.request().method() === 'GET' && params.has('view')) {
      await route.fulfill({ json: { ok: true, total: 0, counts: { all: 0, todo: 0, doing: 0, done: 0, cancelled: 0 }, projectIds: [], items: [] } });
      return;
    }
    await route.fallback();
  });
  const created = page.waitForRequest(request =>
    request.method() === 'POST' && request.url().includes('/api/desktop/plans')
    && request.postDataJSON()?.action === 'kanban_create');
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: /新建任务|New task/ }).click();
  await expect(page.getByRole('heading', { name: /新建看板任务|New kanban task/ })).toBeVisible();
  await page.getByRole('dialog').getByPlaceholder(/例如|e\.g\./).fill('校对发布说明');  await page.getByRole('dialog').locator('textarea').first().fill('发布前逐条核对。');
  await page.getByRole('dialog').getByPlaceholder('default').fill('agent-a');
  await page.getByRole('dialog').locator('textarea').nth(1).fill('发布说明与变更一致\n包含升级注意事项');
  await page.getByRole('dialog').getByRole('button', { name: /创建任务|Create task/ }).click();
  const request = await created;
  const body = request.postDataJSON();
  expect(body).toMatchObject({ action: 'kanban_create', form: 'single', title: '校对发布说明', agentId: 'agent-a', autoStart: true });
  expect(body.completionConditions.map((entry: { description: string }) => entry.description)).toEqual(['发布说明与变更一致', '包含升级注意事项']);
});
