import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import { installBuiltInAgentTemplate, listBuiltInAgentTemplates } from "./builtInAgentTemplates";
import { buildSystemPrompt, buildSystemPromptPreview } from "./prompt";
import { normalizeEditableBody } from "./profiles";

test("shipped Agent profiles render once, override global identity and preserve Bot directives", () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "molibot-shipped-prompts-"));
  const agentsRoot = path.join(dataRoot, "agents");
  const workspaceDir = path.join(dataRoot, "moli-f", "bots", "template-test");
  const originalDataDir = storagePaths.dataDir;
  try {
    storagePaths.dataDir = dataRoot;
    mkdirSync(agentsRoot);
    mkdirSync(workspaceDir, { recursive: true });
    for (const name of ["AGENTS.md", "SOUL.md", "IDENTITY.md"]) {
      writeFileSync(path.join(dataRoot, name), `# ${name}\n\nGLOBAL-ROLE-SENTINEL`);
    }
    writeFileSync(path.join(workspaceDir, "BOT.md"), "# BOT.md\n\nBOT-DIRECTIVE-SENTINEL");
    for (const template of listBuiltInAgentTemplates({ agentsRoot })) {
      assert.match(template.version, /^\d+\.\d+\.\d+$/);
      const { agentDir } = installBuiltInAgentTemplate(template.id, { agentsRoot });
      const options: NonNullable<Parameters<typeof buildSystemPrompt>[4]> = {
        channel: "feishu", timezone: "UTC",
        settings: {
          ...defaultRuntimeSettings,
          channels: {
            ...defaultRuntimeSettings.channels,
            feishu: { instances: [{ id: "template-test", name: "Test", enabled: true,
              agentId: template.id, credentials: {}, allowedChatIds: [] }] }
          }
        }
      };
      const prompt = buildSystemPrompt(workspaceDir, "chat", "session", "", options);
      assert.equal(buildSystemPromptPreview(workspaceDir, "chat", "session", "", options), prompt);
      assert.doesNotMatch(prompt, /GLOBAL-ROLE-SENTINEL/);
      assert.equal(prompt.split("BOT-DIRECTIVE-SENTINEL").length - 1, 1);
      for (const name of ["AGENTS.md", "SOUL.md", "IDENTITY.md"]) {
        const body = normalizeEditableBody(readFileSync(path.join(agentDir, name), "utf8"))
          .replaceAll("${dataRoot}", dataRoot);
        assert.equal(prompt.split(body).length - 1, 1, `${template.id}/${name} must render once`);
      }
      assert.doesNotMatch(prompt, /14 年以上买方|~\/\.molibot\/skills\/miniapp-creator/);
    }
  } finally {
    storagePaths.dataDir = originalDataDir;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
