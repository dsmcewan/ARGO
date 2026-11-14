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
  process.stdout.write('child imports complete\n');
  const config = JSON.parse(await readFile(join(childDir,'child-config.json'),'utf8'));
  const privateKey = createPrivateKey(await readFile(join(childDir,'child-key.pem'),'utf8'));
  const ledger = await openWorldLedger({path:join(childDir,'world.sqlite'),genesis:config.genesis,privateKey});
  process.stdout.write('child journal opened\n');
  const store = await openWorldConversationStore({path:join(childDir,'turns.sqlite'),mode:'open',genesis:config.genesis,player:config.player,npc:config.npc,policy:config.policy});
  process.stdout.write('child outbox opened\n');
  const model = responseModel(async (_request, context) => {
    await writeFile(join(childDir,'provider-entered.json'), JSON.stringify({context}), {mode:0o600});
    return new Promise(() => {});
  });
  const host = createWorldConversation({store,ledger,model:model.model});
  await host.turn({turn_id:'crash_attempt',text:'Please answer after my crash.'});
  throw Error('Crash fixture unexpectedly completed');
}

const groups = [];
const group = (name, run) => groups.push({name,run});

group('01_context_exact_duplicate_and_restart', () => fixture(async f => {
  const m = responseModel(async (_r, c) => providerResponse('Actual injected answer for ' + c.turn_id));
  const before = await f.a.snapshot();
  const host = f.host(f.s, durableSubmit(f,f.a,(c,p,l) => l.submit(c,p)), m.model);
  const input = {turn_id:'first',text:'Could you answer this exact question?'};
  const result = await finish(host,'first',await host.turn(input)); resultSafety(result);
  assert.equal(result.outcome,'replied'); assert.equal(result.delivery.text,'Actual injected answer for first');
  assert.equal(m.evidence.calls,1); assert(JSON.stringify(m.evidence.requests[0]).includes(input.text));
  assert(JSON.stringify(m.evidence.requests[0]).includes('PRIVATE_NPC_NATURE_CANARY'));
  const events = await f.a.events(); assert.equal(events.length,2);
  assert.equal(events[0].principal.principal_id,f.player.principal_id); assert.equal(events[1].principal.principal_id,f.npc.principal_id);
  assert.deepEqual(events[1].command.action.audience,{kind:'whisper',addressed_actor_ids:['hero']});
  assert.equal(events[1].command.action.in_reply_to,events[0].memory.record_id);
  assert.deepEqual((await f.a.snapshot()).physical,before.physical);
  await append(f,activity('An unrelated later event'));
  const duplicate = await host.turn(input); assert.deepEqual(duplicate.reply_receipt,result.reply_receipt); assert.equal(m.evidence.calls,1);
  await assert.rejects(async()=>host.turn({...input,text:'Different text under the old identity'}));
  await host.close(); await f.s.close();
  const never = responseModel(async () => {throw Error('Restart invoked the model again');});
  const reopened = f.host(await f.store(),await f.ledger(),never.model), recovered = await reopened.resume({turn_id:'first'});
  assert.deepEqual(recovered.reply_receipt,result.reply_receipt); assert.equal(recovered.delivery.delivery_id,result.delivery.delivery_id);
  assert.equal(never.evidence.calls,0); assert.equal((await f.a.snapshot()).cursor.sequence,3);
}));

for (const actor of ['hero','raider']) group(`02_commit_then_bad_receipt_${actor}`, () => fixture(async f => {
  let bad = true; const sent = [], m = responseModel();
  const wrapper = durableSubmit(f,f.a,async (c,p,l) => {
    sent.push(structuredClone(c)); const receipt = await l.submit(c,p);
    return bad && c.actor_id === actor ? {...receipt,request_hash:'f'.repeat(64)} : receipt;
  });
  const host = f.host(f.s,wrapper,m.model);
  await observed(host.turn({turn_id:'bad_receipt',text:'Keep the exact request after a bad receipt.'}));
  const row = savedRow(f.outboxPath,'bad_receipt'); assert.equal(row.phase,actor === 'hero' ? 'input_pending' : 'reply_pending');
  assert.equal(row.terminal,null); assert.equal((await f.a.snapshot()).cursor.sequence,actor === 'hero' ? 1 : 2);
  const exact = structuredClone(actor === 'hero' ? row.input_command : row.reply_command);
  for (const c of sent.filter(c => c.actor_id === actor)) assert.deepEqual(c,exact);
  assert.equal(m.evidence.calls,actor === 'hero' ? 0 : 1);
  await append(f,activity('Later than the lost acknowledgment'));
  await host.close(); await f.s.close(); bad = false;
  const after = responseModel(), h = f.host(await f.store(),await f.ledger(),after.model);
  const result = await finish(h,'bad_receipt'); assert.equal(result.outcome,'replied');
  assert.equal(after.evidence.calls,actor === 'hero' ? 1 : 0);
  const events = await f.a.events(); assert.equal(events.filter(e => e.command.request_id === exact.request_id).length,1);
  assert.deepEqual(events.find(e => e.command.request_id === exact.request_id).command,exact);
}));

group('03_cancel_pending_intent_before_real_submit_then_reconcile', () => fixture(async f => {
  const seen = []; let blocked = true; const m = responseModel();
  const wrapper = durableSubmit(f,f.a,async(c,p,l) => {seen.push(structuredClone(c)); if(blocked)throw new ArgoError('UNAUTHORIZED','Injected pre-submit uncertainty'); return l.submit(c,p);});
  const host = f.host(f.s,wrapper,m.model);
  await observed(host.turn({turn_id:'pending_cancel',text:'This saved dispatch cannot be forgotten.'}));
  assert.equal(savedRow(f.outboxPath,'pending_cancel').phase,'input_pending');
  await observed(host.cancel({turn_id:'pending_cancel'})); assert.equal((await f.a.snapshot()).cursor.sequence,0);
  blocked = false;
  const result = await finish(host,'pending_cancel'); assert(result.cancel_requested); assert.equal(result.delivery,null);
  assert.equal(result.outcome,'cancelled'); assert.equal((await f.a.snapshot()).cursor.sequence,1); assert.equal(m.evidence.calls,0);
  for(const c of seen)assert.deepEqual(c,seen[0]);
}));

group('04_two_handles_one_attempt_and_waiter_abort', () => fixture(async f => {
  const entered=latch(),release=latch(),m=responseModel(async()=>{entered.resolve();await release.promise;return providerResponse('The single completed answer.');});
  const a=f.host(f.s,f.a,m.model),b=f.host(await f.store(),await f.ledger(),m.model);
  const first=observed(a.turn({turn_id:'concurrent',text:'Only one adapter invocation.'})); await bounded(entered.promise);
  const abort=new AbortController(),duplicate=observed(b.turn({turn_id:'concurrent',text:'Only one adapter invocation.'},{signal:abort.signal}));
  await pause(20);abort.abort();await bounded(duplicate);assert.equal(m.evidence.calls,1);assert.equal(savedRow(f.outboxPath,'concurrent').cancel_requested,false);
  const marker=structuredClone(savedRow(f.outboxPath,'concurrent').attempt);release.resolve();
  const initial=await bounded(first);assert(initial.ok);const result=await finish(a,'concurrent',initial.value);
  assert.equal(result.outcome,'replied');assert.equal(m.evidence.calls,1);assert.deepEqual(savedRow(f.outboxPath,'concurrent').attempt,marker);
  assert.equal((await f.a.snapshot()).cursor.sequence,2);
}));

group('05_durable_cancel_fences_ignored_cross_handle_late_output', () => fixture(async f => {
  const entered=latch(),release=latch(),m=responseModel(async()=>{entered.resolve();await release.promise;return providerResponse('LATE_CANCELLED_CANARY');});
  const a=f.host(f.s,f.a,m.model),b=f.host(await f.store(),await f.ledger(),m.model);
  const running=observed(a.turn({turn_id:'cancel',text:'Wait until I cancel.'}));await bounded(entered.promise);
  await b.cancel({turn_id:'cancel'});release.resolve();await bounded(running);
  const result=await finish(b,'cancel');assert(result.cancel_requested);assert.equal(result.delivery,null);assert.equal(result.outcome,'cancelled');
  assert.equal((await f.a.snapshot()).cursor.sequence,1);assert.equal(m.evidence.calls,1);
  await b.resume({turn_id:'cancel'});assert.equal(m.evidence.calls,1);assert(savedRow(f.outboxPath,'cancel').attempt);
}));

group('06_close_fences_local_generation_keeps_ledger_and_other_handle', () => fixture(async f => {
  const entered=latch(),release=latch(),m=responseModel(async()=>{entered.resolve();await release.promise;return providerResponse('LATE_CLOSED_CANARY');});
  const a=f.host(f.s,f.a,m.model),b=f.host(await f.store(),await f.ledger(),responseModel().model);
  const running=observed(a.turn({turn_id:'close',text:'Close this host while I wait.'}));await bounded(entered.promise);
  const deadline=savedRow(f.outboxPath,'close').attempt.deadline_at_ms;
  await bounded(a.close(),1000,'Host close waited for an abort-ignoring provider');
  assert.equal(savedRow(f.outboxPath,'close').cancel_requested,false,'Host close must not be durable cancellation');
  await append(f,activity('Ledger still belongs to its caller'));
  release.resolve();await bounded(running);
  if(Date.now()<=deadline)await pause(deadline-Date.now()+20);
  const result=await finish(b,'close');assert.equal(result.delivery,null);assert.notEqual(result.outcome,'replied');assert.equal(m.evidence.calls,1);
  assert.equal((await f.a.snapshot()).memories.filter(r=>r.actor_id==='raider'&&r.payload.type==='speak').length,0);
  const other=await finish(b,'other',await b.turn({turn_id:'other',text:'The other handle remains usable.'}));assert.equal(other.outcome,'replied');
},{policy:{timeout_ms:1000}}));

group('07_deadline_does_not_renew_or_accept_late_provider', () => fixture(async f => {
  const entered=latch(),release=latch(),m=responseModel(async()=>{entered.resolve();await release.promise;return providerResponse('EXPIRED_CANARY');});
  const h=f.host(f.s,f.a,m.model),running=observed(h.turn({turn_id:'deadline',text:'This attempt has a short deadline.'}));await bounded(entered.promise);
  const marker=structuredClone(savedRow(f.outboxPath,'deadline').attempt);await pause(Math.max(0,marker.deadline_at_ms-Date.now())+30);
  const before=await bounded(running);release.resolve();await pause(20);
  const result=await finish(h,'deadline',before.ok?before.value:undefined);assert.notEqual(result.outcome,'replied');assert.equal(result.delivery,null);
  for(let i=0;i<3;i++)await h.resume({turn_id:'deadline'});
  assert.equal(m.evidence.calls,1);assert.deepEqual(savedRow(f.outboxPath,'deadline').attempt,marker);assert.equal((await f.a.snapshot()).cursor.sequence,1);
},{policy:{timeout_ms:1000}}));

group('08_stale_generation_and_lock_free_world_writer', () => fixture(async f => {
  const entered=latch(),release=latch(),m=responseModel(async()=>{entered.resolve();await release.promise;return providerResponse('STALE_CANARY');});
  const h=f.host(f.s,f.a,m.model),running=observed(h.turn({turn_id:'stale',text:'A concurrent action will change this prefix.'}));await bounded(entered.promise);
  await bounded(append(f,activity('Another writer succeeded during generation')),1000,'Model held a world writer lock');
  release.resolve();const done=await bounded(running);assert(done.ok);const result=await finish(h,'stale',done.value);
  assert.equal(result.outcome,'no_reply');assert.equal(result.delivery,null);assert.equal(m.evidence.calls,1);assert.equal((await f.a.snapshot()).cursor.sequence,2);
}));

group('09_closure_after_reply_commit_before_delivery', () => fixture(async f => {
  let closed=false;const m=responseModel(async()=>providerResponse('CLOSED_DISCLOSURE_CANARY'));
  const wrapper=durableSubmit(f,f.a,async(c,p,l)=>{const receipt=await l.submit(c,p);if(c.actor_id==='raider'&&!closed){closed=true;await append(f,{type:'close_mythic_engagement'},'host','closure_after_reply');}return receipt;});
  const h=f.host(f.s,wrapper,m.model),r=await finish(h,'closure',await h.turn({turn_id:'closure',text:'Close after committing the response.'}));
  assert.equal(r.outcome,'replied');assert(r.reply_receipt);assert.equal(r.delivery,null);assert(!JSON.stringify(r).includes('CLOSED_DISCLOSURE_CANARY'));
  assert.equal((await f.a.snapshot()).cursor.sequence,3);assert.equal((await h.read({turn_id:'closure'})).delivery,null);
}));

group('10_player_eviction_while_npc_still_sees_reply', () => fixture(async f => {
  let evicted=false;const m=responseModel(async()=>providerResponse('NPC_ONLY_CACHED_TEXT_CANARY'));
  const wrapper=durableSubmit(f,f.a,async(c,p,l)=>{const receipt=await l.submit(c,p);if(c.actor_id==='raider'&&!evicted){evicted=true;for(let i=0;i<33;i++)await append(f,{type:'speak',text:'Player-private newer memory '+i,audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null},'hero','private_'+i);}return receipt;});
  const h=f.host(f.s,wrapper,m.model),r=await finish(h,'evict',await h.turn({turn_id:'evict',text:'This answer will leave my visible window.'}));
  const npc=f.session(f.a,'raider'),player=f.session(f.a),nv=await npc.view(await npc.query()),pv=await player.view(await player.query());
  assert(nv.memories.some(x=>x.payload.type==='speak'&&x.payload.text==='NPC_ONLY_CACHED_TEXT_CANARY'));
  assert(!pv.memories.some(x=>x.payload.type==='speak'&&x.payload.text==='NPC_ONLY_CACHED_TEXT_CANARY'));
  assert.equal(r.outcome,'replied');assert.equal(r.delivery,null);assert(!JSON.stringify(r).includes('NPC_ONLY_CACHED_TEXT_CANARY'));
  assert.equal((await h.read({turn_id:'evict'})).delivery,null);assert.equal(m.evidence.calls,1);
}));

group('11_cancellation_during_async_player_read_suppresses_delivery', () => fixture(async f => {
  const entered=latch(),release=latch();let gated=false,gate=false;
  const wrapped={...f.a,snapshot:async()=>{const state=await f.a.snapshot();if(gate&&!gated){gated=true;entered.resolve();await release.promise;}return state;}};
  const h=f.host(f.s,wrapped,responseModel().model),other=f.host(await f.store(),await f.ledger(),responseModel().model);
  const original=await finish(h,'read_cancel',await h.turn({turn_id:'read_cancel',text:'Cancel while a later read waits.'}));assert(original.delivery);
  gate=true;const reading=observed(h.read({turn_id:'read_cancel'}));await bounded(entered.promise);
  await other.cancel({turn_id:'read_cancel'});release.resolve();const r=await bounded(reading);assert(r.ok);assert.equal(r.value.delivery,null);
}));

group('12_silence_and_malformed_model_outputs_never_authorize_actions', async () => {
  for(const [name,output,outcome] of [
    ['silence',providerResponse(null),'no_reply'],
    ['extra_actor',{...providerResponse('x'),output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text:'x',actor_id:'hero'})}]}]},'generation_failed'],
    ['tool',{...providerResponse('x'),output:[{type:'function_call',name:'accept_loan',arguments:'{}',call_id:'forged'}]},'generation_failed'],
  ]) await fixture(async f=>{
    const m=responseModel(async()=>output),h=f.host(f.s,f.a,m.model),r=await finish(h,name,await h.turn({turn_id:name,text:'No mechanical authority from model output.'}));
    assert.equal(r.outcome,outcome);assert.equal(r.delivery,null);assert.equal(m.evidence.calls,1);assert.equal((await f.a.snapshot()).cursor.sequence,1);
    const state=await f.a.snapshot();assert.deepEqual(state.loans,[]);assert.deepEqual(state.offers,[]);
  });
});

group('13_passive_input_detachment_and_opaque_store_capability', () => fixture(async f => {
  let traps=0;const m=responseModel(),h=f.host(f.s,f.a,m.model);
  await assert.rejects(async()=>h.turn({turn_id:'getter',get text(){traps++;throw Error('getter executed');}}));
  await assert.rejects(async()=>h.turn(new Proxy({turn_id:'proxy',text:'hostile'},{ownKeys(){traps++;throw Error('proxy executed');}})));
  assert.equal(traps,0);assert.equal(m.evidence.calls,0);assert.equal((await f.a.snapshot()).cursor.sequence,0);
  assert.throws(()=>createWorldConversation({store:{binding:f.s.binding,close:async()=>{}},ledger:f.a,model:m.model}));
  const input={turn_id:'detached',text:'The original accepted text.'},pending=h.turn(input);input.text='MUTATED_AFTER_CALL';
  const result=await finish(h,'detached',await pending);assert.equal(result.outcome,'replied');
  assert.equal((await f.a.events())[0].command.action.text,'The original accepted text.');
}));

group('14_missing_or_foreign_receipt_prefix_refuses_cached_delivery', () => fixture(async f => {
  let replace=false;const wrapper={...f.a,events:async options=>replace?[]:f.a.events(options)};
  const h=f.host(f.s,wrapper,responseModel().model),r=await finish(h,'prefix',await h.turn({turn_id:'prefix',text:'Require my exact committed prefix.'}));assert(r.delivery);
  replace=true;await assert.rejects(async()=>h.read({turn_id:'prefix'}));await assert.rejects(async()=>h.resume({turn_id:'prefix'}));
  assert.equal((await f.a.snapshot()).cursor.sequence,2);
  replace=false;const prior=await f.a.events();
  const foreign=createWorldEvent(f.g,initialWorldState(f.g),{...prior[0].command,request_id:'valid_but_different',action:{...prior[0].command.action,text:'Another signed history.'}},f.player,f.keys.privateKey).event;
  const alternate={...f.a,events:async()=>[foreign]},other=f.host(await f.store(),alternate,responseModel().model);
  await assert.rejects(async()=>other.read({turn_id:'prefix'}));assert.equal((await f.a.snapshot()).cursor.sequence,2);
}));

group('15_crashed_process_permanent_attempt_never_regenerates', () => fixture(async f => {
  await f.s.close();await f.a.close();
  await writeFile(join(f.directory,'child-config.json'),JSON.stringify({genesis:f.g,player:f.player,npc:f.npc,policy:f.policy}),{mode:0o600});
  await writeFile(join(f.directory,'child-key.pem'),f.keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  const out=await openFile(join(f.directory,'child-out.log'),'wx',0o600),err=await openFile(join(f.directory,'child-err.log'),'wx',0o600);
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--root',root,'--child',f.directory],{stdio:['ignore',out.fd,err.fd],env:{...process.env,NODE_NO_WARNINGS:'1'}});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.on('error',()=>{});
  let waitActive=true;
  try {
    await bounded((async()=>{for(;waitActive;){try{await readFile(join(f.directory,'provider-entered.json'));return;}catch(e){if(e.code!=='ENOENT')throw e;}await pause(10);}})(),20000,'Child never entered injected provider');
    const marker=structuredClone(savedRow(f.outboxPath,'crash_attempt').attempt);
    child.kill('SIGKILL');const status=await bounded(exited);assert.equal(status.signal,'SIGKILL');
    const ledger=await f.ledger(),m=responseModel(async()=>{throw Error('Crashed attempt invoked provider again');});
    const h=f.host(await f.store(),ledger,m.model);let r=await h.resume({turn_id:'crash_attempt'});
    assert.equal(m.evidence.calls,0);
    if(Date.now()<=marker.deadline_at_ms)await pause(marker.deadline_at_ms-Date.now()+20);
    r=await finish(h,'crash_attempt',r.phase==='settled'?r:undefined);assert.equal(r.outcome,'generation_uncertain');assert.equal(r.delivery,null);
    assert.equal(m.evidence.calls,0);assert.deepEqual(savedRow(f.outboxPath,'crash_attempt').attempt,marker);assert.equal((await ledger.snapshot()).cursor.sequence,1);
  } catch(error) {
    const details={stdout:await readFile(join(f.directory,'child-out.log'),'utf8'),stderr:await readFile(join(f.directory,'child-err.log'),'utf8'),exit:await Promise.race([exited,pause(10).then(()=>null)])};
    throw new Error(String(error.message)+'; child diagnostics '+JSON.stringify(details));
  } finally {waitActive=false;child.kill('SIGKILL');await bounded(exited).catch(()=>{});await out.close();await err.close();}
},{policy:{timeout_ms:1000}}));

group('16_actual_journal_only_rollback_rejects_retained_receipt', () => fixture(async f => {
  const m=responseModel(),h=f.host(f.s,f.a,m.model),result=await finish(h,'rollback',await h.turn({turn_id:'rollback',text:'Retain the acknowledged signed prefix.'}));
  assert(result.reply_receipt);await h.close();await f.s.close();await f.a.close();
  const db=new DatabaseSync(f.worldPath);try{db.exec('DROP TRIGGER shared_world_v1_events_no_delete; DELETE FROM shared_world_v1_events WHERE sequence>=2;');}finally{db.close();}
  const ledger=await f.ledger();assert.equal((await ledger.snapshot()).cursor.sequence,1);
  const never=responseModel(async()=>{throw Error('Rollback started fresh generation');}),reopened=f.host(await f.store(),ledger,never.model);
  await assert.rejects(async()=>reopened.read({turn_id:'rollback'}));await assert.rejects(async()=>reopened.resume({turn_id:'rollback'}));
  assert.equal(never.evidence.calls,0);assert.equal((await ledger.snapshot()).cursor.sequence,1);
}));

group('17_saved_reply_stale_slot_proves_rejection_without_rebase', () => fixture(async f => {
  let raced=false;const m=responseModel(),sent=[];
  const wrapper=durableSubmit(f,f.a,async(c,p,l)=>{
    if(c.actor_id==='raider'){sent.push(structuredClone(c));if(!raced){raced=true;await append(f,activity('Occupy the exact pending reply slot'),'hero','occupied_reply_slot');}}
    return l.submit(c,p);
  });
  const h=f.host(f.s,wrapper,m.model),r=await finish(h,'rejected',await h.turn({turn_id:'rejected',text:'Do not rebase generated text after a racing commit.'}));
  assert.equal(r.outcome,'reply_rejected');assert.equal(r.delivery,null);assert.equal(r.reply_receipt,null);assert.equal(m.evidence.calls,1);
  const row=savedRow(f.outboxPath,'rejected');assert(row.terminal.rejection_proof);assert.deepEqual(row.reply_command,sent[0]);
  const events=await f.a.events();assert.equal(events.length,2);assert.equal(events[1].command.request_id,'occupied_reply_slot');
  await h.resume({turn_id:'rejected'});assert.equal(m.evidence.calls,1);assert.equal((await f.a.snapshot()).cursor.sequence,2);
}));

group('18_cancel_during_ignored_token_counter_has_no_provider_call', () => fixture(async f => {
  const entered=latch(),release=latch(),m=responseModel();let counters=0;
  m.model.countTokensFor=(_candidate,context)=>{assert(Object.isFrozen(context));return async()=>{counters++;entered.resolve();await release.promise;return 100;};};
  const h=f.host(f.s,f.a,m.model),other=f.host(await f.store(),await f.ledger(),responseModel().model);
  const running=observed(h.turn({turn_id:'count_cancel',text:'Cancel before counting completes.'}));await bounded(entered.promise);
  await other.cancel({turn_id:'count_cancel'});release.resolve();await bounded(running);
  const r=await finish(other,'count_cancel');assert(r.cancel_requested);assert.equal(r.delivery,null);assert.equal(m.evidence.calls,0);assert.equal(counters,1);
  assert.equal((await f.a.snapshot()).cursor.sequence,1);
},{policy:{candidates:[{vendor:'openai',model:'gpt-6-astra',pool:'offline_only'}]}}));

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
