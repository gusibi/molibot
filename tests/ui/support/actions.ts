import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { randomUUID } from 'node:crypto';

export const uniqueToken = () => randomUUID().slice(0, 8);
export const composer = (page: Page) => page.getByTestId('chat-composer');
export const transcript = (page: Page) => page.locator('article');

export async function openChat(page: Page, agent = 'Momo') {
  await page.goto('/');
  await page.getByRole('button', { name: "Don't show again", exact: true }).click();
  await page.getByRole('button', { name: agent, exact: true }).click();
  await expect(composer(page)).toBeEnabled();
}
export async function send(page: Page, mode = 'reply', marker = uniqueToken()) {
  await composer(page).fill(`[[ui:${mode}:${marker}]]`);
  await composer(page).press('Enter');
  return marker;
}
export async function expectReply(page: Page, marker: string) {
  await expect(transcript(page).getByText(`UI_REPLY:${marker}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
}
export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Molibot · Online', exact: true }).click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
}
