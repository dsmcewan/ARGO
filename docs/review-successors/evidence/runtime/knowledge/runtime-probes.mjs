import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';

const [rootArg,expectedCommit,outputArg]=process.argv.slice(2);
assert(rootArg&&/^[0-9a-f]{40}$/.test(expectedCommit??'')&&outputArg,'Supply candidate path, immutable SHA and output directory');
const root=resolve(rootArg),output=resolve(outputArg);
const execute=promisify(execFile);
const git=async(...args)=>(await execute('git',['-C',root,...args],{encoding:'utf8'})).stdout.trim();
assert.equal(await git('rev-parse','HEAD'),expectedCommit);
assert.equal(await git('status','--porcelain'),'','Review requires a clean immutable candidate');
await mkdir(output,{recursive:true});
const sha256=value=>createHash('sha256').update(value).digest('hex');
const require=createRequire(join(root,'package.json'));
const paths={};
async function publicModule(name){
 const path=require.resolve(name);
 assert(path.startsWith(root+'/'),'Public package resolved outside candidate: '+path);
 paths[name]={path:relative(root,path),sha256:sha256(await readFile(path))};
 return import(pathToFileURL(path));
}
const C=await publicModule('@argo/contracts');
const I=await publicModule('@argo/interventions');
const S=await publicModule('@argo/tempted-fates');
const M=await publicModule('@argo/model-client/request');
const required={
 contracts:['assertKnowledgeActivationRegistration','assertKnowledgeViewBinding','assertAuthoredSourceBytes','assertAuthoredKnowledgeContract','hash','canonical'],
 interventions:['createModelCharacterAgent'],
 scenario:['campaignKnowledgeCatalog','campaignKnowledgeSourceManifest','campaignKnowledgeIdentity','createCampaignKnowledgeActivation','buildCampaignKnowledgeView','buildCampaignKnowledgeDialogueSupplement','buildCampaignDialogueSupplement'],
};
for(const [key,api] of [['contracts',C],['interventions',I],['scenario',S]])for(const name of required[key])assert(name in api,`Missing public ${key} export ${name}`);

const pack=JSON.parse(await readFile(join(root,'scenarios/tempted-fates/campaign/world.json'),'utf8'));
const scope={tenant_id:'tenant',rights_lane:'homebrew',workspace_id:'workspace',workspace_tenant_id:'tenant:homebrew:workspace',campaign_id:'campaign',world_id:'world',branch_id:'main'};
const cursor={sequence:7,head:'a'.repeat(64),world_time:100};
const query=(actor_id='melia')=>({version:'character-memory/1.0.0',scope:structuredClone(scope),cursor:structuredClone(cursor),actor_id});
const knowledgeId='melia_lamp_loan_offer',incomingId='b'.repeat(64);
const expectedTerms={loan_fee_obols:0,advance_deposit_obols:0,replacement_value_obols:5,repair_basis:'actual_damage_by_explicit_agreement',repair_cap_obols:5,oil_supplied_by:'borrower',oil_price_obols:1,oil_duration_exploration_turns:6,return_checkpoint:'explicit_agreement_normally_next_harbor_return',compulsory_service:false,oath_required:false};
function binding(q=query()){
 const activation=S.createCampaignKnowledgeActivation(pack,q,'review_melia_offer',[knowledgeId]);
 return {version:'authored-knowledge-read/1.0.0',query:structuredClone(q),activation,disclosure:{version:'authored-knowledge-disclosure/1.0.0',query:structuredClone(q),catalog_hash:S.campaignKnowledgeIdentity.catalog_hash,source_manifest_hash:S.campaignKnowledgeIdentity.source_manifest_hash,activation_hash:C.hash(activation),knowledge_ids:[knowledgeId],basis:'host_current_entitlement_and_ancestor_membership'}};
}
function actorView(actor='melia'){
 const npc=pack.npcs.find(row=>row.id===actor);assert(npc);
 return {query:query(actor),profile:{actor_id:actor,revision:1,nature:structuredClone(npc.nature),activity:{description:npc.activity.description,busy_until:100},speech_policy:{max_characters:256,minimum_interval:1}},alive:true,last_spoke_at:null,impressions:[],experiences:[{record_id:incomingId,kind:'speech',actor_id:'traveler',principal_actor_id:'traveler',sequence:6,world_time:99,text:'What does borrowing your lamp cost, and when must I return it?',action_type:null,addressed_actor_ids:[actor]}],ontology_blocked:false,engagement_closed:false};
}
const closedError=error=>error instanceof C.ArgoError;
const complete=text=>({id:'review_fixture',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({text})}]}]});
function rig({actor='melia',supplement,invoke,count,session='knowledge_review'}={}){
 const view=actorView(actor),read=actor==='melia'?binding(view.query):{version:'authored-knowledge-read/1.0.0',query:view.query,activation:null,disclosure:null},requests=[];
 const agent=I.createModelCharacterAgent({scope:view.query.scope,actorId:actor,sessionId:session,candidates:[{vendor:count?'openai':'xai',model:count?'gpt-6-astra':'grok-4.7',pool:'review_only'}],refreshContext:async()=>structuredClone(view),readSupplement:async q=>supplement?supplement(q):S.buildCampaignKnowledgeDialogueSupplement(pack,read,{location_id:null}),clientFor:()=>({responses:{create:async request=>{requests.push(structuredClone(request));return invoke?invoke(request):complete('No fee or deposit. We agree the return before you take it.');}}}),...(count?{countTokensFor:()=>count}:{})});
 return {view,read,agent,requests,respond:()=>agent.respond(view.query,incomingId,'review_reply')};
}
function packet(request){
 const content=request.input[0].content;
 return JSON.parse(content.slice(content.lastIndexOf('\n\n')+2));
}
function strings(value){if(typeof value==='string')return [value];if(value&&typeof value==='object')return Object.values(value).flatMap(strings);return [];}
const checks=[];
async function check(name,run){try{await run();checks.push({name,result:'pass'});}catch(error){checks.push({name,result:'fail',error:String(error.stack??error)});}}
const captures={};

await check('fixed bundled identities authenticate exact source bytes and reject a changed source',async()=>{
 assert.equal(C.hash(pack),S.campaignKnowledgeIdentity.pack_hash);
 assert.equal(C.hash(S.campaignKnowledgeCatalog),S.campaignKnowledgeIdentity.catalog_hash);
 assert.equal(C.hash(S.campaignKnowledgeSourceManifest),S.campaignKnowledgeIdentity.source_manifest_hash);
 const documents=await Promise.all([...new Set(S.campaignKnowledgeSourceManifest.sources.map(row=>row.document_path))].map(async document_path=>({document_path,content:await readFile(join(root,document_path),'utf8')})));
 C.assertAuthoredSourceBytes(S.campaignKnowledgeSourceManifest,documents,S.campaignKnowledgeIdentity.source_manifest_hash);
 documents[0].content+='\n';
 assert.throws(()=>C.assertAuthoredSourceBytes(S.campaignKnowledgeSourceManifest,documents,S.campaignKnowledgeIdentity.source_manifest_hash),closedError);
});
await check('activation is detached, immutable and registered at the verified current cursor',()=>{
 const q=query(),original=C.canonical({pack,q}),read=binding(q);
 assert.deepEqual(read.activation.acquired_at,q.cursor);
 assert.notEqual(read.activation.acquired_at,q.cursor);
 assert(Object.isFrozen(read.activation)&&Object.isFrozen(read.activation.acquired_at));
 const changed=structuredClone(read.activation);changed.acquired_at={sequence:0,head:null,world_time:0};
 assert.throws(()=>C.assertKnowledgeActivationRegistration(S.campaignKnowledgeCatalog,S.campaignKnowledgeSourceManifest,S.campaignKnowledgeIdentity,changed,q),closedError);
 assert.equal(C.canonical({pack,q}),original);
});
await check('selected policy has exact terms and no event, accepted-loan or global-fact claim',()=>{
 const read=binding(),view=S.buildCampaignKnowledgeView(pack,read);
 C.assertKnowledgeViewBinding(view,S.campaignKnowledgeCatalog,S.campaignKnowledgeSourceManifest,S.campaignKnowledgeIdentity,read);
 assert.equal(view.claims.length,1);const claim=view.claims[0];
 assert.equal(claim.owner_actor_id,'melia');assert.equal(claim.kind,'offer_policy');assert.equal(claim.subject_item_id,'traveler_lamp');assert.equal(claim.provenance.kind,'authored_actor_policy');
 assert.deepEqual(claim.terms,expectedTerms);
 for(const key of ['accepted','source_event_id','custodian_id','debt'])assert.equal(Object.hasOwn(claim,key),false);
 assert.equal(view.source_definitions.length,3);
});
await check('missing and empty grants produce no knowledge, including for another NPC',()=>{
 for(const mode of ['both','activation','disclosure','empty']){
  const read=binding();if(mode==='both'||mode==='activation')read.activation=null;if(mode==='both'||mode==='disclosure')read.disclosure=null;if(mode==='empty')read.disclosure.knowledge_ids=[];
  assert.equal(S.buildCampaignKnowledgeView(pack,read),null);
 }
 assert.equal(S.buildCampaignKnowledgeView(pack,{version:'authored-knowledge-read/1.0.0',query:query('dion'),activation:null,disclosure:null}),null);
 assert.throws(()=>S.createCampaignKnowledgeActivation(pack,query('dion'),'foreign',[knowledgeId]),closedError);
});
await check('actor, world, branch, exact cursor and pinned identity mismatches are refused',()=>{
 const mutations=[
  value=>{value.query.actor_id='dion';},value=>{value.query.scope.world_id='other';},value=>{value.query.scope.branch_id='other';},
  value=>{value.disclosure.query.cursor.head='f'.repeat(64);},value=>{value.disclosure.query.cursor.world_time++;},
  value=>{value.disclosure.catalog_hash='f'.repeat(64);},value=>{value.disclosure.source_manifest_hash='f'.repeat(64);},value=>{value.disclosure.activation_hash='f'.repeat(64);},
  value=>{value.activation.acquired_at.sequence++;value.disclosure.activation_hash=C.hash(value.activation);},
  value=>{value.activation.acquired_at.world_time++;value.disclosure.activation_hash=C.hash(value.activation);},
  value=>{value.activation.acquired_at.head='f'.repeat(64);value.disclosure.activation_hash=C.hash(value.activation);},
 ];
 for(const mutate of mutations){const value=structuredClone(binding());mutate(value);assert.throws(()=>S.buildCampaignKnowledgeView(pack,value),closedError);}
 const read=binding();read.activation=null;read.disclosure.catalog_hash='f'.repeat(64);assert.throws(()=>S.buildCampaignKnowledgeView(pack,read),closedError);
});
await check('fixed helpers refuse attacker-chosen pack, catalog and pins',()=>{
 const changed=structuredClone(pack);changed.npcs.find(row=>row.id==='melia').wants='ATTACKER_POLICY';
 assert.throws(()=>S.buildCampaignKnowledgeView(changed,binding()),closedError);
 const read=binding();read.catalog={entries:[]};read.pins={pack_hash:C.hash(pack)};
 assert.throws(()=>S.buildCampaignKnowledgeView(pack,read),closedError);
 assert(Object.isFrozen(S.campaignKnowledgeCatalog)&&Object.isFrozen(S.campaignKnowledgeIdentity));
});
await check('shape validation does not claim to authenticate caller-selected knowledge',()=>{
 const read=binding(),forged=structuredClone(S.buildCampaignKnowledgeView(pack,read));forged.claims[0].terms.loan_fee_obols=77;
 C.assertAuthoredKnowledgeContract('AuthoredKnowledgeView',forged);
 assert.throws(()=>C.assertKnowledgeViewBinding(forged,S.campaignKnowledgeCatalog,S.campaignKnowledgeSourceManifest,S.campaignKnowledgeIdentity,read),closedError);
});
await check('hostile objects, oversized selections, sparse arrays and cycles are refused without effects',()=>{
 let traps=0;const read=binding(),active={...read};Object.defineProperty(active,'activation',{enumerable:true,get(){traps++;throw Error('getter ran');}});
 assert.throws(()=>S.buildCampaignKnowledgeView(pack,active),closedError);
 const proxy=new Proxy(read,{get(){traps++;throw Error('proxy ran');},ownKeys(){traps++;throw Error('proxy ran');}});
 assert.throws(()=>S.buildCampaignKnowledgeView(pack,proxy),closedError);
 const revoked=Proxy.revocable(read,{});revoked.revoke();assert.throws(()=>S.buildCampaignKnowledgeView(pack,revoked.proxy),closedError);
 assert.equal(traps,0);
 for(const ids of [Array(3),Array.from({length:65},(_,i)=>'id_'+i)])assert.throws(()=>S.createCampaignKnowledgeActivation(pack,query(),'oversized',ids),closedError);
 const cycle=binding();cycle.extra=cycle;assert.throws(()=>S.buildCampaignKnowledgeView(pack,cycle),closedError);
 const oversized=structuredClone(binding());oversized.activation.activation_id='x'.repeat(1048577);assert.throws(()=>S.buildCampaignKnowledgeView(pack,oversized),closedError);
});
await check('legacy 0.1 preserves its closed field set and an actual request contains no authored terms',async()=>{
 const old=S.buildCampaignDialogueSupplement(pack,query(),{location_id:null});
 assert.equal(old.version,'character-dialogue/0.1.0');assert.deepEqual(Object.keys(old).sort(),['actor','query','scene','source','version']);
 const r=rig({supplement:()=>old});assert.equal((await r.respond()).body.type,'speak');
 const body=packet(r.requests[0]);assert.equal(body.version,'character-dialogue/0.1.0');assert.equal(Object.hasOwn(body.supplement,'actor_knowledge'),false);
 captures.legacy=r.requests[0];
 const illegal={...old,actor_knowledge:null};const bad=rig({supplement:()=>illegal});await assert.rejects(bad.respond(),closedError);assert.equal(bad.requests.length,0);
});
await check('public model path sends exact Melia terms and no private pack, authority or narrator data',async()=>{
 const r=rig(),before=C.canonical({pack,view:r.view,read:r.read}),result=await r.respond();
 assert.equal(result.body.type,'speak');assert.equal(result.body.text,'No fee or deposit. We agree the return before you take it.');assert.equal(r.requests.length,1);
 const body=packet(r.requests[0]);assert.equal(body.version,'character-dialogue/0.2.0');assert.deepEqual(body.supplement.actor_knowledge.claims[0].terms,expectedTerms);
 assert.equal(body.supplement.actor_knowledge.claims[0].owner_actor_id,'melia');assert.equal(body.supplement.scene,null);
 const values=strings(body);
 for(const npc of pack.npcs)for(const secret of [...npc.private_knowledge,npc.speech_example])assert(!values.includes(secret),'Private/sample NPC content entered request');
 for(const location of pack.locations)assert(!values.includes(location.referee_notes),'Referee room content entered request');
 for(const variant of pack.variants)assert(!values.includes(variant.referee_truth),'Variant truth entered request');
 assert.equal(r.requests[0].tools,undefined);assert.equal(r.requests[0].input.length,1);
 assert.equal(C.canonical({pack,view:r.view,read:r.read}),before);
 captures.knowledge=r.requests[0];
});
await check('another NPC request cannot acquire Melia policy by sharing the campaign',async()=>{
 const r=rig({actor:'dion'});await r.respond();const body=packet(r.requests[0]);
 assert.equal(body.supplement.actor.actor_id,'dion');assert.equal(body.supplement.actor_knowledge,null);assert(!JSON.stringify(body).includes('melia_lamp_loan_offer'));
});
await check('cache scope distinguishes dialogue version 0.1 and 0.2',()=>{
 assert.notEqual(captures.legacy.prompt_cache_key,captures.knowledge.prompt_cache_key);
 const sessionId='npc:'+C.hash({session:'knowledge_review',actor_id:'melia',task:'speech'});
 assert.equal(captures.knowledge.prompt_cache_key,M.cacheKey({scope:{...scope,profile:'character-dialogue/0.2.0',actor_id:'melia',task:'speech'},sessionId,vendor:'xai',model:'grok-4.7'}));
});
await check('grant revocation during token counting prevents generation',async()=>{
 let revoked=false;const read=binding();
 const r=rig({count:async()=>{revoked=true;return 100;},supplement:()=>S.buildCampaignKnowledgeDialogueSupplement(pack,{...read,disclosure:revoked?null:read.disclosure},{location_id:null})});
 assert.equal(await r.respond(),null);assert.equal(r.requests.length,0);
});
await check('grant or content binding changes during generation suppress the proposed command',async()=>{
 for(const mode of ['grant','activation','catalog']){
  let changed=false;const original=binding();
  const r=rig({supplement:()=>{const read=structuredClone(original);if(changed&&mode==='grant')read.disclosure=null;if(changed&&mode==='activation'){read.activation.activation_id='new_binding';read.disclosure.activation_hash=C.hash(read.activation);}if(changed&&mode==='catalog')read.disclosure.catalog_hash='f'.repeat(64);return S.buildCampaignKnowledgeDialogueSupplement(pack,read,{location_id:null});},invoke:async()=>{changed=true;return complete('This stale offer must never be delivered.');}});
  assert.equal(await r.respond(),null);assert.equal(r.requests.length,1);
 }
});
await check('knowledge views outside validity or future acquisition fail before the model call',async()=>{
 for(const mutate of [value=>{value.actor_knowledge.activation.acquired_at.world_time=101;},value=>{value.actor_knowledge.claims[0].validity.from_tick=101;},value=>{value.actor_knowledge.claims[0].validity.until_tick=100;}]){
  const supplement=structuredClone(S.buildCampaignKnowledgeDialogueSupplement(pack,binding(),{location_id:null}));mutate(supplement);
  const r=rig({supplement:()=>supplement});await assert.rejects(r.respond(),closedError);assert.equal(r.requests.length,0);
 }
});

assert.equal(await git('rev-parse','HEAD'),expectedCommit,'Candidate moved during review');
assert.equal(await git('status','--porcelain'),'','Candidate changed during review');
const result={candidate:expectedCommit,public_modules:paths,public_exports:required,checks,passed:checks.filter(row=>row.result==='pass').length,failed:checks.filter(row=>row.result==='fail').length,live_provider_calls:0,authority_writes:0,limitations:['Fixtures exercise actual provider request construction with injected responses; no live model prose quality or latency result.','Host authentication, persisted activation and earlier-prefix ancestry are trusted integration obligations; JSON shape and hash matching do not prove them.']};
await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
for(const [name,request] of Object.entries(captures))await writeFile(join(output,name+'-request.json'),JSON.stringify(request,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(result.failed)process.exitCode=1;
