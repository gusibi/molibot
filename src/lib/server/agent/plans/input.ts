import { createHash } from "node:crypto";
import { constants, copyFileSync, mkdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileAttachment } from "../core/types.js";

export interface PlanInputSnapshot {
  text: string;
  workspaceDir: string;
  attachments: FileAttachment[];
}

/** Plan-owned copies remain available after the source conversation is removed. */
export function capturePlanInput(planId: string, input: PlanInputSnapshot): PlanInputSnapshot {
  const workspaceDir = realpathSync(input.workspaceDir);
  const directory = join(".plans", createHash("sha256").update(planId).digest("hex"), "inputs");
  const attachments = input.attachments.map((attachment, index) => {
    const source = realpathSync(resolve(workspaceDir, attachment.local));
    const fromWorkspace = relative(workspaceDir, source);
    if (isAbsolute(fromWorkspace) || fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`)) throw new Error("Plan input must belong to its Agent workspace.");
    const local = join(directory, `${index}-${basename(source)}`);
    mkdirSync(join(workspaceDir, directory), { recursive: true });
    try { copyFileSync(source, join(workspaceDir, local), constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return { ...attachment, local };
  });
  return { text: input.text, workspaceDir, attachments };
}
