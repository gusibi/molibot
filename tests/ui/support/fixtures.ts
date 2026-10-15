import { test as base, expect, type TestInfo } from '@playwright/test';
import { startIsolatedInstance, type IsolatedInstance } from './instance';
import { registerSharedScripts } from './scripts';

interface WorkerFixtures {
  instance: IsolatedInstance;
}

interface TestFixtures {
  baseURL: string;
}

/**
 * Worker-level isolated instance + per-test browser context.
 *
 * A test that leaves an unmatched model request, an unhandled page error, or a
 * provider request outside its script fails at teardown by default; tests opt
 * out explicitly. Evidence for failures is attached automatically.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  instance: [async ({ browser }, use) => {
    const instance = await startIsolatedInstance();
    // Warm the Vite dev server so the first test does not pay for on-demand
    // compilation of the app shell and sidebar.
    const warmup = await browser.newContext();
    try {
      const page = await warmup.newPage();
      await page.goto(instance.frontend);
      await page.getByRole('button', { name: 'Momo', exact: true }).waitFor({ state: 'attached', timeout: 60_000 });
    } finally {
      await warmup.close();
    }
    try {
      await use(instance);
    } finally {
      await instance.close();
    }
  }, { scope: 'worker', timeout: 180_000 }],

  baseURL: async ({ instance }, use) => use(instance.frontend),

  context: async ({ browser, contextOptions, instance }, use, testInfo) => {
    instance.model.resetScripts();
    registerSharedScripts(instance.model);
    const context = await browser.newContext(contextOptions);
    await context.addInitScript(() => {
      // Runs on about:blank too, where storage access is denied (Chromium).
      try {
        localStorage.setItem('molibot-desktop-locale', 'en-US');
        localStorage.setItem('molibot-desktop-appearance', 'light');
        localStorage.setItem('molibot-desktop-low-performance', 'true');
        // Skip the first-launch dialog for every test except the dedicated
        // cold-start one, which removes this flag itself.
        localStorage.setItem('molibot-desktop-first-launch-seen', '1');
      } catch {
        // Denied before the app origin is available; the real navigation re-runs this.
      }
    });
    const errors: string[] = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.stack ?? error.message)));
    const requestBaseline = instance.model.requests.length;
    const unmatchedBaseline = instance.model.unmatched.length;
    const logBaseline = instance.logs.length;
    try {
      await use(context);
    } finally {
      await context.close();
      if (testInfo.status === testInfo.expectedStatus) {
        await assertNoUnexpectedSignals({ instance, errors, requestBaseline, unmatchedBaseline, testInfo });
      } else {
        await attachEvidence({ instance, errors, logBaseline, testInfo });
      }
    }
  }
});

async function attachEvidence(input: {
  instance: IsolatedInstance;
  errors: string[];
  logBaseline: number;
  testInfo: TestInfo;
}) {
  await input.testInfo.attach('service-and-frontend.log', {
    body: input.instance.logs.slice(input.logBaseline).join(''),
    contentType: 'text/plain'
  });
  await input.testInfo.attach('page-errors.json', { body: JSON.stringify(input.errors, null, 2), contentType: 'application/json' });
  await input.testInfo.attach('model-requests.json', { body: JSON.stringify(input.instance.model.requests, null, 2), contentType: 'application/json' });
  await input.testInfo.attach('unmatched-model-requests.json', { body: JSON.stringify(input.instance.model.unmatched, null, 2), contentType: 'application/json' });
}

async function assertNoUnexpectedSignals(input: {
  instance: IsolatedInstance;
  errors: string[];
  requestBaseline: number;
  unmatchedBaseline: number;
  testInfo: TestInfo;
}) {
  const unmatched = input.instance.model.unmatched.slice(input.unmatchedBaseline);
  // A test may declare navigation-cancelled errors it deliberately provokes
  // (e.g. a reload mid-stream cancels the in-flight fetches). The allowance is
  // per-test and explicit, never a global silence.
  const ignored = input.testInfo.annotations
    .filter((annotation) => annotation.type === "expected-page-error")
    .map((annotation) => annotation.description ?? "")
    .filter(Boolean);
  const errors = input.errors.filter((error) => !ignored.some((needle) => error.includes(needle)));
  const failures: string[] = [];
  if (unmatched.length > 0) {
    failures.push(`${unmatched.length} unmatched model request(s):\n${JSON.stringify(unmatched.map(request => ({
      index: request.index,
      model: request.model,
      system: request.system.slice(0, 200)
    })), null, 2)}`);
  }
  if (errors.length > 0) {
    failures.push(`page errors:\n${errors.join('\n')}`);
  }
  if (failures.length > 0) {
    await attachEvidence({ ...input, errors, logBaseline: 0 });
    throw new Error(`test produced unexpected signals:\n${failures.join('\n\n')}`);
  }
}

export { expect };
