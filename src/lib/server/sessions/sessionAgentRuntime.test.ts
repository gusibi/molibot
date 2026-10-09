import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
test("ordinary Agent executes its own identity and restores only its Session after process restart", { timeout: 60_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "molibot-personal-runner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = [];
  const provider = createServer(async (req, res) => {
    let text = ""; for await (const part of req) text += part;
    const body = JSON.parse(text); requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: "test", object: "chat.completion.chunk", created: 1, model: body.model };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "AGENT_ANSWER" }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => provider.close());
  const port = (provider.address() as { port: number }).port;
  const env = { ...process.env, DATA_DIR: root, DB_DIR: join(root, "db") };
  const common = `
    import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { getRuntime } from './src/lib/server/app/runtime.ts';
    import { getAgentDir } from './src/lib/server/agent/prompts/profiles.ts';
    import { POST as send } from './src/routes/api/stream/+server.ts';
    const runtime = getRuntime();
    async function turn(id,text,agentId) {
      const response = await send({request:new Request('http://localhost/api/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:'agent-researcher',conversationId:id,message:text,agentId})})});
      return {status:response.status,text:await response.text()};
    }
  `;
  const first = await execute(process.execPath, ["--import", "./scripts/register-loader.js", "--import", "tsx", "--input-type=module", "-e", common + `
    runtime.updateSettings({providerMode:'custom',defaultCustomProviderId:'personal-test',defaultAgentId:'researcher',permissionMode:'accept_edits',
      modelRouting:{...runtime.getSettings().modelRouting,textModelKey:'custom|personal-test|global'},
      customProviders:[{id:'personal-test',name:'Test',enabled:true,protocol:'openai-compatible',baseUrl:'http://127.0.0.1:${port}/v1',apiKey:'test',path:'/chat/completions',defaultModel:'global',models:['global','agent-model','override'].map(id=>({id,enabled:true,tags:['text'],supportedRoles:['system','user','assistant','tool','developer']}))}],
      agents:[...runtime.getSettings().agents,{id:'researcher',name:'Researcher',description:'',enabled:true,modelRouting:{textModelKey:'custom|personal-test|agent-model'}}]});
    mkdirSync(getAgentDir('researcher'),{recursive:true}); writeFileSync(join(getAgentDir('researcher'),'IDENTITY.md'),'You are PERSONAL_RESEARCH_IDENTITY.');
    const owner='web:agent-researcher:web-anonymous';
    await runtime.memory.add({channel:'web',externalUserId:owner,botId:'agent-researcher',agentId:'researcher',ownerId:'owner'}, {namespace:'agent:researcher',domain:'agent_self',type:'user_fact',subject:'research_method',content:'PERSONAL_PRIVATE_MEMORY',reason:'user_explicit',pinned:true});
    await runtime.memory.add({channel:'web',externalUserId:owner,botId:'default',agentId:'default',ownerId:'owner'}, {namespace:'agent:default',domain:'agent_self',type:'user_fact',subject:'private_method',content:'FOREIGN_AGENT_PRIVATE',reason:'user_explicit',pinned:true});
    const session=runtime.sessions.createWebConversation(owner);
    const { getRuntimeContextForConversation } = await import('./src/lib/server/web/runtimeContext.ts');
    const { claimAgentConversation } = await import('./src/lib/server/sessions/sessionAgentService.ts');
    getRuntimeContextForConversation('agent-researcher',session.id).pool.get(owner,session.id);
    claimAgentConversation(runtime.sessions,runtime.getSettings(),{externalUserId:owner,conversationId:session.id,agentId:'researcher'});
    const other=runtime.sessions.createWebConversation(owner,undefined,'researcher');
    runtime.sessions.appendMessage(other.id,'user','OTHER_SESSION_SECRET');
    const result=await turn(session.id,'FIRST_INPUT');
    if(result.status!==200 || !result.text.includes('AGENT_ANSWER')) throw new Error(JSON.stringify(result));
    runtime.sessions.setConversationModelKey(session.id,'custom|personal-test|override');
    writeFileSync(join(process.env.DATA_DIR,'test-session.json'),JSON.stringify({id:session.id,owner}));
    console.log('PERSONAL_OK'); process.exit(0);
  `], { env, timeout: 40_000, maxBuffer: 4_000_000 });
  assert.match(first.stdout, /PERSONAL_OK/);
  const second = await execute(process.execPath, ["--import", "./scripts/register-loader.js", "--import", "tsx", "--input-type=module", "-e", common + `
    const {id,owner}=JSON.parse(readFileSync(join(process.env.DATA_DIR,'test-session.json'),'utf8'));
    runtime.updateSettings({agents:runtime.getSettings().agents.map(a=>a.id==='researcher'?{...a,shareOwnerMemory:false}:a)});
    const result=await turn(id,'SECOND_INPUT');
    if(result.status!==200 || !result.text.includes('AGENT_ANSWER')) throw new Error(JSON.stringify(result));
    const mismatch=await turn(id,'MISMATCH_INPUT','default');
    if(mismatch.status!==409) throw new Error('Mismatch admitted');
    runtime.updateSettings({defaultAgentId:'default',agents:runtime.getSettings().agents.map(a=>a.id==='researcher'?{...a,enabled:false}:a)});
    const disabled=await turn(id,'DISABLED_INPUT');
    if(disabled.status!==409) throw new Error('Disabled admitted');
    console.log('PERSONAL_OK'); process.exit(0);
  `], { env, timeout: 40_000, maxBuffer: 4_000_000 });
  assert.match(second.stdout, /PERSONAL_OK/);
  const turns = requests.filter(request => JSON.stringify(request.messages.filter(message => ["system", "developer"].includes(message.role))).includes("PERSONAL_RESEARCH_IDENTITY"));
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map(request => request.model), ["agent-model", "override"]);
  for (const request of turns) {
    assert.match(JSON.stringify(request.messages.filter(message => ["system", "developer"].includes(message.role))), /PERSONAL_RESEARCH_IDENTITY/);
    assert.match(JSON.stringify(request.messages), /PERSONAL_PRIVATE_MEMORY/);
    assert.doesNotMatch(JSON.stringify(request.messages), /OTHER_SESSION_SECRET|MISMATCH_INPUT|DISABLED_INPUT|FOREIGN_AGENT_PRIVATE/);
  }
  assert.match(JSON.stringify(turns[1].messages), /FIRST_INPUT/);
});
