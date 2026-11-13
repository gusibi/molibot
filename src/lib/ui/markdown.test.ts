import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderMarkdown } from "./markdown";

const repoRoot = new URL("../../../", import.meta.url);

function readSource(path: string): string {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

test("Web and Desktop share the CommonMark line-break rule", () => {
  const html = renderMarkdown("line one\nline two");
  assert.doesNotMatch(html, /<br/);
  assert.match(html, /<p>line one\nline two<\/p>/);
});

test("GFM task lists keep standard Markdown checkboxes only", () => {
  const html = renderMarkdown("- [ ] todo\n- [x] done");
  assert.match(html, /<input type="checkbox" disabled> todo/);
  assert.match(html, /<input type="checkbox" disabled checked> done/);
  assert.equal(renderMarkdown('<input type="text" onfocus="alert(1)">').includes("<input"), false);
  assert.doesNotMatch(renderMarkdown("<input type=checkbox onclick=alert(1)>"), /onclick|alert\(1\)/);
});

test("wide GFM tables scroll inside a local wrapper", () => {
  const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
  assert.match(html, /^<div class="markdown-table-wrap"><table>/);
  assert.match(html, /<\/table><\/div>/);
});

test("raw HTML cannot inject scripts, styles or event handlers", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n\n<style>body{display:none}</style>\n\n<img src="/a.png" onerror="alert(2)" style="position:fixed">'
  );
  assert.doesNotMatch(html, /<script|<style|onerror|position:fixed|alert\(/);
  assert.match(html, /<img src="\/a\.png" loading="lazy" decoding="async">/);
});

test("links with unsafe protocols lose their href", () => {
  assert.match(renderMarkdown("[x](javascript:alert(1))"), /<a>x<\/a>/);
  assert.doesNotMatch(renderMarkdown("[x](javascript:alert(1))"), /javascript:/);
  assert.match(
    renderMarkdown("[safe](https://example.com)"),
    /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer">safe<\/a>/
  );
});

test("image URLs, alt text and query strings survive sanitizing exactly once", () => {
  const image = renderMarkdown('![diagram](/files/diagram.png "Figure 1")');
  assert.match(image, /src="\/files\/diagram\.png"/);
  assert.match(image, /alt="diagram"/);
  assert.match(image, /loading="lazy" decoding="async"/);

  const link = renderMarkdown("[link](https://example.com/?a=1&b=2)");
  assert.match(link, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(link, /&amp;amp;/);
});

test("figure and figcaption from standard Markdown image markup are allowed", () => {
  const html = renderMarkdown('<figure><img src="/a.png"><figcaption>Chart A</figcaption></figure>');
  assert.match(html, /<figure><img src="\/a\.png" loading="lazy"/);
  assert.match(html, /<figcaption>Chart A<\/figcaption><\/figure>/);
});

test("unbalanced tags are closed so an answer cannot break the transcript DOM", () => {
  const html = renderMarkdown("<blockquote><p>unfinished");
  assert.match(html, /<\/p><\/blockquote>$/);
});

test("the sanitizer has no DOM branch, so SSR and hydration emit identical HTML", () => {
  const source = readSource("src/lib/ui/markdown.ts");
  assert.doesNotMatch(source, /\bdocument\b|createElement\("template"\)/);
  // Explicitly prove the Node (SSR) path still sanitizes rather than passing
  // the input through, which the old `typeof document === "undefined"` did.
  assert.equal(typeof globalThis.document, "undefined");
  assert.doesNotMatch(renderMarkdown("<script>alert(1)</script>"), /<script/);
});

test("one global document scale covers every Web renderMarkdown surface", () => {
  const appCss = readSource("src/app.css");
  const docCss = readSource("src/styles/markdown.css");
  const main = readSource("src/routes/+page.svelte");
  const sessions = readSource("src/routes/settings/sessions/+page.svelte");
  const settingsCss = readSource("src/styles/settings-custom.css");

  assert.match(appCss, /@import "\.\/styles\/markdown\.css"/);
  assert.match(docCss, /\.markdown-body \{[^}]*font-size: 15px;[^}]*line-height: 25px;/);
  assert.match(docCss, /max-height: 360px/);
  assert.match(docCss, /\.markdown-table-wrap/);
  assert.match(docCss, /\.md-audio-player/);

  // A page-scoped copy would only exist while that page is mounted, which is
  // how the session-history preview used to fall out of the design system.
  assert.doesNotMatch(main, /<style>|:global\(\.markdown-body/);
  assert.doesNotMatch(main, /markdown-body[^\n]*text-\[15px\]|markdown-body[^\n]*leading-8|markdown-body[^\n]*text-sm/);
  assert.match(sessions, /class="session-msg-content markdown-body"/);
  assert.doesNotMatch(
    settingsCss,
    /\.session-msg-content \{[^}]*font-size:/
  );
});

test("the Web mirror never drifts from the Desktop --md-* scale", () => {
  const desktop = readSource("apps/desktop/src/styles.css");
  const web = readSource("src/styles/markdown.css");
  const token = (name: string): string => {
    const match = new RegExp(`${name}:\\s*([\\d.]+px)`).exec(desktop);
    assert.ok(match, `${name} missing from Desktop tokens`);
    return match[1];
  };

  const bodySize = token("--md-fs-body");
  const bodyLine = token("--md-lh-body");
  const h1Size = token("--md-fs-h1");
  const h1Line = token("--md-lh-h1");

  assert.match(web, new RegExp(`\\.markdown-body \\{[^}]*font-size: ${bodySize};[^}]*line-height: ${bodyLine};`));
  assert.match(web, new RegExp(`\\.markdown-body h1 \\{[^}]*font-size: ${h1Size};[^}]*line-height: ${h1Line};`));
  // One size/line-height pair, one step above the 14/22 UI text rank.
  assert.equal(bodySize, "15px");
  assert.equal(bodyLine, "25px");
});

test("every Web audio surface uses the one shared player", () => {
  const surfaces = [
    "src/routes/+page.svelte",
    "src/routes/settings/tts/+page.svelte",
    "src/routes/settings/sessions/+page.svelte"
  ];
  for (const path of surfaces) {
    const source = readSource(path);
    assert.match(source, /<AudioPlayer/, path);
    assert.doesNotMatch(source, /<audio[^>]*controls/, path);
  }
  const player = readSource("src/lib/components/ui/audio-player/audio-player.svelte");
  assert.match(player, /decodeAudioData/);
  assert.match(player, /aria-label=/);
  assert.match(readSource("src/styles/markdown.css"), /prefers-reduced-motion/);
});

test("the Notion answer style is a skin shared by both ends, not a second renderer", () => {
  const web = readSource("src/styles/markdown.css");
  const desktop = readSource("apps/desktop/src/styles.css");
  assert.match(web, /:root\[data-doc-style="notion"\] \.markdown-body/);
  assert.match(desktop, /:root\[data-doc-style="notion"\] \{/);
  // Both skins sit on one typography axis: the Notion H1 rank is identical on
  // the two ends (Desktop via tokens, Web via the mirrored literal values).
  assert.match(web, /data-doc-style="notion"\] \.markdown-body h1 \{[^}]*font-size: 26px;[^}]*line-height: 32px;/);
  assert.match(desktop, /--md-fs-h1: 26px;\s+--md-lh-h1: 32px;/);
  // One attribute is the only switch. A renderer that branches on the style
  // would fork the cached HTML and break the streamed/settled skeleton.
  assert.match(readSource("src/app.html"), /dataset\.docStyle/);
  assert.match(readSource("src/routes/+layout.svelte"), /DOC_STYLE_STORAGE_KEY/);
  assert.doesNotMatch(readSource("src/lib/ui/markdown.ts"), /docStyle|data-doc-style/);
  assert.doesNotMatch(readSource("apps/desktop/src/lib/markdown.ts"), /docStyle|data-doc-style/);
});

test("inline images stay inline on both ends while figures stay block-level", () => {
  const web = readSource("src/styles/markdown.css");
  const desktop = readSource("apps/desktop/src/styles.css");
  // A block-level <img> inside a <p> visually splits one sentence into three
  // blocks. The block treatment belongs to .md-figure only.
  const inlineRule = /:is\([^)]*p,[^)]*\) img \{[^}]*display: inline;/;
  assert.match(web, inlineRule, "Web inline image rule missing");
  assert.match(desktop, inlineRule, "Desktop inline image rule missing");
  assert.match(desktop, /\.markdown-body \.md-figure img \{ margin: 0 auto; \}/);
});
