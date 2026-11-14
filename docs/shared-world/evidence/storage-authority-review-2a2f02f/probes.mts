import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sign,verify,createPublicKey} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.ARGO_SW_ROOT??'/workspace/ARGO/.board/shared-world-storage/worktrees/SW-300-1-054041f70a';
const mod=async(p:string)=>import(pathToFileURL(`${root}/${p}`).href);
const {genesis,principal,command,speak,offer,accept}=await mod('TESTS/shared-world-rules-helpers.ts');
const {keys}=await mod('TESTS/mortal-fixtures.ts');
const {canonical,hash}=await mod('packages/contracts/src/index.ts');
const {worldRequestHash}=await mod('packages/contracts/src/shared-world.ts');
const {initialWorldState,worldStateHash,createWorldEvent,verifyWorldEvent,replayWorld,verifyWorldReceipt,openWorldLedger}=await mod('packages/ledger/src/world/index.ts');
const clone=(x:any)=>structuredClone(x),note={type:'speak',text:'Independent storage probe',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null};
const code=(wanted:string)=>(e:any)=>e?.code===wanted;
const trust=(g:any)=>({scope:g.mortal.scope,genesis_hash:hash(g),authority_key_id:g.mortal.authority_key_id,authority_public_key:g.mortal.authority_public_key});
function resignEvent(event:any){const {hash:_,signature:__,...body}=event;const signed={...body,signature:sign(null,Buffer.from(canonical({domain:'shared-world/0.1.0/event',event:body})),keys.privateKey).toString('base64')};return {...signed,hash:hash(signed)};}
function resignReceipt(receipt:any){const {signature:_,...body}=receipt;return {...body,signature:sign(null,Buffer.from(canonical({domain:'shared-world/0.1.0/receipt',receipt:body})),keys.privateKey).toString('base64')};}
async function setup(t:any){const dir=await mkdtemp('/tmp/argo-sw300-independent-'),path=join(dir,'world.sqlite'),g=genesis(),handles:any[]=[];t.after(async()=>{await Promise.all(handles.map(h=>h.close().catch(()=>{})));await rm(dir,{recursive:true,force:true});});const open=async(extra={})=>{const h=await openWorldLedger({path,genesis:g,privateKey:keys.privateKey,...extra});handles.push(h);return h;};return {dir,path,g,open};}
function sql(path:string,fn:(db:any)=>any){const db=new DatabaseSync(path);try{return fn(db);}finally{db.close();}}
const count=(path:string)=>sql(path,db=>Number(db.prepare('SELECT count(*) n FROM shared_world_v1_events').get().n));
async function submit(h:any,g:any,action:any,id='hero',request?:string){const s=await h.snapshot(),c=command(s,action,id,request),p=principal(g,id);return {c,p,receipt:await h.submit(c,p),state:await h.snapshot()};}

 test('independent signature and hash domains bind full event, principal, request, genesis and receipt',()=>{
 const g=genesis(),s=initialWorldState(g),c=command(s,note),p=principal(g),made=createWorldEvent(g,s,c,p,keys.privateKey);
 const {hash:eventHash,...signed}=made.event,{signature,...body}=signed;assert.equal(eventHash,hash(signed));assert.equal(verify(null,Buffer.from(canonical({domain:'shared-world/0.1.0/event',event:body})),createPublicKey(g.mortal.authority_public_key),Buffer.from(signature,'base64')),true);
 assert.equal(verify(null,Buffer.from(canonical(body)),createPublicKey(g.mortal.authority_public_key),Buffer.from(signature,'base64')),false);
 const {signature:receiptSig,...receiptBody}=made.receipt;assert.equal(verify(null,Buffer.from(canonical({domain:'shared-world/0.1.0/receipt',receipt:receiptBody})),keys.publicKey,Buffer.from(receiptSig,'base64')),true);
 assert.equal(made.receipt.request_hash,hash({domain:'shared-world/0.1.0/request',command:c,principal:p}));assert.equal(made.event.genesis_hash,hash(g));assert.equal(made.event.previous_hash,hash(g));assert.equal(made.receipt.cursor.head,made.event.hash);assert.equal(made.receipt.state_hash,worldStateHash(made.state));assert.equal('effects' in made.receipt,false);
 for(const change of [(x:any)=>x.profiles[0].nature.description+=' changed',(x:any)=>x.scenes[0].description+=' changed',(x:any)=>x.knowledge_catalog.entries[0].text+=' changed']){const other=clone(g);change(other);assert.throws(()=>verifyWorldEvent(other,s,made.event));}
 for(const field of Object.keys(p.scope)){const receipt=clone(made.receipt);receipt.scope[field]=field==='rights_lane'?'homebrew':receipt.scope[field]+'_other';assert.throws(()=>verifyWorldReceipt(receipt,trust(g)));}
});

test('valid authority signatures cannot legitimize false outcomes or unauthorized principals',()=>{
 const g=genesis(),s=initialWorldState(g),made=createWorldEvent(g,s,command(s,{type:'speak',text:'heard',audience:{kind:'room',addressed_actor_ids:[]},in_reply_to:null}),principal(g),keys.privateKey);
 const changes=[(e:any)=>e.memory.acquired_by.pop(),(e:any)=>e.memory.payload.text='not spoken',(e:any)=>e.after_hash='d'.repeat(64),(e:any)=>e.effects.push({kind:'world_time',actor_id:null,subject_id:null,amount:1}),(e:any)=>e.draws.push({index:0,purpose:'forged',sides:6,value:1}),(e:any)=>e.principal.principal_id='impostor',(e:any)=>e.command.expected.world_time++,(e:any)=>e.command.causation_id='e'.repeat(64)];
 for(const change of changes){const e=clone(made.event);change(e);const signed=resignEvent(e);assert.throws(()=>verifyWorldEvent(g,s,signed));assert.throws(()=>replayWorld(g,[signed]));}
 assert.deepEqual(verifyWorldEvent(g,s,made.event),made.state);
});

test('every mixed signed prefix replays deterministically and journal outputs cannot alias authority state',()=>{
 const g=genesis(),events:any[]=[];let state=initialWorldState(g);
 for(const [action,id] of [[note,'hero'],[offer('signed_loan',3000),'hero'],[{type:'mortal',action:{type:'wait',turns:1}},'remote']] as any){const made=createWorldEvent(g,state,command(state,action,id),principal(g,id),keys.privateKey);events.push(made.event);state=made.state;assert.equal(canonical(replayWorld(g,events)),canonical(state));}
 const accepted=createWorldEvent(g,state,command(state,accept(state),'companion'),principal(g,'companion'),keys.privateKey);events.push(accepted.event);state=accepted.state;assert.equal(state.physical.items.find((i:any)=>i.id==='lamp').owner_id,'companion');assert.equal(state.loans.length,1);assert.equal(state.cursor.world_time,600);assert.deepEqual(replayWorld(g,events),state);
 const saved=canonical(state);accepted.event.memory.acquired_by.length=0;accepted.receipt.cursor.world_time=999;assert.equal(canonical(state),saved);assert.throws(()=>replayWorld(g,events));
});

test('two writers race different loan outcomes; one commit wins and exact retries survive later closure/revocation',async t=>{
 const f=await setup(t),a=await f.open(),b=await f.open();const issued=await submit(a,f.g,offer('race',3000));const s=issued.state,c=command(s,accept(s),'companion','take'),p=principal(f.g,'companion'),withdraw=command(s,{type:'withdraw_loan_offer',offer_id:'race'},'hero','withdraw');
 const results=await Promise.allSettled([a.submit(c,p),b.submit(withdraw,principal(f.g))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&code('CONFLICT')(x.reason)).length,1);assert.equal(count(f.path),2);assert.deepEqual(await a.snapshot(),await b.snapshot());
 await submit(a,f.g,{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');await submit(a,f.g,{type:'close_mythic_engagement'},'host');assert.deepEqual(await b.submit(issued.c,issued.p),issued.receipt);assert.equal(count(f.path),4);
 await assert.rejects(b.submit(issued.c,{...issued.p,principal_id:'other'}),code('CONFLICT'));await assert.rejects(b.submit({...issued.c,action:note},issued.p),code('CONFLICT'));await a.close();await b.close();const reopened=await f.open();assert.deepEqual(await reopened.submit(issued.c,issued.p),issued.receipt);assert.equal(count(f.path),4);
});

test('simultaneous identical acceptance creates exactly one durable compound event and receipt',async t=>{
 const f=await setup(t);const [a,b]=await Promise.all([f.open(),f.open()]);const issued=await submit(a,f.g,offer('same_accept',3000));const c=command(issued.state,accept(issued.state),'companion','same_accept_request'),p=principal(f.g,'companion');const receipts=await Promise.all([a.submit(c,p),b.submit(clone(c),clone(p)),a.submit(clone(c),clone(p))]);assert.ok(receipts.every(r=>canonical(r)===canonical(receipts[0])));assert.equal(count(f.path),2);const s=await b.snapshot();assert.equal(s.loans.length,1);assert.equal(s.memories.filter((m:any)=>m.payload.type==='loan_accepted').length,1);assert.equal(s.physical.items.find((i:any)=>i.id==='lamp').owner_id,'companion');assert.deepEqual(replayWorld(f.g,await a.events()),s);
});

test('deferred constraint failure at COMMIT rolls back the inserted event and never publishes cache or request',async t=>{
 const f=await setup(t),a=await f.open(),issued=await submit(a,f.g,offer('commit_failure',3000)),before=issued.state,c=command(before,accept(before),'companion','after_insert'),p=principal(f.g,'companion');
 sql(f.path,db=>db.exec('CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_child(parent_id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER injected_commit_failure AFTER INSERT ON shared_world_v1_events BEGIN INSERT INTO commit_child(parent_id) VALUES(123); END;'));
 await assert.rejects(a.submit(c,p),code('UNAVAILABLE'));assert.equal(count(f.path),1);assert.equal(sql(f.path,db=>Number(db.prepare('SELECT count(*) n FROM commit_child').get().n)),0);assert.strictEqual(await a.snapshot(),before);assert.equal(before.loans.length,0);assert.equal(before.offers[0].status,'open');assert.equal(before.physical.items.find((i:any)=>i.id==='lamp').owner_id,'hero');
 sql(f.path,db=>db.exec('DROP TRIGGER injected_commit_failure; DROP TABLE commit_child; DROP TABLE commit_parent;'));const receipt=await a.submit(c,p);assert.equal(count(f.path),2);assert.deepEqual(await a.submit(c,p),receipt);await a.close();const b=await f.open();assert.equal((await b.snapshot()).loans.length,1);assert.deepEqual(await b.submit(c,p),receipt);
});

test('fully re-signed false-outcome database rows fail suffix replay without publishing a partial prefix',async t=>{
 const f=await setup(t),a=await f.open(),s=await a.snapshot(),c=command(s,note,'hero','signed_false'),p=principal(f.g),made=createWorldEvent(f.g,s,c,p,keys.privateKey);const bad=clone(made.event);bad.effects.push({kind:'world_time',actor_id:null,subject_id:null,amount:1});const event=resignEvent(bad),receipt=resignReceipt({...made.receipt,event_hash:event.hash,cursor:{...made.receipt.cursor,head:event.hash}});verifyWorldReceipt(receipt,trust(f.g));
 sql(f.path,db=>db.prepare('INSERT INTO shared_world_v1_events(sequence,event_hash,request_id,request_hash,event_json,receipt_json) VALUES(?,?,?,?,?,?)').run(1,event.hash,c.request_id,worldRequestHash(c,p),canonical(event),canonical(receipt)));
 await assert.rejects(a.snapshot(),code('CORRUPT_LEDGER'));await assert.rejects(f.open(),code('CORRUPT_LEDGER'));
 sql(f.path,db=>db.exec('DROP TRIGGER shared_world_v1_events_no_delete; DELETE FROM shared_world_v1_events; CREATE TRIGGER shared_world_v1_events_no_delete BEFORE DELETE ON shared_world_v1_events BEGIN SELECT RAISE(ABORT,\'Shared events are append-only\'); END;'));
 assert.strictEqual(await a.snapshot(),s);const good=await a.submit(c,p);assert.equal(count(f.path),1);assert.deepEqual(await a.submit(c,p),good);
});

test('independent external checkpoints include time; acknowledged rollback fails but unanchored restart remains explicit',async t=>{
 const f=await setup(t),a=await f.open(),first=await submit(a,f.g,note),second=await submit(a,f.g,{type:'mortal',action:{type:'wait',turns:1}}),third=await submit(a,f.g,note);assert.equal(third.receipt.cursor.world_time,600);
 const b=await f.open({expectedHead:first.receipt.cursor});assert.equal((await b.snapshot()).cursor.sequence,3);await b.close();for(const expectedHead of [{...second.receipt.cursor,world_time:0},{...second.receipt.cursor,head:'c'.repeat(64)},{...third.receipt.cursor,sequence:4}])await assert.rejects(f.open({expectedHead}),code('CORRUPT_LEDGER'));
 sql(f.path,db=>db.exec('DROP TRIGGER shared_world_v1_events_no_delete; DELETE FROM shared_world_v1_events WHERE sequence=3;'));
 await assert.rejects(a.snapshot(),code('CORRUPT_LEDGER'));await a.close();await assert.rejects(f.open({expectedHead:third.receipt.cursor}),code('CORRUPT_LEDGER'));const unanchored=await f.open();assert.equal((await unanchored.snapshot()).cursor.sequence,2);
});

test('lost acknowledgement after compound COMMIT reconciles original receipt without a second transfer',async t=>{
 const f=await setup(t),a=await f.open(),issued=await submit(a,f.g,offer('lost_ack',3000)),c=command(issued.state,accept(issued.state),'companion','lost_accept'),p=principal(f.g,'companion');let captured:any,termination:any;const original=Worker.prototype.emit;
 const mock=t.mock.method(Worker.prototype,'emit',function(this:Worker,event:any,...args:any[]){const reply=args[0];if(event==='message'&&reply?.ok&&reply.value?.request_id===c.request_id&&reply.value?.signature){captured=clone(reply.value);termination=this.terminate();return true;}return Reflect.apply(original,this,[event,...args]);});
 try{await assert.rejects(a.submit(c,p),code('UNAVAILABLE'));await termination;}finally{mock.mock.restore();}
 assert.ok(captured);assert.equal(count(f.path),2);const b=await f.open({expectedHead:issued.receipt.cursor});assert.deepEqual(await b.submit(c,p),captured);const s=await b.snapshot();assert.equal(s.loans.length,1);assert.equal(s.memories.filter((m:any)=>m.payload.type==='loan_accepted').length,1);assert.equal(s.physical.items.find((i:any)=>i.id==='lamp').owner_id,'companion');assert.equal(count(f.path),2);
});

test('foreign profile refusal preserves existing database bytes and journal mode',async t=>{
 const f=await setup(t);sql(f.path,db=>db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE legacy_world_meta(content TEXT); INSERT INTO legacy_world_meta VALUES (\'unchanged\');'));const before=await readFile(f.path);await assert.rejects(f.open(),code('CORRUPT_LEDGER'));assert.deepEqual(await readFile(f.path),before);assert.equal(sql(f.path,db=>db.prepare('PRAGMA journal_mode').get().journal_mode),'delete');
});
