import { readFileSync } from 'node:fs';
import { test, expect } from './support/fixtures';

/**
 * Visual baseline for both answer styles (Feishu Docs / Notion).
 *
 * The model is deliberately not involved: mounting the real Desktop
 * `renderMarkdown()` into the real app shell (so the real global stylesheet,
 * theme tokens, KaTeX/highlight.js CSS and font stack are all loaded) is the
 * only way to inspect the typography without an LLM paraphrasing the fixture.
 * Both skins render the SAME HTML; only `data-doc-style` changes, which is
 * what proves the style is a skin and not a second renderer.
 *
 * Screenshots go to SHOWCASE_OUT_DIR (default /tmp) so a normal test run never
 * writes into the repository. Run it with:
 *   node node_modules/@playwright/test/cli.js test \
 *     --config tests/ui/playwright.config.ts --project=chromium \
 *     tests/ui/markdown-showcase.spec.ts
 */
const source = readFileSync(new URL('../fixtures/markdown-showcase.md', import.meta.url), 'utf8');
const cover = readFileSync(new URL('../fixtures/showcase-cover.svg', import.meta.url));
const outDir = process.env.SHOWCASE_OUT_DIR ?? '/tmp';
const styles = ['feishu', 'notion'] as const;

test('both answer styles render the same Markdown through the real Desktop renderer @chat', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('**/showcase-cover.svg', async route => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: cover });
  });

  await page.goto('/');
  await page.evaluate(async markdown => {
    // A variable keeps tsc from trying to resolve this Vite dev-server URL.
    const modulePath = '/src/lib/markdown.ts';
    const { renderMarkdown } = await import(/* @vite-ignore */ modulePath);
    const root = document.documentElement;
    root.setAttribute('data-theme-family', 'feishu');
    root.setAttribute('data-resolved-appearance', 'light');
    root.style.height = 'auto';
    document.body.style.cssText = 'height:auto;min-height:100vh;overflow:visible;display:block;';

    const target = document.createElement('div');
    target.id = 'showcase';
    target.className = 'markdown-body';
    Object.assign(target.style, {
      boxSizing: 'border-box',
      maxWidth: '760px',
      margin: '32px auto',
      padding: '0 28px 64px'
    });
    document.body.replaceChildren(target);
    target.innerHTML = renderMarkdown(markdown, 'Copy code', {
      labels: { wrapLines: 'Wrap lines', previewArtifact: 'Preview', openTable: 'Open table' }
    });
  }, source);

  await expect(page.locator('#showcase h1')).toHaveText('Q4 产品周报 · 排版验收样张');
  await expect.poll(async () =>
    page.locator('#showcase img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)
  ).toBeGreaterThan(0);
  // KaTeX and the table wrapper are the two blocks most likely to be missing a
  // stylesheet in a stripped-down page, so assert them before capturing.
  await expect(page.locator('#showcase .katex').first()).toBeVisible();
  await expect(page.locator('#showcase .markdown-table-wrap').first()).toBeVisible();

  for (const style of styles) {
    await page.evaluate(next => {
      document.documentElement.dataset.docStyle = next;
      document.documentElement.setAttribute('data-resolved-appearance', 'light');
      window.scrollTo(0, 0);
    }, style);
    await page.waitForTimeout(80);

    // The attribute must actually change the rendered document: Feishu draws
    // a rule under H1, Notion deliberately does not.
    const h1 = page.locator('#showcase h1');
    if (style === 'notion') {
      await expect(h1).toHaveCSS('border-bottom-style', 'none');
      await expect(h1).toHaveCSS('font-weight', '600');
    } else {
      await expect(h1).toHaveCSS('border-bottom-width', '1px');
      await expect(h1).toHaveCSS('font-weight', '500');
    }

    await page.screenshot({ path: `${outDir}/molibot-showcase-${style}-top-light.png` });
    await page.screenshot({ path: `${outDir}/molibot-showcase-${style}-full-light.png`, fullPage: true });

    for (const [name, heading] of [['code', '五、代码块'], ['media', '七、图文排版']] as const) {
      await page.evaluate(text => {
        const target = [...document.querySelectorAll('#showcase h2')]
          .find(element => element.textContent?.includes(text));
        target?.scrollIntoView({ block: 'start' });
      }, heading);
      if (name === 'code') {
        // The code-block toolbar is hover/focus revealed by design; put the
        // pointer on the first block so the screenshot shows its real chrome.
        const box = await page.locator('#showcase .code-block').first().boundingBox();
        if (box) await page.mouse.move(box.x + box.width - 40, box.y + 16);
        // The toolbar fades in; capture after the transition so the icons are
        // actually visible in the baseline image.
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `${outDir}/molibot-showcase-${style}-${name}-light.png` });
    }

    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.setAttribute('data-resolved-appearance', 'dark');
    });
    await page.screenshot({ path: `${outDir}/molibot-showcase-${style}-top-dark.png` });
    await page.screenshot({ path: `${outDir}/molibot-showcase-${style}-full-dark.png`, fullPage: true });
  }
});
