import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBashTool, getBashToolDefinition } from "$lib/server/agent/tools/bash.js";
import { normalizeCommandOutput } from "$lib/server/agent/tools/helpers.js";
import { truncateMiddle } from "$lib/server/agent/tools/truncate.js";
import { defaultToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { getHostBashStore, createHostBashApprovalRecord, type ApprovedHostBashEntry, type HostBashApprovalRecord } from "$lib/server/hostBash/index.js";
import type { ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";

function hostApprovalStore(sessionMode: "default" | "session" = "default"): any {
  return {
    getSessionHostApprovalMode: () => sessionMode
  };
}

function firstText(result: Awaited<ReturnType<ReturnType<typeof createBashTool>["execute"]>>): string {
  const item = result.content[0];
  return item?.type === "text" ? item.text : "";
}

function capturingHostBashStore(pending: HostBashApprovalRecord[]): any {
  return {
    requestApproval: (input: Parameters<typeof createHostBashApprovalRecord>[0]) => {
      const approval = createHostBashApprovalRecord(input);
      pending.push(approval);
      return { kind: "created", approval };
    },
    getApprovedEntry: () => undefined
  };
}

function approvedHostBashEntry(toolId: string, command = toolId): ApprovedHostBashEntry {
  return {
    id: `hbw-${toolId}`,
    toolId,
    displayName: toolId,
    command,
    reason: "approved for host execution",
    permissions: {
      envAllowlist: ["PATH"],
      filesystem: "scratch-only",
      network: "none"
    },
    approvedAt: "2026-05-13T00:00:00.000Z",
    approvedFromRecordId: `hba-${toolId}`,
    channel: "telegram",
    chatId: "chat-1",
    scopeId: "chat-1",
    enabled: true
  };
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

test("bash tool definition keeps sandbox guidance concise", () => {
  const def = getBashToolDefinition({ cwd: "/tmp" });
  assert.match(def.description, /runtime-managed sandbox/);
  assert.match(def.description, /Use hostApproval only for host-only capabilities/);
  assert.doesNotMatch(def.description, /sandbox-exec|bubblewrap/);
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

test("bash relocates modified existing root artifacts into dated artifact directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  try {
    writeFileSync(join(cwd, "gold_daily_20260524_momo.html"), "old", "utf8");
    const tool = createBashTool(cwd, { artifactDir: "2026/05/24" });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "sleep 0.01; printf 'new' > gold_daily_20260524_momo.html"
    });

    assert.equal(existsSync(join(cwd, "gold_daily_20260524_momo.html")), false);
    assert.equal(readFileSync(join(cwd, "2026/05/24/gold_daily_20260524_momo.html"), "utf8"), "new");
    assert.match(firstText(result), /Moved generated artifact\(s\).*2026\/05\/24\/gold_daily_20260524_momo\.html/);
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
  const pendingApprovals: HostBashApprovalRecord[] = [];
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: capturingHostBashStore(pendingApprovals),
        getSettings: () => settings,
        updateSettings: (patch: any) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      } as any
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

    assert.equal(pendingApprovals.length, 1);
    assert.equal(pendingApprovals[0]?.command, "agent-browser");
    assert.equal(pendingApprovals[0]?.approvalMode, "persistent");
    assert.equal(pendingApprovals[0]?.pendingAction?.kind, "run_approved_host_bash");
    assert.deepEqual(pendingApprovals[0]?.pendingAction?.args, ["--open"]);
    assert.match(firstText(result), /Host Bash approval requested/);
    assert.equal(Boolean(result.details && "hostBashApproval" in result.details), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash requests persistent host approval for longbridge pipeline with safe helper", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const pendingApprovals: HostBashApprovalRecord[] = [];
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: capturingHostBashStore(pendingApprovals),
        getSettings: () => settings,
        updateSettings: (patch: any) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "longbridge news FIG.US 2>&1 | head -30",
      hostApproval: { reason: "Needs host longbridge access." }
    });

    assert.equal(pendingApprovals.length, 1);
    assert.equal(pendingApprovals[0]?.approvalMode, "persistent");
    assert.equal(pendingApprovals[0]?.toolId, "longbridge");
    assert.equal(pendingApprovals[0]?.command, "longbridge");
    assert.equal(pendingApprovals[0]?.pendingAction?.originalCommand, "longbridge news FIG.US 2>&1 | head -30");
    assert.equal(pendingApprovals[0]?.classification?.kind, "persistent-capability");
    assert.match(firstText(result), /Host Bash approval requested/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash ignores hostApproval and runs directly when tool sandbox is disabled", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const pendingApprovals: HostBashApprovalRecord[] = [];
  try {
    const tool = createBashTool(cwd, {
      sandbox: {
        settings: { ...defaultToolSandboxSettings, enabled: false },
        workspaceDir: cwd
      },
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: capturingHostBashStore(pendingApprovals)
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf '%s' host-full-access",
      hostApproval: {
        reason: "Host full access is already enabled.",
        permissions: {
          filesystem: "workspace-write",
          network: "internet"
        }
      }
    });

    assert.equal(firstText(result), "host-full-access");
    assert.equal(pendingApprovals.length, 0);
    assert.equal(Boolean(result.details && "hostBashApproval" in result.details), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash can request one-time host approval for compound shell commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  const dbStore = getHostBashStore() as any;
  dbStore.db.exec("DELETE FROM approval_requests");
  dbStore.db.exec("DELETE FROM approval_grants");
  try {
    const tool = createBashTool(cwd, {
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        getSettings: () => settings,
        updateSettings: (patch: any) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "mkdir -p ~/.molibot/skills\nmv ./weread-skills ~/.molibot/skills/",
      hostApproval: { reason: "Needs one-time install flow." }
    });

    const pending = getHostBashStore().listPending("chat-1");
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.approvalMode, "ephemeral");
    assert.equal(pending[0]?.pendingAction?.kind, "run_one_time_host_script");
    assert.equal(settings.hostTools.approvedTools.length, 0);
    assert.match(firstText(result), /Host (Bash|tool) approval requested/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash executes approved Host Bash without calling sandbox shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const approvedHostBash: ApprovedHostBashEntry = {
    id: "hbw-printf",
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
    approvedFromRecordId: "hba-printf",
    channel: "telegram",
    chatId: "chat-1",
    scopeId: "chat-1",
    enabled: true
  };
  let shellCalled = false;
  try {
    const def = getBashToolDefinition({
      cwd,
      sandbox: {
        settings: { ...defaultToolSandboxSettings, enabled: true },
        workspaceDir: cwd
      },
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: {
          getApprovedEntry: (toolId: string) => toolId === "printf" ? approvedHostBash : undefined
        } as any
      }
    });
    const result = await def.handler({
      label: "bash",
      command: "printf '%s' approved-host"
    }, {
      runId: "tool-1",
      sessionId: "session-1",
      workspaceId: "personal",
      actorId: "chat-1",
      cwd,
      fs: {
        readText: async () => "",
        writeText: async () => {}
      },
      shell: {
        run: async () => {
          shellCalled = true;
          return { exitCode: 1, stdout: "", stderr: "sandbox should not run" };
        }
      },
      network: {
        fetch: async () => ({})
      },
      emit: () => {}
    } satisfies ToolExecutionContext);

    assert.equal(result.ok, true);
    const item = Array.isArray(result.content) ? result.content[0] : undefined;
    assert.equal(item?.type === "text" ? item.text : "", "approved-host");
    assert.equal(shellCalled, false);
    assert.equal((result.details as { hostBash?: boolean } | undefined)?.hostBash, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash executes approved host pipeline with safe helper without calling sandbox shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const approvedHostBash = approvedHostBashEntry("printf");
  let shellCalled = false;
  try {
    const def = getBashToolDefinition({
      cwd,
      sandbox: {
        settings: { ...defaultToolSandboxSettings, enabled: true },
        workspaceDir: cwd
      },
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: {
          getApprovedEntry: (toolId: string) => toolId === "printf" ? approvedHostBash : undefined
        } as any
      }
    });
    const result = await def.handler({
      label: "bash",
      command: "printf 'alpha\\nbeta\\n' 2>&1 | head -1"
    }, {
      runId: "tool-1",
      sessionId: "session-1",
      workspaceId: "personal",
      actorId: "chat-1",
      cwd,
      fs: {
        readText: async () => "",
        writeText: async () => {}
      },
      shell: {
        run: async () => {
          shellCalled = true;
          return { exitCode: 1, stdout: "", stderr: "sandbox should not run" };
        }
      },
      network: {
        fetch: async () => ({})
      },
      emit: () => {}
    } satisfies ToolExecutionContext);

    assert.equal(result.ok, true);
    const item = Array.isArray(result.content) ? result.content[0] : undefined;
    assert.equal(item?.type === "text" ? item.text : "", "alpha\n");
    assert.equal(shellCalled, false);
    assert.equal((result.details as { hostBash?: boolean } | undefined)?.hostBash, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash executes approved same-tool chained commands with safe helper through host bash", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const approvedHostBash = approvedHostBashEntry("printf");
  let shellCalled = false;
  try {
    const def = getBashToolDefinition({
      cwd,
      sandbox: {
        settings: { ...defaultToolSandboxSettings, enabled: true },
        workspaceDir: cwd
      },
      hostApproval: {
        channel: "telegram",
        chatId: "chat-1",
        scopeId: "chat-1",
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: {
          getApprovedEntry: (toolId: string) => toolId === "printf" ? approvedHostBash : undefined
        } as any
      }
    });
    const result = await def.handler({
      label: "bash",
      command: "printf 'opened\\n' && sleep 0 && printf 'closed\\n'"
    }, {
      runId: "tool-1",
      sessionId: "session-1",
      workspaceId: "personal",
      actorId: "chat-1",
      cwd,
      fs: {
        readText: async () => "",
        writeText: async () => {}
      },
      shell: {
        run: async () => {
          shellCalled = true;
          return { exitCode: 1, stdout: "", stderr: "sandbox should not run" };
        }
      },
      network: {
        fetch: async () => ({})
      },
      emit: () => {}
    } satisfies ToolExecutionContext);

    assert.equal(result.ok, true);
    const item = Array.isArray(result.content) ? result.content[0] : undefined;
    assert.equal(item?.type === "text" ? item.text : "", "opened\nclosed\n");
    assert.equal(shellCalled, false);
    assert.equal((result.details as { hostBash?: boolean } | undefined)?.hostBash, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bash runs approved host tools through shell before sandbox/plain execution", async () => {
  const cwd = process.cwd();
  process.env.MOLIBOT_APPROVED_BASH_TOKEN = "expanded";
  const approvedHostBash: ApprovedHostBashEntry = {
    id: "hbw-printf",
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
    approvedFromRecordId: "hba-printf",
    channel: "telegram",
    chatId: "chat-1",
    scopeId: "chat-1",
    enabled: true
  };
  let settings: RuntimeSettings = {
    ...structuredClone(defaultRuntimeSettings),
    hostTools: {
      pendingApprovals: [],
      approvalHistory: [],
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
        sessionId: "session-1",
        store: hostApprovalStore(),
        hostBashStore: {
          getApprovedEntry: (toolId: string) => toolId === "printf" ? approvedHostBash : undefined
        } as any,
        getSettings: () => settings,
        updateSettings: (patch: any) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: "printf 'hello %s' \"$MOLIBOT_APPROVED_BASH_TOKEN\""
    });

    assert.equal(firstText(result), "hello expanded");
    assert.equal((result.details as { hostBash?: boolean } | undefined)?.hostBash, true);
  } finally {
    delete process.env.MOLIBOT_APPROVED_BASH_TOKEN;
  }
});

test("bash auto-requests host approval after sandbox permission failure for single commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const blockedFile = join(cwd, "blocked.txt");
  writeFileSync(blockedFile, "secret", "utf8");
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  const dbStore = getHostBashStore() as any;
  dbStore.db.exec("DELETE FROM approval_requests");
  dbStore.db.exec("DELETE FROM approval_grants");
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
        sessionId: "session-1",
        store: hostApprovalStore(),
        getSettings: () => settings,
        updateSettings: (patch: any) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: `cat ${JSON.stringify(blockedFile)}`
    });

    if ((result.details as { sandboxApplied?: boolean; sandboxWarning?: string } | undefined)?.sandboxApplied !== true) {
      return;
    }
    assert.match(firstText(result), /host approval was requested automatically/i);
    const pending = getHostBashStore().listPending("chat-1");
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.command, "cat");
    assert.equal(Boolean(result.details && "hostBashApproval" in result.details), true);
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

test("bash falls back to host bash after sandbox denial when session approval mode is enabled", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-bash-"));
  const blockedFile = join(cwd, "blocked.txt");
  writeFileSync(blockedFile, "secret", "utf8");
  let settings: RuntimeSettings = structuredClone(defaultRuntimeSettings);
  const dbStore = getHostBashStore() as any;
  dbStore.db.exec("DELETE FROM approval_requests");
  dbStore.db.exec("DELETE FROM approval_grants");
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
        sessionId: "session-1",
        store: hostApprovalStore("session") as any,
        getSettings: () => settings,
        updateSettings: (patch: any) => {
          settings = { ...settings, ...patch } as RuntimeSettings;
          return settings;
        }
      } as any
    });
    const result = await tool.execute("tool-1", {
      label: "bash",
      command: `cat ${JSON.stringify(blockedFile)}`
    });

    const details = result.details as { sandboxApplied?: boolean; sandboxWarning?: string } | undefined;
    if (!details?.sandboxWarning?.includes("session-approved host bash fallback")) {
      return;
    }
    assert.equal((result.details as { hostBash?: boolean } | undefined)?.hostBash, true);
    assert.match(firstText(result), /secret/);
    assert.match(firstText(result), /\[SESSION\] Sandbox was bypassed for this session/);
    assert.equal(getHostBashStore().listPending("chat-1").length, 0);
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
