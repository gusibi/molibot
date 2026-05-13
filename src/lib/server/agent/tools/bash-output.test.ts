import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBashTool } from "./bash.js";
import { normalizeCommandOutput } from "./helpers.js";
import { truncateMiddle } from "./truncate.js";
import { defaultToolSandboxSettings } from "../../settings/toolSandbox.js";
import { defaultRuntimeSettings } from "../../settings/defaults.js";
import type { RuntimeSettings } from "../../settings/index.js";

function firstText(result: Awaited<ReturnType<ReturnType<typeof createBashTool>["execute"]>>): string {
  const item = result.content[0];
  return item?.type === "text" ? item.text : "";
}

test("normalizeCommandOutput keeps final carriage-return update", () => {
  const raw = "start\nprogress 10%\rprogress 50%\rprogress 100%\nend";
  const normalized = normalizeCommandOutput(raw);
  assert.equal(normalized, "start\nprogress 100%\nend");
});

test("truncateMiddle preserves both opening and closing context", () => {
  const raw = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n");
  const truncated = truncateMiddle(raw, { maxLines: 6, maxBytes: 200, headLines: 2, tailLines: 3 });
  assert.equal(truncated.truncated, true);
  assert.match(truncated.content, /^line-1\nline-2\n\[\.\.\. 7 lines omitted \.\.\.\]\nline-10\nline-11\nline-12$/);
});

test("bash exposes dated artifact directory to shell commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, { artifactDir: "2026/05/10" });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf '%s' \"$MOLIBOT_SCRATCH_ARTIFACT_DIR\""
    });

    assert.equal(firstText(result), "2026/05/10");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash relocates newly generated root artifacts into dated artifact directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, { artifactDir: "2026/05/10" });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf 'image' > flying_pig_cartoon.png"
    });

    assert.equal(existsSync(join(cwd, "flying_pig_cartoon.png")), false);
    assert.equal(readFileSync(join(cwd, "2026/05/10/flying_pig_cartoon.png"), "utf8"), "image");
    assert.match(firstText(result), /Moved generated artifact\(s\).*2026\/05\/10\/flying_pig_cartoon\.png/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash leaves non-artifact root support files in place", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, { artifactDir: "2026/05/10" });
    await tool.execute("tool-1", {
      label: "bash",
      command: "printf '{}' > package.json"
    });

    assert.equal(readFileSync(join(cwd, "package.json"), "utf8"), "{}");
    assert.equal(existsSync(join(cwd, "2026/05/10/package.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash keeps legacy host env inheritance when tool sandbox is disabled", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const previous = process.env.MOLIBOT_BASH_HOST_ENV_TEST;
  process.env.MOLIBOT_BASH_HOST_ENV_TEST = "host-visible";
  try {
    const tool = createBashTool(cwd, {
      sandbox: {
        settings: { ...defaultToolSandboxSettings, enabled: false },
        workspaceDir: cwd
      }
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf '%s' \"$MOLIBOT_BASH_HOST_ENV_TEST\""
    });

    assert.equal(firstText(result), "host-visible");
  } finally {
    if (previous === undefined) {
      delete process.env.MOLIBOT_BASH_HOST_ENV_TEST;
    } else {
      process.env.MOLIBOT_BASH_HOST_ENV_TEST = previous;
    }
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash can request host tool approval without a separate approval tool", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        getSettings: () => settings,
        updateSettings: (patch) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      }
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "agent-browser --open",
      hostApproval: {
        reason: "Requires browser IPC outside the sandbox.",
        permissions: {
          filesystem: "scratch-only",
          network: "internet"
        }
      }
    });

    assert.equal(settings.hostTools.pendingApprovals.length, 1);
    assert.equal(settings.hostTools.pendingApprovals[0]?.command, "agent-browser");
    assert.deepEqual(settings.hostTools.pendingApprovals[0]?.pendingAction?.args, ["--open"]);
    assert.match(firstText(result), /Host tool approval requested/);
    assert.equal(Boolean(result.details && "hostToolApproval" in result.details), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash runs approved host tools directly before sandbox/plain execution", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  let settings: RuntimeSettings = {
    ...structuredClone(defaultRuntimeSettings),
    hostTools: {
      pendingApprovals: [],
      approvedTools: [{
        toolId: "printf",
        displayName: "printf",
        command: "printf",
        reason: "approved for host execution",
        permissions: {
          envAllowlist: ["PATH"],
          filesystem: "scratch-only",
          network: "none"
        },
        approvedAt: "2026-05-13T00:00:00.000Z",
        approvedFromRequestId: "hta-printf",
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        enabled: true
      }]
    }
  };
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        getSettings: () => settings,
        updateSettings: (patch) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      }
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf 'hello %s' world"
    });

    assert.equal(firstText(result), "hello world");
    assert.equal((result.details as { hostTool?: boolean } | undefined)?.hostTool, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash auto-requests host approval after sandbox permission failure for single commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const blockedFile = join(cwd, "blocked.txt");
  writeFileSync(blockedFile, "secret", "utf8");
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  try {
    const tool = createBashTool(cwd, {
      sandbox: {
        settings: {
          ...defaultToolSandboxSettings,
          enabled: true,
          filesystem: {
            ...defaultToolSandboxSettings.filesystem,
            denyRead: [...defaultToolSandboxSettings.filesystem.denyRead, blockedFile]
          }
        },
        workspaceDir: cwd
      },
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        getSettings: () => settings,
        updateSettings: (patch) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      }
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: `cat ${JSON.stringify(blockedFile)}`
    });

    if ((result.details as { sandboxApplied?: boolean; sandboxWarning?: string } | undefined)?.sandboxApplied !== true) {
      return;
    }
    assert.match(firstText(result), /host approval was requested automatically/i);
    assert.equal(settings.hostTools.pendingApprovals.length, 1);
    assert.equal(settings.hostTools.pendingApprovals[0]?.command, "cat");
    assert.equal(Boolean(result.details && "hostToolApproval" in result.details), true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Sandbox is not supported|sandbox-runtime|dependencies/i.test(message)) {
      return;
    }
    throw error;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash host approval rejects compound shell commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        getSettings: () => structuredClone(defaultRuntimeSettings),
        updateSettings: () => structuredClone(defaultRuntimeSettings)
      }
    });
    await assert.rejects(
      () => tool.execute("tool-1", {
        label: "bash",
        command: "agent-browser --open | cat",
        hostApproval: { reason: "Needs host IPC." }
      }),
      /single executable command with structured argv/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
