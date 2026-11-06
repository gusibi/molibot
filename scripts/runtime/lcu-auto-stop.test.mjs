import test from 'node:test';
import assert from 'node:assert/strict';
import {withLcuAutoStop, sharingSnapshot, retrySharingCleanup} from './lcu-auto-stop.mjs';
function fixture() {
 const calls=[];let apps=['app.fixture'];let fail=false;
 const client={hasHostControl:true,
  controlStatus:async turn=>{calls.push(['status',turn]);return {computerUse:{activeApplications:apps.map(bundleIdentifier=>({bundleIdentifier}))}};},
  controlStop:async turn=>{calls.push(['stop',turn]);if(fail)throw new Error('Fixture stop failed');apps=apps.filter(app=>app!==turn.app);return {accepted:true,applicationId:turn.app};},
  turnEnded:async turn=>{calls.push(['end',turn]);},close:async()=>{calls.push(['close']);}
 };
 return {client,calls,setFail:value=>fail=value};
}
test('stops and verifies the original turn before ending and closing; the next turn can open again',async()=>{
 const f=fixture();const client=withLcuAutoStop(f.client,{deadlineMs:100,pollMs:1});
 const turn={sessionId:'owned-session',turnId:'owned-turn',event:'Stop'};
 await client.turnEnded(turn);await client.close();
 assert.deepEqual(f.calls.map(call=>call[0]),['status','stop','status','end','close']);
 assert.deepEqual(f.calls.find(call=>call[0]==='stop')[1],{sessionId:'owned-session',turnId:'owned-turn',app:'app.fixture'});
 assert.equal(sharingSnapshot().status,'released');
 const next=fixture();const nextClient=withLcuAutoStop(next.client,{deadlineMs:100,pollMs:1});
 await nextClient.turnEnded({...turn,turnId:'next-turn'});await nextClient.close();
 assert.equal(next.calls.find(call=>call[0]==='stop')[1].turnId,'next-turn');
});
test('failed stop retains the original connection and retry never borrows another turn identity',async()=>{
 const f=fixture();f.setFail(true);const client=withLcuAutoStop(f.client,{deadlineMs:100,pollMs:1});
 const turn={sessionId:'old-session',turnId:'old-turn',event:'Interrupt'};
 await assert.rejects(client.turnEnded(turn),/Fixture stop failed/);
 await assert.rejects(client.close(),/pending/);
 assert.equal(f.calls.some(call=>['end','close'].includes(call[0])),false);
 assert.equal(sharingSnapshot().status,'unknown');assert.equal(sharingSnapshot().retryable,true);
 f.setFail(false);await retrySharingCleanup();
 assert.equal(sharingSnapshot().status,'released');assert.equal(sharingSnapshot().retryable,false);
 assert.deepEqual(f.calls.filter(call=>call[0]==='end').map(call=>call[1]),[turn]);
 assert.equal(f.calls.at(-1)[0],'close');
});
test('late status responses after a deadline cannot start Stop or end the turn',async()=>{
 const f=fixture();let release;const original=f.client.controlStatus;
 f.client.controlStatus=()=>new Promise(resolve=>{release=()=>original({}).then(resolve);});
 const client=withLcuAutoStop(f.client,{deadlineMs:15,pollMs:1});
 await assert.rejects(client.turnEnded({sessionId:'session',turnId:'turn',event:'Stop'}),/timed out/);
 release();await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.calls.some(call=>['stop','end'].includes(call[0])),false);
 f.client.controlStatus=original;await client.close().catch(()=>{});await retrySharingCleanup();
});

test('an end that outlives the deadline is awaited on retry without opening a new upstream turn',async()=>{
 const f=fixture();let release;
 f.client.turnEnded=turn=>{f.calls.push(['end',turn]);return new Promise(resolve=>{release=resolve;});};
 const client=withLcuAutoStop(f.client,{deadlineMs:15,pollMs:1});
 const turn={sessionId:'session',turnId:'slow-end',event:'Stop'};
 await assert.rejects(client.turnEnded(turn),/timed out/);await client.close().catch(()=>{});
 const priorStatusCount=f.calls.filter(call=>call[0]==='status').length;
 release();await Promise.resolve();await retrySharingCleanup();
 assert.equal(f.calls.filter(call=>call[0]==='status').length,priorStatusCount);
 assert.equal(f.calls.filter(call=>call[0]==='end').length,1);
 await client.turnEnded(turn);
 assert.equal(f.calls.filter(call=>call[0]==='end').length,1);
});
