// Independent ordinary-process host controls. Never invokes node:test or a provider SDK.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, chmod, open as openFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash, generateKeyPairSync, createPrivateKey} from 'node:crypto';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

const args = process.argv.slice(2);
function arg(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const root = resolve(arg('--root', ''));
const childDir = arg('--child');
const exec = promisify(execFile);
const git = async (...argv) => (await exec('git', ['-C', root, ...argv])).stdout.trim();
const expected = arg('--expected-sha');
if (!childDir) {
  assert(expected && /^[0-9a-f]{40}$/.test(expected), 'Pass exact immutable --expected-sha');
  assert.equal(await git('rev-parse', 'HEAD'), expected);
  assert.equal(await git('status', '--porcelain'), '', 'Candidate must be clean');
  assert.equal(process.env.NODE_TEST_CONTEXT, undefined, 'Run as an ordinary Node process');
}
const load = relative => import(pathToFileURL(join(root, relative)).href);
const [sessions, ledgerAPI, contracts, fixtures] = await Promise.all([
  load('packages/session/src/index.ts'), load('packages/ledger/src/index.ts'),
  load('packages/contracts/src/index.ts'), load('TESTS/shared-world-rules-helpers.ts'),
]);
for (const name of ['openWorldConversationStore', 'createWorldConversation', 'createWorldSession']) {
  assert.equal(typeof sessions[name], 'function', `Missing frozen public API ${name}`);
}
const {openWorldConversationStore, createWorldConversation, createWorldSession} = sessions;
const {openWorldLedger, initialWorldState, createWorldEvent} = ledgerAPI;
const {ArgoError, canonical, hash} = contracts;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function latch() { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; }
async function bounded(promise, ms = 5000, message = 'Probe operation did not finish') {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error(message)), ms);})]); }
  finally { clearTimeout(timer); }
}
const observed = promise => Promise.resolve(promise).then(value => ({ok:true, value}), error => ({ok:false, code:error?.code, error}));
function providerResponse(text) { return {id:'independent_offline_fixture', status:'completed', output:[{type:'message', content:[{type:'output_text', text:JSON.stringify({text})}]}]}; }
const policy = extra => ({provider_policy_id:'independent_host_review_v1', generation_mode:'offline_fixture',
  candidates:[{vendor:'xai', model:'grok-4.7', pool:'offline_only'}], effort:'low', timeout_ms:2000,
  max_context_bytes:32768, max_output_tokens:800, ...extra});
function principal(g, id) { return fixtures.principal(g, id); }
function savedRow(path, turn) {
  const db = new DatabaseSync(path, {readOnly:true});
  try { const row = db.prepare('SELECT row_json FROM conversation_turns WHERE turn_id=?').get(turn); return row ? JSON.parse(row.row_json) : null; }
  finally { db.close(); }
}
function responseModel(fn = async () => providerResponse('I heard your question.')) {
  const evidence = {calls:0, contexts:[], requests:[]};
  return {evidence, model:{clientFor(candidate, context) {
    assert.equal(candidate.pool, 'offline_only');
    assert(Object.isFrozen(context), 'Per-turn callback metadata must be immutable');
    assert.deepEqual(Object.keys(context).sort(), ['attempt_id','binding_hash','turn_id']);
    assert.match(context.binding_hash, /^[0-9a-f]{64}$/);
    evidence.contexts.push(structuredClone(context));
    return {responses:{create:async request => {
      evidence.calls++; evidence.requests.push(structuredClone(request));
      return fn(request, context);
    }}};
  }}};
}
async function setup(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'argo-turn-host-review-'));
  await chmod(directory, 0o700);
  const keys = generateKeyPairSync('ed25519'), g = fixtures.genesis();
  g.mortal.authority_public_key = keys.publicKey.export({format:'pem',type:'spki'}).toString();
  g.profiles.find(p => p.actor_id === 'raider').nature.description = 'PRIVATE_NPC_NATURE_CANARY: deliberate and attentive.';
  const p = policy(options.policy), player = principal(g, 'hero'), npc = principal(g, 'raider');
  const worldPath = join(directory, 'world.sqlite'), outboxPath = join(directory, 'turns.sqlite');
  const handles = [], stores = [], hosts = [];
  const f = {directory, keys, g, policy:p, player, npc, worldPath, outboxPath, handles, stores, hosts};
  f.ledger = async () => { const h = await openWorldLedger({path:worldPath,genesis:g,privateKey:keys.privateKey}); handles.push(h); return h; };
  f.store = async (mode = 'open') => { const h = await openWorldConversationStore({path:outboxPath,mode,genesis:g,player,npc,policy:p}); stores.push(h); return h; };
  f.host = (store, ledger, model) => { const h = createWorldConversation({store,ledger,model}); hosts.push(h); return h; };
  f.session = (ledger, id = 'hero') => createWorldSession({genesis:g,ledger,principal:principal(g,id)});
  f.close = async () => {
    for (const h of hosts) await bounded(h.close(), 3000, 'Host close stalled').catch(() => {});
    for (const s of stores) await bounded(s.close(), 3000, 'Store close stalled').catch(() => {});
    for (const l of handles) await bounded(l.close(), 3000, 'Ledger close stalled').catch(() => {});
    await rm(directory, {recursive:true,force:true});
  };
  f.a = await f.ledger(); f.s = await f.store('create');
  return f;
}
async function fixture(fn, options) { const f = await setup(options); try { await fn(f); } finally { await f.close(); } }
async function finish(host, turn, first) {
  let value = first ?? await host.resume({turn_id:turn});
  for (let i = 0; i < 12 && value.phase !== 'settled'; i++) {
    if (value.phase === 'generating') await pause(10);
    value = await host.resume({turn_id:turn});
  }
  assert.equal(value.phase, 'settled', `Bounded normal turn did not settle: ${value.phase}`);
  return value;
}
async function append(f, action, id = 'hero', request = 'external_' + Math.random().toString(16).slice(2)) {
  const s = f.session(f.a, id); return s.submit(await s.prepare(action, request));
}
const activity = label => ({type:'set_activity', activity:{description:label,busy_until:0}});
function resultSafety(result) {
  assert.deepEqual(Object.keys(result).sort(), ['cancel_requested','delivery','generation_mode','input_receipt','outcome','phase','reply_receipt','revision','turn_id','version']);
  assert(!JSON.stringify(result).includes('PRIVATE_NPC_NATURE_CANARY'));
  assert.equal(result.generation_mode, 'offline_fixture');
}
function durableSubmit(f, real, transform) {
  return {...real, submit:async (command, principal) => {
    const db = new DatabaseSync(f.outboxPath, {readOnly:true}); let matching;
    try { matching = db.prepare('SELECT row_json FROM conversation_turns').all().map(r => JSON.parse(r.row_json)).find(r => (r.input_command?.request_id === command.request_id || r.reply_command?.request_id === command.request_id)); }
    finally { db.close(); }
    assert(matching, 'Command dispatched before its durable outbox row existed');
    const input = command.actor_id === 'hero';
    assert.equal(matching.phase, input ? 'input_pending' : 'reply_pending');
    assert.deepEqual(input ? matching.input_command : matching.reply_command, command, 'Dispatched command differs from saved bytes');
    return transform(command, principal, real);
  }};
}

if (childDir) {
  const config = JSON.parse(await readFile(join(childDir,'child-config.json'),'utf8'));
  const privateKey = createPrivateKey(await readFile(join(childDir,'child-key.pem'),'utf8'));
  const ledger = await openWorldLedger({path:join(childDir,'world.sqlite'),genesis:config.genesis,privateKey});
  const store = await openWorldConversationStore({path:join(childDir,'turns.sqlite'),mode:'open',genesis:config.genesis,player:config.player,npc:config.npc,policy:config.policy});
  const model = responseModel(async (_request, context) => {
    await writeFile(join(childDir,'provider-entered.json'), JSON.stringify({context}), {mode:0o600});
    return new Promise(() => {});
  });
  const host = createWorldConversation({store,ledger,model:model.model});
  await host.turn({turn_id:'crash_attempt',text:'Please answer after my crash.'});
  throw Error('Crash fixture unexpectedly completed');
}

const groups=[];const group=(name,run)=>groups.push({name,run});

for(const actor of ['hero','raider'])for(const late of ['fulfill','reject'])group(`D_close_${actor}_pending_ack_${late}_fresh_recovery`,()=>fixture(async f=>{
 const entered=latch();let releaseAck,committed,exact;
 const ack=new Promise((resolve,reject)=>{releaseAck=()=>late==='fulfill'?resolve(committed):reject(new ArgoError('UNAVAILABLE','Late acknowledged transport failure'));});
 const model=responseModel();
 const wrapped=durableSubmit(f,f.a,async(c,p,l)=>{
  const receipt=await l.submit(c,p);
  if(c.actor_id===actor){committed=receipt;exact=structuredClone(c);entered.resolve();return ack;}
  return receipt;
 });
 const h=f.host(f.s,wrapped,model.model),running=observed(h.turn({turn_id:'recover_close',text:'A closed owner cannot discard this exact dispatch.'}));
 await bounded(entered.promise);const before=structuredClone(savedRow(f.outboxPath,'recover_close'));
 assert.equal(before.phase,actor==='hero'?'input_pending':'reply_pending');
 await bounded(h.close(),1000,'Host close waited for unresolved caller acknowledgment');await bounded(running,1000);
 const afterClose=structuredClone(savedRow(f.outboxPath,'recover_close'));assert.deepEqual(afterClose,before,'Closing mutated unresolved dispatch intent');
 await f.s.close();
 const nextModel=responseModel(),store=await f.store(),ledger=await f.ledger(),next=f.host(store,ledger,nextModel.model);
 const result=await finish(next,'recover_close');assert.equal(result.outcome,'replied');assert.equal(result.cancel_requested,false);
 assert.deepEqual(actor==='hero'?result.input_receipt:result.reply_receipt,committed);
 assert.equal(nextModel.evidence.calls,actor==='hero'?1:0);assert.equal(model.evidence.calls,actor==='hero'?0:1);
 const events=await ledger.events();assert.equal(events.length,2);assert.deepEqual(events.find(e=>e.command.request_id===exact.request_id).command,exact);
 const settled=structuredClone(savedRow(f.outboxPath,'recover_close'));releaseAck();await pause(30);
 assert.deepEqual(savedRow(f.outboxPath,'recover_close'),settled,'Late acknowledgment advanced a closed host');
 assert.equal((await f.a.snapshot()).cursor.sequence,2,'Host closed caller-owned ledger');
}));

group('E_original_ledger_descriptor_validation_and_receiver_binding',()=>fixture(async f=>{
 let traps=0;const m=responseModel();
 const accessor={...f.a};Object.defineProperty(accessor,'snapshot',{enumerable:true,get(){traps++;throw Error('snapshot getter');}});
 assert.throws(()=>createWorldConversation({store:f.s,ledger:accessor,model:m.model}));
 const proxy=new Proxy(f.a,{get(){traps++;throw Error('ledger proxy get');},getOwnPropertyDescriptor(){traps++;throw Error('ledger proxy descriptor');}});
 assert.throws(()=>createWorldConversation({store:f.s,ledger:proxy,model:m.model}));
 const inherited=Object.create(f.a);assert.throws(()=>createWorldConversation({store:f.s,ledger:inherited,model:m.model}));assert.equal(traps,0);
 let calls=0;const original={
  snapshot(){assert.strictEqual(this,original);calls++;return f.a.snapshot();},
  events(options){assert.strictEqual(this,original);calls++;return f.a.events(options);},
  submit(command,principal){assert.strictEqual(this,original);calls++;return f.a.submit(command,principal);},
  close(){throw Error('Conversation must never close original ledger');}
 };
 const h=f.host(f.s,original,m.model);original.snapshot=()=>{throw Error('Methods were not captured');};original.submit=()=>{throw Error('Methods were not captured');};
 const r=await finish(h,'descriptors',await h.turn({turn_id:'descriptors',text:'Use the original validated capability methods.'}));assert.equal(r.outcome,'replied');assert(calls>0);await h.close();assert.equal((await f.a.snapshot()).cursor.sequence,2);
}));

group('F_cache_identity_stable_across_turns_restart_and_partitions',()=>fixture(async f=>{
 const model=responseModel(),h=f.host(f.s,f.a,model.model);
 for(const id of ['cache_first','cache_second'])await finish(h,id,await h.turn({turn_id:id,text:'A separate contextual exchange '+id}));
 const first=model.evidence.requests[0].prompt_cache_key;assert.equal(typeof first,'string');assert(first);
 assert.equal(model.evidence.requests[1].prompt_cache_key,first,'Different turn ID unnecessarily invalidated the binding cache key');
 assert.notEqual(model.evidence.contexts[0].turn_id,model.evidence.contexts[1].turn_id);assert.notEqual(model.evidence.contexts[0].attempt_id,model.evidence.contexts[1].attempt_id);
 for(const request of model.evidence.requests){assert.equal(request.previous_response_id,undefined);assert.equal(request.input.length,1);}
 await h.close();await f.s.close();const restart=responseModel(),reopened=f.host(await f.store(),f.a,restart.model);
 await finish(reopened,'cache_restart',await reopened.turn({turn_id:'cache_restart',text:'The same binding after reopening.'}));assert.equal(restart.evidence.requests[0].prompt_cache_key,first);
 for(const [label,player,p] of [['policy',f.player,{...f.policy,provider_policy_id:'different_policy_v2'}],['player',principal(f.g,'companion'),f.policy]]){
  const store=await openWorldConversationStore({path:join(f.directory,'turns_'+label+'.sqlite'),mode:'create',genesis:f.g,player,npc:f.npc,policy:p});f.stores.push(store);
  const changed=responseModel(),other=f.host(store,f.a,changed.model);await finish(other,'cache_first',await other.turn({turn_id:'cache_first',text:'Same external turn ID under another full binding.'}));
  assert.notEqual(changed.evidence.requests[0].prompt_cache_key,first,'Cache identity crossed '+label+' binding');
  assert.equal(changed.evidence.requests[0].previous_response_id,undefined);assert.equal(changed.evidence.requests[0].input.length,1);
 }
}));

group('G_close_during_held_prefix_read_detaches_and_consumes_late_failure',()=>fixture(async f=>{
 let block=false,rejectPage;const entered=latch(),page=new Promise((_,reject)=>{rejectPage=reject;});
 const wrapped={...f.a,events:options=>{if(block){entered.resolve();return page;}return f.a.events(options);}};
 const h=f.host(f.s,wrapped,responseModel().model);await finish(h,'prefix_close',await h.turn({turn_id:'prefix_close',text:'Close an external read without losing the turn.'}));
 block=true;const reading=observed(h.read({turn_id:'prefix_close'}));await bounded(entered.promise);
 await bounded(h.close(),1000);await bounded(reading);await f.s.close();rejectPage(new ArgoError('UNAVAILABLE','Late prefix transport failure'));await pause(20);
 const other=f.host(await f.store(),await f.ledger(),responseModel().model),r=await other.read({turn_id:'prefix_close'});assert(r.delivery);assert.equal(r.outcome,'replied');
}));
const reportPath=resolve(arg('--report',join(process.cwd(),'host-probe-results.json'))),only=arg('--only');
const results=[];let fatal;
const watchdog=setTimeout(()=>{process.stderr.write('Independent host probe watchdog expired\n');process.exit(124);},180000);
for(const g of groups.filter(g=>!only||g.name.includes(only))){
  const started=Date.now();try{await g.run();results.push({name:g.name,passed:true,elapsed_ms:Date.now()-started});process.stdout.write('PASS '+g.name+'\n');}
  catch(error){results.push({name:g.name,passed:false,elapsed_ms:Date.now()-started,error:String(error?.stack??error)});process.stdout.write('FAIL '+g.name+' '+String(error?.message??error)+'\n');}
}
try {assert.equal(await git('rev-parse','HEAD'),expected);assert.equal(await git('status','--porcelain'),'');}
catch(error){fatal=String(error?.stack??error);}
clearTimeout(watchdog);
await mkdir(resolve(reportPath,'..'),{recursive:true});
await writeFile(reportPath,JSON.stringify({candidate:expected,node:process.version,ordinary_process:true,test_runner:false,paid_calls:0,
  probe_sha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,...(fatal?{fatal}:{}),
  limits:['Injected offline clients only. Not the full native application gate.','Private temporary worlds/keys are removed; evidence contains no signing keys.']},null,2)+'\n');
process.exitCode=fatal||results.some(r=>!r.passed)?1:0;
