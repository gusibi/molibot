import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { modelRequestMatchers, type ModelReply, type ModelService, type ModelRequest } from './model-service';
import { randomUUID } from 'node:crypto';

export const uniqueToken = () => randomUUID().slice(0, 8);
export const composer = (page: Page) => page.getByTestId('chat-composer');
export const transcript = (page: Page) => page.locator('article');

/** Register a reply that answers the user turn whose latest message contains `userText`. */
export function replyTo(
  model: ModelService,
  userText: string,
  reply: ModelReply | ((request: ModelRequest) => ModelReply)
) {
  return model.script({
    name: `reply:${uniqueToken()}`,
    when: request => modelRequestMatchers(request).lastUserText.includes(userText),
    reply
  });
}

export async function openChat(page: Page, agent = 'Momo') {
  await page.goto('/');
  await expect(page.locator('.agent-home')).toBeVisible();
  await expect(composer(page)).toBeEnabled();
  const agentButton = page.getByRole('button', { name: agent, exact: true });
  const expand = page.getByRole('button', { name: /Expand sidebar|展开侧边栏/, exact: true });
  await expect.poll(async () => await agentButton.isVisible() || await expand.isVisible()).toBe(true);
  if (await expand.isVisible()) await expand.click();
  await agentButton.click();
  await expect(composer(page)).toBeEnabled();
}

export async function sendText(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

export async function expectReply(page: Page, text: string) {
  await expect(transcript(page).getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
}

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Molibot · Online', exact: true }).click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
}
