/**
 * A materialized Skill backup is retained for recovery, never loaded or
 * rescanned as a Skill. The timestamp suffix is written by the builtin
 * materializer and by the Skill Manager's replace step, so one predicate keeps
 * every scan (Runtime, Manager, settings route) consistent.
 */
const SKILL_BACKUP_DIRECTORY = /\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function isSkillBackupDirectory(name: string): boolean {
  return SKILL_BACKUP_DIRECTORY.test(name);
}

/** `name.backup-2026-10-16T00-54-53-963Z` — the sibling path a replace keeps. */
export function skillBackupName(name: string, at: Date = new Date()): string {
  return `${name}.backup-${at.toISOString().replace(/[:.]/g, "-")}`;
}
