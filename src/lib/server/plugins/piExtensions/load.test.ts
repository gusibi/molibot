import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * pi's loader is reused verbatim, so these tests pin the behaviour Molibot
 * depends on: all three discovery shapes load, a broken extension degrades to
 * an error row instead of taking the process down, and terminal-only
 * capabilities are reported rather than silently dropped.
 *
 * DATA_DIR must be set before `env.ts` is imported, so every import here is
 * dynamic and happens after the fixture tree exists.
 */
function buildFixtureDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-pi-ext-"));
  const extensionsDir = join(dataDir, "extensions");

  // 1. Subdirectory with index.ts
  mkdirSync(join(extensionsDir, "hello"), { recursive: true });
  writeFileSync(
    join(extensionsDir, "hello", "index.ts"),
    `import { Type } from "@sinclair/typebox";
export default function hello(pi: any) {
  pi.registerTool({
    name: "hello_tool",
    label: "Hello",
    description: "greets",
    parameters: Type.Object({ who: Type.String() }),
    async execute(_id: string, params: { who: string }) {
      return { content: [{ type: "text", text: "hi " + params.who }], details: {} };
    }
  });
  pi.on("agent_start", async () => undefined);
  pi.registerCommand("hello", { description: "hi", handler: async () => undefined });
}
`,
    "utf8"
  );
  writeFileSync(
    join(extensionsDir, "hello", "package.json"),
    JSON.stringify({ name: "hello-ext", version: "1.2.3", description: "demo" }),
    "utf8"
  );

  // 2. package.json manifest pointing at a non-index entry
  mkdirSync(join(extensionsDir, "manifested", "src"), { recursive: true });
  writeFileSync(
    join(extensionsDir, "manifested", "package.json"),
    JSON.stringify({ name: "manifested", version: "0.1.0", pi: { extensions: ["src/entry.ts"] } }),
    "utf8"
  );
  writeFileSync(
    join(extensionsDir, "manifested", "src", "entry.ts"),
    `export default function manifested(pi: any) {
  pi.registerShortcut("ctrl+k", { handler: async () => undefined });
}
`,
    "utf8"
  );

  // 3. Broken extension: throws while registering
  mkdirSync(join(extensionsDir, "broken"), { recursive: true });
  writeFileSync(
    join(extensionsDir, "broken", "index.ts"),
    `export default function broken() { throw new Error("boom"); }\n`,
    "utf8"
  );

  return dataDir;
}

test("pi extensions load from all three discovery shapes and survive a broken one", async () => {
  process.env.DATA_DIR = buildFixtureDataDir();

  const { loadPiExtensions } = await import("$lib/server/plugins/piExtensions/load.js");
  const result = await loadPiExtensions();

  const byId = new Map(result.extensions.map((entry) => [entry.id, entry]));

  const hello = byId.get("hello");
  assert.ok(hello, "subdirectory with index.ts should load");
  assert.deepEqual(hello.toolNames, ["hello_tool"]);
  assert.deepEqual(hello.eventNames, ["agent_start"]);
  assert.deepEqual(hello.commandNames, ["hello"]);
  // package.json metadata surfaces in the settings list.
  assert.equal(hello.name, "hello-ext");
  assert.equal(hello.version, "1.2.3");
  assert.equal(hello.description, "demo");

  const manifested = byId.get("manifested");
  assert.ok(manifested, "package.json pi.extensions entry should load");
  // Terminal-only capability is reported, not silently ignored.
  assert.deepEqual(manifested.unsupported, ["shortcuts"]);

  assert.equal(byId.has("broken"), false, "a throwing extension must not register");
  const brokenError = result.errors.find((entry) => entry.id === "broken");
  assert.ok(brokenError, "a throwing extension becomes an error row");
  assert.match(brokenError.error, /boom/);
});
