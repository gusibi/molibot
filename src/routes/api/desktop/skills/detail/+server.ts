import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopSkillDetail, desktopSkillId, findDesktopSkillSource, listSkillDirectory } from "$lib/server/app/desktopSkills";
import type { SharedSkillsResponse } from "$lib/server/app/desktopSkills";
import { listBuiltinSkillStates } from "$lib/server/agent/skills/bootstrap";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter.js";
import { storagePaths } from "$lib/server/infra/db/storage";
import type { DesktopSkillDetailResponse } from "$lib/shared/desktop";

// Same reuse as the summary route: the shared settings route does the scanning
// (and owns the absolute paths), and this projects one entry into the detail
// payload the Skills detail pane renders.
import { GET as listSkills } from "../../../settings/skills/+server";

export const GET: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });

  const result = await listSkills(undefined as never);
  const payload = (await result.json()) as SharedSkillsResponse & { ok?: boolean };
  if (!payload.ok) return json({ ok: false, error: "Failed to list skills" }, { status: 500 });

  // The path always comes from the server-side scan: the client only ever
  // sends the opaque id, so it can never ask for a path of its own choosing.
  const source = findDesktopSkillSource(payload, id);
  if (!source?.filePath) return json({ ok: false, error: "Unknown skill" }, { status: 404 });

  const baseDir = source.baseDir ?? path.dirname(source.filePath);
  let frontmatter: Record<string, string> | null = null;
  let updatedAt = "";
  try {
    frontmatter = parseSkillFrontmatter(readFileSync(source.filePath, "utf8"));
    updatedAt = statSync(source.filePath).mtime.toISOString();
  } catch {
    // A Skill whose SKILL.md vanished between the scan and now still returns its
    // identity; only the disk-derived fields stay empty.
  }

  const builtins = listBuiltinSkillStates({ skillsRoot: storagePaths.globalSkillsDir }).map((builtin) => ({
    ...builtin,
    skillId: desktopSkillId(path.join(storagePaths.globalSkillsDir, builtin.id, "SKILL.md"))
  }));

  const detail = buildDesktopSkillDetail({
    item: {
      name: source.name,
      description: source.description ?? "",
      scope: source.scope,
      enabled: source.enabled !== false,
      mcpServers: source.mcpServers,
      agentId: source.agentId,
      chatId: source.chatId,
      filePath: source.filePath,
      baseDir
    },
    frontmatter,
    updatedAt,
    files: listSkillDirectory(baseDir),
    builtin: builtins.find((builtin) => builtin.skillId === id) ?? null
  });

  const response: DesktopSkillDetailResponse = { ok: true, detail };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};
