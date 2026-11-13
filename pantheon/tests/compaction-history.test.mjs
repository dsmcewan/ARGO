import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {sdkTurn} from '../src/sdk/seat-sdk.mjs';
import {saveHistory,loadHistoryState,stageHistoryGeneration,loadHistoryGeneration} from '../src/sdk/history.mjs';
import {saveSeat,loadSeat} from '../src/seat/store.mjs';
const seat={vendor:'anthropic',purpose:'compaction',cwd:'/fixture'};
test('compaction checkpoints are acknowledged by content identity, never by a reused message count',()=>{
 const home=mkdtempSync(join(tmpdir(),'argo-compact-crash-'));
 try{
  const before=[{role:'user',content:'old'},{role:'assistant',content:'old answer'}];saveHistory(seat,before,{home});
  const next=[{role:'assistant',content:[{type:'compaction',content:'summary',signature:'sig'}]},{role:'user',content:'new'},{role:'assistant',content:'answer'}];
  const generation=stageHistoryGeneration(seat,next,{home});
  assert.deepEqual(loadHistoryState(seat,{home,acknowledged:2}).messages,before,'crash before seat ack keeps old history');
  saveSeat(seat,{history_len:next.length,history_generation:generation},{home});
  assert.deepEqual(loadHistoryGeneration(seat,loadSeat(seat,{home}).history_generation,{home}).messages,next,'crash after ack keeps exact replacement');
 }finally{rmSync(home,{recursive:true,force:true});}
});
test('automatic Fable compaction persists signed replacement and resumes it on a third turn',async()=>{
 const home=mkdtempSync(join(tmpdir(),'argo-compact-live-'));const calls=[];
 const block={type:'compaction',content:'summary',signature:'untouched=='};
 const client={messages:{create:async req=>{calls.push(req);return req.compaction?{stop_reason:'compaction',content:[block]}:{stop_reason:'end_turn',content:[{type:'text',text:'complete'}]};}}};
 try{
  const opts={...seat,model:'claude-fable-5-2',client,home,extra:{system:'stable'}};
  assert.equal((await sdkTurn({...opts,prompt:'x'.repeat(513000)})).ok,true);
  const second=await sdkTurn({...opts,prompt:'second'});assert.equal(second.ok,true);
  assert.match(second.seat.history_generation,/^[a-f0-9]{64}$/);
  assert.equal((await sdkTurn({...opts,prompt:'third'})).ok,true);
  assert.deepEqual(calls.at(-1).messages[0].content,[block]);
  assert.equal(calls.filter(c=>c.compaction).length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});
