import { startCli } from "./adapters/cli.js";
import { getRuntime } from "./runtime.js";

function main(): void {
  const runtime = getRuntime();

  const cliOnly = process.argv.includes("--cli");
  if (cliOnly) {
    startCli(runtime.router);
  }
}

main();
