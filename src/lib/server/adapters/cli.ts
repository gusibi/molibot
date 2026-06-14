import readline from "node:readline";
import { MessageRouter } from "$lib/server/channels/shared/messageRouter.js";
import {
  attachReadlineShutdownGuard,
  closeReadlineQuietly,
  isReadlineClosed
} from "$lib/server/adapters/readlineGuard.js";

export function startCli(router: MessageRouter): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you> "
  });
  attachReadlineShutdownGuard(rl);

  console.log("Molibot CLI started. Type /exit to quit.");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (input === "/exit") {
      closeReadlineQuietly(rl);
      return;
    }

    const result = await router.handle({
      channel: "cli",
      externalUserId: "local-user",
      content: input
    });

    if (!result.ok) {
      console.log(`bot> Error: ${result.error}`);
    } else {
      console.log(`bot> ${result.response}`);
    }

    if (!isReadlineClosed(rl)) {
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log("CLI stopped.");
    process.exit(0);
  });
}
