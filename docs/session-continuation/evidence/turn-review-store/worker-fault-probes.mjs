import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const [rootArg,expected,outArg]=process.argv.slice(2),root=resolve(rootArg),out=resolve(outArg),exec=promisify(execFile),git=async(...args)=>(await exec('git',['-C',root,...args])).stdout.trim();
assert.equal(process.env.NODE_TEST_CONTEXT,undefined);assert.equal(await git('rev-parse','HEAD'),expected);assert.equal(await git('status','--porcelain'),'');await mkdir(out,{recursive:true,mode:0o700});
const scratch=await mkdtemp(join(out,'private-')),load=p=>import(pathToFileURL(join(root,p)).href);
const api=await load('packages/session/src/index.ts'),ledgerApi=await load('packages/ledger/src/index.ts'),helpers=await load('TESTS/shared-world-rules-helpers.ts'),{keys}=await load('TESTS/mortal-fixtures.ts');
const policy={provider_policy_id:'independent_fault_fixture/1',generation_mode:'offline_fixture',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],effort:'low',timeout_ms:10000,max_context_bytes:32768,max_output_tokens:256};
const observations=[];
async function fixture(name){const directory=join(scratch,name);await mkdir(directory,{mode:0o700});const genesis=helpers.genesis(),ledger=await ledgerApi.openWorldLedger({path:join(directory,'world.sqlite'),genesis,privateKey:keys.privateKey});const options={path:join(directory,'turns.sqlite'),mode:'create',genesis,player:helpers.principal(genesis,'hero'),npc:helpers.principal(genesis,'raider'),policy};const store=await api.openWorldConversationStore(options);return{directory,genesis,ledger,options,store};}
function host(f,store=f.store){let calls=0;const value=api.createWorldConversation({store,ledger:f.ledger,model:{clientFor:()=>({responses:{create:async()=>{calls++;return{id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"text":"Acknowledged."}'}]}]};}}})}});return{value,calls:()=>calls};}
async function check(name,fn){try{observations.push({name,status:'pass',details:await fn()});console.log('PASS '+name);}catch(e){observations.push({name,status:'fail',error:String(e),stack:e.stack});console.log('FAIL '+name+': '+e);}}
function exchange(worker,id,message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Raw worker response timeout')),15000);const receive=value=>{if(value?.id===id){clearTimeout(timer);worker.off('message',receive);resolve(value);}};worker.on('message',receive);worker.once('error',reject);if(message)worker.postMessage(message);});}
try{
 await check('outbox COMMIT refusal rolls back insertion and same public turn can succeed afterward',async()=>{
  const f=await fixture('commit-refusal'),h=host(f);try{await writeFile(f.options.path+'.review-fault',JSON.stringify({mode:'fail_commit'}),{mode:0o600});await assert.rejects(h.value.turn({turn_id:'refused',text:'Please respond.'}));assert.equal(await h.value.read({turn_id:'refused'}),null);assert.equal((await f.ledger.snapshot()).cursor.sequence,0);assert.equal(h.calls(),0);
   const result=await h.value.turn({turn_id:'refused',text:'Please respond.'});assert.equal(result.outcome,'replied');assert.equal(h.calls(),1);assert.equal((await f.ledger.snapshot()).cursor.sequence,2);return{after_refusal_rows:0,after_success_events:2,model_calls:1};
  }finally{await h.value.close();await f.store.close();await f.ledger.close();}
 });
 await check('worker exit after COMMIT before acknowledgment preserves accepted input without regeneration on read',async()=>{
  const f=await fixture('post-commit-crash'),h=host(f);let reopened,second;try{await writeFile(f.options.path+'.review-fault',JSON.stringify({mode:'crash_after_commit',turn_id:'durable'}),{mode:0o600});await assert.rejects(h.value.turn({turn_id:'durable',text:'Keep this exact input.'}));await h.value.close();await f.store.close();assert.equal(h.calls(),0);
   reopened=await api.openWorldConversationStore({...f.options,mode:'open'});second=host(f,reopened);const row=await second.value.read({turn_id:'durable'});assert.equal(row.phase,'accepted');assert.equal(second.calls(),0);const result=await second.value.resume({turn_id:'durable'});assert.equal(result.outcome,'replied');assert.equal(second.calls(),1);assert.equal((await f.ledger.snapshot()).cursor.sequence,2);return{recovered_phase:row.phase,generation_calls:1,world_events:2};
  }finally{await second?.value.close();await reopened?.close();await h.value.close();await f.store.close();await f.ledger.close();}
 });
 await check('raw worker refuses unknown operation/envelope and oversized RPC without corrupting valid reads',async()=>{
  const f=await fixture('raw-rpc'),h=host(f);let worker;try{await h.value.turn({turn_id:'valid',text:'A valid persisted turn.'});await h.value.close();await f.store.close();worker=new Worker(new URL('packages/session/src/conversation-store-worker.ts',pathToFileURL(root+'/')),{workerData:{path:f.options.path,mode:'open',binding:f.store.binding,maxCharacters:240,maxReplyCharacters:240}});const ready=await exchange(worker,0);assert.equal(ready.ok,true);
   const unknown=await exchange(worker,1,{id:1,method:'erase_everything',args:null});assert.equal(unknown.ok,false);
   const envelope=await exchange(worker,0,{id:2,method:'load',args:{turn_id:'valid'},extra:true});assert.equal(envelope.ok,false);
   const oversized=await exchange(worker,3,{id:3,method:'load',args:{turn_id:'x'.repeat(1048576)}});assert.equal(oversized.ok,false);
   const valid=await exchange(worker,4,{id:4,method:'load',args:{turn_id:'valid'}});assert.equal(valid.ok,true);assert.equal(valid.value.phase,'settled');assert.equal(valid.value.terminal.outcome,'replied');await exchange(worker,5,{id:5,method:'close',args:null});return{unknown_code:unknown.code,envelope_code:envelope.code,oversized_code:oversized.code,preserved_turn:valid.value.turn_id};
  }finally{await worker?.terminate();await h.value.close();await f.store.close();await f.ledger.close();}
 });
}finally{assert.equal(await git('rev-parse','HEAD'),expected);assert.equal(await git('status','--porcelain'),'');await rm(scratch,{recursive:true,force:true});const result={candidate:expected,ordinary_process:true,checks:observations,passed:observations.filter(x=>x.status==='pass').length,failed:observations.filter(x=>x.status==='fail').length,limits:'External preload instruments worker only. COMMIT error is simulated, not a physical disk-full experiment; actual worker exits after COMMIT before acknowledgment. Public host creates all turns; raw worker negative controls are separate internal transport tests.',paid_calls:0};await writeFile(join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.failed?1:0;}
