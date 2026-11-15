/** Offline, disposable real-journal benchmark. No credentials or network.
 * node docs/deep-review/benchmark.mts <checkout> [128,512,1000]
 * Fixture construction is excluded. Cold and warm operations are separate.
 */
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir,cpus} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sign} from 'node:crypto';
const root=resolve(process.argv[2]??'.');
const get=async(path:string)=>import(pathToFileURL(join(root,path)).href);
const {genesis,keys,principal,proposal}=await get('TESTS/fixtures.ts');
const {canonical,CHARACTER_PROFILE,characterProposalId,characterRequestHash}=await get('packages/contracts/src/index.ts');
const {initialSnapshot,unsigned,eventHash}=await get('packages/ledger/src/mechanics.ts');
const {openLedger,createCharacterAuthority}=await get('packages/ledger/src/index.ts');
const {createCharacterViews}=await get('packages/lexi-bridge/src/index.ts');
const {createModelCharacterAgent}=await get('packages/interventions/src/index.ts');
const counts=(process.argv[3]??'128,512,1000').split(',').map(Number);
if(counts.some(n=>!Number.isSafeInteger(n)||n<3||n>10000))throw Error('Invalid benchmark counts');
const g=genesis(),system=principal('system','system'),traveler=principal('traveler'),npc=principal('outsider','npc');
let state=initialSnapshot(g);const lines:string[]=[];
const profile=(actor_id:string)=>({actor_id,revision:1,nature:{description:'Reserved, practical and attentive to promises.',priorities:['finish the work']},activity:{description:'Mending a lamp',busy_until:0},speech_policy:{max_characters:240,minimum_interval:0}});
for(let index=0;index<Math.max(...counts);index++){
 const body=index<2?{type:'configure',profile:profile(index===0?'traveler':'outsider')}:{type:'speak',text:'May I leave this lamp with you?',addressed_actor_ids:['outsider']};
 const requester=index<2?system:traveler,request_id=`bench_${index}`;
 const command={version:CHARACTER_PROFILE,scope:g.scope,request_id,expected_cursor:{sequence:state.sequence,head:state.head,world_time:state.world_time},body};
 const request_hash=characterRequestHash(command,requester);
 const envelope={version:CHARACTER_PROFILE,scope:g.scope,request_id,request_hash,requester:{principal_id:requester.principal_id,actor_id:requester.actor_id,role:requester.role},body:index<2?body:{...body,actor_id:'traveler',witnesses:{request_hash,actor_ids:['traveler','outsider'],party_id:null}}};
 const id=characterProposalId(g.scope,request_id),p=proposal(state,{type:'observe_claim',observation:{claim_id:id,channel:'belief',source_id:'system',content:canonical(envelope),observers:['system'],party_id:null,occurred_at:state.world_time}},'system',id);
 const sequence=state.sequence+1;
 const e={schema_version:'1.0.0',event_id:`event_${sequence}`,scope:g.scope,ruleset_version:g.ruleset_version,sequence,previous_hash:state.head,hash:'0'.repeat(64),kind:'epistemic',proposal:p,authority:{kind:'telos',principal_id:system.principal_id,key_id:g.authority_key_id,signature:'AA==',principal_actor_id:'system',principal_role:'system',receipt_hash:null},rng:null};
 e.authority.signature=sign(null,Buffer.from(canonical(unsigned(e))),keys.privateKey).toString('base64');e.hash=eventHash(e);
 // Construction needs only the envelope cursor. Each measured cold open then
 // validates signatures/rules and reconstructs real state from every event.
 state={...state,sequence,head:e.hash};lines.push(canonical(e));
}
console.log(JSON.stringify({kind:'environment',node:process.version,cpu:cpus()[0]?.model,counts,scope:'synthetic character carriers; no model latency or network'}));
for(const count of counts){
 const directory=await mkdtemp(join(tmpdir(),'argo-incremental-bench-'));
 try{
  await writeFile(join(directory,'genesis.json'),canonical(g)+'\n');
  await writeFile(join(directory,'events.jsonl'),lines.slice(0,count).join('\n')+'\n');
  const row:any={events:count};
  const measure=async(name:string,fn:()=>Promise<any>)=>{const start=performance.now();try{return await fn();}finally{row[name]=Math.round((performance.now()-start)*100)/100;}};
  const ledger=await measure('cold_open_ms',()=>openLedger({directory,genesis:g,privateKey:keys.privateKey}));
  await measure('warm_snapshot_ms',()=>ledger.snapshot());
  await measure('warm_events_ms',()=>ledger.events());
  const authority=await measure('authority_open_ms',()=>createCharacterAuthority({ledger,systemPrincipal:system}));
  const projection=await measure('cold_projection_ms',()=>authority.readProjection());
  await measure('warm_projection_ms',()=>authority.readProjection());
  const views=createCharacterViews({scope:g.scope,readProjection:(call:any)=>authority.readProjection(call),timeoutMs:60000});
  const query={version:CHARACTER_PROFILE,scope:g.scope,cursor:projection.cursor,actor_id:'outsider'};
  await measure('warm_actor_view_ms',()=>views.actor(query,npc));
  let calls=0;
  const agent=createModelCharacterAgent({scope:g.scope,actorId:'outsider',sessionId:'bench',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],refreshContext:(q:any,call:any)=>views.actor(q,npc,call),clientFor:()=>({responses:{create:async()=>{calls++;return {id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"text":"Beside the bench. I will mend it later."}'}]}]};}}})});
  try{const reply=await measure('scripted_dialogue_ms',()=>agent.respond(query,projection.records.at(-1).experience.record_id,'bench_reply'));row.dialogue=reply?'speech':'silence';}
  catch(error){row.dialogue=error instanceof Error?error.message:String(error);}
  row.scripted_provider_calls=calls;
  const current=await ledger.snapshot();
  await measure('warm_submit_ms',()=>ledger.submit(proposal(current,{type:'advance_time',to_time:11},'system'),system));
  console.log(JSON.stringify(row));
 }finally{await rm(directory,{recursive:true,force:true});}
}
