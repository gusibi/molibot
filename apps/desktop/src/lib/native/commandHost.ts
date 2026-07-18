import type { CommandId } from "./commandSystem";

export interface CommandHostAdapter {
  execute(id: CommandId): Promise<void> | void;
}

export class MemoryCommandHostAdapter implements CommandHostAdapter {
  readonly executed: CommandId[] = [];

  execute(id: CommandId): void {
    this.executed.push(id);
  }
}

export class CallbackCommandHostAdapter implements CommandHostAdapter {
  constructor(private readonly handler: (id: CommandId) => Promise<void> | void) {}

  execute(id: CommandId): Promise<void> | void {
    return this.handler(id);
  }
}
