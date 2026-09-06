import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("settings numeric values remain readable inside SettingRow", {
  skip: !process.env.CHROME_BIN && "Set CHROME_BIN to run the browser layout regression",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-number-layout-"));
  try {
    const styles = read("./styles.css").replace(/@import[^;]+;/g, "");
    const row = read("./lib/components/ui/SettingRow.svelte")
      .replace(/<script[\s\S]*?<\/script>/, "")
      .replace("class:stacked ", "")
      .replace(/\{#if description\}[\s\S]*?\{\/if\}/, "")
      .replace('<slot name="detail" />', "");
    const inputs = [...read("./lib/settings/WebSearchSection.svelte").matchAll(/<input class="row-input model-number-input"[^\n]+\/>/g)];
    assert.equal(inputs.length, 3);
    const cases = ["20", "120000", "180000", ""];
    const rows = cases.map((value, index) => row.replace("{title}", index ? "重试超时（毫秒） / Retry timeout (ms)" : "最大结果数 / Maximum results")
      .replace("<slot />", `<input class="${inputs[index % 3][0].match(/class="([^"]+)"/)[1]}" type="number" value="${value}">`)).join("");
    const html = `<style>${styles}</style><main>${rows}</main><script>
      const results = [];
      for (const appearance of ['light', 'dark']) {
        document.documentElement.dataset.resolvedAppearance = appearance;
        for (const locale of ['zh', 'en']) {
          document.querySelectorAll('strong').forEach((label, index) => {
            label.textContent = locale === 'zh' ? (index ? '重试超时（毫秒）' : '最大结果数') : (index ? 'Retry timeout (ms)' : 'Maximum results');
          });
          for (const width of [320, 375, 720]) {
            document.querySelector('main').style.width = width + 'px';
            for (const input of document.querySelectorAll('input')) {
              const rect = input.getBoundingClientRect();
              results.push({ appearance, locale, width, value: input.value, inputWidth: rect.width,
                contained: rect.right <= document.querySelector('main').getBoundingClientRect().right });
            }
          }
        }
      }
      document.body.innerHTML = '<pre id="result">' + JSON.stringify(results) + '</pre>';
    </script>`;
    const file = join(directory, "fixture.html");
    writeFileSync(file, html);
    const result = spawnSync(process.env.CHROME_BIN, ["--headless", "--no-sandbox", "--disable-gpu", `--user-data-dir=${join(directory, "profile")}`, "--dump-dom", `file://${file}`], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, result.stdout.slice(-3000) + result.stderr);
    const results = JSON.parse(match[1]);
    for (const result of results) {
      assert.ok(result.inputWidth >= 110, `Clipped numeric field: ${JSON.stringify(result)}`);
      assert.ok(result.contained, `Overflowing numeric field: ${JSON.stringify(result)}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
