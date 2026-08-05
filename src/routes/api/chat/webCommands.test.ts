import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { WEB_COMMAND_DEFINITIONS } from "$lib/server/app/composerSuggestions.js";

const source = readFileSync(new URL("./+server.ts", import.meta.url), "utf8");

/** The `tryHandleWebCommand` body — the only place a `/command` is dispatched. */
function dispatcherBody(): string {
  const start = source.indexOf("async function tryHandleWebCommand(");
  assert.ok(start >= 0, "tryHandleWebCommand must exist");
  const end = source.indexOf("\nasync function parseRequest(", start);
  assert.ok(end > start, "tryHandleWebCommand must be followed by parseRequest");
  return source.slice(start, end);
}

test("every command the composer advertises actually dispatches", () => {
  // The regression: `/miniapps` was offered in the composer (with its
  // /mini-apps and /apps aliases) while its branch sat stranded inside
  // `buildModelsText`, a formatter that returns a string and never sees `cmd`.
  // It compiled to four type errors and the command silently did nothing.
  const body = dispatcherBody();
  for (const definition of WEB_COMMAND_DEFINITIONS) {
    for (const name of [definition.name, ...(definition.aliases ?? [])]) {
      assert.ok(
        body.includes(`cmd === "/${name}"`),
        `/${name} is offered in the composer but never dispatched in tryHandleWebCommand`
      );
    }
  }
});

test("the Mini App branch returns the catalog listing", () => {
  const body = dispatcherBody();
  const branch = body.slice(body.indexOf('cmd === "/miniapps"'));
  assert.match(
    branch.slice(0, 400),
    /formatMiniAppList\(getMiniAppHost\(\)\.listCatalog\(\)/,
    "/miniapps must answer with the installed Mini App catalog"
  );
});

test("no dispatcher branch is stranded in a text builder", () => {
  // `cmd` is a local of the dispatcher. Any other function referencing it is a
  // branch that was pasted into the wrong body — which is exactly how this bug
  // reached master.
  const outside = source.replace(dispatcherBody(), "");
  assert.ok(
    !/\bcmd === "/.test(outside),
    "a `cmd === \"/...\"` comparison outside tryHandleWebCommand is a misplaced branch"
  );
});
