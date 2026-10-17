import { config } from "$lib/server/app/env.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { AgentStorageMigration, type MigrationBotAssignment, type MigrationStatus } from "./agentStorageMigration.js";

let admitted: boolean | undefined;
let running: Promise<void> | undefined;
let lastError: string | undefined;
let lastStatus: MigrationStatus | undefined;
function migration(ignoredPaths?: string[], botAssignments?: MigrationBotAssignment[], force?: boolean): AgentStorageMigration {
  const settings = new SettingsStore().load(false);
  return new AgentStorageMigration(config.dataDir, {
    agents: settings.agents.map(agent => agent.id),
    agentOptions: settings.agents.map(agent => ({ id: agent.id, name: agent.name })),
    bots: Object.entries(settings.channels).flatMap(([channel, group]) => group.instances.map(bot => ({ channel, botId: bot.id, agentId: bot.agentId })))
  }, ignoredPaths, botAssignments, force);
}
export function storageMigrationStatus(): MigrationStatus & { running: boolean; error?: string } {
  // Runtime ownership is established once per process. Additional legacy sources
  // are detected on the next cold start, before any consumer is initialized.
  if (globalThis.__molibotRuntime && lastStatus) return { ...lastStatus, running: false, error: lastError };
  try {
    const status = migration().status(Boolean(running));
    lastStatus = status;
    admitted = !status.needed && !running;
    return { ...status, needed: status.needed || Boolean(running), running: Boolean(running), error: lastError };
  } catch (error) {
    admitted = false;
    lastError = error instanceof Error ? error.message : String(error);
    return { needed: true, sessions: 0, files: 0, copiedFiles: 0, publishedFiles: 0, conflicts: [lastError], conflictItems: [{ message: lastError }], ignoredPaths: [], botAssignments: [], fixedBotAssignments: [], availableAgents: [], automaticSkippedPaths: [], phase: "pending", running: false, error: lastError };
  }
}
export function storageRuntimeReady(): boolean {
  return admitted ?? !storageMigrationStatus().needed;
}
export function previewStorageMigration(ignoredPaths: string[], botAssignments?: MigrationBotAssignment[]): MigrationStatus {
  return migration(ignoredPaths, botAssignments).status();
}
export async function confirmStorageMigration(ignoredPaths?: string[], botAssignments?: MigrationBotAssignment[], force = false): Promise<void> {
  if (running) return running;
  if (globalThis.__molibotRuntime) throw new Error("Restart the service before confirming a storage migration");
  admitted = false;
  lastError = undefined;
  const selected = migration(ignoredPaths, botAssignments, force);
  const status = selected.status();
  if (status.conflicts.length && !force) throw new Error(status.conflicts.join("\n"));
  selected.saveSelections();
  running = selected.execute().then(() => { lastStatus = migration().status(); admitted = !lastStatus.needed; if (!admitted) throw new Error("Storage migration still has pending sources"); }).catch(error => {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }).finally(() => { running = undefined; });
  return running;
}
