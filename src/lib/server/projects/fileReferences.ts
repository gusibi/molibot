import { parseProjectFileReferences } from "$lib/shared/projectFileReference.js";
import type { ProjectRecord } from "$lib/server/projects/store.js";
import { resolveProjectPath } from "$lib/server/projects/inspection.js";

export interface ResolvedProjectFileReference {
  displayName: string;
  path: string;
  line?: number;
}

export interface ProjectFileReferenceResolution {
  modelText: string;
  persistedText: string;
  runtimeInstruction: string;
  references: ResolvedProjectFileReference[];
}

interface ProjectPathReferenceCandidate {
  displayName: string;
  path: string;
  line?: number;
  start: number;
  end: number;
}

function legacyProjectPathReferences(text: string): ProjectPathReferenceCandidate[] {
  const references: ProjectPathReferenceCandidate[] = [];
  const pattern = /@([^\s@()[\]，。！？；,.!?;]+\/[^\s@()[\]，。！？；,.!?;]+)/gu;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const path = match[1].replace(/[,.!?;，。！？；]+$/u, "");
    if (!path) continue;
    references.push({
      displayName: path.split("/").pop() || path,
      path,
      start: match.index,
      end: match.index + 1 + path.length
    });
  }
  return references;
}

/**
 * Resolve composer references at the trusted Project boundary. The transcript
 * keeps the owner's readable syntax, while the model receives a neutral marker
 * plus an ephemeral, runtime-authored list of canonical paths.
 */
export async function resolveProjectFileReferences(
  text: string,
  project: Pick<ProjectRecord, "rootPath">
): Promise<ProjectFileReferenceResolution> {
  const persistedText = String(text ?? "");
  const structured = parseProjectFileReferences(persistedText);
  // Older Project transcripts used bare `@path/to/file`. Keep those Sessions
  // safe by resolving only path-shaped tokens; single-segment `@todo` remains a
  // Mini App selector/prose and never enters the filesystem reference flow.
  const legacy = legacyProjectPathReferences(persistedText).filter((candidate) =>
    structured.every((reference) => candidate.end <= reference.start || candidate.start >= reference.end)
  );
  const parsed = [...structured, ...legacy].sort((left, right) => left.start - right.start);
  if (parsed.length === 0) {
    return { modelText: persistedText, persistedText, runtimeInstruction: "", references: [] };
  }

  const references: ResolvedProjectFileReference[] = [];
  const unresolved: Array<{ displayName: string; path: string }> = [];
  const chunks: string[] = [];
  let cursor = 0;
  for (const item of parsed) {
    chunks.push(persistedText.slice(cursor, item.start));
    try {
      const resolved = await resolveProjectPath(project, item.path);
      const reference = {
        displayName: item.displayName,
        path: resolved.relative,
        ...(item.line ? { line: item.line } : {})
      };
      references.push(reference);
      chunks.push(`[Project file #${references.length}: ${item.displayName}]`);
    } catch {
      unresolved.push({ displayName: item.displayName, path: item.path });
      chunks.push(`[Unresolved Project file reference: ${item.displayName}]`);
    }
    cursor = item.end;
  }
  chunks.push(persistedText.slice(cursor));

  const instructionLines = [
    references.length > 0 ? "Resolved Project file references (runtime-validated):" : "",
    ...references.flatMap((reference, index) => [
      `${index + 1}. display: ${JSON.stringify(reference.displayName)}`,
      `   path: ${JSON.stringify(reference.path)}`,
      ...(reference.line ? [`   line: ${reference.line}`] : [])
    ]),
    references.length > 0
      ? "Use the exact `path` value without the leading `@` for read/edit/write/ls operations. The display text is not a filesystem path."
      : "",
    unresolved.length > 0 ? "Unresolved Project file references:" : "",
    ...unresolved.map((item) => `- display=${JSON.stringify(item.displayName)} path=${JSON.stringify(item.path)}`),
    unresolved.length > 0
      ? "Do not guess, create, or modify a replacement path for an unresolved reference; report that the selected reference no longer resolves."
      : ""
  ].filter(Boolean);

  return {
    modelText: chunks.join(""),
    persistedText,
    runtimeInstruction: instructionLines.join("\n"),
    references
  };
}
