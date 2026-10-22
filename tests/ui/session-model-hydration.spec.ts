import { test, expect } from './support/fixtures';
import { composer, openChat, sendText, expectReply, replyTo, uniqueToken } from './support/actions';

test('Agent home stays editable after leaving a loading Session and recovers after service restart @chat @navigation', async ({ page, instance }) => {
  await openChat(page);
  const marker = `hydration-${uniqueToken()}`;
  replyTo(instance.model, marker, { type: 'text', text: `REPLY:${marker}` });
  await sendText(page, marker);
  await expectReply(page, `REPLY:${marker}`);
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await page.reload();
  await expect(composer(page)).toBeEnabled();

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let fulfilled!: () => void;
  const responded = new Promise<void>(resolve => { fulfilled = resolve; });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/desktop/session-model?*', async route => {
    started();
    await held;
    await route.fulfill({ json: { ok: true, modelKey: '' } });
    fulfilled();
  });
  const history = page.getByRole('button', { name: new RegExp(marker) }).last();
  await history.click();
  await requested;
  await expect(composer(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  try {
    await expect(composer(page)).toBeEnabled();
  } finally {
    release();
  }
  await responded;
  await page.unroute('**/api/desktop/session-model?*');
  const next = `after-hydration-${uniqueToken()}`;
  replyTo(instance.model, next, { type: 'text', text: `REPLY:${next}` });
  await sendText(page, next);
  await expectReply(page, `REPLY:${next}`);
  await instance.stopService();
  await instance.startService();
  await page.reload();
  await page.getByRole('button', { name: 'Momo', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
});
