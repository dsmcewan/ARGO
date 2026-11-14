import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const [rootArg,sha,outArg]=process.argv.slice(2),root=resolve(rootArg),out=resolve(outArg),exec=promisify(execFile);
const git=async(...args)=>(await exec('git',['-C',root,...args])).stdout.trim();assert.equal(await git('rev-parse','HEAD'),sha);assert.equal(await git('status','--porcelain'),'');assert.equal(process.env.NODE_TEST_CONTEXT,undefined);
await mkdir(out,{recursive:true,mode:0o700});const scratch=await mkdtemp(join(out,'private-'));
const load=p=>import(pathToFileURL(join(root,p)).href);
const store=await load('packages/session/src/conversation-store.ts'),guards=await load('packages/session/src/conversation-guards.ts'),helpers=await load('TESTS/shared-world-rules-helpers.ts'),ledger=await load('packages/ledger/src/index.ts'),{keys}=await load('TESTS/mortal-fixtures.ts');
const policy={provider_policy_id:'checkpoint_review',generation_mode:'offline_fixture',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],effort:'low',timeout_ms:1000,max_context_bytes:32768,max_output_tokens:256};
const observations=[];
async function options(name){const dir=join(scratch,name);await mkdir(dir,{mode:0o700});const g=helpers.genesis();return{path:join(dir,'turns.sqlite'),mode:'create',genesis:g,player:helpers.principal(g,'hero'),npc:helpers.principal(g,'raider'),policy};}
const result=async fn=>{try{return{accepted:true,value:await fn()};}catch(e){return{accepted:false,code:e.code??null,message:e.message};}};
function sql(path,fn){const db=new DatabaseSync(path);try{return fn(db);}finally{db.close();}}
try{
 const o=await options('mode');await writeFile(o.path,'',{mode:0o600});o.mode='open';
 const normal=await result(()=>store.openWorldConversationStore(o));assert.equal(normal.accepted,false);
 const pending=store.openWorldConversationStore(o);o.mode='create';const changed=await result(()=>pending);if(changed.accepted)await changed.value.close();observations.push({name:'caller_mode_mutation_after_await',open_empty_refused:!normal.accepted,mutated_open_initialized:changed.accepted});
 const sopts=await options('schema'),s=await store.openWorldConversationStore(sopts);await s.close();sql(sopts.path,db=>db.exec('CREATE TABLE sqliteXforeign(x TEXT) STRICT'));
 const reopened=await result(()=>store.openWorldConversationStore({...sopts,mode:'open'}));if(reopened.accepted)await reopened.value.close();observations.push({name:'sqlite_like_wildcard_foreign_table',foreign_table_accepted:reopened.accepted});
 const ids={};for(const [name,value,fn]of [['turn_lf','turn\n',guards.turnId],['turn_65','a'.repeat(64)+'\n',guards.turnId],['digest_lf','a'.repeat(64)+'\n',guards.digest]])ids[name]=(await result(()=>fn(value))).accepted;observations.push({name:'closed_identifier_terminal_newline',...ids});
 const eopts=await options('deadline'),binding=guards.buildBinding(eopts),initial=ledger.initialWorldState(eopts.genesis),cmd=helpers.command(initial,helpers.speak('Hello',['raider']),'hero',store.requestIdFor(binding,'deadline','input')),event=ledger.createWorldEvent(eopts.genesis,initial,cmd,eopts.player,keys.privateKey);
 let row=guards.initialRow(binding,{turn_id:'deadline',text:'Hello'},1000);row=guards.mutate(row,{type:'save_input',command:cmd},binding,1000);row=guards.mutate(row,{type:'confirm_input',receipt:event.receipt},binding,1000);row=guards.mutate(row,{type:'claim_generation',attempt:{attempt_id:'a'.repeat(64),owner_id:'b'.repeat(64),query:{version:initial.version,scope:binding.scope,actor_id:binding.npc.actor_id,cursor:event.receipt.cursor},started_at_ms:1000,deadline_at_ms:2000}},binding,1000);
 const late=await result(()=>guards.mutate(row,{type:'settle',terminal:{outcome:'no_reply',reason:'adapter_null',rejection_proof:null}},binding,2001));
 const uncertain=await result(()=>guards.mutate(row,{type:'settle',terminal:{outcome:'generation_uncertain',reason:'attempt_expired',rejection_proof:null}},binding,2001));
 observations.push({name:'expired_null_result_fence',persisted_deadline:2000,settle_time:2001,late_null_accepted:late.accepted,late_null_outcome:late.value?.terminal?.outcome,expired_uncertain_control:uncertain.accepted});
 const qopts=await options('close'),q=await store.openWorldConversationStore(qopts),access=store.storeAccess(q),writes=Array.from({length:64},(_,i)=>access.insert({turn_id:'q'+i,text:'Queued'})),done=Promise.allSettled(writes),closed=await result(()=>q.close()),all=await done;
 observations.push({name:'close_at_rpc_capacity',close_accepted:closed.accepted,close_code:closed.code??null,accepted_calls:64,fulfilled:all.filter(r=>r.status==='fulfilled').length,rejected:all.filter(r=>r.status==='rejected').length});
 const lopts=await options('directory-link'),l=await store.openWorldConversationStore(lopts);await l.close();const alias=join(scratch,'alias');await symlink(join(lopts.path,'..'),alias);const linked=await result(()=>store.openWorldConversationStore({...lopts,mode:'open',path:join(alias,'turns.sqlite')}));if(linked.accepted)await linked.value.close();observations.push({name:'directory_symlink',directory_alias_accepted:linked.accepted,interpretation:'Canonical alias accepted; contract interpretation should distinguish from symlink file refusal.'});
 const zopts=await options('oversized'),z=await store.openWorldConversationStore(zopts),za=store.storeAccess(z);await za.insert({turn_id:'oversized',text:'Hello'});
 const huge=JSON.stringify({padding:'x'.repeat(262144)});sql(zopts.path,db=>db.prepare('UPDATE conversation_turns SET row_json=? WHERE turn_id=?').run(huge,'oversized'));
 const oversized=await result(()=>za.load('oversized'));await z.close();observations.push({name:'oversized_decode',json_bytes:Buffer.byteLength(huge),row_limit:131072,load_refused:!oversized.accepted,code:oversized.code??null,parse_instrumentation:'See parse-trace.jsonl: worker JSON.parse called before bounded row refusal.'});
}finally{
 assert.equal(await git('rev-parse','HEAD'),sha);assert.equal(await git('status','--porcelain'),'');await writeFile(join(out,'observations.json'),JSON.stringify({candidate:sha,ordinary_process:true,scope:'Interim store/guard checkpoint only; internal storeAccess used because driver is absent.',observations},null,2)+'\n');console.log(JSON.stringify(observations,null,2));await rm(scratch,{recursive:true,force:true});
}
