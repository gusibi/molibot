import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactNotFoundError,
  artifactContentType,
  artifactDocumentCsp,
  artifactPreviewResponse,
  hasArtifactProxyHeader,
  injectPreviewBaseStyle,
  resolveArtifactFile
} from "./artifactRoute.js";
import {
  decodeSessionArtifactToken,
  encodeSessionArtifactToken
} from "../../shared/artifactToken.js";

function fixture(rootPath: string): { rootPath: string } {
  return { rootPath };
}

test("an HTML file inside the project root resolves with an HTML content type", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    writeFileSync(join(root, "report.html"), "<!doctype html><p>hi</p>");
    const target = await resolveArtifactFile(fixture(root), "report.html");
    assert.equal(target.isHtml, true);
    assert.match(target.contentType, /^text\/html/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a relative css asset in a subfolder resolves inside the root", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "style.css"), "body{color:red}");
    const target = await resolveArtifactFile(fixture(root), "assets/style.css");
    assert.equal(target.isHtml, false);
    assert.match(target.contentType, /^text\/css/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a `..` escape outside the project root fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  const outside = mkdtempSync(join(tmpdir(), "molibot-artifact-out-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "secret");
    await assert.rejects(
      () => resolveArtifactFile(fixture(root), "../" + (outside.split("/").pop() as string) + "/secret.txt"),
      ArtifactNotFoundError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a symlink that escapes the project root fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  const outside = mkdtempSync(join(tmpdir(), "molibot-artifact-out-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
    await assert.rejects(
      () => resolveArtifactFile(fixture(root), "escape.txt"),
      ArtifactNotFoundError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a missing file fails closed with the generic not-found error", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    await assert.rejects(
      () => resolveArtifactFile(fixture(root), "does-not-exist.html"),
      ArtifactNotFoundError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a directory path fails closed (only files are served)", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    mkdirSync(join(root, "subdir"));
    await assert.rejects(
      () => resolveArtifactFile(fixture(root), "subdir"),
      ArtifactNotFoundError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the resolved target never carries a host absolute path in its content type", async () => {
  // The route response uses the validated target only to stream bytes; the
  // content type comes from the extension, never from the host path. A leak
  // would mean echoing `target` into a header or body (pitfall #6).
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    writeFileSync(join(root, "page.html"), "<p>ok</p>");
    const target = await resolveArtifactFile(fixture(root), "page.html");
    assert.doesNotMatch(target.contentType, /\/Users\/|\/tmp\/|rootPath/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hasArtifactProxyHeader accepts only the exact marker value", () => {
  const withHeader = new Request("http://127.0.0.1/x", {
    headers: { "x-molibot-artifact-proxy": "v1" }
  });
  assert.equal(hasArtifactProxyHeader(withHeader), true);
  const missing = new Request("http://127.0.0.1/x");
  assert.equal(hasArtifactProxyHeader(missing), false);
  const wrong = new Request("http://127.0.0.1/x", {
    headers: { "x-molibot-artifact-proxy": "other" }
  });
  assert.equal(hasArtifactProxyHeader(wrong), false);
});

test("the HTML document CSP blocks the network and names the artifact scheme", () => {
  const csp = artifactDocumentCsp();
  // No network egress: the preview is a static render, not a browser.
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  // Relative subresources resolve to molibot-artifact:// through the transport.
  assert.match(csp, /script-src 'unsafe-inline' molibot-artifact:/);
  assert.match(csp, /img-src data: blob: molibot-artifact:/);
  // The frame can only be embedded by the desktop WebView origins.
  assert.match(csp, /frame-ancestors 'self' tauri:\/\/localhost/);
});

test("artifactContentType maps html, css, js and unknown", () => {
  assert.equal(artifactContentType("a.html").isHtml, true);
  assert.equal(artifactContentType("a.htm").isHtml, true);
  assert.equal(artifactContentType("a.css").isHtml, false);
  assert.match(artifactContentType("a.css").contentType, /^text\/css/);
  assert.match(artifactContentType("a.js").contentType, /^text\/javascript/);
  assert.equal(artifactContentType("a.bin").contentType, "application/octet-stream");
  assert.equal(artifactContentType("a.bin").isHtml, false);
});

test("the preview base style is injected ahead of every page style", () => {
  const styled =
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><style>body{color:pink}</style></head></html>";
  const dark = injectPreviewBaseStyle(styled, "dark");
  // Injected as the first thing in <head>, so the page's own <style> wins.
  assert.ok(dark.indexOf("<style>html{color-scheme:dark;background:#0d1117;color:#e6edf3}</style>") < dark.indexOf("<style>body{color:pink}"));
  const light = injectPreviewBaseStyle(styled, "light");
  assert.ok(light.includes("<style>html{color-scheme:light;background:#ffffff;color:#1f2328}</style>"));
  // A fragment with no <head> anchors on <html>; bare template text prepends.
  assert.match(injectPreviewBaseStyle("<html><body>{{ x }}</body></html>", "dark"), /^<html><style>/);
  assert.ok(injectPreviewBaseStyle("{{- if or .Params.mermaid -}}", "dark").startsWith("<style>"));
  // `<header>` is a body element, not the head anchor.
  const headerDoc = injectPreviewBaseStyle("<body><header>nav</header></body>", "dark");
  assert.ok(headerDoc.startsWith("<style>"));
  assert.ok(headerDoc.endsWith("<body><header>nav</header></body>"));
  // ASCII-only injection can sit before a late <meta charset> without
  // re-encoding the document.
  assert.equal(
    injectPreviewBaseStyle("<head></head>", "dark"),
    "<head><style>html{color-scheme:dark;background:#0d1117;color:#e6edf3}</style></head>"
  );
});

test("the preview response injects the theme base style into HTML documents", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    writeFileSync(join(root, "page.html"), "<!doctype html><html><head><title>t</title></head></html>");
    const target = await resolveArtifactFile(fixture(root), "page.html");
    const base = { resolved: target, size: 74, mtimeMs: 1_000 };

    const dark = await artifactPreviewResponse({ ...base, theme: "dark", rangeHeader: null, ifNoneMatch: null });
    assert.equal(dark.status, 200);
    assert.match(await dark.text(), /color-scheme:dark;background:#0d1117/);
    assert.equal(dark.headers.get("content-security-policy"), artifactDocumentCsp());

    // The ETag is theme-specific, so a light-theme cache can never 304 a dark
    // request into repainting the stale canvas.
    const darkEtag = dark.headers.get("etag");
    const light = await artifactPreviewResponse({ ...base, theme: "light", rangeHeader: null, ifNoneMatch: null });
    assert.notEqual(light.headers.get("etag"), darkEtag);

    const revalidate = await artifactPreviewResponse({ ...base, theme: "dark", rangeHeader: null, ifNoneMatch: darkEtag });
    assert.equal(revalidate.status, 304);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requests outside the injection gate stream the raw file", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-artifact-"));
  try {
    writeFileSync(join(root, "page.html"), "<!doctype html><html><body>raw</body></html>");
    const target = await resolveArtifactFile(fixture(root), "page.html");
    const base = { resolved: target, size: 43, mtimeMs: 1_000 };

    // No theme hint: a non-panel caller gets the file verbatim.
    const raw = await artifactPreviewResponse({ ...base, size: 44, theme: null, rangeHeader: null, ifNoneMatch: null });
    assert.equal(await raw.text(), "<!doctype html><html><body>raw</body></html>");
    assert.equal(raw.headers.get("content-security-policy"), artifactDocumentCsp());

    // A ranged request (never sent for documents, always for media) streams.
    const ranged = await artifactPreviewResponse({ ...base, theme: "dark", rangeHeader: "bytes=0-6", ifNoneMatch: null });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "<!docty");

    // Non-HTML assets never get a style injected.
    writeFileSync(join(root, "app.js"), "console.log(1);");
    const js = await resolveArtifactFile(fixture(root), "app.js");
    const rawJs = await artifactPreviewResponse({ resolved: js, size: 15, mtimeMs: 1_000, theme: "dark", rangeHeader: null, ifNoneMatch: null });
    assert.equal(await rawJs.text(), "console.log(1);");
    assert.equal(rawJs.headers.get("content-security-policy"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a session artifact token round-trips profile, session and project ids", () => {
  const token = encodeSessionArtifactToken({ profileId: "p1", sessionId: "s-20260806-abcd", projectId: "proj-1" });
  assert.deepEqual(decodeSessionArtifactToken(token), {
    profileId: "p1",
    sessionId: "s-20260806-abcd",
    projectId: "proj-1"
  });
  // An ordinary web session carries no project id and must not gain an empty one.
  const plain = encodeSessionArtifactToken({ profileId: "p1", sessionId: "s-20260806-abcd" });
  assert.deepEqual(decodeSessionArtifactToken(plain), { profileId: "p1", sessionId: "s-20260806-abcd" });
});

test("a session artifact token carries ids only, never a host path", () => {
  // Pitfall #6: the WebView must never receive or be able to supply a host path.
  const token = encodeSessionArtifactToken({ profileId: "p1", sessionId: "s-1" });
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  assert.doesNotMatch(decoded, /\//);
  assert.deepEqual(Object.keys(JSON.parse(decoded)).sort(), ["profileId", "sessionId"]);
});

test("a malformed or session-less artifact token is refused, not defaulted", () => {
  assert.equal(decodeSessionArtifactToken("not-base64url-json"), null);
  assert.equal(decodeSessionArtifactToken(""), null);
  assert.equal(decodeSessionArtifactToken(Buffer.from("[]", "utf8").toString("base64url")), null);
  // A token naming a profile but no session addresses nothing; it must not fall
  // back to some default workspace.
  const sessionless = Buffer.from(JSON.stringify({ profileId: "p1" }), "utf8").toString("base64url");
  assert.equal(decodeSessionArtifactToken(sessionless), null);
});

test("session artifacts resolve against a workspace root with the same escape rules", async () => {
  // The Session root check is the Project check with a different root, so a
  // `..` escape and a symlink out are rejected identically. The sibling
  // stylesheet is the case a blob URL could never serve.
  const root = mkdtempSync(join(tmpdir(), "molibot-session-artifact-"));
  const outside = mkdtempSync(join(tmpdir(), "molibot-session-outside-"));
  try {
    mkdirSync(join(root, "attachments"), { recursive: true });
    writeFileSync(join(root, "attachments", "page.html"), "<!doctype html><link rel=stylesheet href=./a.css>");
    writeFileSync(join(root, "attachments", "a.css"), "p{}");
    writeFileSync(join(outside, "secret.txt"), "nope");

    const html = await resolveArtifactFile(fixture(root), "attachments/page.html");
    assert.equal(html.isHtml, true);
    const css = await resolveArtifactFile(fixture(root), "attachments/a.css");
    assert.match(css.contentType, /^text\/css/);

    await assert.rejects(
      () => resolveArtifactFile(fixture(root), `../${outside.split("/").pop() as string}/secret.txt`),
      ArtifactNotFoundError
    );
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    await assert.rejects(() => resolveArtifactFile(fixture(root), "link.txt"), ArtifactNotFoundError);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
