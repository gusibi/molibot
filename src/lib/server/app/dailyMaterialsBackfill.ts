import type { DailyMaterialsInternal, DailyMaterialsService } from "$lib/server/memory/dailyMaterials.js";
import type { DailyMaterialsBackfillStatus } from "$lib/shared/desktop.js";

function idleStatus(): DailyMaterialsBackfillStatus {
  return { status: "idle", total: 0, processed: 0, daysWithData: 0, createdFiles: 0, scannedMessages: 0 };
}

// One-off, in-memory driver for the "backfill all history" button. Only one run
// at a time; progress is polled by the desktop UI. Interruptions (restart,
// error) are safe because the service advances watermarks per day, so a re-run
// resumes from wherever it stopped.
export class DailyMaterialsBackfillJob {
  private current: DailyMaterialsBackfillStatus = idleStatus();
  private running = false;

  constructor(private readonly service: DailyMaterialsService) {}

  getStatus(): DailyMaterialsBackfillStatus {
    return { ...this.current };
  }

  start(internals: DailyMaterialsInternal[]): DailyMaterialsBackfillStatus {
    if (this.running) return this.getStatus();
    if (internals.length === 0) {
      throw new Error("没有已配置的每日素材任务，请先在设置里启用每日素材并选择输出项目。");
    }
    this.running = true;
    this.current = { ...idleStatus(), status: "running", startedAt: new Date().toISOString() };
    void this.run(internals);
    return this.getStatus();
  }

  private async run(internals: DailyMaterialsInternal[]): Promise<void> {
    let baseProcessed = 0;
    let baseTotal = 0;
    let aggDays = 0;
    let aggFiles = 0;
    let aggMessages = 0;
    let fromMin: string | undefined;
    let toMax: string | undefined;
    try {
      for (const internal of internals) {
        const result = await this.service.runBackfill(internal, {
          onProgress: (progress) => {
            this.current = {
              ...this.current,
              total: baseTotal + progress.total,
              processed: baseProcessed + progress.index,
              currentDate: progress.localDate,
              daysWithData: aggDays + progress.daysWithData,
              createdFiles: aggFiles + progress.daysWithData,
              scannedMessages: aggMessages + progress.scannedMessages
            };
          }
        });
        baseProcessed += result.totalDays;
        baseTotal += result.totalDays;
        aggDays += result.daysWithData;
        aggFiles += result.createdFiles.length;
        aggMessages += result.scannedMessages;
        if (!fromMin || result.from < fromMin) fromMin = result.from;
        if (!toMax || result.to > toMax) toMax = result.to;
      }
      this.current = {
        status: "done",
        startedAt: this.current.startedAt,
        finishedAt: new Date().toISOString(),
        from: fromMin,
        to: toMax,
        total: baseTotal,
        processed: baseProcessed,
        daysWithData: aggDays,
        createdFiles: aggFiles,
        scannedMessages: aggMessages
      };
    } catch (cause) {
      this.current = {
        ...this.current,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : String(cause)
      };
    } finally {
      this.running = false;
    }
  }
}
