import assert from "node:assert/strict";
import test from "node:test";

import { handlerReplacements } from "./svelte-adapter-node-sqlite.js";

test("replaces every runtime placeholder required by adapter-node handler", () => {
  const replacements = handlerReplacements(
    {
      config: { kit: { paths: { base: "/molibot" } } },
      prerendered: { paths: ["/", "/settings"] }
    },
    "APP_",
    true
  );

  assert.equal(replacements.BASE, '"/molibot"');
  assert.equal(replacements.PRERENDERED, 'new Set(["/","/settings"])');
});
