import { expect, test } from './support/fixtures';
import { importedThemeCss } from '../../apps/desktop/src/lib/theme/themeStyle';
import { hydrateImportedTheme, toStoredImportedTheme } from '../../apps/desktop/src/lib/theme/vscodeTheme';
import { expectReply, openChat, replyTo, sendText, uniqueToken } from './support/actions';

test('the Agent desk follows the live turn and stamps the saved reply across themes', async ({ page, instance }, info) => {
  await openChat(page);
  const marker = uniqueToken();
  const prompt = `Desk note ${marker}`;
  const answer = `Desk result ${marker}`;
  replyTo(instance.model, prompt, { type: 'thinking', thinking: 'Working on the desk note', text: answer, key: marker });
  await sendText(page, prompt);
  const note = page.locator('.desk-user-note').filter({ hasText: prompt });
  const live = page.locator('.streaming-message');
  const stamp = page.getByTestId('desk-turn-stamp');
  await expect(note).toBeVisible({ timeout: 4000 });
  await expect(live.locator('[data-desk-expression="thinking"]')).toBeVisible();
  await expect(stamp).toHaveCount(0);
  instance.model.release(marker);
  await expectReply(page, answer);
  const reply = page.locator('.message-row.assistant').filter({ hasText: answer });
  await expect(reply.getByTestId('desk-turn-stamp')).toHaveText('Done');
  await expect(stamp).toHaveClass(/desk-turn-stamp--arrived/);
  await expect(stamp).toHaveCSS('animation-name', 'none');
  await expect(reply.locator('[data-desk-expression="task-finisher"]')).toBeVisible();

  for (const [family, appearance] of [['macos', 'light'], ['macos', 'dark'], ['feishu', 'dark'], ['brutalism', 'light'], ['terminal', 'dark'], ['win98', 'light']]) {
    await page.evaluate(([family, appearance]) => {
      localStorage.setItem('molibot-desktop-theme-family', family);
      localStorage.setItem('molibot-desktop-appearance', appearance);
    }, [family, appearance]);
    await page.setViewportSize({ width: family === 'macos' ? 1120 : 390, height: 820 });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', family);
    await expect(note).toBeVisible();
    await expect(stamp).toHaveCount(1);
    await expect(stamp).not.toHaveClass(/desk-turn-stamp--arrived/);
    const colors = await note.evaluate(node => {
      const expected = document.createElement('div');
      expected.style.backgroundColor = 'var(--desk-note-bg, var(--bubble-mine-bg))';
      node.append(expected);
      const background = getComputedStyle(expected).backgroundColor;
      expected.remove();
      const list = node.closest('.messages')!;
      return { actual: getComputedStyle(node).backgroundColor, background, fits: list.scrollWidth <= list.clientWidth + 1 };
    });
    expect(colors.actual).toBe(colors.background);
    expect(colors.fits).toBe(true);
    if (family === 'macos' || family === 'brutalism') {
      await page.screenshot({ path: info.outputPath(`desk-${family}-${appearance}.png`) });
    }
  }

  const imported = hydrateImportedTheme(toStoredImportedTheme(JSON.stringify({
    name: 'Desk Test', type: 'dark', colors: {
      'editor.background': '#201a26', 'editor.foreground': '#f5ecff',
      'editorWidget.background': '#312641', 'input.background': '#251d2c'
    }
  }), { idSuffix: 'desk-test' }))!;
  await page.addStyleTag({ content: importedThemeCss(imported) });
  await page.evaluate(id => {
    document.documentElement.dataset.themeFamily = `imported-${id}`;
    document.documentElement.dataset.resolvedAppearance = 'dark';
    delete document.documentElement.dataset.themeRecipe;
  }, imported.id);
  await expect(stamp).toBeVisible();
  const importedNote = await note.evaluate(node => {
    const originalBubble = document.createElement('div');
    originalBubble.style.backgroundColor = 'var(--bubble-mine-bg)';
    node.append(originalBubble);
    const result = [getComputedStyle(node).backgroundColor, getComputedStyle(originalBubble).backgroundColor];
    originalBubble.remove();
    return result;
  });
  expect(importedNote[0]).toBe(importedNote[1]);
});

test('a stopped Agent turn keeps its process and has no completion stamp', async ({ page, instance }) => {
  await openChat(page);
  const marker = uniqueToken();
  replyTo(instance.model, marker, { type: 'thinking', thinking: 'An in-progress thought', text: 'Unsent result', key: marker });
  await sendText(page, marker);
  await expect(page.locator('.streaming-message [data-desk-expression="thinking"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.streaming-message .turn-process')).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.streaming-message')).toHaveCount(0);
  await expect(page.locator('.message-row.assistant [data-desk-expression="serious"]')).toBeVisible();
  await expect(page.getByTestId('desk-turn-stamp')).toHaveCount(0);
});

test('a custom avatar keeps its own identity during a desk turn', async ({ page, instance, request }) => {
  const endpoint = `${instance.frontend}/molibot-api/api/desktop/agents`;
  const current = await request.get(endpoint);
  expect(current.ok()).toBe(true);
  const { summary } = await current.json();
  const momo = summary.items.find((agent: { id: string }) => agent.id === summary.defaultAgentId);
  const avatar = '/agent-avatars/pattern-1.svg';
  const updated = await request.put(endpoint, { data: { ...momo, avatar } });
  expect(updated.ok()).toBe(true);

  try {
    await openChat(page);
    const prompt = `Custom desk ${uniqueToken()}`;
    replyTo(instance.model, prompt, { type: 'thinking', thinking: 'Custom avatar working', text: 'Custom avatar finished', key: prompt });
    await sendText(page, prompt);
    const live = page.locator('.streaming-message');
    const liveAvatar = live.locator('.desk-agent-avatar img[data-avatar-image]');
    await expect(liveAvatar).toHaveAttribute('src', avatar);
    await expect(liveAvatar).toBeVisible();
    await expect(live.locator('[data-desk-expression]')).toHaveCount(0);
    instance.model.release(prompt);
    await expectReply(page, 'Custom avatar finished');

    const reply = page.locator('.message-row.assistant').filter({ hasText: 'Custom avatar finished' });
    await expect(reply.locator('.desk-agent-avatar img[data-avatar-image]')).toHaveAttribute('src', avatar);
    await expect(reply.getByTestId('desk-turn-stamp')).toBeVisible();
  } finally {
    expect((await request.put(endpoint, { data: { ...momo, avatar: momo.avatar ?? '' } })).ok()).toBe(true);
  }
});
