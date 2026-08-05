import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopMiniAppItem, openableMiniApps } from "$lib/server/app/desktopMiniApps.js";
import type { MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";

/**
 * The Mini App catalog → Desktop contract projection.
 *
 * This mapper enumerates fields rather than spreading, on purpose: it is the
 * guarantee that no host path ever reaches the WebView. The cost of that choice
 * is that a new field is silently dropped unless it is asserted here, which is
 * exactly what this test exists to prevent.
 */

const entry: MiniAppCatalogEntry = {
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  description: "Shared tasks.",
  status: "active",
  enabled: true,
  builtin: true,
  hasUi: true,
  toolNames: ["add", "list"],
  iconDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
  source: { kind: "builtin" },
  updateAvailable: true,
  availableVersion: "2.0.0"
};

test("every catalog field the desktop needs survives the projection", () => {
  const item = buildDesktopMiniAppItem(entry);
  assert.deepEqual(item, {
    id: "todo",
    name: "Todo",
    version: "1.0.0",
    description: "Shared tasks.",
    status: "active",
    enabled: true,
    builtin: true,
    toolNames: ["add", "list"],
    iconDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
    source: { kind: "builtin" },
    updateAvailable: true,
    availableVersion: "2.0.0",
    error: ""
  });
});

test("absent optionals become empty strings rather than undefined", () => {
  const item = buildDesktopMiniAppItem({
    ...entry,
    description: undefined,
    error: undefined,
    updateAvailable: false,
    availableVersion: ""
  });
  assert.equal(item.description, "");
  assert.equal(item.error, "");
  assert.equal(item.updateAvailable, false);
  assert.equal(item.availableVersion, "");
});

test("only enabled, loaded, error-free apps are offered for opening", () => {
  const items = [
    buildDesktopMiniAppItem(entry),
    buildDesktopMiniAppItem({ ...entry, id: "off", enabled: false, status: "disabled" }),
    buildDesktopMiniAppItem({ ...entry, id: "broken", status: "error", error: "Missing manifest.json." })
  ];
  assert.deepEqual(openableMiniApps(items).map((item) => item.id), ["todo"]);
});
