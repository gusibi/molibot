import { momError } from "../../agent/log.js";

export class ChannelQueue {
  private readonly queue: Array<() => Promise<void>> = [];
  private processing = false;

  constructor(private readonly channel: string) {}

  enqueue(job: () => Promise<void>): void {
    this.queue.push(job);
    void this.run();
  }

  size(): number {
    return this.queue.length;
  }

  private async run(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;
      try {
        await job();
      } catch (error) {
        momError(this.channel, "queue_job_failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }

    this.processing = false;
  }
}
