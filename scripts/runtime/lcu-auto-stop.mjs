const registryKey = Symbol.for('molibot.lcu-auto-stop');
const registry = globalThis[registryKey] ??= {clients:new Set(),lastStatus:'unverified'};

export function sharingSnapshot() {
  const states=[...registry.clients];
  return {status:states.some(state=>state.status==='unknown')?'unknown':states.some(state=>state.status==='stopping')?'stopping':states.some(state=>state.status==='released')?'released':registry.lastStatus,
    retryable:states.some(state=>state.pending.size>0)};
}
function publish() {
  const state=sharingSnapshot();
  if(process.connected) process.send?.({kind:'nativeSharing',...state});
}
async function bounded(operation, milliseconds) {
  const controller=new AbortController();let timer;
  try {
    return await Promise.race([operation(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{
      const error=new Error('LCU sharing stop timed out; release is unconfirmed.');controller.abort(error);reject(error);
    },milliseconds);})]);
  } finally {clearTimeout(timer);}
}

/** Wrap the official client; Stop always uses that client's original turn mapping. */
export function withLcuAutoStop(client,{deadlineMs=4_000,pollMs=100}={}) {
  const originalEnd=client.turnEnded.bind(client), originalClose=client.close.bind(client);
  const state={status:'unverified',pending:new Map(),flights:new Map(),endings:new Map(),completed:new Set(),closing:false,closed:false,retry:undefined};
  registry.clients.add(state);registry.lastStatus='unverified';
  const report=status=>{state.status=status;registry.lastStatus=status;publish();};
  const close=async()=>{
    state.closing=true;
    if(state.pending.size) throw new Error('LCU sharing cleanup is pending; the cleanup-only connection is retained for retry.');
    if(!state.closed){await originalClose();state.closed=true;registry.clients.delete(state);publish();}
  };
  const end=async input=>{
    if(!input?.sessionId||!input?.turnId||!['Stop','Interrupt','SubagentStop'].includes(input.event??'Stop')) throw new Error('LCU cleanup requires the original session and turn identity.');
    const turn={sessionId:input.sessionId,turnId:input.turnId,event:input.event??'Stop'};
    const key=JSON.stringify([turn.sessionId,turn.turnId]);
    if(state.completed.has(key))return;
    if(state.closed) throw new Error('The LCU cleanup connection has closed.');
    if(state.flights.has(key)) return state.flights.get(key);
    state.pending.set(key,turn);report('stopping');
    const operation=bounded(async signal=>{
      const assertCurrent=()=>{signal.throwIfAborted();if(state.pending.get(key)!==turn) throw new Error('LCU cleanup ownership changed.');};
      if(!client.hasHostControl) throw new Error('LCU automatic sharing Stop requires its macOS host-control endpoint.');
      const stopped=new Set();
      while(!state.endings.has(key)){
        assertCurrent();
        const status=await client.controlStatus({sessionId:turn.sessionId,turnId:turn.turnId});assertCurrent();
        const apps=status?.computerUse?.activeApplications;
        if(!Array.isArray(apps)||apps.some(app=>typeof app?.bundleIdentifier!=='string'||!app.bundleIdentifier)) throw new Error('LCU returned an invalid active-application status; sharing release is unconfirmed.');
        if(!apps.length) break;
        for(const app of apps){
          assertCurrent();
          if(stopped.has(app.bundleIdentifier))continue;
          const result=await client.controlStop({sessionId:turn.sessionId,turnId:turn.turnId,app:app.bundleIdentifier});assertCurrent();
          if(result?.accepted!==true||result.applicationId!==app.bundleIdentifier) throw new Error('LCU did not acknowledge the application Stop.');
          stopped.add(app.bundleIdentifier);
        }
        await new Promise(resolve=>setTimeout(resolve,pollMs));
      }
      assertCurrent();report('released');
      if(!state.endings.has(key)) state.endings.set(key,Promise.resolve().then(()=>originalEnd(turn)).then(value=>({ok:true,value}),error=>({ok:false,error})));
      const result=await state.endings.get(key);assertCurrent();
      state.endings.delete(key);
      if(!result.ok)throw result.error;
      state.pending.delete(key);state.completed.add(key);publish();
    },deadlineMs).catch(error=>{report('unknown');throw error;}).finally(()=>state.flights.delete(key));
    state.flights.set(key,operation);return operation;
  };
  state.retry=async()=>{
    for(const turn of [...state.pending.values()]) await end(turn);
    if(state.closing)await close();
  };
  client.turnEnded=end;client.close=close;
  return client;
}

/** Only retries already-owned cleanup; never starts tools, models or a new turn. */
export async function retrySharingCleanup() {
  const states=[...registry.clients].filter(state=>state.pending.size>0);
  if(!states.length) throw new Error('No retained LCU sharing cleanup is available to retry.');
  for(const state of states) await state.retry();
  return sharingSnapshot();
}
