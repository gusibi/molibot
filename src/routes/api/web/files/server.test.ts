import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationMessage } from "$lib/shared/types/message.js";
import { _buildConversationFiles } from "./+server.js";

test("ordinary Session scratch outputs are listed without an attachment copy", () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "molibot-session-files-"));
  const externalUserId = "web:default:web-anonymous";
  const relativeOutput = "2026/08/26/report.html";
  const local = `${externalUserId}/scratch/${relativeOutput}`;
  try {
    mkdirSync(path.dirname(path.join(workspaceDir, local)), { recursive: true });
    writeFileSync(path.join(workspaceDir, local), "<!doctype html><p>ready</p>");

    const messages = [{
      id: "assistant-1",
      conversationId: "session-1",
      role: "assistant",
      content: "完成",
      createdAt: "2026-08-26T00:00:00.000Z",
      activities: [{
        key: "write-1",
        kind: "tool",
        label: "Write",
        state: "success",
        fileOutput: { path: relativeOutput, action: "created", rootKind: "scratch" }
      }]
    }] satisfies ConversationMessage[];

    assert.deepEqual(_buildConversationFiles(workspaceDir, externalUserId, messages), [{
      id: Buffer.from(local, "utf8").toString("base64url"),
      original: "report.html",
      local,
      mimeType: undefined,
      mediaType: "file",
      size: 27,
      createdAt: "2026-08-26T00:00:00.000Z",
      source: "persisted",
      origin: "generated",
      previewKind: "code"
    }]);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("ordinary Session scratch outputs reject a symlink escape", () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "molibot-session-files-"));
  const outsideDir = mkdtempSync(path.join(tmpdir(), "molibot-session-files-outside-"));
  const externalUserId = "web:default:web-anonymous";
  try {
    const scratchRoot = path.join(workspaceDir, externalUserId, "scratch");
    mkdirSync(scratchRoot, { recursive: true });
    writeFileSync(path.join(outsideDir, "secret.html"), "secret");
    symlinkSync(path.join(outsideDir, "secret.html"), path.join(scratchRoot, "escape.html"));

    const messages = [{
      id: "assistant-1",
      conversationId: "session-1",
      role: "assistant",
      content: "完成",
      createdAt: "2026-08-26T00:00:00.000Z",
      activities: [{
        key: "write-1",
        kind: "tool",
        label: "Write",
        state: "success",
        fileOutput: { path: "escape.html", action: "created", rootKind: "scratch" }
      }]
    }] satisfies ConversationMessage[];

    assert.deepEqual(_buildConversationFiles(workspaceDir, externalUserId, messages), []);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("external file listing reads the migration map once for the whole workspace", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = mkdtempSync(path.join(tmpdir(), "molibot-external-file-list-"));
  try {
    await promisify(execFile)(process.execPath, ["--import", "./scripts/register-loader.js", "--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { mock } from 'node:test';
      import { join } from 'node:path';
      import { AgentStorageMigration } from './src/lib/server/sessions/agentStorageMigration.ts';
      import { encodeExternalSessionId } from './src/lib/server/app/externalSessionsFromContexts.ts';
      import { GET } from './src/routes/api/web/files/+server.ts';
      const root = process.env.DATA_DIR;
      const source = join(root, 'moli-f/bots/one/chat');
      fs.mkdirSync(join(source, 'contexts'), {recursive:true});
      fs.mkdirSync(join(source, 'attachments'), {recursive:true});
      fs.writeFileSync(join(source,'contexts/session.jsonl'), JSON.stringify({type:'message',id:'user',timestamp:'2026-10-11',message:{role:'user',content:join(source,'attachments/000.txt')}})+'\\n');
      for(let index=0;index<80;index++) fs.writeFileSync(join(source,'attachments',String(index).padStart(3,'0')+'.txt'),'file');
      const plan = await new AgentStorageMigration(root,{agents:['assistant'],bots:[{channel:'feishu',botId:'one',agentId:'assistant'}]}).execute();
      const id = encodeExternalSessionId({channel:'feishu',botId:'one',chatId:'chat',sessionId:plan.sessions[0].targetId});
      const read = fs.readFileSync;
      let manifestReads=0;
      const mocked = mock.method(fs,'readFileSync',function(file,...args){ if(String(file)===join(root,'runtime/agent-storage-migration/manifest.json')) manifestReads++; return read.call(fs,file,...args); });
      syncBuiltinESMExports();
      try {
        const response = await GET({url:new URL('http://localhost/api/web/files?sessionId='+id),request:new Request('http://localhost/api/web/files')});
        assert.equal(response.status,200);
        const payload=await response.json();
        assert.equal(payload.files.length,1);
        assert.equal(payload.files[0].original,'000.txt');
        assert.equal(manifestReads,1,'migration map must be read once per listing');
      } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    `], { env: { ...process.env, DATA_DIR: root, DB_DIR: path.join(root, "db"), PI_CODING_AGENT_DIR: path.join(root, "pi"), MOLIBOT_IMPORT_SKIP_SETTINGS_AUTOCREATE: "1" }, timeout: 30_000, maxBuffer: 1_000_000 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("attachment provenance follows message role, not the attachments directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-file-origin-"));
  try {
    mkdirSync(path.join(root, "attachments"));
    writeFileSync(path.join(root, "attachments", "upload.png"), "image");
    writeFileSync(path.join(root, "attachments", "generated.png"), "image");
    const messages = ["user", "assistant"].map((role, index) => ({ id: role, conversationId: "test", role, content: "", createdAt: `2026-10-11T0${index}:00:00.000Z`, attachments: [{local: `attachments/${index ? "generated" : "upload"}.png`, original: "image.png", mediaType: "image"}] })) as ConversationMessage[];
    const files = _buildConversationFiles(root, "test", messages);
    assert.equal(files[0].origin, "generated");
    assert.equal(files[1].origin, "uploaded");
  } finally { rmSync(root, {recursive: true, force: true}); }
});


test("external file evidence separates incoming attachments, generated copies and unknown history", async () => {
  const { createSessionFileEvidenceMatcher } = await import("$lib/server/sessions/agentFileReferences.js");
  const root = mkdtempSync(path.join(tmpdir(), "molibot-file-evidence-"));
  try {
    const body = [
      {type: "message", timestamp: "2026-10-10", message: {role: "user", content: "<channel_attachments>\nattachments/input.png\n</channel_attachments>"}},
      {type: "message", timestamp: "2026-10-11", message: {role: "toolResult", toolName: "imageGenerate", isError: false, content: [], details: {filePath: "attachments/output.png"}}},
      {type: "message", timestamp: "2026-10-11", message: {role: "user", content: "See attachments/history.txt"}}
    ].map(entry => JSON.stringify(entry)).join("\n");
    const evidence = createSessionFileEvidenceMatcher(root, body);
    assert.deepEqual(evidence("attachments/input.png"), {origin: "uploaded", createdAt: "2026-10-10"});
    assert.deepEqual(evidence("attachments/output.png"), {origin: "generated", createdAt: "2026-10-11"});
    assert.deepEqual(evidence("attachments/history.txt"), {origin: "unknown", createdAt: ""});
    assert.equal(evidence("attachments/other.txt"), null);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
