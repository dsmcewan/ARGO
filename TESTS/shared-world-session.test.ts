import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat,symlink,open,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {ArgoError,canonical,hash} from '../packages/contracts/src/index.ts';
import type {WorldLedger,WorldPrincipal} from '../packages/contracts/src/shared-world-types.ts';
import {openWorldLedger,createWorldEvent,initialWorldState,replayWorld} from '../packages/ledger/src/index.ts';
import {createWorldModelAgent} from '../packages/interventions/src/index.ts';
import {submitForDisplay} from '../scenarios/tempted-fates/shared-world/cli.ts';
import {genesis,principal,speak,command} from './shared-world-rules-helpers.ts';
import {keys} from './mortal-fixtures.ts';

type API=typeof import('../packages/session/src/index.ts');
async function api():Promise<API>{const m=await import(new URL('../packages/session/src/index.ts',import.meta.url).href).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});assert.equal(typeof m.createWorldSession,'function','Shared session must be implemented');return m;}
const code=(c:string)=>(e:unknown)=>e instanceof ArgoError&&e.code===c;
async function setup(t:TestContext){
 const directory=await mkdtemp(join(tmpdir(),'argo-world-session-')),g=genesis(),path=join(directory,'world.sqlite');
 const ledger=await openWorldLedger({path,genesis:g,privateKey:keys.privateKey});
 t.after(async()=>{await ledger.close();await rm(directory,{recursive:true,force:true});});
 const {createWorldSession}=await api();
 const session=(id='hero')=>createWorldSession({genesis:g,ledger,principal:principal(g,id)});
 return {directory,path,g,ledger,session,createWorldSession};
}

test('session binds one direct principal and latest query while exact old retries survive restart',async t=>{
 const f=await setup(t),hero=f.session(),other=f.session('companion'),q=await hero.query(),c=await hero.prepare(speak('A private promise',['companion']),'said_once');
 const receipt=await hero.submit(c);assert.equal(receipt.cursor.sequence,1);assert.equal(receipt.genesis_hash,hash(f.g));
 await assert.rejects(hero.view(q),code('CONFLICT'));await assert.rejects(other.submit(c),code('UNAUTHORIZED'));
 assert.equal((await other.view(await other.query())).memories.at(-1)!.payload.type,'speak');
 assert.equal((await f.session('watcher').view(await f.session('watcher').query())).memories.length,0);
 await hero.submit(await hero.prepare({type:'set_activity',activity:{description:'Waiting',busy_until:0}},'activity'));
 assert.deepEqual(await hero.submit(c),receipt);await f.ledger.close();
 const restarted=await openWorldLedger({path:f.path,genesis:f.g,privateKey:keys.privateKey,expectedHead:receipt.cursor});
 try{const again=f.createWorldSession({genesis:f.g,ledger:restarted,principal:principal(f.g)});assert.deepEqual(await again.submit(c),receipt);assert.deepEqual(replayWorld(f.g,await restarted.events()),await restarted.snapshot());}finally{await restarted.close();}
});

test('session rejects authentic receipts for another exact request or principal',async t=>{
 const f=await setup(t),s=initialWorldState(f.g),p=principal(f.g),wanted=command(s,speak(),'hero','wanted');
 const foreign=createWorldEvent(f.g,s,command(s,speak('different'),'hero','foreign'),p,keys.privateKey).receipt;
 const sameId=createWorldEvent(f.g,s,{...wanted,action:speak('different')},p,keys.privateKey).receipt;
 const other=createWorldEvent(f.g,s,command(s,{type:'set_activity',activity:{description:'Working',busy_until:0}},'companion','wanted'),principal(f.g,'companion'),keys.privateKey).receipt;
 for(const receipt of [foreign,sameId,other]){
  const ledger:WorldLedger={...f.ledger,submit:async()=>receipt};const session=f.createWorldSession({genesis:f.g,ledger,principal:p});
  await assert.rejects(session.submit(wanted),code('UNAUTHORIZED'));
 }
 assert.equal((await f.ledger.snapshot()).cursor.sequence,0);
});

test('session refuses forged identity, foreign genesis and active inputs before touching data',async t=>{
 const f=await setup(t);assert.throws(()=>f.createWorldSession({genesis:f.g,ledger:f.ledger,principal:{...principal(f.g),principal_id:'impostor'}}),code('UNAUTHORIZED'));
 assert.throws(()=>f.createWorldSession({genesis:f.g,ledger:f.ledger,principal:{...principal(f.g),role:'npc'} as WorldPrincipal}),code('UNAUTHORIZED'));
 let reads=0;const hostile={get genesis(){reads++;throw Error('getter');},ledger:f.ledger,principal:principal(f.g)};
 assert.throws(()=>f.createWorldSession(hostile as never),code('INVALID_CONTRACT'));assert.equal(reads,0);
 const session=f.session();const action={get type(){reads++;throw Error('getter');}};
 await assert.rejects(session.prepare(action as never,'bad'),code('INVALID_CONTRACT'));assert.equal(reads,0);
 const foreign=structuredClone(f.g);foreign.mortal.scope.world_id='another_world';
 const mixed=f.createWorldSession({genesis:foreign,ledger:f.ledger,principal:principal(foreign)});
 await assert.rejects(mixed.query(),code('INVALID_CONTRACT'));
 const original=principal(f.g),detached=f.createWorldSession({genesis:f.g,ledger:f.ledger,principal:original});original.actor_id='companion';
 assert.equal((await detached.query()).actor_id,'hero');
});

test('referee capability stays actorless and current closure suppresses old memories',async t=>{
 const f=await setup(t),hero=f.session(),host=f.session('host');
 await assert.rejects(host.query(),code('UNAUTHORIZED'));await assert.rejects(host.view(await hero.query()),code('UNAUTHORIZED'));
 await hero.submit(await hero.prepare(speak(),'before_close'));const old=await hero.query();
 await host.submit(await host.prepare({type:'close_mythic_engagement'},'close'));
 await assert.rejects(hero.view(old),code('CONFLICT'));const view=await hero.view(await hero.query());assert.equal(view.mythic_closed,true);assert.equal(view.memories.length,0);assert.equal(view.knowledge.length,0);
});

test('stale racing session commands and unauthorized combat never partially apply',async t=>{
 const f=await setup(t),hero=f.session(),host=f.session('host');
 const a=await hero.prepare({type:'mortal',action:{type:'wait',turns:1}},'left'),b=await hero.prepare({type:'mortal',action:{type:'wait',turns:1}},'right');
 await hero.submit(a);const before=await f.ledger.snapshot();await assert.rejects(hero.submit(b),code('CONFLICT'));assert.deepEqual(await f.ledger.snapshot(),before);
 const begin={type:'mortal' as const,action:{type:'begin_encounter' as const,encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true}};
 await assert.rejects(hero.prepare(begin,'forged_referee'));
 await host.submit(await host.prepare(begin,'begin_fight'));const fight=await f.ledger.snapshot();assert.ok(fight.physical.encounter);
 const acting=fight.physical.encounter.order[fight.physical.encounter.turn]!;
 await f.session(acting).submit(await f.session(acting).prepare({type:'mortal',action:{type:'defend'}},'combat_defend'));
 const after=await f.ledger.snapshot();assert.ok(after.cursor.sequence>fight.cursor.sequence);assert.deepEqual(replayWorld(f.g,await f.ledger.events()),after);
});

test('generated dialogue is pending until acceptance and a closure race suppresses committed display',async t=>{
 const f=await setup(t),hero=f.session(),npc=f.session('raider'),host=f.session('host');
 const agent=createWorldModelAgent({scope:f.g.mortal.scope,actorId:'raider',sessionId:'session_test',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],refreshContext:async query=>npc.view(query),clientFor:()=>({responses:{create:async()=>({id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"text":"I heard you."}'}]}]})}})});
 async function proposal(request:string){await hero.submit(await hero.prepare(speak('Will you listen?'),request));const view=await npc.view(await npc.query());return agent.respond(view.query,view.memories.at(-1)!.record_id,request+'_reply');}
 const stale=await proposal('ask_first');assert.ok(stale);assert.equal((await f.ledger.snapshot()).memories.filter(r=>r.actor_id==='raider').length,0);
 await hero.submit(await hero.prepare({type:'set_activity',activity:{description:'Watching',busy_until:0}},'move_prefix'));
 await assert.rejects(submitForDisplay(npc,stale),code('CONFLICT'));assert.equal((await f.ledger.snapshot()).memories.some(r=>r.actor_id==='raider'),false);
 const pending=await proposal('ask_again');assert.ok(pending);
 const raced={...npc,submit:async(c:Parameters<typeof npc.submit>[0])=>{const receipt=await npc.submit(c);await host.submit(await host.prepare({type:'close_mythic_engagement'},'close_after_accept'));return receipt;}};
 const result=await submitForDisplay(raced,pending);assert.equal(result.spoken,null);assert.equal(result.receipt.request_id,'ask_again_reply');assert.equal((await f.ledger.snapshot()).memories.some(r=>r.actor_id==='raider'),true);
});

test('revoked knowledge cannot be recovered through a stale session view and lost acknowledgments retry exactly',async t=>{
 const f=await setup(t),hero=f.session(),host=f.session('host'),old=await hero.query();assert.equal((await hero.view(old)).knowledge.length,1);
 await host.submit(await host.prepare({type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'revoke'));
 await assert.rejects(hero.view(old),code('CONFLICT'));assert.equal((await hero.view(await hero.query())).knowledge.length,0);
 const c=await hero.prepare(speak(),'lost_ack');let failed=false;
 const uncertain=f.createWorldSession({genesis:f.g,principal:principal(f.g),ledger:{...f.ledger,submit:async(command,principal)=>{const receipt=await f.ledger.submit(command,principal);if(!failed){failed=true;throw new ArgoError('UNAVAILABLE','Acknowledgment lost');}return receipt;}}});
 await assert.rejects(uncertain.submit(c),code('UNAVAILABLE'));const committed=await f.ledger.snapshot();const receipt=await uncertain.submit(c);assert.equal(receipt.cursor.sequence,committed.cursor.sequence);assert.deepEqual(await f.ledger.snapshot(),committed);
});

const cli=new URL('../scenarios/tempted-fates/shared-world/cli.ts',import.meta.url);
async function runCli(args:string[],input?:string){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 // Regular-file descriptors also work in execution environments that discard
 // child stdout pipes. This still runs the actual ordinary-process CLI entry.
 const output=await mkdtemp(join(tmpdir(),'argo-cli-output-')),out=await open(join(output,'out'),'wx',0o600),err=await open(join(output,'err'),'wx',0o600);
 await writeFile(join(output,'in'),input??'',{mode:0o600,flag:'wx'});const incoming=await open(join(output,'in'),'r');
 try{
  const status=await new Promise<number|null>((resolve,reject)=>{
   const child=spawn(process.execPath,[cli.pathname,...args],{env,stdio:[incoming.fd,out.fd,err.fd]});
   const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve(code);});
  });
  const result={stdout:await readFile(join(output,'out'),'utf8'),stderr:await readFile(join(output,'err'),'utf8')};
  if(status!==0)throw Object.assign(new Error('CLI process failed: '+result.stdout),{...result,status});return result;
 }finally{await incoming.close();await out.close();await err.close();await rm(output,{recursive:true,force:true});}
}

test('ordinary-process offline CLI demo commits exact terms, night travel, return and signed restart privately',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'argo-cli-')),dir=join(parent,'world');t.after(()=>rm(parent,{recursive:true,force:true}));
 const result=await runCli(['demo','--dir',dir]);const rows=result.stdout.trim().split('\n').map(row=>JSON.parse(row));
 const complete=rows.find(r=>r.type==='demo_complete');assert.ok(complete);assert.equal(complete.offline,true);assert.equal(complete.no_loan_from_conversation,true);assert.equal(complete.replayed,true);assert.equal(complete.loan_returned,true);assert.ok(complete.oil_spent>0);assert.ok(complete.elapsed_seconds>0);
 assert.equal(rows.filter(r=>r.type==='spoken').length,1);assert.equal(rows.find(r=>r.type==='spoken').speaker_id,'melia');
 assert.equal((await stat(dir)).mode&0o777,0o700);for(const name of ['genesis.json','signing-key.pem','manifest.json','model-request.json','world.sqlite'])assert.equal((await stat(join(dir,name))).mode&0o777,0o600);
 const captured=await readFile(join(dir,'model-request.json'),'utf8');for(const phrase of ['melia_lamp_loan_offer','actual_damage_by_explicit_agreement','May I borrow'])assert.ok(captured.includes(phrase));
 assert.equal(result.stdout.includes('PRIVATE KEY'),false);await assert.rejects(runCli(['demo','--dir',dir]));
 const resumed=await runCli(['resume','--dir',dir,'--actor','hero'],'{"op":"query"}\n');assert.equal(JSON.parse(resumed.stdout).query.cursor.sequence,complete.cursor.sequence);
 await assert.rejects(runCli(['resume','--dir',dir,'--actor','hero'],'{"op":"query","actor_id":"melia"}\n'));
});

test('CLI requires explicit private path and refuses symlink aliases into its source checkout',async t=>{
 await assert.rejects(runCli(['demo']));const parent=await mkdtemp(join(tmpdir(),'argo-cli-alias-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const checkout=resolve(new URL('..',import.meta.url).pathname),alias=join(parent,'source');await symlink(checkout,alias);
 await assert.rejects(runCli(['demo','--dir',join(alias,'.board','forbidden-cli-world')]));
 await assert.rejects(runCli(['demo','--dir',join(parent,'fresh'),'--unexpected','yes']));
});

test('ordinary CLI init uses closed explicit configuration and fixed referee/player capabilities',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'argo-cli-init-'));t.after(()=>rm(parent,{recursive:true,force:true}));const dir=join(parent,'world'),configFile=join(parent,'config.json');
 const config={scope:{tenant_id:'test',rights_lane:'homebrew',workspace_id:'table',workspace_tenant_id:'test:homebrew:table',campaign_id:'campaign',world_id:'world',branch_id:'main'},authority_key_id:'key',referee_id:'referee',npc_controller_id:'npcs',variant:'legend',hp_mode:'floor4',environment:'day',starting_kit:'standard',initial_knowledge_ids:[],travelers:[{id:'hero',name:'Hero',controller_id:'hero_host',weapon:'spear',nature:{description:'Patient',priorities:['listen']},presentation:{occupation:'Traveler',wants:'Understand',will_not:'Coerce'},max_speech_characters:240}]};
 await writeFile(configFile,JSON.stringify({...config,seed:'ab'.repeat(32)}),{mode:0o600});await assert.rejects(runCli(['init','--dir',dir,'--config',configFile]));
 await writeFile(configFile,JSON.stringify(config));const initialized=await runCli(['init','--dir',dir,'--config',configFile]);assert.equal(JSON.parse(initialized.stdout).type,'initialized');
 const prepared=await runCli(['resume','--dir',dir,'--referee'],'{"op":"prepare","request_id":"close","action":{"type":"close_mythic_engagement"}}\n');const command=JSON.parse(prepared.stdout).command;assert.equal(command.actor_id,null);
 await assert.rejects(runCli(['resume','--dir',dir,'--actor','hero'],JSON.stringify({op:'submit',command})+'\n'));
 const closed=await runCli(['resume','--dir',dir,'--referee'],JSON.stringify({op:'submit',command})+'\n');assert.equal(JSON.parse(closed.stdout).receipt.request_id,'close');
 await assert.rejects(runCli(['resume','--dir',dir,'--referee'],'{"op":"query"}\n'));
 await assert.rejects(runCli(['resume','--dir',dir,'--actor','hero'],'x'.repeat(1024*1024+1)));
 await chmod(join(dir,'signing-key.pem'),0o644);await assert.rejects(runCli(['resume','--dir',dir,'--actor','hero'],'{"op":"query"}\n'));
});
