import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRelativeResourcePath } from "./markdownImages.js";

test("a sibling reference resolves inside the file's directory", () => {
  assert.equal(
    resolveRelativeResourcePath("content/zh/post/nuxt-ssr-to-worker-r2-architecture", "cloudflare-error-1102.png"),
    "content/zh/post/nuxt-ssr-to-worker-r2-architecture/cloudflare-error-1102.png"
  );
});

test("./ and nested subdirectory references resolve under the base directory", () => {
  assert.equal(resolveRelativeResourcePath("docs", "./img.png"), "docs/img.png");
  assert.equal(resolveRelativeResourcePath("docs", "img/deep.png"), "docs/img/deep.png");
});

test(".. climbs toward the root without escaping it", () => {
  assert.equal(resolveRelativeResourcePath("docs/guide", "../shared/asset.png"), "docs/shared/asset.png");
  assert.equal(resolveRelativeResourcePath("docs/guide", "a/../../b.png"), "docs/b.png");
});

test("a reference above the root, an empty result, and an empty source do not resolve", () => {
  assert.equal(resolveRelativeResourcePath("docs", "../../escape.png"), null);
  assert.equal(resolveRelativeResourcePath("docs", ".."), null);
  assert.equal(resolveRelativeResourcePath("docs", ""), null);
});

test("absolute URLs, protocol-relative, data URIs and root-absolute paths are left to the caller", () => {
  assert.equal(resolveRelativeResourcePath("docs", "https://example.com/a.png"), null);
  assert.equal(resolveRelativeResourcePath("docs", "http://127.0.0.1:1/a.png"), null);
  assert.equal(resolveRelativeResourcePath("docs", "//cdn.example.com/a.png"), null);
  assert.equal(resolveRelativeResourcePath("docs", "data:image/png;base64,AAAA"), null);
  assert.equal(resolveRelativeResourcePath("docs", "blob:abc"), null);
  assert.equal(resolveRelativeResourcePath("docs", "/images/post/a.png"), null);
});

test("a file at the root has no base directory and still resolves", () => {
  assert.equal(resolveRelativeResourcePath("", "img.png"), "img.png");
  assert.equal(resolveRelativeResourcePath("", "./a/b.png"), "a/b.png");
});
