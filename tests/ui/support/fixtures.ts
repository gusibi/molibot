import { test as base, expect } from '@playwright/test';
import { startUiHarness } from './harness';

export const test = base.extend<{}, { harness: Awaited<ReturnType<typeof startUiHarness>> }>({
  harness: [async ({}, use) => {
    const harness = await startUiHarness();
    try { await use(harness); } finally { await harness.close(); }
  }, { scope: 'worker', timeout: 120000 }],
  baseURL: async ({ harness }, use) => use(harness.frontend),
  context: async ({ browser, contextOptions, harness }, use, testInfo) => {
    const context = await browser.newContext(contextOptions);
    await context.addInitScript(() => {
      localStorage.setItem('molibot-desktop-locale', 'en-US');
      localStorage.setItem('molibot-desktop-appearance', 'light');
      localStorage.setItem('molibot-desktop-low-performance', 'true');
    });
    const errors: string[] = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.stack ?? error.message)));
    const startLog = harness.logs.length;
    try {
      await use(context);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('service-and-vite.log', { body: harness.logs.slice(startLog).join(''), contentType: 'text/plain' });
        await testInfo.attach('page-errors.json', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' });
        await testInfo.attach('provider-requests.json', { body: JSON.stringify(harness.provider.requests, null, 2), contentType: 'application/json' });
      }
      await context.close();
    }
  }
});
export { expect };
