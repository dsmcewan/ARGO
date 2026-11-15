// Independent ordinary-process probes. Do not execute before immutable release.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,appendFile,chmod,stat,lstat,symlink,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fork,execFile} from 'node:child_process';
import {promisify} from 'node:util';

const [checkoutArg,expectedSha,outputArg]=process.argv.slice(2);
if(!checkoutArg||!expectedSha||!outputArg)throw Error('Usage: node probes.mjs CHECKOUT IMMUTABLE_SHA OUTPUT_DIR');
assert.equal(process.env.NODE_TEST_CONTEXT,undefined,'Run as an ordinary Node process, outside node --test');
const root=resolve(checkoutArg),out=resolve(outputArg),exec=promisify(execFile);
const git=async(...args)=>(await exec('git',['-C',root,...args])).stdout.trim();
const before={sha:await git('rev-parse','HEAD'),status:await git('status','--porcelain')};
assert.equal(before.sha,expectedSha);assert.equal(before.status,'');
await mkdir(out,{recursive:true,mode:0o700});const scratch=await mkdtemp(join(out,'private-probes-'));await chmod(scratch,0o700);
const load=p=>import(pathToFileURL(join(root,p)).href);
const api=await load('packages/session/src/index.ts');
const ledgerApi=await load('packages/ledger/src/index.ts');
const contracts=await load('packages/contracts/src/index.ts');
const helpers=await load('TESTS/shared-world-rules-helpers.ts');
assert.equal(typeof api.openWorldConversationStore,'function');assert.equal(typeof api.createWorldConversation,'function');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const canonical=contracts.canonical;
const checks=[];
const policy={provider_policy_id:'independent-store-review/1',generation_mode:'offline_fixture',candidates:[{vendor:'xai',model:'grok-4.7',pool:'review_offline'}],effort:'low',timeout_ms:10000,max_context_bytes:32768,max_output_tokens:256};
const response=text=>({id:'independent_offline_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text})}]}]});
const reject=async fn=>assert.rejects(fn,e=>{assert.equal(typeof e?.code,'string');return true;});
async function check(name,fn){if(process.env.ARGO_REVIEW_GROUP&&!name.includes(process.env.ARGO_REVIEW_GROUP))return;try{checks.push({name,status:'pass',details:await fn()});console.log('PASS '+name);}catch(e){checks.push({name,status:'fail',error:String(e),stack:e.stack});console.log('FAIL '+name+': '+String(e));}}
async function fixture(name){
 const directory=join(scratch,name);await mkdir(directory,{mode:0o700});
 const keys=generateKeyPairSync('ed25519'),genesis=helpers.genesis();genesis.mortal.authority_public_key=keys.publicKey.export({format:'pem',type:'spki'}).toString();
 const player=helpers.principal(genesis,'hero'),npc=helpers.principal(genesis,'raider');
 const options={path:join(directory,'turns.sqlite'),mode:'create',genesis,player,npc,policy:structuredClone(policy)};
 const ledger=await ledgerApi.openWorldLedger({path:join(directory,'world.sqlite'),genesis,privateKey:keys.privateKey});
 const resources=[];
 const store=async(overrides={})=>{const s=await api.openWorldConversationStore({...options,...overrides});resources.push(s);return s;};
 const host=(s,invoke=async()=>response('Fixture response.'))=>{const h=api.createWorldConversation({store:s,ledger,model:{clientFor:()=>({responses:{create:invoke}})}});resources.unshift(h);return h;};
 return {directory,keys,genesis,player,npc,options,ledger,store,host,async close(){for(const resource of resources)await resource.close().catch(()=>{});await ledger.close().catch(()=>{});}};
}
function sql(path,operation){const db=new DatabaseSync(path);try{return operation(db);}finally{db.close();}}
const row=path=>sql(path,db=>{const r=db.prepare('SELECT * FROM conversation_turns ORDER BY turn_id').all();return r.map(x=>({...x,decoded:JSON.parse(x.row_json)}));});
async function waitEvent(child,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Child '+name+' timeout')),15000);const onMessage=m=>{if(m?.type===name){clearTimeout(timer);child.off('message',onMessage);resolve(m);}};child.on('message',onMessage);child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('Child exited '+code));});});}
function child(config){const c=fork(join(dirname(fileURLToPath(import.meta.url)),'process-racer.mjs'),[root,expectedSha,config],{stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,NODE_TEST_CONTEXT:undefined}});let errors='';c.stderr.on('data',b=>{errors=(errors+b).slice(-16384);});return {process:c,errors:()=>errors};}
try{
 await check('private explicit create/open and no replacement on existing or missing stores',async()=>{
  const f=await fixture('create-open');try{
   await reject(()=>f.store({mode:'open'}));await assert.rejects(lstat(f.options.path),e=>e.code==='ENOENT');
   const s=await f.store();assert.deepEqual(Object.keys(s).sort(),['binding','close']);assert.ok(Object.isFrozen(s.binding));
   assert.equal((await stat(f.options.path)).mode&0o777,0o600);const expected=canonical(s.binding);await s.close();
   const digest=sha256(await readFile(f.options.path));await reject(()=>f.store());assert.equal(sha256(await readFile(f.options.path)),digest);
   const reopened=await f.store({mode:'open'});assert.equal(canonical(reopened.binding),expected);return {mode:0o600,binding:sha256(expected)};
  }finally{await f.close();}
 });
 await check('path grammar, unsafe permissions, symlinks and unsafe sidecars refuse before use',async()=>{
  const f=await fixture('paths');try{
   for(const path of [':memory:','file:review.sqlite',join(f.directory,'missing','turns.sqlite'),'relative.sqlite'])await reject(()=>f.store({path}));
   const unsafe=join(f.directory,'unsafe');await mkdir(unsafe,{mode:0o755});await chmod(unsafe,0o755);await reject(()=>f.store({path:join(unsafe,'turns.sqlite')}));
   const s=await f.store();await s.close();await chmod(f.options.path,0o644);await reject(()=>f.store({mode:'open'}));await chmod(f.options.path,0o600);
   const alias=join(f.directory,'alias.sqlite');await symlink(f.options.path,alias);await reject(()=>f.store({path:alias,mode:'open'}));
   const dirAlias=join(scratch,'directory-alias');await symlink(f.directory,dirAlias);await reject(()=>f.store({path:join(dirAlias,'turns.sqlite'),mode:'open'}));
   for(const suffix of ['-wal','-shm']){const side=f.options.path+suffix;await writeFile(side,'unsafe',{mode:0o644});await chmod(side,0o644);await reject(()=>f.store({mode:'open'}));await rm(side);const target=join(f.directory,'target'+suffix);await writeFile(target,'unchanged',{mode:0o600});await symlink(target,side);await reject(()=>f.store({mode:'open'}));assert.equal(await readFile(target,'utf8'),'unchanged');await rm(side);}
  }finally{await f.close();}
 });
 await check('foreign SQLite file and every full world/player/policy binding mismatch refuse',async()=>{
  const f=await fixture('binding');try{
   const foreign=join(f.directory,'foreign.sqlite');await writeFile(foreign,'',{mode:0o600});sql(foreign,db=>db.exec('CREATE TABLE foreign_data(value TEXT); INSERT INTO foreign_data VALUES (\'retain\')'));
   const bytes=sha256(await readFile(foreign));await reject(()=>f.store({path:foreign,mode:'open'}));assert.equal(sha256(await readFile(foreign)),bytes);
   const s=await f.store();await s.close();
   const changed=structuredClone(f.genesis);changed.profiles[0].nature.description='Changed immutable genesis';
   for(const change of [{genesis:changed},{player:helpers.principal(f.genesis,'companion')},{policy:{...policy,provider_policy_id:'different'}},{policy:{...policy,timeout_ms:3000}},{policy:{...policy,candidates:[{...policy.candidates[0],pool:'different'}]}}])await reject(()=>f.store({mode:'open',...change}));
   await reject(()=>f.store({mode:'open',npc:{...f.npc,principal_id:'impostor'}}));
   assert.equal(sql(f.options.path,db=>db.prepare('SELECT COUNT(*) n FROM conversation_turns').get().n),0);
  }finally{await f.close();}
 });
 await check('opaque registration and passive constructor/input data never execute traps',async()=>{
  const f=await fixture('passive');try{
   const s=await f.store();let traps=0;const model={clientFor:()=>({responses:{create:async()=>response(null)}})};
   for(const store of [Object.freeze({...s}),Object.freeze({binding:s.binding,close:async()=>{}})])assert.throws(()=>api.createWorldConversation({store,ledger:f.ledger,model}));
   const hostile={...f.options};Object.defineProperty(hostile,'policy',{enumerable:true,get(){traps++;throw Error('getter');}});await reject(()=>api.openWorldConversationStore(hostile));
   const h=f.host(s),input={turn_id:'trap',get text(){traps++;throw Error('getter');}};await reject(()=>h.turn(input));assert.equal(traps,0);assert.equal(row(f.options.path).length,0);
  }finally{await f.close();}
 });
 await check('same-file two-handle CAS preserves one attempt and cancelled tombstone',async()=>{
  const f=await fixture('two-handles');let release;try{
   const a=await f.store(),b=await f.store({mode:'open'});let calls=0,startedResolve;const started=new Promise(r=>{startedResolve=r;}),held=new Promise(r=>{release=r;});
   const first=f.host(a,async()=>{calls++;startedResolve();await held;return response('Late fixture text');}),second=f.host(b,async()=>{calls++;return response('Duplicate should not run');});
   const pending=first.turn({turn_id:'same_turn',text:'Please answer once.'});pending.catch(()=>{});let startTimer;try{await Promise.race([started,pending.then(()=>{throw Error('Turn completed before model start');}),new Promise((_,reject)=>{startTimer=setTimeout(()=>reject(Error('Model callback did not start')),15000);})]);}finally{clearTimeout(startTimer);}
   const claimed=row(f.options.path)[0].decoded;assert.equal(claimed.phase,'generating');assert.ok(claimed.attempt);const attempt=canonical(claimed.attempt);
   await second.turn({turn_id:'same_turn',text:'Please answer once.'});assert.equal(calls,1);
   const cancelled=await second.cancel({turn_id:'same_turn'});assert.equal(cancelled.cancel_requested,true);const fenced=row(f.options.path)[0].decoded;assert.ok(fenced.revision>claimed.revision);assert.equal(canonical(fenced.attempt),attempt);
   release();await pending;const after=row(f.options.path)[0].decoded;assert.equal(after.cancel_requested,true);assert.equal(canonical(after.attempt),attempt);assert.equal(after.reply_command,null);
   await reject(()=>second.turn({turn_id:'same_turn',text:'Changed identity'}));await second.read({turn_id:'same_turn'});await second.resume({turn_id:'same_turn'});assert.equal(calls,1);
   assert.throws(()=>sql(f.options.path,db=>db.exec('DELETE FROM conversation_turns')));assert.equal((await f.ledger.snapshot()).cursor.sequence,1);return {calls,revision_before:claimed.revision,revision_after:after.revision};
  }finally{release?.();await f.close();}
 });
 await check('same canonical outbox across two ordinary processes consumes one generation',async()=>{
  const f=await fixture('two-processes');const children=[];try{
   const s=await f.store();await s.close();await f.ledger.close();
   const config=join(f.directory,'process-config.json'),calls=join(f.directory,'calls.jsonl');
   await writeFile(config,JSON.stringify({options:{...f.options,mode:'open'},world_path:join(f.directory,'world.sqlite'),private_key:f.keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),calls}),{mode:0o600});
   const a=child(config),b=child(config);children.push(a,b);await Promise.all(children.map(c=>waitEvent(c.process,'ready')));const done=children.map(c=>waitEvent(c.process,'done'));for(const c of children)c.process.send({type:'start'});await Promise.all(done);
   const invocations=(await readFile(calls,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);assert.equal(invocations.length,1);
   const stored=row(f.options.path);assert.equal(stored.length,1);assert.equal(stored[0].decoded.phase,'settled');assert.equal(stored[0].decoded.terminal.outcome,'replied');assert.ok(stored[0].decoded.attempt);
   return {processes:2,generation_calls:invocations.length,phase:stored[0].decoded.phase};
  }finally{for(const [i,c] of children.entries()){await writeFile(join(out,'process-'+i+'.stderr'),c.errors());if(c.process.exitCode===null)c.process.kill();}await f.close();}
 });
 await check('silence tombstone survives close/reopen and read/resume never regenerate it',async()=>{
  const f=await fixture('silence');try{
   let calls=0;const s=await f.store(),h=f.host(s,async()=>{calls++;return response(null);});const result=await h.turn({turn_id:'silent',text:'You may remain silent.'});assert.equal(result.phase,'settled');assert.equal(result.outcome,'no_reply');await h.close();await s.close();
   const reopened=f.host(await f.store({mode:'open'}),async()=>{calls++;return response('Must not regenerate');});const saved=row(f.options.path)[0].decoded;for(const name of ['read','resume']){const r=await reopened[name]({turn_id:'silent'});assert.equal(r.outcome,'no_reply');assert.equal(r.delivery,null);}assert.equal(calls,1);assert.equal(canonical(row(f.options.path)[0].decoded.attempt),canonical(saved.attempt));
  }finally{await f.close();}
 });
 await check('external local corruption controls: closed row JSON, duplicate columns/hash and binding are checked on open/read',async()=>{
  // These deliberate owner-level SQL edits exercise corruption detection only;
  // the trusted local store does not authenticate adversarially rehashed history.
  for(const kind of ['row_json','row_hash','revision','phase','binding']){
   const f=await fixture('corrupt-'+kind);try{
    const s=await f.store(),h=f.host(s,async()=>response(null));await h.turn({turn_id:'corrupt',text:'A stored silent turn.'});await h.close();await s.close();
    sql(f.options.path,db=>{
     // Drop only triggers that prevent this deliberately out-of-band fixture edit.
     const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
     for(const t of triggers)db.exec('DROP TRIGGER "'+t.name.replaceAll('"','""')+'"');
     const r=db.prepare('SELECT * FROM conversation_turns').get();
     if(kind==='row_json'){const decoded=JSON.parse(r.row_json);decoded.unknown='forged';const text=canonical(decoded);db.prepare('UPDATE conversation_turns SET row_json=?,row_hash=?,row_bytes=?').run(text,sha256(text),Buffer.byteLength(text));}
     else if(kind==='row_hash')db.prepare('UPDATE conversation_turns SET row_hash=?').run('f'.repeat(64));
     else if(kind==='revision')db.prepare('UPDATE conversation_turns SET revision=revision+1').run();
     else if(kind==='phase')db.prepare('UPDATE conversation_turns SET phase=?').run('accepted');
     else db.prepare('UPDATE conversation_meta SET binding_hash=?').run('f'.repeat(64));
     for(const t of triggers)db.exec(t.sql);
    });
    await reject(()=>f.store({mode:'open'}));
   }finally{await f.close();}
  }
  return {classification:'Trusted-local corruption detection; not malicious-storage or rollback authentication'};
 });
}finally{
 const after={sha:await git('rev-parse','HEAD'),status:await git('status','--porcelain')};assert.deepEqual(after,before);
 const results={candidate:expectedSha,before,after,ordinary_process:true,paid_calls:0,checks,passed:checks.filter(c=>c.status==='pass').length,failed:checks.filter(c=>c.status==='fail').length,scope:'Independent public host/store tests; external SQL controls assume trusted local storage. Crash/COMMIT and private RPC source review are separate.'};
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(results,null,2));await rm(scratch,{recursive:true,force:true});process.exitCode=results.failed?1:0;
}
