import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './support/fixtures';
import { openChat, send, transcript } from './support/actions';

async function probeFiles(root: string, marker: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await probeFiles(path, marker));
    else if (entry.name === `ui-probe-${marker}.txt`) files.push(path);
  }
  return files;
}

for (const decision of ['allow', 'reject', 'keyboard'] as const) {
  test(`${decision} approval resolves the real tool once @approval @smoke`, async ({ page, harness }) => {
    await openChat(page);
    const marker = await send(page, 'approve');
    const card = page.getByTestId('decision-card').filter({ hasText: marker });
    await expect(card).toBeVisible();
    expect(await probeFiles(harness.dataDir, marker)).toHaveLength(0);
    if (decision === 'keyboard') {
      await page.locator('body').click({ position: { x: 600, y: 120 } });
      await page.keyboard.press('Escape');
    } else {
      const button = card.getByRole('button', { name: decision === 'reject' ? /Reject|Deny/ : /Just once|Allow once/ });
      await button.click();
    }
    await expect(card).toHaveCount(0);
    await expect(transcript(page).getByText(`DECISION_COMPLETE:${marker}`, { exact: true })).toBeVisible();
    const files = await probeFiles(harness.dataDir, marker);
    expect(files).toHaveLength(decision === 'allow' ? 1 : 0);
    if (files[0]) expect(await readFile(files[0], 'utf8')).toBe(`approved:${marker}`);
    expect(harness.provider.requests.filter(r => r.marker === marker && !r.toolResult)).toHaveLength(1);
  });
}
