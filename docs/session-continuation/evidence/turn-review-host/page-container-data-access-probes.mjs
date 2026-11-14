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
group('C_prefix_page_containers_reject_accessors_and_proxies_without_traps',()=>fixture(async f=>{
 let hostile=null,traps=0,thenReads=0,dataKeys=[];const wrapped={...f.a,events:async options=>hostile??f.a.events(options)};
 const h=f.host(f.s,wrapped,responseModel().model);await finish(h,'container',await h.turn({turn_id:'container',text:'Check the outer event page too.'}));
 const event=(await f.a.events({after:0,limit:1}))[0];
 const accessor=[];Object.defineProperty(accessor,'0',{enumerable:true,configurable:true,get(){traps++;throw Error('Accessor trap executed');}});
 hostile=accessor;await assert.rejects(async()=>h.read({turn_id:'container'}));const accessorTraps=traps;
 traps=0;hostile=new Proxy([event],{get(target,key,receiver){if(key==='then')thenReads++;else{traps++;dataKeys.push(String(key));}return Reflect.get(target,key,receiver);}});
 await observed(h.read({turn_id:'container'}));const proxyTraps=traps;
 process.stdout.write('PAGE_TRAPS '+JSON.stringify({accessorTraps,proxyDataTraps:proxyTraps,thenReads,dataKeys})+'\n');
 assert.deepEqual({accessorTraps,proxyTraps},{accessorTraps:0,proxyTraps:0},'Prefix page DTO container executed active code before rejecting it');
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
