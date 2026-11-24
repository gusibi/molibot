import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopStyles = readFileSync(resolve(here, "styles.css"), "utf8");
const webAppCss = readFileSync(resolve(here, "../../../src/app.css"), "utf8");

test("desktop and web share the exact same motion duration and easing tokens", () => {
  const tokens = [
    "--duration-instant: 100ms;",
    "--duration-fast: 160ms;",
    "--duration-normal: 240ms;",
    "--duration-panel: 300ms;",
    "--ease-standard: cubic-bezier(0.2, 0, 0, 1);",
    "--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.1);"
  ];
  for (const token of tokens) {
    assert.ok(desktopStyles.includes(token), `desktop styles missing token: ${token}`);
    assert.ok(webAppCss.includes(token), `web app.css missing token: ${token}`);
  }
});

test("interactive transitions in desktop styles use shared duration and easing tokens", () => {
  const lines = desktopStyles.split("\n");
  const loopPattern = /(spin|pulse|blink|wave|flow|walk|bob|signal|working|target|shimmer|orbit)/i;
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/^(transition|animation)\s*:/.test(line)) continue;
    if (loopPattern.test(line)) continue;
    if (/\b\d+(\.\d+)?ms\b/.test(line) && !line.includes("var(--duration-")) {
      violations.push(`${i + 1}: ${line}`);
    }
    if (/\b(ease|ease-in|ease-out|ease-in-out|cubic-bezier)\b/.test(line) && !line.includes("var(--ease-")) {
      violations.push(`${i + 1}: ${line}`);
    }
  }
  assert.deepEqual(violations, [], `Found raw hardcoded motion durations/easings:\n${violations.join("\n")}`);
});

test("high-frequency scroll marker animates GPU transform rather than layout height", () => {
  const markerBlock = desktopStyles.slice(
    desktopStyles.indexOf(".prompt-navigation-line {"),
    desktopStyles.indexOf(".prompt-navigation-overflow {")
  );
  assert.match(markerBlock, /transition:\s*transform var\(--duration-instant\)/);
  assert.match(markerBlock, /transform:\s*scaleY\(1\.5\)/);
  assert.doesNotMatch(markerBlock, /transition:[^;]*\bheight\b/);
});

test("new and unified motion surfaces are covered by reduced-motion and low-performance fallbacks", () => {
  const required = [
    ".modal-card",
    ".project-dialog",
    ".memory-trace-drawer",
    ".session-history-drawer",
    ".automation-detail-panel",
    ".agent-home-feed",
    ".agent-home-work-detail",
    ".agent-home-undo-bar",
    ".notification-expanded-result",
    ".prompt-navigation-line"
  ];
  const reducedStart = desktopStyles.indexOf("@media (prefers-reduced-motion: reduce) {\n\n  .ios-switch-track,");
  const reducedSlice = desktopStyles.slice(reducedStart, reducedStart + 3000);
  const lowPerfStart = desktopStyles.indexOf(':root[data-performance="low"] :is(.appearance-segmented');
  const lowPerfSlice = desktopStyles.slice(lowPerfStart, lowPerfStart + 3000);

  for (const selector of required) {
    assert.ok(reducedSlice.includes(selector), `prefers-reduced-motion missing ${selector}`);
    assert.ok(lowPerfSlice.includes(selector), `data-performance="low" missing ${selector}`);
  }
  assert.match(webAppCss, /@media \(prefers-reduced-motion: reduce\)/);
});
