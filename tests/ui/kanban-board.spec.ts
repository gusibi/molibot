import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
      ], inputs: [{ inputId: 'in1', text: '改用万元单位。', createdAt: now, consumedRound: 2 }], handoffs: [], attempts: [] } });
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

test('kanban create dialog keeps its close and footer actions reachable in a short window @plans @kanban', async ({ page }, testInfo) => {
  await page.route('**/api/desktop/plans?*', async route => {
    if (route.request().method() !== 'GET' || !new URL(route.request().url()).searchParams.has('view')) return route.fallback();
    await route.fulfill({ json: { ok: true, total: 0, counts: { all: 0, todo: 0, doing: 0, done: 0, cancelled: 0 }, projectIds: [], items: [] } });
  });
  await page.setViewportSize({ width: 900, height: 520 });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await expect(page.locator('.kanban-column')).toHaveCount(3);
  await expect(page.locator('.kanban-add-card')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plans-empty.png') });
  await page.locator('.kanban-add-card').click();
  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', { name: /创建任务|Create task/, exact: true });
  await expect(submit).toBeVisible();
  const box = await submit.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(520);
  await page.screenshot({ path: testInfo.outputPath('kanban-create-short.png') });
  await dialog.getByRole('button', { name: /关闭|Close/, exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('plan task create offers real project names instead of board project ids @plans @kanban', async ({ page, request, instance }, testInfo) => {
  test.info().annotations.push({ type: 'expected-page-error', description: 'ResizeObserver loop completed with undelivered notifications' });
  const suffix = randomUUID().slice(0, 8);
  const projectName = `Project ${suffix}`;
  const rootPath = join(instance.home, `plan-project-${suffix}`);
  await mkdir(rootPath, { recursive: true });
  const created = await request.post(instance.endpoint + '/api/settings/projects', {
    headers: { origin: instance.endpoint },
    data: { name: projectName, rootPath }
  });
  const createdBody = await created.json();
  expect(created.ok(), JSON.stringify(createdBody)).toBe(true);
  const listed = await (await request.get(instance.endpoint + '/api/settings/projects')).json();
  expect(listed.projects.map((project: { name: string }) => project.name)).toContain(projectName);
  await page.route('**/api/desktop/plans?*', async route => {
    if (route.request().method() !== 'GET' || !new URL(route.request().url()).searchParams.has('view')) return route.fallback();
    // A stale board projection must not leak into the project picker.
    await route.fulfill({ json: { ok: true, total: 0, counts: { all: 0, todo: 0, doing: 0, done: 0, cancelled: 0 }, projectIds: ['project-2'], items: [] } });
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  const filter = page.locator('.plans-toolbar .select-control-trigger');
  await expect(filter).toBeVisible();
  await filter.click();
  await page.getByRole('option', { name: projectName, exact: true }).click();
  // An empty project is still a kanban board: keep the columns and the add affordance.
  await expect(page.locator('.kanban-column')).toHaveCount(3);
  await expect(page.locator('.kanban-add-card')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plans-project-empty.png') });
  await page.locator('.kanban-add-card').click();
  const dialog = page.getByRole('dialog');
  const projectField = dialog.getByRole('button', { name: 'Project (optional)', exact: true });
  // Creating from a filtered board keeps the task in that project.
  await expect(projectField).toContainText(projectName);
  await projectField.click();
  await expect(page.getByRole('option', { name: projectName, exact: true })).toBeVisible();
  await page.locator('.select-control-content').evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath('kanban-create-projects.png') });
  await request.delete(`${instance.endpoint}/api/settings/projects/${encodeURIComponent(createdBody.project.id)}`, { headers: { origin: instance.endpoint } });
});

test('kanban create team form offers coordinators before members are picked @plans @kanban', async ({ page }, testInfo) => {
  await page.route('**/api/desktop/plans?*', async route => {
    if (route.request().method() !== 'GET' || !new URL(route.request().url()).searchParams.has('view')) return route.fallback();
    await route.fulfill({ json: { ok: true, total: 0, counts: { all: 0, todo: 0, doing: 0, done: 0, cancelled: 0 }, projectIds: [], items: [] } });
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.kanban-add-card').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Agent Team', exact: true }).click();
  const coordinator = dialog.getByRole('button', { name: 'Coordinator', exact: true });
  await coordinator.click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  const label = (await options.first().textContent())?.trim() ?? '';
  await options.first().click();
  await expect(coordinator).toContainText(label.split(' (')[0] ?? label);
  // The chosen coordinator joins the member set automatically.
  await expect(dialog.locator('.kanban-create-members input[type="checkbox"]:checked')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('kanban-create-team.png') });
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
  // Keep this a form test: persisting an auto-start task would wake the durable
  // executor after the test and turn its model call into cross-test noise.
  await page.route('**/api/desktop/plans', async route => {
    if (route.request().method() === 'POST') { await route.fulfill({ json: { ok: true } }); return; }
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByTestId('chat-composer')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Chat', exact: true }).getByRole('button', { name: 'Plans', exact: true }).click();
  await page.locator('.kanban-add-card').click();
  await expect(page.getByRole('heading', { name: /新建看板任务|New kanban task/ })).toBeVisible();
  await page.getByRole('dialog').getByPlaceholder(/例如|e\.g\./).fill('校对发布说明');  await page.getByRole('dialog').locator('textarea').first().fill('发布前逐条核对。');
  await page.getByRole('dialog').getByRole('button', { name: /执行 Agent|Executor Agent/ }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('dialog').locator('textarea').nth(1).fill('发布说明与变更一致\n包含升级注意事项');
  await page.getByRole('dialog').getByRole('button', { name: /创建任务|Create task/ }).click();
  const request = await created;
  const body = request.postDataJSON();
  expect(body).toMatchObject({ action: 'kanban_create', form: 'single', title: '校对发布说明', autoStart: true });
  expect(body.agentId).toBeTruthy();
  expect(body.completionConditions.map((entry: { description: string }) => entry.description)).toEqual(['发布说明与变更一致', '包含升级注意事项']);
});
