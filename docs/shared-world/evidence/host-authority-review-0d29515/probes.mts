import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,chmod,rename,symlink,lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const root=process.env.ARGO_SW_ROOT??'/workspace/ARGO/.board/shared-world-host/worktrees/SW-510-1-3f6965d414';
const mod=async(p:string)=>import(pathToFileURL(`${root}/${p}`).href);
const {genesis,principal,command,offer,accept}=await mod('TESTS/shared-world-rules-helpers.ts');
const {keys}=await mod('TESTS/mortal-fixtures.ts');
const {canonical,hash}=await mod('packages/contracts/src/index.ts');
const {createWorldSession}=await mod('packages/session/src/index.ts');
const {initialWorldState,createWorldEvent,openWorldLedger,replayWorld}=await mod('packages/ledger/src/index.ts');
const {main}=await mod('scenarios/tempted-fates/shared-world/cli.ts');
const clone=(x:any)=>structuredClone(x),note=(text='Independent host probe')=>({type:'speak',text,audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});
const code=(wanted:string)=>(e:any)=>e?.code===wanted;
const fake=(snapshot:any,submit:any)=>({snapshot,submit,events:async()=>[],close:async()=>{}});
const deferred=()=>{let resolve:any;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const resign=(r:any)=>{const {signature:_,...receipt}=r;return {...receipt,signature:sign(null,Buffer.from(canonical({domain:'shared-world/0.1.0/receipt',receipt})),keys.privateKey).toString('base64')};};
async function* lines(text=''){yield text;}
async function run(args:string[],input=''){const rows:any[]=[];const exit=await main(args,lines(input),r=>rows.push(r));return {exit,rows};}
async function rejectedRun(args:string[],input=''){try{const r=await run(args,input);assert.notEqual(r.exit,0);return r;}catch(e){if(e?.code==='ERR_ASSERTION')throw e;return {error:e};}}
async function dirFor(t:any,prefix:string){const d=await mkdtemp('/tmp/'+prefix);t.after(()=>rm(d,{recursive:true,force:true}));return d;}

test('session owns full genesis/principal and rejects identity overrides before any ledger call',async()=>{
 const g=genesis(),initial=initialWorldState(g),supplied=clone(g),p=principal(g);let snapshots=0,submits=0;const ledger=fake(async()=>{snapshots++;return initial;},async()=>{submits++;throw Error('unexpected');});
 const session=createWorldSession({genesis:supplied,principal:p,ledger});supplied.profiles[0].nature.description='changed';supplied.mortal.actors[0].controller_id='changed';p.actor_id='companion';p.principal_id='changed';const q=await session.query();assert.equal(q.actor_id,'hero');assert.equal((await session.prepare(note(),'fixed')).expected.head,hash(g));
 for(const pp of [{...principal(g),principal_id:'wrong'},{...principal(g),actor_id:'companion'},{...principal(g),role:'npc'},{...principal(g,'host'),principal_id:'wrong'}])assert.throws(()=>createWorldSession({genesis:g,principal:pp,ledger}));
 for(const key of Object.keys(g.mortal.scope)){const pp=principal(g);pp.scope[key]=key==='rights_lane'?'homebrew':pp.scope[key]+'_other';assert.throws(()=>createWorldSession({genesis:g,principal:pp,ledger}));}
 const before=snapshots;await assert.rejects(session.submit(command(initial,note(),'companion','foreign')),code('UNAUTHORIZED'));await assert.rejects(session.view({...q,actor_id:'companion'}),code('UNAUTHORIZED'));assert.equal(snapshots,before);assert.equal(submits,0);
});

test('prepare, view and submit detach caller inputs before crossing await and detach returned receipts',async()=>{
 const g=genesis(),s=initialWorldState(g),p=principal(g);let gate=deferred(),captured:any;const ledger=fake(()=>gate.promise,async(c:any,pp:any)=>{captured={c,pp};return gate.promise;});const session=createWorldSession({genesis:g,principal:p,ledger});
 const action=note('original'),prepared=session.prepare(action,'async_prepare');action.text='mutated';gate.resolve(s);const c=await prepared;assert.equal(c.action.text,'original');assert.ok(Object.isFrozen(c.action));
 const q={version:s.version,scope:clone(s.scope),actor_id:'hero',cursor:clone(s.cursor)};gate=deferred();const viewing=session.view(q);q.actor_id='companion';q.cursor.world_time=1;gate.resolve(s);assert.equal((await viewing).query.actor_id,'hero');
 gate=deferred();const raw=clone(c),submitting=session.submit(raw);raw.action.text='changed after dispatch';raw.request_id='other';assert.equal(captured.c.action.text,'original');assert.equal(captured.c.request_id,'async_prepare');assert.ok(Object.isFrozen(captured.c));assert.ok(Object.isFrozen(captured.pp));const made=createWorldEvent(g,s,captured.c,captured.pp,keys.privateKey);gate.resolve(made.receipt);const receipt=await submitting;made.receipt.request_id='mutated ledger result';assert.equal(receipt.request_id,'async_prepare');assert.ok(Object.isFrozen(receipt.cursor));
});

test('authentic but wrong-request or result-prefix receipts are refused; submit has no current-state precheck',async()=>{
 const g=genesis(),s=initialWorldState(g),p=principal(g),c=command(s,note(),'hero','wanted'),valid=createWorldEvent(g,s,c,p,keys.privateKey).receipt;
 const foreign=createWorldEvent(g,s,command(s,note(),'hero','other'),p,keys.privateKey).receipt;
 const changed=createWorldEvent(g,s,{...c,action:note('different')},p,keys.privateKey).receipt;
 const wrongActor=createWorldEvent(g,s,command(s,note(),'companion','wanted'),principal(g,'companion'),keys.privateKey).receipt;
 const wrongSequence=resign({...valid,cursor:{...valid.cursor,sequence:2}});
 for(const receipt of [foreign,changed,wrongActor,wrongSequence]){const session=createWorldSession({genesis:g,principal:p,ledger:fake(async()=>{throw Error('submit must not read snapshot');},async()=>receipt)});await assert.rejects(session.submit(c),code('UNAUTHORIZED'));}
 const session=createWorldSession({genesis:g,principal:p,ledger:fake(async()=>{throw Error('no current prefix available');},async()=>valid)});assert.deepEqual(await session.submit(c),valid);
 const next=createWorldEvent(g,s,command(s,{type:'mortal',action:{type:'wait',turns:1}},'hero','wait'),p,keys.privateKey).state;const late=command(next,note(),'hero','late'),receipt=createWorldEvent(g,next,late,p,keys.privateKey).receipt;const backwards=resign({...receipt,cursor:{...receipt.cursor,world_time:0}});const backwardsSession=createWorldSession({genesis:g,principal:p,ledger:fake(async()=>next,async()=>backwards)});await assert.rejects(backwardsSession.submit(late),code('UNAUTHORIZED'));
});

test('referee remains actorless and forged role/action combinations refuse before storage',async()=>{
 const g=genesis(),s=initialWorldState(g);let reads=0,writes=0;const ledger=fake(async()=>{reads++;return s;},async()=>{writes++;throw Error('unexpected');});const host=createWorldSession({genesis:g,principal:principal(g,'host'),ledger}),hero=createWorldSession({genesis:g,principal:principal(g),ledger});
 await assert.rejects(host.query(),code('UNAUTHORIZED'));await assert.rejects(host.view({version:s.version,scope:s.scope,actor_id:'hero',cursor:s.cursor}),code('UNAUTHORIZED'));assert.equal(reads,0);
 await assert.rejects(hero.prepare({type:'close_mythic_engagement'},'forged'));await assert.rejects(host.prepare(note(),'actor_speech'));assert.equal(reads,0);
 const close=await host.prepare({type:'close_mythic_engagement'},'real_referee');assert.equal(close.actor_id,null);assert.equal(close.expected.head,hash(g));await assert.rejects(hero.submit(close),code('UNAUTHORIZED'));assert.equal(writes,0);
 const foreign=clone(s);foreign.physical.actors[0].controller_id='forged';const bad=createWorldSession({genesis:g,principal:principal(g,'host'),ledger:fake(async()=>foreign,async()=>{})});await assert.rejects(bad.prepare({type:'close_mythic_engagement'},'bad_snapshot'));
});

test('real compound acceptance retry survives return, closure, stale view and restart without another transfer',async t=>{
 const dir=await dirFor(t,'argo-host-ledger-'),path=join(dir,'world.sqlite'),g=genesis();let ledger=await openWorldLedger({path,genesis:g,privateKey:keys.privateKey});t.after(()=>ledger.close());let hero=createWorldSession({genesis:g,principal:principal(g),ledger}),borrower=createWorldSession({genesis:g,principal:principal(g,'companion'),ledger});const host=createWorldSession({genesis:g,principal:principal(g,'host'),ledger});
 const stale=await hero.query();await hero.submit(await hero.prepare(offer('host_loan',3000),'offer'));const offered=await ledger.snapshot(),acceptance=await borrower.prepare(accept(offered),'accept'),receipt=await borrower.submit(acceptance);await borrower.submit(await borrower.prepare({type:'return_loan',loan_id:'host_loan'},'return'));await host.submit(await host.prepare({type:'close_mythic_engagement'},'close'));await assert.rejects(hero.view(stale),code('CONFLICT'));
 const before=await ledger.snapshot();assert.deepEqual(await borrower.submit(acceptance),receipt);assert.strictEqual(await ledger.snapshot(),before);assert.equal(before.loans[0].status,'returned');assert.equal(before.physical.items.find((i:any)=>i.id==='lamp').owner_id,'hero');await ledger.close();ledger=await openWorldLedger({path,genesis:g,privateKey:keys.privateKey,expectedHead:before.cursor});borrower=createWorldSession({genesis:g,principal:principal(g,'companion'),ledger});assert.deepEqual(await borrower.submit(acceptance),receipt);assert.deepEqual(replayWorld(g,await ledger.events()),await ledger.snapshot());assert.equal((await ledger.snapshot()).cursor.sequence,4);
});

const config={scope:{tenant_id:'independent',rights_lane:'homebrew',workspace_id:'table',workspace_tenant_id:'independent:homebrew:table',campaign_id:'campaign',world_id:'host_probe',branch_id:'main'},authority_key_id:'local_key',referee_id:'host',npc_controller_id:'npc_host',variant:'legend',hp_mode:'floor4',environment:'day',starting_kit:'standard',initial_knowledge_ids:[],travelers:[{id:'hero',name:'Hero',controller_id:'hero_host',weapon:'spear',nature:{description:'Patient',priorities:['listen']},presentation:{occupation:'Traveler',wants:'Learn',will_not:'Coerce'},max_speech_characters:240}]};
async function ordinary(args:string[],input:string,dir:string){const paths=['stdin','stdout','stderr'].map(name=>join(dir,name));await writeFile(paths[0],input,{mode:0o600});const files=await Promise.all([open(paths[0],'r'),open(paths[1],'w',0o600),open(paths[2],'w',0o600)]);const env={...process.env};delete env.NODE_TEST_CONTEXT;try{const status=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'scenarios/tempted-fates/shared-world/cli.ts'),...args],{env,stdio:files.map(f=>f.fd)});const timer=setTimeout(()=>child.kill('SIGKILL'),60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);resolve(code);});});return {status,stdout:await readFile(paths[1],'utf8'),stderr:await readFile(paths[2],'utf8')};}finally{await Promise.all(files.map(f=>f.close()));}}

test('ordinary CLI init creates private state once; saved principal/referee commands and exact retries work',async t=>{
 const parent=await dirFor(t,'argo-host-cli-'),dir=join(parent,'world'),cfg=join(parent,'config.json');await writeFile(cfg,JSON.stringify(config),{mode:0o600});const started=await ordinary(['init','--dir',dir,'--config',cfg],'',parent);assert.equal(started.status,0,started.stdout);assert.equal(JSON.parse(started.stdout).type,'initialized');assert.equal((await lstat(dir)).mode&0o777,0o700);for(const name of ['genesis.json','manifest.json','signing-key.pem','ready.json','world.sqlite'])assert.equal((await lstat(join(dir,name))).mode&0o777,0o600);
 const before=await readFile(join(dir,'genesis.json'));await rejectedRun(['init','--dir',dir,'--config',cfg]);assert.deepEqual(await readFile(join(dir,'genesis.json')),before);
 const prepared=await run(['resume','--dir',dir,'--referee'],JSON.stringify({op:'prepare',request_id:'close',action:{type:'close_mythic_engagement'}})+'\n');const c=prepared.rows[0].command;assert.equal(c.actor_id,null);assert.equal((await run(['resume','--dir',dir,'--actor','hero'],JSON.stringify({op:'submit',command:c})+'\n')).exit,1);
 const committed=await run(['resume','--dir',dir,'--referee'],JSON.stringify({op:'submit',command:c})+'\n');assert.equal(committed.exit,0);const retried=await run(['resume','--dir',dir,'--referee'],JSON.stringify({op:'submit',command:c})+'\n');assert.deepEqual(retried.rows,committed.rows);assert.equal(committed.rows[0].receipt.cursor.sequence,1);assert.equal((await run(['resume','--dir',dir,'--referee'],'{"op":"query"}\n')).exit,1);
});

test('CLI resume refuses symlinks, unsafe private permissions, missing DB and wrong ready marker without replacement',async t=>{
 const parent=await dirFor(t,'argo-host-files-'),dir=join(parent,'world'),cfg=join(parent,'config.json');await writeFile(cfg,JSON.stringify(config),{mode:0o600});assert.equal((await run(['init','--dir',dir,'--config',cfg])).exit,0);const args=['resume','--dir',dir,'--actor','hero'],input='{"op":"query"}\n';
 for(const name of ['genesis.json','signing-key.pem','ready.json','world.sqlite']){const path=join(dir,name),backup=path+'.original';await rename(path,backup);await symlink(backup,path);await rejectedRun(args,input);await rm(path);await rename(backup,path);}
 for(const name of ['genesis.json','signing-key.pem','ready.json','world.sqlite']){const path=join(dir,name);await chmod(path,0o644);await rejectedRun(args,input);await chmod(path,0o600);}
 await chmod(dir,0o755);await rejectedRun(args,input);await chmod(dir,0o700);
 const db=join(dir,'world.sqlite'),backup=db+'.original';await rename(db,backup);await rejectedRun(args,input);await assert.rejects(lstat(db),e=>e.code==='ENOENT');await rename(backup,db);
 const ready=join(dir,'ready.json'),saved=await readFile(ready);await writeFile(ready,JSON.stringify({version:'shared-world-local/0.1.0',genesis_hash:'f'.repeat(64)}));await rejectedRun(args,input);await writeFile(ready,saved);
 const target=join(parent,'sidecar-target');await writeFile(target,'do not touch',{mode:0o600});await symlink(target,db+'-wal');await rejectedRun(args,input);assert.equal(await readFile(target,'utf8'),'do not touch');await rm(db+'-wal');
 const alias=join(parent,'world-alias');await symlink(dir,alias);await rejectedRun(['resume','--dir',alias,'--actor','hero'],input);
 assert.equal((await run(args,input)).rows[0].query.cursor.sequence,0);
});

test('CLI incomplete/unknown/oversized inputs refuse while independent lines continue and no world is overwritten',async t=>{
 const parent=await dirFor(t,'argo-host-input-'),cfg=join(parent,'config.json'),dir=join(parent,'world');await writeFile(cfg,JSON.stringify({...config,seed:'a'.repeat(64)}),{mode:0o600});await rejectedRun(['init','--dir',dir,'--config',cfg]);await assert.rejects(lstat(dir),e=>e.code==='ENOENT');await writeFile(cfg,JSON.stringify(config));await run(['init','--dir',dir,'--config',cfg]);
 const args=['resume','--dir',dir,'--actor','hero'];const result=await run(args,'{bad json}\n{"op":"query","principal":"host"}\n{"op":"query"}\n');assert.equal(result.exit,1);assert.deepEqual(result.rows.map(r=>r.type),['error','error','query']);assert.equal(result.rows[2].query.cursor.sequence,0);
 await rejectedRun(args,'x'.repeat(1024*1024+1));const marker=join(dir,'ready.json');await rm(marker);await rejectedRun(args,'{"op":"query"}\n');await rejectedRun(['init','--dir',dir,'--config',cfg]);assert.equal((await readdir(dir)).includes('ready.json'),false);
 const broken=join(parent,'broken');await symlink(join(parent,'absent'),broken);await rejectedRun(['init','--dir',broken,'--config',cfg]);assert.equal((await lstat(broken)).isSymbolicLink(),true);
});
