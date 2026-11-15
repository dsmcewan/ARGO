// Authored presentation data, not canonical state or a ledger acquisition event.
// The caller must authenticate the host, pin source identities, persist activation
// and verify prefix membership. These guards prove binding and shape only.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {types as nodeTypes} from 'node:util';
import {Ajv2020} from 'ajv/dist/2020.js';
import legacy from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import characters from '../../../SYSTEMS/characters-v1/characters.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/dialogue-knowledge-v1/knowledge.schema.json' with {type:'json'};
import {assertScope,canonical,hash,fail} from './index.ts';
import {assertCharacterContract} from './characters.ts';
import type {CharacterActorQuery,CharacterCursor} from './character-types.ts';
import type {AuthoredKnowledgeContractMap,AuthoredKnowledgeSource,AuthoredSourceManifest,AuthoredSourceDocument,AuthoredLoanTerms,AuthoredKnowledgeEntry,AuthoredKnowledgeCatalog,TrustedKnowledgeIdentity,AuthoredKnowledgeActivation,AuthoredKnowledgeDisclosure,AuthoredKnowledgeRead,AuthoredKnowledgeView,DialogueSupplementV2} from './dialogue-knowledge-types.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function freeze<T>(value:T):T{if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export const authoredKnowledgeSchema=freeze(definition);
const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);ajv.addSchema(characters);ajv.addSchema(authoredKnowledgeSchema);
const validators=new Map(Object.keys(definition.$defs).map(name=>[name,ajv.compile({$ref:`${definition.$id}#/$defs/${name}`})]));

// Inspect descriptors before reads, including on exported composite guard inputs.
// Bounds apply to a complete argument, not separately to each nested record.
function passive(value:unknown):void{
 const active=new Set<object>();let nodes=0,bytes=0;
 function text(value:string):void{bytes+=Buffer.byteLength(value,'utf8');if(bytes>1048576)invalid('Authored knowledge data exceeds its byte bound');}
 function visit(value:unknown,depth:number):void{
  if(++nodes>30000||depth>32)invalid('Authored knowledge data exceeds its structural bound');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){text(value);return;}
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('Authored knowledge requires safe integers');return;}
  if(typeof value!=='object')invalid('Authored knowledge requires JSON data');
  if(nodeTypes.isProxy(value))invalid('Authored knowledge cannot contain proxies');
  if(active.has(value))invalid('Authored knowledge cannot contain cycles');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Authored knowledge requires plain data');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'))invalid('Authored knowledge cannot contain symbols');
  active.add(value);
  try{
   if(array){
    const length=descriptors.length;
    if(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1)invalid('Authored knowledge arrays must be dense and undecorated');
    for(let i=0;i<length.value;i++){const d=descriptors[String(i)];if(!d||!d.enumerable||!('value'in d))invalid('Authored knowledge contains an active array entry');visit(d.value,depth+1);}
   }else for(const key of keys as string[]){
    const d=descriptors[key];text(key);
    if(['__proto__','prototype','constructor'].includes(key)||!d||!d.enumerable||!('value'in d))invalid('Authored knowledge contains an unsafe property');
    visit(d.value,depth+1);
   }
  }finally{active.delete(value);}
 }
 visit(value,0);
}
function same(a:unknown,b:unknown,message:string):void{if(canonical(a)!==canonical(b))invalid(message);}
function unique(values:readonly string[],what:string):void{if(new Set(values).size!==values.length)invalid(`Duplicate ${what}`);}
function query(value:CharacterActorQuery):void{
 assertCharacterContract('CharacterActorQuery',value);
 if(!validators.get('Id')!(value.actor_id))invalid('Invalid authored knowledge query actor');
}
function cursor(value:CharacterCursor):void{assertCharacterContract('CharacterCursor',value);}
function prefix(acquired:CharacterCursor,current:CharacterCursor):void{
 cursor(acquired);cursor(current);
 if(acquired.sequence>current.sequence||acquired.world_time>current.world_time)invalid('Authored knowledge acquisition exceeds the query');
 if(acquired.sequence===current.sequence&&canonical(acquired)!==canonical(current))invalid('Equal-sequence acquisition must bind the exact cursor');
 // Earlier head ancestry is attested by the trusted disclosure issuer.
}
function source(value:AuthoredKnowledgeSource):void{if(value.locator.end_line<value.locator.start_line)invalid('Invalid authored source line interval');}
function sourceSet(values:AuthoredKnowledgeSource[]):void{
 unique(values.map(row=>row.source_id),'authored source identity');
 const documents=new Map<string,string>();
 for(const value of values){source(value);const prior=documents.get(value.document_path);if(prior!==undefined&&prior!==value.document_sha256)invalid('Authored sources disagree on document identity');documents.set(value.document_path,value.document_sha256);}
}
function terms(value:AuthoredLoanTerms):void{if(value.repair_cap_obols>value.replacement_value_obols)invalid('Authored repair cap exceeds replacement value');}
function entry(value:AuthoredKnowledgeEntry):void{
 terms(value.terms);
 if(value.validity.until_tick!==null&&value.validity.until_tick<=value.validity.from_tick)invalid('Authored policy validity must be a nonempty half-open interval');
}
function entries(values:AuthoredKnowledgeEntry[]):void{unique(values.map(row=>row.knowledge_id),'authored knowledge identity');for(const value of values)entry(value);}
function activation(value:AuthoredKnowledgeActivation):void{assertScope(value.scope);cursor(value.acquired_at);}
function disclosure(value:AuthoredKnowledgeDisclosure):void{query(value.query);}
function read(value:AuthoredKnowledgeRead):void{
 query(value.query);
 if(value.activation!==null){activation(value.activation);same(value.activation.scope,value.query.scope,'Authored activation scope differs from query');if(value.activation.owner_actor_id!==value.query.actor_id)invalid('Authored activation owner differs from query');prefix(value.activation.acquired_at,value.query.cursor);}
 if(value.disclosure!==null){disclosure(value.disclosure);same(value.disclosure.query,value.query,'Authored disclosure differs from exact query');}
}
function atQuery(value:AuthoredKnowledgeEntry,q:CharacterActorQuery):void{
 if(value.owner_actor_id!==q.actor_id)invalid('Authored policy belongs to a different actor');
 if(value.validity.from_tick>q.cursor.world_time||value.validity.until_tick!==null&&q.cursor.world_time>=value.validity.until_tick)invalid('Authored policy is outside its validity interval');
}
function view(value:AuthoredKnowledgeView):void{
 query(value.query);prefix(value.activation.acquired_at,value.query.cursor);entries(value.claims);sourceSet(value.source_definitions);
 const allowed=new Set(value.source_definitions.map(row=>row.source_id)),referenced=new Set<string>();
 for(const claim of value.claims){atQuery(claim,value.query);for(const id of claim.provenance.source_ids){if(!allowed.has(id))invalid('Authored view source is missing');referenced.add(id);}}
 if(referenced.size!==allowed.size)invalid('Authored view includes unreferenced source metadata');
}
function supplement(value:DialogueSupplementV2):void{
 query(value.query);
 if(value.actor!==null&&value.actor.actor_id!==value.query.actor_id)invalid('Dialogue supplement actor differs from query');
 if(value.actor_knowledge!==null){view(value.actor_knowledge);same(value.actor_knowledge.query,value.query,'Authored knowledge differs from dialogue query');if(value.actor_knowledge.source.pack_hash!==value.source.content_hash)invalid('Authored knowledge differs from dialogue pack');}
}

/** Shape and internal invariants only. This never authenticates host authority. */
export function assertAuthoredKnowledgeContract<K extends keyof AuthoredKnowledgeContractMap>(name:K,value:unknown):asserts value is AuthoredKnowledgeContractMap[K]{
 passive(value);const validate=typeof name==='string'?validators.get(name):undefined;
 if(!validate||!validate(value))invalid('Invalid authored knowledge contract');
 switch(name){
 case 'AuthoredKnowledgeSource':source(value as AuthoredKnowledgeSource);break;
 case 'AuthoredSourceManifest':sourceSet((value as AuthoredSourceManifest).sources);break;
 case 'AuthoredLoanTerms':terms(value as AuthoredLoanTerms);break;
 case 'AuthoredKnowledgeEntry':entry(value as AuthoredKnowledgeEntry);break;
 case 'AuthoredKnowledgeCatalog':entries((value as AuthoredKnowledgeCatalog).entries);break;
 case 'AuthoredKnowledgeActivation':activation(value as AuthoredKnowledgeActivation);break;
 case 'AuthoredKnowledgeDisclosure':disclosure(value as AuthoredKnowledgeDisclosure);break;
 case 'AuthoredKnowledgeRead':read(value as AuthoredKnowledgeRead);break;
 case 'AuthoredKnowledgeView':view(value as AuthoredKnowledgeView);break;
 case 'DialogueSupplementV2':supplement(value as DialogueSupplementV2);break;
 }
}

/** Pins must come from trusted configuration or independently verified bytes. */
export function assertKnowledgeCatalogIdentity(catalog:AuthoredKnowledgeCatalog,manifest:AuthoredSourceManifest,pins:TrustedKnowledgeIdentity):void{
 assertAuthoredKnowledgeContract('AuthoredKnowledgeCatalog',catalog);assertAuthoredKnowledgeContract('AuthoredSourceManifest',manifest);assertAuthoredKnowledgeContract('TrustedKnowledgeIdentity',pins);
 if(hash(catalog)!==pins.catalog_hash||hash(manifest)!==pins.source_manifest_hash||catalog.pack_hash!==pins.pack_hash||catalog.source_manifest_hash!==pins.source_manifest_hash)invalid('Authored catalog does not match trusted content identities');
 const sources=new Set(manifest.sources.map(row=>row.source_id));
 for(const claim of catalog.entries)for(const id of claim.provenance.source_ids)if(!sources.has(id))invalid('Authored catalog references an unlisted source');
}
function activated(catalog:AuthoredKnowledgeCatalog,pins:TrustedKnowledgeIdentity,value:AuthoredKnowledgeActivation):void{
 if(value.catalog_hash!==pins.catalog_hash||value.source_manifest_hash!==pins.source_manifest_hash)invalid('Authored activation differs from trusted catalog');
 const rows=new Map(catalog.entries.map(row=>[row.knowledge_id,row]));
 for(const id of value.knowledge_ids){const row=rows.get(id);if(!row||row.owner_actor_id!==value.owner_actor_id)invalid('Authored activation selects unknown or foreign knowledge');}
}

/** Run once when registering; persist the checked binding rather than re-date it. */
export function assertKnowledgeActivationRegistration(catalog:AuthoredKnowledgeCatalog,manifest:AuthoredSourceManifest,pins:TrustedKnowledgeIdentity,value:AuthoredKnowledgeActivation,currentQuery:CharacterActorQuery):void{
 assertKnowledgeCatalogIdentity(catalog,manifest,pins);assertAuthoredKnowledgeContract('AuthoredKnowledgeActivation',value);passive(currentQuery);query(currentQuery);
 activated(catalog,pins,value);same(value.scope,currentQuery.scope,'Authored activation must use current scope');
 if(value.owner_actor_id!==currentQuery.actor_id)invalid('Authored activation must use current actor');
 same(value.acquired_at,currentQuery.cursor,'Authored activation cannot be backdated or staged in the future');
}

/** Validate host selection against immutable content and persisted activation. */
export function assertKnowledgeReadBinding(catalog:AuthoredKnowledgeCatalog,manifest:AuthoredSourceManifest,pins:TrustedKnowledgeIdentity,value:AuthoredKnowledgeRead):void{
 assertKnowledgeCatalogIdentity(catalog,manifest,pins);assertAuthoredKnowledgeContract('AuthoredKnowledgeRead',value);
 if(value.activation!==null)activated(catalog,pins,value.activation);
 const grant=value.disclosure;if(grant===null)return;
 if(grant.catalog_hash!==pins.catalog_hash||grant.source_manifest_hash!==pins.source_manifest_hash)invalid('Authored disclosure differs from trusted content');
 const rows=new Map(catalog.entries.map(row=>[row.knowledge_id,row]));
 for(const id of grant.knowledge_ids){const row=rows.get(id);if(!row)invalid('Authored disclosure selects unknown knowledge');atQuery(row,value.query);}
 if(value.activation===null)return;
 if(grant.activation_hash!==hash(value.activation))invalid('Authored disclosure differs from persisted activation');
 for(const id of grant.knowledge_ids)if(!value.activation.knowledge_ids.includes(id))invalid('Authored disclosure exceeds activation selection');
}

/** Certify an exact selected projection, never an arbitrary matching-hash claim. */
export function assertKnowledgeViewBinding(value:AuthoredKnowledgeView,catalog:AuthoredKnowledgeCatalog,manifest:AuthoredSourceManifest,pins:TrustedKnowledgeIdentity,binding:AuthoredKnowledgeRead):void{
 assertKnowledgeReadBinding(catalog,manifest,pins,binding);assertAuthoredKnowledgeContract('AuthoredKnowledgeView',value);
 const grant=binding.disclosure,activation=binding.activation;
 if(grant===null||activation===null||grant.knowledge_ids.length===0)invalid('Authored knowledge requires a selected host binding');
 const ids=new Set(grant.knowledge_ids),claims=catalog.entries.filter(row=>ids.has(row.knowledge_id));
 const sources=new Set(claims.flatMap(row=>row.provenance.source_ids));
 const expected:AuthoredKnowledgeView={version:'authored-knowledge-view/1.0.0',query:binding.query,source:pins,activation:{activation_id:activation.activation_id,activation_hash:hash(activation),acquired_at:activation.acquired_at},claims,source_definitions:manifest.sources.filter(row=>sources.has(row.source_id))};
 same(value,expected,'Authored view differs from the exact selected source projection');
}

/** Verify supplied UTF-8 document content; never open caller-selected paths. */
export function assertAuthoredSourceBytes(manifest:AuthoredSourceManifest,documents:AuthoredSourceDocument[],trustedManifestHash:string):void{
 assertAuthoredKnowledgeContract('AuthoredSourceManifest',manifest);passive(documents);
 if(typeof trustedManifestHash!=='string'||!validators.get('Hash')!(trustedManifestHash)||hash(manifest)!==trustedManifestHash)invalid('Authored source manifest differs from its trusted pin');
 if(!Array.isArray(documents)||documents.length<1||documents.length>32)invalid('Invalid authored source document collection');
 for(const document of documents)assertAuthoredKnowledgeContract('AuthoredSourceDocument',document);
 unique(documents.map(row=>row.document_path),'authored source document');
 const required=new Set(manifest.sources.map(row=>row.document_path));
 if(required.size!==documents.length||documents.some(row=>!required.has(row.document_path)))invalid('Authored source documents differ from the pinned allowlist');
 const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
 const checked=new Map(documents.map(row=>[row.document_path,{lines:row.content.split('\n'),digest:digest(row.content)}]));
 for(const source of manifest.sources){
  const document=checked.get(source.document_path)!;
  if(document.digest!==source.document_sha256||source.locator.end_line>document.lines.length)invalid('Authored source document does not match pinned bytes');
  if(digest(document.lines.slice(source.locator.start_line-1,source.locator.end_line).join('\n'))!==source.excerpt_sha256)invalid('Authored source excerpt does not match pinned bytes');
 }
}
