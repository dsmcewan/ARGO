import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';
import {ArgoError,canonical,hash} from '../packages/contracts/src/index.ts';
import type * as K from '../packages/contracts/src/dialogue-knowledge-types.ts';
import {characterActorQuery} from './character-fixtures.ts';
import {validateDialogueSupplement} from '../packages/interventions/src/dialogue-context.ts';
import schema from '../SYSTEMS/dialogue-knowledge-v1/knowledge.schema.json' with {type:'json'};
import pinnedSources from '../SYSTEMS/dialogue-knowledge-v1/authored-sources.json' with {type:'json'};
import legacy from '../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import characters from '../SYSTEMS/characters-v1/characters.schema.json' with {type:'json'};

interface API {
 assertAuthoredKnowledgeContract:(name:string,value:unknown)=>void;
 assertKnowledgeCatalogIdentity:(catalog:K.AuthoredKnowledgeCatalog,manifest:K.AuthoredSourceManifest,pins:K.TrustedKnowledgeIdentity)=>void;
 assertKnowledgeActivationRegistration:(catalog:K.AuthoredKnowledgeCatalog,manifest:K.AuthoredSourceManifest,pins:K.TrustedKnowledgeIdentity,activation:K.AuthoredKnowledgeActivation,query:ReturnType<typeof characterActorQuery>)=>void;
 assertKnowledgeReadBinding:(catalog:K.AuthoredKnowledgeCatalog,manifest:K.AuthoredSourceManifest,pins:K.TrustedKnowledgeIdentity,read:K.AuthoredKnowledgeRead)=>void;
 assertKnowledgeViewBinding:(view:K.AuthoredKnowledgeView,catalog:K.AuthoredKnowledgeCatalog,manifest:K.AuthoredSourceManifest,pins:K.TrustedKnowledgeIdentity,read:K.AuthoredKnowledgeRead)=>void;
 assertAuthoredSourceBytes:(manifest:K.AuthoredSourceManifest,documents:K.AuthoredSourceDocument[],trustedManifestHash:string)=>void;
}
const implementation=await import('../packages/contracts/src/dialogue-knowledge.ts').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&String(error.message).includes('dialogue-knowledge.ts'))return null;
 throw error;
});
function api():API {assert(implementation,'Authored knowledge contract guards must exist');return implementation as unknown as API;}
const invalid=(error:unknown)=>error instanceof ArgoError;
const bytesHash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const query={...characterActorQuery(),actor_id:'melia'},manifest=structuredClone(pinnedSources) as K.AuthoredSourceManifest;
 const entry:K.AuthoredKnowledgeEntry={knowledge_id:'melia_lamp',owner_actor_id:'melia',kind:'offer_policy',subject_item_id:'traveler_lamp',text:'The loan is free; an agreed repair cannot exceed five obols.',
  terms:{loan_fee_obols:0,advance_deposit_obols:0,replacement_value_obols:5,repair_basis:'actual_damage_by_explicit_agreement',repair_cap_obols:5,oil_supplied_by:'borrower',oil_price_obols:1,oil_duration_exploration_turns:6,return_checkpoint:'explicit_agreement_normally_next_harbor_return',compulsory_service:false,oath_required:false},
  validity:{from_tick:0,until_tick:null},provenance:{kind:'authored_actor_policy',source_ids:['quickstart_lamp_terms']},disclosure:'owner_context_may_express_in_addressed_speech'};
 const catalog:K.AuthoredKnowledgeCatalog={version:'authored-knowledge/1.0.0',catalog_id:'loan_policies',revision:'1',pack_hash:'c'.repeat(64),source_manifest_hash:hash(manifest),entries:[entry]};
 const pins:K.TrustedKnowledgeIdentity={pack_hash:catalog.pack_hash,catalog_hash:hash(catalog),source_manifest_hash:hash(manifest)};
 const activation:K.AuthoredKnowledgeActivation={version:'authored-knowledge-activation/1.0.0',activation_id:'melia_activation',scope:structuredClone(query.scope),owner_actor_id:'melia',catalog_hash:pins.catalog_hash,source_manifest_hash:pins.source_manifest_hash,acquired_at:{sequence:2,head:'b'.repeat(64),world_time:5},knowledge_ids:['melia_lamp']};
 const disclosure:K.AuthoredKnowledgeDisclosure={version:'authored-knowledge-disclosure/1.0.0',query:structuredClone(query),catalog_hash:pins.catalog_hash,source_manifest_hash:pins.source_manifest_hash,activation_hash:hash(activation),knowledge_ids:['melia_lamp'],basis:'host_current_entitlement_and_ancestor_membership'};
 const read:K.AuthoredKnowledgeRead={version:'authored-knowledge-read/1.0.0',query,activation,disclosure};
 const view:K.AuthoredKnowledgeView={version:'authored-knowledge-view/1.0.0',query:structuredClone(query),source:structuredClone(pins),activation:{activation_id:activation.activation_id,activation_hash:hash(activation),acquired_at:structuredClone(activation.acquired_at)},claims:[structuredClone(entry)],source_definitions:[structuredClone(manifest.sources.find(s=>s.source_id==='quickstart_lamp_terms')!)]};
 const supplement:K.DialogueSupplementV2={version:'character-dialogue/0.2.0',query:structuredClone(query),source:{content_hash:pins.pack_hash,revision:'tempting-fates-pack/0.1.0'},actor:{actor_id:'melia',name:'Melia',occupation:'Potter',wants:'Finish the lamp.',will_not:'Invent hidden debts.'},scene:{location_id:'l_harbor',name:'Harbor',description:'Stone walls and a burning brazier.'},actor_knowledge:view};
 return {query,manifest,entry,catalog,pins,activation,disclosure,read,view,supplement};
}
function repin(f:ReturnType<typeof fixture>){
 f.catalog.source_manifest_hash=hash(f.manifest);f.pins={pack_hash:f.catalog.pack_hash,catalog_hash:hash(f.catalog),source_manifest_hash:hash(f.manifest)};
 f.activation.catalog_hash=f.pins.catalog_hash;f.activation.source_manifest_hash=f.pins.source_manifest_hash;
 f.disclosure.catalog_hash=f.pins.catalog_hash;f.disclosure.source_manifest_hash=f.pins.source_manifest_hash;f.disclosure.activation_hash=hash(f.activation);
}

test('authored knowledge schemas are strict closed draft-2020 contracts',()=>{
 const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);ajv.addSchema(characters);assert.equal(ajv.validateSchema(schema),true);
 ajv.addSchema(schema);for(const name of Object.keys(schema.$defs))ajv.compile({$ref:schema.$id+'#/$defs/'+name});
 for(const value of Object.values(schema.$defs) as Record<string,unknown>[]){if(value.type==='object')assert.equal(value.additionalProperties,false);}
});

test('every public knowledge record validates and refuses missing or extra fields',()=>{
 const f=fixture(),records:Record<string,unknown>={AuthoredKnowledgeSource:f.manifest.sources[0],AuthoredSourceManifest:f.manifest,AuthoredSourceDocument:{document_path:'CAMPAIGNS/Tempting_Fates/QUICKSTART.md',content:'text'},AuthoredLoanTerms:f.entry.terms,AuthoredKnowledgeEntry:f.entry,AuthoredKnowledgeCatalog:f.catalog,TrustedKnowledgeIdentity:f.pins,AuthoredKnowledgeActivation:f.activation,AuthoredKnowledgeDisclosure:f.disclosure,AuthoredKnowledgeRead:f.read,AuthoredKnowledgeView:f.view,DialogueSupplementV2:f.supplement};
 for(const [name,value] of Object.entries(records)){
  api().assertAuthoredKnowledgeContract(name,value);
  for(const key of Object.keys(value as object)){const missing:any=structuredClone(value);delete missing[key];assert.throws(()=>api().assertAuthoredKnowledgeContract(name,missing),invalid,`${name}.${key}`);}
  const extra:any=structuredClone(value);extra.unreviewed_authority=true;assert.throws(()=>api().assertAuthoredKnowledgeContract(name,extra),invalid,name);
 }
});

test('trusted source and catalog identities bind both authored sources and the exact pack',()=>{
 const f=fixture();api().assertKnowledgeCatalogIdentity(f.catalog,f.manifest,f.pins);
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.catalog.entries[0]!.text='A fabricated fee';},
  (v:ReturnType<typeof fixture>)=>{v.manifest.sources[0]!.document_sha256='d'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{v.catalog.pack_hash='d'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{v.catalog.source_manifest_hash='d'.repeat(64);},
 ]){const changed=fixture();change(changed);assert.throws(()=>api().assertKnowledgeCatalogIdentity(changed.catalog,changed.manifest,changed.pins),invalid);}
 const unknown=fixture();unknown.catalog.entries[0]!.provenance.source_ids=['not_allowed'];repin(unknown);
 assert.throws(()=>api().assertKnowledgeCatalogIdentity(unknown.catalog,unknown.manifest,unknown.pins),invalid);
});

test('the pinned authored source manifest verifies actual document and exact excerpt bytes without file lookup',()=>{
 const manifest=structuredClone(pinnedSources) as K.AuthoredSourceManifest;
 const paths=[...new Set(manifest.sources.map(row=>row.document_path))];
 const documents=paths.map(document_path=>({document_path,content:readFileSync(new URL('../'+document_path,import.meta.url),'utf8')}));
 for(const source of manifest.sources){const document=documents.find(row=>row.document_path===source.document_path)!;assert.equal(bytesHash(document.content),source.document_sha256);assert.equal(bytesHash(document.content.split('\n').slice(source.locator.start_line-1,source.locator.end_line).join('\n')),source.excerpt_sha256);}
 api().assertAuthoredSourceBytes(manifest,documents,hash(manifest));
 const altered=structuredClone(documents);altered[0]!.content+='Changed later.';
 assert.throws(()=>api().assertAuthoredSourceBytes(manifest,altered,hash(manifest)),invalid);
 assert.throws(()=>api().assertAuthoredSourceBytes(manifest,documents.slice(1),hash(manifest)),invalid);
 assert.throws(()=>api().assertAuthoredSourceBytes(manifest,[...documents,documents[0]!],hash(manifest)),invalid);
 const forged=structuredClone(manifest);forged.sources[0]!.excerpt_sha256='f'.repeat(64);
 assert.throws(()=>api().assertAuthoredSourceBytes(forged,documents,hash(manifest)),invalid);
});

test('source references refuse traversal, URLs, inconsistent document identities and invalid line intervals',()=>{
 for(const path of ['../secret.md','/tmp/secret.md','https://example.test/source.md','CAMPAIGNS/../secret.md','CAMPAIGNS\\secret.md']){
  const source=structuredClone(pinnedSources.sources[0]!);source.document_path=path;assert.throws(()=>api().assertAuthoredKnowledgeContract('AuthoredKnowledgeSource',source),invalid);
 }
 const f=fixture();f.manifest.sources[0]!.locator.end_line=f.manifest.sources[0]!.locator.start_line-1;
 assert.throws(()=>api().assertAuthoredKnowledgeContract('AuthoredSourceManifest',f.manifest),invalid);
 const conflict=fixture();conflict.manifest.sources[1]!.document_sha256='f'.repeat(64);
 assert.throws(()=>api().assertAuthoredKnowledgeContract('AuthoredSourceManifest',conflict.manifest),invalid);
});

test('activation registration binds the current host query and refuses backdating',()=>{
 const f=fixture();f.activation.acquired_at=structuredClone(f.query.cursor);
 api().assertKnowledgeActivationRegistration(f.catalog,f.manifest,f.pins,f.activation,f.query);
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.activation.acquired_at.sequence--;},
  (v:ReturnType<typeof fixture>)=>{v.activation.acquired_at.world_time--;},
  (v:ReturnType<typeof fixture>)=>{v.activation.acquired_at.head='e'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{v.activation.owner_actor_id='dion';},
  (v:ReturnType<typeof fixture>)=>{v.activation.scope.branch_id='other';},
 ]){const changed=fixture();changed.activation.acquired_at=structuredClone(changed.query.cursor);change(changed);assert.throws(()=>api().assertKnowledgeActivationRegistration(changed.catalog,changed.manifest,changed.pins,changed.activation,changed.query),invalid);}
});

test('an exact current host disclosure permits only activation-selected owner knowledge',()=>{
 const f=fixture(),before=canonical(f);api().assertKnowledgeReadBinding(f.catalog,f.manifest,f.pins,f.read);api().assertKnowledgeViewBinding(f.view,f.catalog,f.manifest,f.pins,f.read);
 assert.equal(canonical(f),before);
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.disclosure.query.cursor.world_time--;},
  (v:ReturnType<typeof fixture>)=>{v.disclosure.query.actor_id='dion';},
  (v:ReturnType<typeof fixture>)=>{v.disclosure.query.scope.world_id='other';},
  (v:ReturnType<typeof fixture>)=>{v.disclosure.activation_hash='e'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{v.disclosure.catalog_hash='e'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{v.disclosure.source_manifest_hash='e'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{v.disclosure.knowledge_ids=['unknown'];},
 ]){const changed=fixture();change(changed);assert.throws(()=>api().assertKnowledgeReadBinding(changed.catalog,changed.manifest,changed.pins,changed.read),invalid);}
});

test('missing or unselected binding cannot certify a nonempty knowledge view',()=>{
 for(const shape of ['both_missing','activation_missing','grant_missing','unselected']){
  const f=fixture();
  if(shape==='both_missing'||shape==='activation_missing')f.read.activation=null;
  if(shape==='both_missing'||shape==='grant_missing')f.read.disclosure=null;
  if(shape==='unselected')f.disclosure.knowledge_ids=[];
  api().assertKnowledgeReadBinding(f.catalog,f.manifest,f.pins,f.read);
  assert.throws(()=>api().assertKnowledgeViewBinding(f.view,f.catalog,f.manifest,f.pins,f.read),invalid);
 }
});

test('acquisition is bounded by both sequence and time with exact equal-sequence heads',()=>{
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.activation.acquired_at.sequence=v.query.cursor.sequence+1;},
  (v:ReturnType<typeof fixture>)=>{v.activation.acquired_at.world_time=v.query.cursor.world_time+1;},
  (v:ReturnType<typeof fixture>)=>{v.activation.acquired_at.sequence=v.query.cursor.sequence;},
 ]){const f=fixture();change(f);f.disclosure.activation_hash=hash(f.activation);assert.throws(()=>api().assertKnowledgeReadBinding(f.catalog,f.manifest,f.pins,f.read),invalid);}
 const same=fixture();same.activation.acquired_at=structuredClone(same.query.cursor);same.disclosure.activation_hash=hash(same.activation);api().assertKnowledgeReadBinding(same.catalog,same.manifest,same.pins,same.read);
});

test('offer validity is half-open and never replaces acquisition time',()=>{
 for(const validity of [{from_tick:11,until_tick:null},{from_tick:0,until_tick:10},{from_tick:11,until_tick:10}]){
  const f=fixture();f.entry.validity=validity;repin(f);assert.throws(()=>api().assertKnowledgeReadBinding(f.catalog,f.manifest,f.pins,f.read),invalid);
 }
 const f=fixture();f.entry.validity={from_tick:10,until_tick:11};repin(f);api().assertKnowledgeReadBinding(f.catalog,f.manifest,f.pins,f.read);
});

test('cross-actor catalog selection fails even under a self-consistent disclosure hash',()=>{
 const f=fixture();f.entry.owner_actor_id='dion';repin(f);
 assert.throws(()=>api().assertKnowledgeReadBinding(f.catalog,f.manifest,f.pins,f.read),invalid);
 const unknown=fixture();unknown.activation.knowledge_ids=['missing'];unknown.disclosure.activation_hash=hash(unknown.activation);
 assert.throws(()=>api().assertKnowledgeReadBinding(unknown.catalog,unknown.manifest,unknown.pins,unknown.read),invalid);
});

test('views refuse changed policy text, unselected source metadata and foreign owners',()=>{
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.view.claims[0]!.terms.advance_deposit_obols=100;},
  (v:ReturnType<typeof fixture>)=>{v.view.claims[0]!.text='The traveler has already accepted.';},
  (v:ReturnType<typeof fixture>)=>{v.view.claims[0]!.owner_actor_id='dion';},
  (v:ReturnType<typeof fixture>)=>{v.view.source_definitions.push(v.manifest.sources[0]!);},
  (v:ReturnType<typeof fixture>)=>{v.view.activation.acquired_at.world_time=0;},
 ]){const f=fixture();change(f);assert.throws(()=>api().assertKnowledgeViewBinding(f.view,f.catalog,f.manifest,f.pins,f.read),invalid);}
});

test('dialogue 0.2 keeps authored claims in their owner lane with exact query and source binding',()=>{
 const f=fixture();api().assertAuthoredKnowledgeContract('DialogueSupplementV2',f.supplement);
 for(const change of [
  (v:ReturnType<typeof fixture>)=>{v.supplement.actor_knowledge!.query.cursor.world_time--;},
  (v:ReturnType<typeof fixture>)=>{v.supplement.actor_knowledge!.source.pack_hash='e'.repeat(64);},
  (v:ReturnType<typeof fixture>)=>{(v.supplement.scene as any).claims=v.view.claims;},
  (v:ReturnType<typeof fixture>)=>{(v.view.claims[0] as any).kind='canonical_fact';},
 ]){const changed=fixture();change(changed);assert.throws(()=>api().assertAuthoredKnowledgeContract('DialogueSupplementV2',changed.supplement),invalid);}
 f.supplement.actor_knowledge=null;api().assertAuthoredKnowledgeContract('DialogueSupplementV2',f.supplement);
});

test('old supplement 0.1 retains its exact shape without hidden knowledge injection',()=>{
 const f=fixture(),{actor_knowledge,...base}=f.supplement,old={...base,version:'character-dialogue/0.1.0'};
 assert.deepEqual(validateDialogueSupplement(old,f.query),old);
 assert.throws(()=>validateDialogueSupplement({...old,actor_knowledge},f.query),invalid);
});

test('contract guards reject active objects before any getter or proxy trap executes',()=>{
 let calls=0;const getter:any=fixture().catalog;
 Object.defineProperty(getter,'entries',{enumerable:true,get(){calls++;throw Error('Getter executed');}});
 assert.throws(()=>api().assertAuthoredKnowledgeContract('AuthoredKnowledgeCatalog',getter),invalid);
 const proxy=new Proxy(fixture().catalog,{ownKeys(){calls++;throw Error('Proxy executed');}}),revocable=Proxy.revocable(fixture().catalog,{});revocable.revoke();
 for(const value of [proxy,revocable.proxy])assert.throws(()=>api().assertAuthoredKnowledgeContract('AuthoredKnowledgeCatalog',value),invalid);
 assert.equal(calls,0);
});

test('closed bounded contracts reject unsafe identities, cycles, malformed lists and excessive Unicode text',()=>{
 for(const change of [
  (v:any)=>{v.entries[0].knowledge_id='melia_lamp\n';},(v:any)=>{v.entries[0].knowledge_id='constructor';},
  (v:any)=>{v.entries[0].text='𐀀'.repeat(2049);},(v:any)=>{v.entries[0].text=' ';},
  (v:any)=>{v.entries[0].terms.repair_cap_obols=6;},(v:any)=>{v.entries[0].terms.oil_price_obols=1.5;},
  (v:any)=>{v.entries[0].provenance.source_ids.push(v.entries[0].provenance.source_ids[0]);},
  (v:any)=>{v.entries.push(structuredClone(v.entries[0]));},(v:any)=>{delete v.entries[0];},
  (v:any)=>{v.cycle=v;},(v:any)=>{v.entries[0].text=()=>'';},
 ]){const value=fixture().catalog;change(value);assert.throws(()=>api().assertAuthoredKnowledgeContract('AuthoredKnowledgeCatalog',value),invalid);}
 const f=fixture();f.entry.text='𐀀'.repeat(2048);api().assertAuthoredKnowledgeContract('AuthoredKnowledgeCatalog',f.catalog);
});

test('historical campaign, character and authored knowledge contract bytes remain frozen',()=>{
 for(const manifestPath of ['scenarios/tempted-fates/campaign/FREEZE.json','SYSTEMS/characters-v1/FREEZE.json','SYSTEMS/dialogue-knowledge-v1/FREEZE.json']){
  const record=JSON.parse(readFileSync(new URL('../'+manifestPath,import.meta.url),'utf8')) as {files:Record<string,string>};
  for(const [path,wanted] of Object.entries(record.files))assert.equal(bytesHash(readFileSync(new URL('../'+path,import.meta.url))),wanted,path);
 }
});
