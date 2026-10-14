import { test, expect } from './support/fixtures';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1kAAAAASUVORK5CYII=', 'base64');

for (const failed of [false, true]) {
  test(`chat local Markdown image ${failed ? 'failure' : 'loads'} through attachments @chat`, async ({ page }) => {
    let requests = 0;
    await page.route('**/image-fixture*.png', async route => {
      requests += 1;
      await route.fulfill({ status: failed ? 404 : 200, contentType: 'image/png', body: failed ? '' : png });
    });
    await page.goto('/');
    await page.evaluate(async failed => {
      const path = '/src/lib/chat/fixtures/mountMarkdownImages.ts';
      const { mountImages } = await import(/* @vite-ignore */ path);
      const target = document.createElement('div');
      document.body.replaceChildren(target);
      mountImages(target, { locale: 'en', loadBytes: async () => {
        const response = await fetch(failed ? '/image-fixture-missing.png' : '/image-fixture.png');
        if (!response.ok) throw new Error('Image unavailable');
        return await response.blob();
      } });
    }, failed);
    const fixture = page.getByTestId('image-fixture');
    await expect(fixture.getByText('Generated cover', { exact: true })).toBeVisible();
    await expect(fixture.getByRole('img', { name: 'Cover', exact: true })).toBeVisible();
    await expect(fixture.getByLabel('Image requests')).toHaveText('1');
    if (failed) {
      await expect(fixture.locator('img[alt="Cover"]')).toHaveCount(0);
    } else {
      const image = fixture.getByRole('img', { name: 'Cover', exact: true });
      await expect(image).toHaveAttribute('src', /^blob:/);
      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1);
      const sanitized = await page.evaluate(async () => {
        const path = '/src/lib/markdown.ts';
        const { renderMarkdown } = await import(/* @vite-ignore */ path);
        const document = new DOMParser().parseFromString(renderMarkdown('[Unsafe](javascript:alert(1)) [Blob link](blob:cover)', 'Copy'), 'text/html');
        return [...document.querySelectorAll('a')].map(link => link.getAttribute('href'));
      });
      expect(sanitized).toEqual([null, null]);
      await image.click();
      await expect(page.locator('.image-lightbox')).toBeVisible();
    }
    expect(requests).toBe(1);
  });
}

test('large previews preserve their ratio and enlarge on click @chat', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/lib/chat/fixtures/mountMarkdownImages.ts';
    const { mountImages } = await import(/* @vite-ignore */ path);
    const target = document.createElement('div');
    document.body.replaceChildren(target);
    document.documentElement.setAttribute('data-resolved-appearance', 'dark');
    mountImages(target, { locale: 'zh-CN', loadBytes: async () => new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="red"/></svg>'
    ], { type: 'image/svg+xml' }) });
  });
  const image = page.getByTestId('image-fixture').getByRole('img', { name: 'Cover', exact: true });
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1200);
  const preview = await image.boundingBox();
  expect(preview!.width).toBeLessThanOrEqual(480);
  expect(preview!.height).toBeLessThanOrEqual(360);
  expect(preview!.width / preview!.height).toBeCloseTo(0.75);
  await image.click();
  const enlarged = page.locator('.image-lightbox img');
  await expect(enlarged).toBeVisible();
  expect((await enlarged.boundingBox())!.height).toBeGreaterThan(preview!.height);
  await page.keyboard.press('Escape');
  await expect(page.locator('.image-lightbox')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 760 });
  const narrow = await image.boundingBox();
  expect(narrow!.width).toBeLessThanOrEqual(320);
  expect(narrow!.height).toBeLessThanOrEqual(360);
  expect(narrow!.width / narrow!.height).toBeCloseTo(0.75);
});
