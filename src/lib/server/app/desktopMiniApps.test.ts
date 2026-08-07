import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesktopBuiltinMiniApps,
  buildDesktopMiniAppItem,
  buildDesktopMiniAppsPayload,
  openableMiniApps
} from "$lib/server/app/desktopMiniApps.js";
import type { MiniAppBuiltinEntry, MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";

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
  messageActions: [{
    tool: "add",
    label: { zh: "存为待办", en: "Save as Todo" },
    icon: "check-square",
    accepts: ["text"]
  }],
  aiCapabilities: [],
  badge: { kind: "count", count: 3 },
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
    messageActions: [{
      tool: "add",
      label: { zh: "存为待办", en: "Save as Todo" },
      icon: "check-square",
      accepts: ["text"]
    }],
    aiCapabilities: [],
    badge: { kind: "count", count: 3 },
    iconDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
    source: { kind: "builtin" },
    updateAvailable: true,
    availableVersion: "2.0.0",
    error: ""
  });
});

test("a badge is copied rather than shared with the catalog entry", () => {
  // The projection is the WebView's boundary: handing back the host's own
  // object would let a later mutation inside the host change what the desktop
  // already rendered.
  const item = buildDesktopMiniAppItem(entry);
  assert.deepEqual(item.badge, { kind: "count", count: 3 });
  assert.notEqual(item.badge, entry.badge);
});

test("an app with no badge projects null rather than undefined", () => {
  assert.equal(buildDesktopMiniAppItem({ ...entry, badge: null }).badge, null);
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

/**
 * The built-in catalog projection. Same enumeration discipline, same reason:
 * a field added to the host entry and forgotten here is a control the manager
 * silently loses (an install button that never appears, an update never
 * offered).
 */
const builtinEntry: MiniAppBuiltinEntry = {
  id: "note",
  name: "Note",
  description: "Card notes.",
  availableVersion: "1.0.0",
  iconDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
  toolNames: ["create_note"],
  installed: false,
  installedVersion: "",
  updateAvailable: false,
  enabled: false,
  status: "not-installed",
  removedByOwner: true
};

test("a built-in that is not installed still projects everything its row needs", () => {
  assert.deepEqual(buildDesktopBuiltinMiniApps([builtinEntry]), [{
    id: "note",
    name: "Note",
    description: "Card notes.",
    availableVersion: "1.0.0",
    iconDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
    toolNames: ["create_note"],
    installed: false,
    installedVersion: "",
    updateAvailable: false,
    enabled: false,
    status: "not-installed",
    removedByOwner: true,
    error: ""
  }]);
});

test("every Mini App route answers with both catalogs", () => {
  // Installing, updating or uninstalling changes what is installed *and* what
  // the built-in tab should say about it; a payload carrying one of them is
  // how a list ends up showing the state before the click.
  const payload = buildDesktopMiniAppsPayload({
    listCatalog: () => [entry],
    listBuiltinCatalog: () => [builtinEntry]
  });
  assert.deepEqual(payload.items.map((item) => item.id), ["todo"]);
  assert.deepEqual(payload.builtin.map((item) => item.id), ["note"]);
});
