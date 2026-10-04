import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
test("Desktop Room dispatch uses distinct configured models and identities in real Runner prompts", { timeout: 60_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-room-runtime-"));
  const projectDir = mkdtempSync(join(tmpdir(), "molibot-room-project-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(projectDir, { recursive: true, force: true }); });
  const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = [];
  const provider = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    const lastUser = payload.messages.findLast((m: { role: string }) => m.role === "user");
    if (JSON.stringify(lastUser?.content).includes("ROOM_FAILED_INPUT") && !JSON.stringify(lastUser?.content).includes("ROOM_AFTER_FAILURE")) {
      res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Controlled failure" } })); return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: "test", object: "chat.completion.chunk", created: 1, model: payload.model };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: `Answer from ${payload.model}` }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => provider.close());
  const port = (provider.address() as { port: number }).port;
  const script = `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { getRuntime } from './src/lib/server/app/runtime.ts';
    import { getRoomService, saveRoomFile } from './src/lib/server/rooms/runtime.ts';
    import { getAgentDir } from './src/lib/server/agent/prompts/profiles.ts';
    import { handleRoomRequest } from './src/lib/server/app/desktopRooms.ts';
    const runtime = getRuntime();
    runtime.updateSettings({providerMode:'custom',defaultCustomProviderId:'room-test',permissionMode:'accept_edits',
      modelRouting:{...runtime.getSettings().modelRouting,textModelKey:'custom|room-test|model-a'},
      customProviders:[{id:'room-test',name:'Test',enabled:true,protocol:'openai-compatible',baseUrl:'http://127.0.0.1:${port}/v1',apiKey:'test',path:'/chat/completions',defaultModel:'model-a',models:['model-a','model-b'].map(id=>({id,enabled:true,tags:['text','vision'],verification:{vision:'passed'},supportedRoles:['system','user','assistant','tool','developer']}))}],
      agents:[{id:'a',name:'Agent A',description:'',enabled:true,modelRouting:{textModelKey:'custom|room-test|model-a'}},{id:'b',name:'Agent B',description:'',enabled:true,modelRouting:{textModelKey:'custom|room-test|model-b'}}]});
    for(const id of ['a','b']) { mkdirSync(getAgentDir(id),{recursive:true}); writeFileSync(join(getAgentDir(id),'IDENTITY.md'),'You are identity-'+id+'.'); }
    const { getProjectStore } = await import('./src/lib/server/projects/store.ts');
    const projectRoot = process.env.ROOM_PROJECT_ROOT;
    const project = getProjectStore().create({name:'Room project',rootPath:projectRoot,instructions:'project-room-convention',modelKey:'custom|room-test|model-b'});
    const service = getRoomService();
    const room = service.create({title:'Runtime room',agentIds:['a','b'],primaryAgentId:'a',projectId:project.id});
    const image = await saveRoomFile(room.id,new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yAAAAABJRU5ErkJggg==','base64')],'pixel.png',{type:'image/png'}));
    const response = await handleRoomRequest(service,new Request('http://localhost/api/desktop/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',roomId:room.id,sessionId:room.id,submissionId:'first',text:'@a @Agent B Say hello briefly',attachmentIds:[image.id]})}),new URL('http://localhost/api/desktop/rooms'));
    if(response.status!==200) throw new Error(await response.text());
    const deadline=Date.now()+40000;
    while(service.isBusy(room.id)&&Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    const initial = service.view(room.id);
    service.send(room.id,{submissionId:'fail',text:'do not remember: ROOM_FAILED_INPUT',agentIds:['a']});
    while(service.isBusy(room.id)&&Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    if(service.view(room.id).executions.at(-1).status!=='failed') throw new Error('Expected failed run');
    service.send(room.id,{submissionId:'after-fail',text:'ROOM_AFTER_FAILURE',agentIds:['a']});
    while(service.isBusy(room.id)&&Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    const picked = await handleRoomRequest(service,new Request('http://localhost/api/desktop/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',roomId:room.id,sessionId:room.id,submissionId:'picked',text:'ROOM_MODEL_PICK',agentIds:['a'],modelKey:'custom|room-test|model-b',thinkingLevel:'off'})}),new URL('http://localhost/api/desktop/rooms'));
    if(picked.status!==200) throw new Error(await picked.text());
    while(service.isBusy(room.id)&&Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    const invalid = await handleRoomRequest(service,new Request('http://localhost/api/desktop/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',roomId:room.id,sessionId:room.id,submissionId:'invalid',text:'invalid',modelKey:'invalid'})}),new URL('http://localhost/api/desktop/rooms'));
    if(invalid.status===200) throw new Error('Invalid model accepted');
    const { MomRuntimeStore } = await import('./src/lib/server/agent/session/store.ts');
    const persisted = new MomRuntimeStore(join(process.env.DATA_DIR,'moli-w','rooms',room.id,'runtime'));
    console.log('ROOM_ROUTING_PERSISTED='+JSON.stringify(initial.executions.flatMap(e=>persisted.listSessionMessageEntries(room.id,e.contextId))));
    console.log('ROOM_RESULT='+JSON.stringify(initial));
    console.log('ROOM_AFTER_FAILURE='+JSON.stringify(service.view(room.id).executions.at(-1)));
    const next = service.newSession(room.id);
    service.send(room.id,{submissionId:'fresh',text:'ROOM_FRESH_SESSION',agentIds:['a']},next.id);
    while(service.isBusy(room.id)&&Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    if(runtime.sessions.listProjectConversations(project.id).filter(s=>!s.origin?.startsWith('internal:')).length!==1) throw new Error('Room conversation leaked into project list');
    console.log('ROOM_FRESH_RESULT='+JSON.stringify(service.view(room.id,next.id)));
    console.log('ROOM_OLD_RESULT='+JSON.stringify(service.view(room.id,room.id)));
    await service.dispose(); process.exit(0);
  `;
  const result = await execute(process.execPath, ["--import", "./scripts/register-loader.js", "--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { ...process.env, DATA_DIR: dir, ROOM_PROJECT_ROOT: projectDir, MOLIBOT_DISABLE_LIVE_CHANNELS: "1" }, timeout: 50_000, maxBuffer: 2_000_000
  });
  const line = result.stdout.split("\n").find(line => line.startsWith("ROOM_RESULT="));
  assert.ok(line, result.stderr.slice(-1000));
  const view = JSON.parse(line.slice("ROOM_RESULT=".length));
  assert.deepEqual(view.executions.map((e: { status: string }) => e.status), ["completed", "completed"], JSON.stringify(view.executions));
  assert.deepEqual(view.messages.filter((m: { role: string }) => m.role === "assistant").map((m: { authorAgentId: string }) => m.authorAgentId).sort(), ["a", "b"]);
  assert.deepEqual(view.messages.filter((m: { role: string }) => m.role === "assistant").map((m: { content: string }) => m.content).sort(), ["Answer from model-a", "Answer from model-b"]);
  assert.deepEqual(view.memberModelKeys, {a: "custom|room-test|model-a", b: "custom|room-test|model-b"});
  const a = requests.find(r => r.model === "model-a"); const b = requests.find(r => r.model === "model-b");
  assert.ok(a); assert.ok(b);
  for (const request of [a, b]) {
    const input = JSON.stringify(request.messages.filter(m => m.role === "user"));
    assert.match(input, /Runtime routing metadata/);
    assert.match(input, /read-only discussion/);
    assert.doesNotMatch(input, /Then call exitPlan/);
    const tools = (request as typeof request & {tools: Array<{function: {name: string}}>}).tools;
    assert.ok(!tools.some(t => ["exitPlan", "bash", "write", "edit", "subagent", "webSearch", "webFetch"].includes(t.function.name)));
    assert.match(input, /not a request to invoke subagent tools/);
    assert.match(input, /Agent A/); assert.match(input, /Agent B/);
    assert.doesNotMatch(JSON.stringify(request.messages.filter(m => m.role === "system" || m.role === "developer")), /Runtime routing metadata/);
  }
  const persisted = result.stdout.split("\n").find(line => line.startsWith("ROOM_ROUTING_PERSISTED="));
  assert.ok(persisted); assert.match(persisted, /Say hello briefly/); assert.doesNotMatch(persisted, /Runtime routing metadata|already been dispatched/);
  assert.ok(requests.some(r => r.model === "model-b" && JSON.stringify(r.messages.at(-1)?.content).includes("ROOM_MODEL_PICK")), "Explicit Room model selection must reach the real provider");
  assert.match(JSON.stringify(a.messages), /image_url/);
  assert.match(JSON.stringify(b.messages), /image_url/);
  assert.match(JSON.stringify(a.messages), /project-room-convention/);
  assert.match(JSON.stringify(b.messages), /project-room-convention/);
  assert.match(JSON.stringify(a.messages.filter(m => m.role === "system" || m.role === "developer")), /identity-a/);
  assert.doesNotMatch(JSON.stringify(a.messages.filter(m => m.role === "system" || m.role === "developer")), /identity-b/);
  assert.match(JSON.stringify(b.messages.filter(m => m.role === "system" || m.role === "developer")), /identity-b/);
  const freshRequest = requests.find(r => JSON.stringify(r.messages.at(-1)?.content).includes("ROOM_FRESH_SESSION"));
  assert.ok(freshRequest);
  assert.doesNotMatch(JSON.stringify(freshRequest.messages), /Say hello briefly|ROOM_FAILED_INPUT|ROOM_AFTER_FAILURE|ROOM_MODEL_PICK/);
  assert.match(JSON.stringify(freshRequest.messages), /project-room-convention|identity-a/);
  const freshView = JSON.parse(result.stdout.split("\n").find(line => line.startsWith("ROOM_FRESH_RESULT="))!.slice("ROOM_FRESH_RESULT=".length));
  assert.deepEqual(freshView.executions.map((e: { status: string }) => e.status), ["completed"]);
  assert.equal(freshView.messages.length, 2);
  assert.notEqual(freshView.session.contexts.find((c: { agentId: string }) => c.agentId === "a").contextId, view.session.contexts.find((c: { agentId: string }) => c.agentId === "a").contextId);
  assert.equal(freshView.room.id, view.room.id);
  const afterFailure = requests.findLast(r => JSON.stringify(r.messages.findLast(m => m.role === "user")).includes("ROOM_AFTER_FAILURE"));
  assert.ok(afterFailure);
  assert.equal((JSON.stringify(afterFailure.messages).match(/ROOM_FAILED_INPUT/g) ?? []).length, 1);
  assert.equal(JSON.parse(result.stdout.split("\n").find(line => line.startsWith("ROOM_AFTER_FAILURE="))!.slice("ROOM_AFTER_FAILURE=".length)).status, "completed");
});
