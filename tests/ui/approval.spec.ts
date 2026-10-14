import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './support/fixtures';
import { modelRequestMatchers, type ModelRequest } from './support/model-service';
import { openChat, sendText, transcript, uniqueToken } from './support/actions';
import type { IsolatedInstance } from './support/instance';

async function probeFiles(root: string, name: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await probeFiles(path, name));
    else if (entry.name === name) files.push(path);
  }
  return files;
}

function registerApprovalFlow(instance: IsolatedInstance, marker: string) {
  const probe = `ui-probe-${marker}.txt`;
  const call = instance.model.script({
    name: `tool:${marker}`,
    when: (request: ModelRequest) => {
      const m = modelRequestMatchers(request);
      return request.tools.length > 0 && !m.afterToolResults && m.lastUserText.includes(marker);
    },
    reply: { type: 'toolCalls', calls: [{ name: 'write', args: { label: `probe ${marker}`, path: probe, content: `approved:${marker}` } }] }
  });
  const follow = instance.model.script({
    name: `follow:${marker}`,
    when: (request: ModelRequest) => modelRequestMatchers(request).afterToolResults,
    reply: { type: 'text', text: `DECISION_DONE:${marker}` }
  });
  return { probe, call, follow };
}

for (const decision of ['allow', 'reject'] as const) {
  test(`${decision} approval resolves the tool once @approval`, async ({ page, instance }) => {
    await openChat(page);
    const marker = uniqueToken();
    const { probe, call } = registerApprovalFlow(instance, marker);
    await sendText(page, `probe ${marker}`);
    const card = page.getByTestId('decision-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    expect(await probeFiles(instance.dataDir, probe)).toHaveLength(0);
    const button = card.getByRole('button', { name: decision === 'reject' ? /Deny|Reject/ : /Just once|Allow once/ });
    await button.click();
    await expect(card).toHaveCount(0);
    await expect(transcript(page).getByText(`DECISION_DONE:${marker}`, { exact: true })).toBeVisible();
    const files = await probeFiles(instance.dataDir, probe);
    expect(files).toHaveLength(decision === 'allow' ? 1 : 0);
    if (files[0]) expect(await readFile(files[0], 'utf8')).toBe(`approved:${marker}`);
    expect(instance.model.matched(call.name)).toHaveLength(1);
  });
}

test('a repeated approval click executes the tool exactly once @approval', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const { probe, call } = registerApprovalFlow(instance, marker);
  await sendText(page, `probe ${marker}`);
  const card = page.getByTestId('decision-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  // Two clicks in one task: the second must be ignored while resolving.
  await card.getByRole('button', { name: /Just once|Allow once/ }).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(transcript(page).getByText(`DECISION_DONE:${marker}`, { exact: true })).toBeVisible();
  expect(await probeFiles(instance.dataDir, probe)).toHaveLength(1);
  expect(instance.model.matched(call.name)).toHaveLength(1);
});

test('switching conversation while an approval is pending does not leak or duplicate it @approval @navigation', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const { probe } = registerApprovalFlow(instance, marker);
  await sendText(page, `probe ${marker}`);
  await expect(page.getByTestId('decision-card')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await expect(page.getByTestId('decision-card')).toHaveCount(0);

  // The agent toggle carries its status ("Momo Working") while the approval waits.
  await page.getByRole('button', { name: /^Momo/ }).click();
  // Switching back may land on the Agent home; open the waiting session.
  const row = page.locator('.agent-history-row').filter({ hasText: `probe ${marker}` });
  if (await row.count()) await row.first().click();
  const card = page.getByTestId('decision-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Deny|Reject/ }).click();
  await expect(card).toHaveCount(0);
  expect(await probeFiles(instance.dataDir, probe)).toHaveLength(0);
  await expect(transcript(page).getByText(`DECISION_DONE:${marker}`, { exact: true })).toBeVisible();
});

test('approving and switching conversation mid-submit still resolves exactly once @approval @navigation', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  const { probe, call } = registerApprovalFlow(instance, marker);
  await sendText(page, `probe ${marker}`);
  const card = page.getByTestId('decision-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: /Just once|Allow once/ }).click();
  await page.getByRole('button', { name: 'UI Second', exact: true }).click();
  await page.getByRole('button', { name: /^Momo/ }).click();
  // A background completion may leave the Agent on its home; open the session.
  const row = page.locator('.agent-history-row').filter({ hasText: `probe ${marker}` });
  if (await row.count()) await row.first().click();

  await expect(transcript(page).getByText(`DECISION_DONE:${marker}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await probeFiles(instance.dataDir, probe)).toHaveLength(1);
  expect(instance.model.matched(call.name)).toHaveLength(1);
});
