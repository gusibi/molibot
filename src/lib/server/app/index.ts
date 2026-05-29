import { startCli } from "$lib/server/adapters/cli.js";
import { getRuntime } from "$lib/server/app/runtime.js";

function main(): void {
  const runtime = getRuntime();

  const cliOnly = process.argv.includes("--cli");
  if (cliOnly) {
    startCli(runtime.router);
  }
}

main();
