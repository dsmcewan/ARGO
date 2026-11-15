import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ajv2020} from 'ajv/dist/2020.js';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as publicContracts from '../packages/contracts/src/index.ts';
import {ArgoError,assertContract,assertKnowledgeDisclosure,canonical,schemaDefinition} from '../packages/contracts/src/index.ts';
import type {KnowledgeQuery,KnowledgeView} from '../packages/contracts/src/generated.ts';
import type {ProjectionContractMap,ProjectionActorKnowledgeView} from '../packages/contracts/src/projection-generated.ts';
import type {ProjectionReadContext} from '../packages/contracts/src/projection-v2.ts';
import {
  projectionSchema,assertProjectionContract,validateActorQuery,validateCanonicalQuery,
  buildActorView,selectCanonicalRelations,adaptV1KnowledgeQuery,encodeIdEntries,
} from '../packages/contracts/src/projection-v2.ts';
import {
  HEAD_A,HEAD_B,EVENT_HASH,PRIVATE_SOURCE,projectionScope,prefix,checkpoint,readContext,readPolicy,
  actorQuery,canonicalQuery,claim,acquisition,relation,
} from './projection-fixtures.ts';

function refused(fn:()=>unknown,code?:string):void {
  assert.throws(fn,(error:unknown)=>error instanceof ArgoError && (code===undefined || error.code===code));
}
function assertDeepFrozen(value:unknown):void {
  if(value!==null&&typeof value==='object'){
    assert.equal(Object.isFrozen(value),true);
    for(const child of Object.values(value))assertDeepFrozen(child);
  }
}
function changed<T>(value:T,modify:(copy:T)=>void):T {const copy=structuredClone(value);modify(copy);return copy;}
function validView():ProjectionActorKnowledgeView {
  return {schema_version:'2.0.0',query:actorQuery(),policy_id:'policy_1',ontology_blocked:false,engagement_closed:false,
    claims:[{claim_id:'claim_a',channel:'belief',content:'visible',occurred_at_tick:15,acquired_at_tick:20,acquired_at_sequence:3}]};
}
const shapeAjv=new Ajv2020({allErrors:true,strict:true});
shapeAjv.addSchema(schemaDefinition);shapeAjv.addSchema(projectionSchema);
function shape(name:keyof ProjectionContractMap,value:unknown):boolean {
  return !!shapeAjv.compile({$ref:`https://argo.local/schemas/projection-v2.json#/$defs/${name}`})(value);
}

test('projection exports and generated consumer types share the additive public boundary',()=>{
  const exports={projectionSchema,assertProjectionContract,validateActorQuery,validateCanonicalQuery,
    buildActorView,selectCanonicalRelations,adaptV1KnowledgeQuery,encodeIdEntries};
  for(const [name,value] of Object.entries(exports))assert.equal(Reflect.get(publicContracts,name),value,name);
  const view:publicContracts.ProjectionActorKnowledgeView=buildActorView(actorQuery(),readContext(),[claim()],[acquisition()]);
  const context:publicContracts.ProjectionReadContext=readContext();
  assert.equal(view.query.checkpoint_id,context.checkpoint.checkpoint_id);
  assert.equal(projectionSchema.$id,'https://argo.local/schemas/projection-v2.json');
  assert.equal(projectionSchema.$schema,'https://json-schema.org/draft/2020-12/schema');
});

test('projection schema accepts each complete wire record and refuses every missing or extra named field',()=>{
  const examples:Partial<Record<keyof ProjectionContractMap,unknown>>={
    Prefix:prefix(),PlaneCursor:checkpoint().canonical,CommonCheckpoint:checkpoint(),
    SourceRef:{kind:'event',sequence:1,event_hash:EVENT_HASH},ObjectRef:{kind:'entity',entity_id:'donor'},
    CanonicalRelationVersion:relation(),EpistemicClaim:claim(),Acquisition:acquisition(),
    ActorKnowledgeQuery:actorQuery(),CanonicalHistoryQuery:canonicalQuery(),DisclosedClaim:validView().claims[0],
    ActorKnowledgeView:validView(),ReadPolicy:readPolicy(),IdEntries:[{id:'item_1',value:{safe:[1,true,null,'text']}}],
  };
  for(const [key,example] of Object.entries(examples)){
    const name=key as keyof ProjectionContractMap;
    assert.equal(shape(name,example),true,name);assertProjectionContract(name,example);
    if(!Array.isArray(example)&&example!==null&&typeof example==='object'){
      assert.equal(shape(name,{...example,unexpected:true}),false,`${key} extra field`);
      for(const field of Object.keys(example)){
        const missing:Record<string,unknown>={...example};delete missing[field];
        assert.equal(shape(name,missing),false,`${key} missing ${field}`);
      }
    }
  }
  assert.equal(shape('SourceRef',{kind:'genesis',genesis_ref:'genesis_1'}),true);
  for(const value of [null,true,-4,0,'scalar'])assert.equal(shape('ObjectRef',{kind:'scalar',value}),true);
  assert.equal(shape('ObjectRef',{kind:'scalar',value:{nested:true}}),false);
  assert.equal(shape('ObjectRef',{kind:'entity',entity_id:'donor',value:'hidden'}),false);
});

test('projection schemas retain ASCII IDs hash syntax numeric safety and array bounds',()=>{
  for(const id of ['', '__proto__','a/b','a.b','é','a'.repeat(97)])assert.equal(shape('ActorKnowledgeQuery',actorQuery({request_id:id})),false,id);
  for(const id of ['constructor','prototype','toString','A-z_09'])assert.equal(shape('ActorKnowledgeQuery',actorQuery({request_id:id})),true,id);
  for(const head of ['A'.repeat(64),'a'.repeat(63),'g'.repeat(64)])assert.equal(shape('Prefix',{...prefix(),head}),false);
  for(const sequence of [-1,0.5,Number.MAX_SAFE_INTEGER+1])assert.equal(shape('Prefix',{...prefix(),sequence}),false);
  refused(()=>assertProjectionContract('Prefix',{...prefix(),sequence:-0}));
  assert.equal(shape('EpistemicClaim',claim('c',{content:''})),false);
  assert.equal(shape('EpistemicClaim',claim('c',{content:'x'.repeat(65537)})),false);
  assert.equal(shape('ReadPolicy',{...readPolicy(),party_ids:Array.from({length:129},(_,i)=>`party_${i}`)}),false);
  const entries=Array.from({length:4097},(_,i)=>({id:`entry_${String(i).padStart(5,'0')}`,value:null}));
  assert.equal(shape('IdEntries',entries),false);
  refused(()=>buildActorView(actorQuery(),readContext(),Array.from({length:4097},(_,i)=>claim(`c_${i}`)),[]));
  refused(()=>buildActorView(actorQuery(),readContext(),[],Array.from({length:4097},(_,i)=>acquisition(`a_${i}`))));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),Array.from({length:4097},(_,i)=>relation({relation_id:`r_${i}`}))));
});

test('standalone projection semantics reject coherent-shape contradictions before context guards',()=>{
  const contradictory:Array<[keyof ProjectionContractMap,unknown,boolean?]>=[
    ['Prefix',{...prefix(0),head:HEAD_A}],['Prefix',{...prefix(),head:null}],
    ['CanonicalRelationVersion',relation({valid_from_tick:20,valid_to_tick:20}),true],
    ['CanonicalRelationVersion',relation({recorded_from_sequence:3,recorded_to_sequence:2,source:{kind:'event',sequence:3,event_hash:EVENT_HASH}}),true],
    ['CanonicalRelationVersion',relation({source:{kind:'event',sequence:2,event_hash:EVENT_HASH}}),true],
    ['CanonicalRelationVersion',relation({source:{kind:'genesis',genesis_ref:'genesis_1'}})],
    ['Acquisition',acquisition('a','claim_a',{source:{kind:'event',sequence:4,event_hash:EVENT_HASH}}),true],
    ['ActorKnowledgeQuery',actorQuery({audience:'party',party_id:null})],
    ['ActorKnowledgeQuery',actorQuery({audience:'actor',party_id:'party_a'})],
    ['DisclosedClaim',{...validView().claims[0],occurred_at_tick:21},true],
    ['ReadPolicy',{...readPolicy(),party_ids:['party_b','party_a']},true],
    ['ActorKnowledgeView',{...validView(),engagement_closed:true}],
    ['ActorKnowledgeView',{...validView(),ontology_blocked:true}],
  ];
  for(const [name,value,crossFieldComparison] of contradictory){
    // Standard JSON Schema can express conditional literal combinations. Only cross-value
    // comparisons/sorting require this raw-shape acceptance oracle; every case must refuse below.
    if(crossFieldComparison)assert.equal(shape(name,value),true,`${name} comparison remains structurally valid`);
    refused(()=>assertProjectionContract(name,value));
  }
  assertProjectionContract('Prefix',prefix(0,10));
  assertProjectionContract('CanonicalRelationVersion',relation({recorded_from_sequence:0,source:{kind:'genesis',genesis_ref:'genesis_1'}}));
});

test('common checkpoints require both planes and every prefix identity to agree',()=>{
  for(const modify of [
    (c:ReturnType<typeof checkpoint>)=>{c.epistemic.prefix.head=HEAD_B;},
    (c:ReturnType<typeof checkpoint>)=>{c.canonical.prefix.sequence=11;},
    (c:ReturnType<typeof checkpoint>)=>{c.epistemic.prefix.world_time=39;},
    (c:ReturnType<typeof checkpoint>)=>{c.canonical.prefix.scope.branch_id='other';},
  ]){
    const c=changed(checkpoint(),modify);assert.equal(shape('CommonCheckpoint',c),true);
    refused(()=>assertProjectionContract('CommonCheckpoint',c));
    refused(()=>validateActorQuery(actorQuery(),{...readContext(),checkpoint:c}));
  }
  refused(()=>assertProjectionContract('CommonCheckpoint',{...checkpoint(),canonical:checkpoint().epistemic}));
});

test('actor guards bind request checkpoint scope principal and current trusted policy',()=>{
  const context=readContext();const query=actorQuery();const before=canonical({context,query});
  const result=validateActorQuery(query,context);assert.deepEqual(result,query);assert.notEqual(result,query);assertDeepFrozen(result);
  assert.equal(canonical({context,query}),before);assert.equal(Object.isFrozen(query),false);
  query.scope.branch_id='mutated';assert.equal(result.scope.branch_id,'main');
  refused(()=>validateActorQuery(actorQuery({actor_id:'outsider'}),readContext()));
  refused(()=>validateActorQuery(actorQuery({checkpoint_id:'other_checkpoint'}),readContext()));
  refused(()=>validateActorQuery(actorQuery(),{...readContext(),policy:null}),'UNAVAILABLE');
  refused(()=>validateActorQuery(actorQuery(),changed(readContext(),c=>{c.policy!.actor_authorized=false;})));
  refused(()=>validateActorQuery(actorQuery(),changed(readContext(),c=>{c.policy!.actor_id='outsider';})));
  for(const target of ['query','principal','policy','canonical','epistemic'] as const){
    const q=actorQuery(),c=readContext();
    const scope=target==='query'?q.scope:target==='principal'?c.principal.scope:target==='policy'?c.policy!.prefix.scope:c.checkpoint[target].prefix.scope;
    scope.rights_lane='open_license';scope.workspace_tenant_id='tenant:open_license:workspace';
    refused(()=>validateActorQuery(q,c));
  }
  const wrong=actorQuery();wrong.scope.workspace_tenant_id='forged';refused(()=>validateActorQuery(wrong,readContext()));
});

test('policy prefix dominance includes equal-sequence hash and clock while allowing newer policy',()=>{
  for(const modify of [
    (c:ProjectionReadContext)=>{c.policy!.prefix.sequence=11;},
    (c:ProjectionReadContext)=>{c.policy!.prefix.world_time=39;},
    (c:ProjectionReadContext)=>{c.policy!.prefix.head=HEAD_B;},
    (c:ProjectionReadContext)=>{c.policy!.prefix.world_time=41;},
  ])refused(()=>validateActorQuery(actorQuery(),changed(readContext(),modify)));
  const newer=readContext();newer.policy!.prefix={...prefix(13,41),head:HEAD_B};
  assert.deepEqual(validateActorQuery(actorQuery(),newer),actorQuery());
  // Acceptance here is host-trusted dominance, never a proof that HEAD_B descends from HEAD_A.
});

test('query bounds reject future acquisition selectors and times before the supported genesis',()=>{
  for(const overrides of [{acquired_through_tick:41},{acquired_through_sequence:13},{acquired_through_tick:9}])refused(()=>validateActorQuery(actorQuery(overrides),readContext()));
  assert.equal(validateActorQuery(actorQuery({acquired_through_tick:10,acquired_through_sequence:0}),readContext()).acquired_through_sequence,0);
  for(const time of [9,41])refused(()=>validateCanonicalQuery(canonicalQuery({valid_at_tick:time}),readContext(true)));
  for(const genesis_world_time of [-1,0.5,41,Number.MAX_SAFE_INTEGER+1])refused(()=>validateActorQuery(actorQuery(),{...readContext(),genesis_world_time}));
  const missing:Record<string,unknown>={...readContext()};delete missing.genesis_world_time;
  refused(()=>validateActorQuery(actorQuery(),missing as unknown as ProjectionReadContext));
});

test('canonical history needs both system role and an explicit canonical read grant',()=>{
  assert.deepEqual(validateCanonicalQuery(canonicalQuery(),readContext(true)),canonicalQuery());
  refused(()=>validateCanonicalQuery(canonicalQuery(),readContext()));
  refused(()=>validateCanonicalQuery(canonicalQuery(),changed(readContext(true),c=>{c.policy!.canonical_read=false;})));
  refused(()=>validateCanonicalQuery(canonicalQuery(),changed(readContext(),c=>{c.policy!.canonical_read=true;})));
  refused(()=>validateActorQuery({...actorQuery(),valid_at_tick:20},readContext(true)));
  refused(()=>validateCanonicalQuery({...canonicalQuery(),actor_id:'donor'},readContext(true)));
});

test('party queries require the exact trusted party grant and never widen to another party',()=>{
  const q=actorQuery({audience:'party',party_id:'party_a'});
  assert.deepEqual(validateActorQuery(q,readContext()),q);
  refused(()=>validateActorQuery({...q,party_id:'party_c'},readContext()));
  refused(()=>validateActorQuery(q,changed(readContext(),c=>{c.policy!.party_ids=[];})));
  const claims=[claim('a'),claim('b'),claim('solo'),claim('other_actor')];
  const rows=[acquisition('acq_a','a',{party_id:'party_a'}),acquisition('acq_b','b',{party_id:'party_b'}),
    acquisition('acq_solo','solo'),acquisition('acq_other','other_actor',{party_id:'party_a',knower_id:'traveler'})];
  assert.deepEqual(buildActorView(q,readContext(),claims,rows).claims.map(c=>c.claim_id),['a']);
  assert.deepEqual(buildActorView(actorQuery(),readContext(),claims,rows).claims.map(c=>c.claim_id),['a','b','solo']);
});

test('actor disclosure intersects acquisition tick and sequence without substituting occurrence time',()=>{
  const claims=[claim('eligible'),claim('late_tick',{occurred_at_tick:1}),claim('late_seq'),claim('other')];
  const rows=[acquisition('a','eligible'),acquisition('b','late_tick',{acquired_at_tick:30}),
    acquisition('c','late_seq',{acquired_at_sequence:5,source:{kind:'event',sequence:5,event_hash:EVENT_HASH}}),
    acquisition('d','other',{knower_id:'outsider'})];
  const result=buildActorView(actorQuery({acquired_through_tick:20,acquired_through_sequence:3}),readContext(),claims,rows);
  assert.deepEqual(result.claims.map(c=>c.claim_id),['eligible']);
});

test('disclosure deduplicates eligible acquisitions by earliest sequence then tick and sorts claim IDs',()=>{
  const rows=[acquisition('z','claim_b',{acquired_at_tick:25,acquired_at_sequence:4,source:{kind:'event',sequence:4,event_hash:EVENT_HASH}}),
    acquisition('b','claim_b',{acquired_at_tick:22}),acquisition('a','claim_b',{acquired_at_tick:20}),
    acquisition('c','claim_a'),acquisition('hidden','claim_b',{knower_id:'outsider',acquired_at_sequence:2,source:{kind:'event',sequence:2,event_hash:EVENT_HASH}})];
  const result=buildActorView(actorQuery(),readContext(),[claim('claim_b'),claim('claim_a')],rows);
  assert.deepEqual(result.claims.map(c=>[c.claim_id,c.acquired_at_sequence,c.acquired_at_tick]),[['claim_a',3,20],['claim_b',3,20]]);
});

test('actor public output strips private provenance and retains detached deeply frozen values',()=>{
  const q=actorQuery(),context=readContext(),claims=[claim()],rows=[acquisition()];
  const before=canonical({q,context,claims,rows});const view=buildActorView(q,context,claims,rows);
  assert.deepEqual(Object.keys(view).sort(),['claims','engagement_closed','ontology_blocked','policy_id','query','schema_version']);
  assert.deepEqual(Object.keys(view.claims[0]!).sort(),['acquired_at_sequence','acquired_at_tick','channel','claim_id','content','occurred_at_tick']);
  for(const secret of [PRIVATE_SOURCE,EVENT_HASH,'knower_id','observers','state_digest','store_generation','seed','rolls'])assert.equal(JSON.stringify(view).includes(secret),false,secret);
  assertDeepFrozen(view);assert.equal(canonical({q,context,claims,rows}),before);
  claims[0]!.content='changed';q.scope.branch_id='changed';assert.equal(view.claims[0]!.content,'Content of claim_a');assert.equal(view.query.scope.branch_id,'main');
  assert.equal(Object.isFrozen(rows[0]),false);
});

test('all supplied claim and acquisition rows are validated even when they would be filtered out',()=>{
  const badClaims=[
    changed(claim('hidden'),c=>{c.scope.branch_id='foreign';}),
    claim('hidden',{occurred_at_tick:41}),
    claim('hidden',{source:{kind:'event',sequence:13,event_hash:EVENT_HASH}}),
  ];
  for(const bad of badClaims)refused(()=>buildActorView(actorQuery(),readContext(),[claim(),bad],[acquisition()]));
  const badRows=[
    acquisition('hidden','absent',{knower_id:'outsider'}),
    acquisition('hidden','claim_a',{knower_id:'outsider',acquired_at_tick:41}),
    acquisition('hidden','claim_a',{knower_id:'outsider',acquired_at_tick:14}),
    acquisition('hidden','claim_a',{knower_id:'outsider',acquired_at_sequence:1,source:{kind:'event',sequence:1,event_hash:EVENT_HASH}}),
    acquisition('hidden','claim_a',{knower_id:'outsider',acquired_at_sequence:13,source:{kind:'event',sequence:13,event_hash:EVENT_HASH}}),
    changed(acquisition('hidden'),a=>{a.scope.branch_id='foreign';}),
  ];
  for(const bad of badRows)refused(()=>buildActorView(actorQuery(),readContext(),[claim()],[acquisition(),bad]));
  refused(()=>buildActorView(actorQuery(),readContext(),[claim(),claim()],[acquisition()]));
  refused(()=>buildActorView(actorQuery(),readContext(),[claim()],[acquisition(),acquisition()]));
  refused(()=>buildActorView(actorQuery(),readContext(),[claim('c',{source:{kind:'genesis',genesis_ref:'genesis_1'} as never})],[]));
});

test('source identities agree at the known checkpoint tail and within each supplied sequence',()=>{
  const c=claim('claim_a',{source:{kind:'event',sequence:12,event_hash:HEAD_A}});
  const a=acquisition('a','claim_a',{acquired_at_tick:40,acquired_at_sequence:12,source:{kind:'event',sequence:12,event_hash:HEAD_A}});
  assert.equal(buildActorView(actorQuery(),readContext(),[c],[a]).claims.length,1);
  refused(()=>buildActorView(actorQuery(),readContext(),[c],[{...a,acquired_at_tick:39}]));
  refused(()=>buildActorView(actorQuery(),readContext(),[claim('claim_a',{occurred_at_tick:1})],[acquisition('a','claim_a',{acquired_at_tick:9})]));
  refused(()=>buildActorView(actorQuery(),readContext(),[{...c,source:{kind:'event',sequence:12,event_hash:HEAD_B}}],[a]));
  refused(()=>buildActorView(actorQuery(),readContext(),[c],[{...a,source:{kind:'event',sequence:12,event_hash:HEAD_B}}]));
  const sameSequence=acquisition('a','claim_a',{acquired_at_sequence:2,source:{kind:'event',sequence:2,event_hash:HEAD_B}});
  refused(()=>buildActorView(actorQuery(),readContext(),[claim()],[sameSequence]));
  const atTail=relation({recorded_from_sequence:12,source:{kind:'event',sequence:12,event_hash:HEAD_A}});
  assert.equal(selectCanonicalRelations(canonicalQuery(),readContext(true),[atTail]).length,1);
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[{...atTail,source:{kind:'event',sequence:12,event_hash:HEAD_B}}]));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[relation(),relation({relation_id:'other',source:{kind:'event',sequence:1,event_hash:HEAD_B}})]));
});

test('current cutoff policies empty historical v2 claims without modifying stored knowledge',()=>{
  const q=actorQuery({acquired_through_tick:20,acquired_through_sequence:3}),claims=[claim()],rows=[acquisition()];
  const before=canonical({claims,rows});
  for(const closed of [false,true]){
    const context=readContext();context.policy!.prefix={...prefix(13,50),head:HEAD_B};
    context.policy!.ontology_blocked=true;context.policy!.engagement_closed=closed;
    const view=buildActorView(q,context,claims,rows);
    assert.deepEqual(view.claims,[]);assert.equal(view.ontology_blocked,true);assert.equal(view.engagement_closed,closed);
    assertProjectionContract('ActorKnowledgeView',view);
  }
  assert.equal(canonical({claims,rows}),before);
  assert.equal(buildActorView(q,readContext(),claims,rows).claims.length,1);
  refused(()=>buildActorView(q,changed(readContext(),c=>{c.policy!.engagement_closed=true;}),claims,rows));
});

test('public view semantics enforce bounded sorted unique claims and query disclosure limits',()=>{
  const base=validView(),a=base.claims[0]!;
  for(const claims of [[a,a],[{...a,claim_id:'z'},{...a,claim_id:'a'}],[{...a,acquired_at_tick:41}],[{...a,acquired_at_sequence:13}]]){
    refused(()=>assertProjectionContract('ActorKnowledgeView',{...base,claims}));
  }
  refused(()=>assertProjectionContract('ReadPolicy',{...readPolicy(),party_ids:['party_a','party_a']}));
});

test('bitemporal selection preserves an old interval revision at prefix 12 and applies closure at 13',()=>{
  const old=relation({recorded_to_sequence:13});
  const closed=relation({revision_id:'revision_closed',valid_to_tick:35,recorded_from_sequence:13,
    source:{kind:'event',sequence:13,event_hash:HEAD_B}});
  const records=[closed,old],before=canonical(records),at12=readContext(true);
  // Both materialized prefixes already have world clock 40: the change is knowledge of the valid interval.
  const selected=selectCanonicalRelations(canonicalQuery(),at12,records);
  assert.deepEqual(selected.map(r=>r.revision_id),['revision_old']);assert.equal(selected[0]!.valid_to_tick,null);
  const at13=readContext(true);at13.checkpoint=checkpoint(13,40);
  at13.checkpoint.prefix.head=HEAD_B;
  at13.checkpoint.canonical.prefix.head=HEAD_B;
  at13.checkpoint.epistemic.prefix.head=HEAD_B;
  at13.policy!.prefix=structuredClone(at13.checkpoint.prefix);
  assert.notEqual(at12.checkpoint.prefix.head,at13.checkpoint.prefix.head);
  assert.deepEqual(selectCanonicalRelations(canonicalQuery(),at13,records),[]);
  assert.deepEqual(selectCanonicalRelations(canonicalQuery({valid_at_tick:34}),at13,records).map(r=>r.revision_id),['revision_closed']);
  assert.deepEqual(selectCanonicalRelations(canonicalQuery({valid_at_tick:35}),at13,records),[]);
  assert.equal(canonical(records),before);assertDeepFrozen(selected);old.object_ref={kind:'scalar',value:'mutated'};
  assert.deepEqual(selected[0]!.object_ref,{kind:'entity',entity_id:'donor'});
});

test('canonical selection uses half-open valid and recorded intervals and deterministic relation ordering',()=>{
  const records=[relation({relation_id:'z',valid_from_tick:20,valid_to_tick:40}),
    relation({relation_id:'a',valid_from_tick:20,valid_to_tick:41}),
    relation({relation_id:'future',recorded_from_sequence:13,source:{kind:'event',sequence:13,event_hash:EVENT_HASH}}),
    relation({relation_id:'past',recorded_to_sequence:12})];
  assert.deepEqual(selectCanonicalRelations(canonicalQuery({valid_at_tick:20}),readContext(true),records).map(r=>r.relation_id),['a','z']);
  assert.deepEqual(selectCanonicalRelations(canonicalQuery(),readContext(true),records).map(r=>r.relation_id),['a']);
  assert.deepEqual(selectCanonicalRelations(canonicalQuery({valid_at_tick:19}),readContext(true),records),[]);
});

test('canonical history refuses duplicate or overlapping revisions foreign scope and wrong genesis provenance',()=>{
  const r=relation();
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[r,r]));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[r,{...r,revision_id:'another'}]));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[changed(r,row=>{row.scope.branch_id='foreign';})]));
  const initial=relation({recorded_from_sequence:0,source:{kind:'genesis',genesis_ref:'genesis_1'}});
  assert.equal(selectCanonicalRelations(canonicalQuery(),readContext(true),[initial]).length,1);
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[{...initial,source:{kind:'genesis',genesis_ref:'other'}}]));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[relation({source:{kind:'event',sequence:2,event_hash:EVENT_HASH}})]));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[relation({valid_to_tick:10})]));
});

test('projection entry points reject DTO accessors without executing them or mutating the inputs',()=>{
  let calls=0;
  function poison<T extends object>(value:T,key:string):T {
    Object.defineProperty(value,key,{enumerable:true,configurable:true,get(){calls++;throw new Error('getter executed');}});return value;
  }
  refused(()=>validateActorQuery(poison(actorQuery(),'actor_id'),readContext()));
  refused(()=>validateCanonicalQuery(poison(canonicalQuery(),'valid_at_tick'),readContext(true)));
  refused(()=>validateActorQuery(actorQuery(),poison(readContext(),'policy')));
  refused(()=>buildActorView(actorQuery(),readContext(),[poison(claim(),'content')],[acquisition()]));
  refused(()=>buildActorView(actorQuery(),readContext(),[claim()],[poison(acquisition(),'knower_id')]));
  refused(()=>selectCanonicalRelations(canonicalQuery(),readContext(true),[poison(relation(),'object_ref')]));
  refused(()=>assertProjectionContract('ReadPolicy',poison(readPolicy(),'actor_authorized')));
  const query:KnowledgeQuery={schema_version:'1.0.0',scope:projectionScope(),actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:20,as_of_sequence:3};
  refused(()=>adaptV1KnowledgeQuery(poison(query,'actor_id'),'checkpoint_12','request_1'));
  const rows:unknown[]=[claim()];Object.defineProperty(rows,'0',{enumerable:true,get(){calls++;return claim();}});
  refused(()=>buildActorView(actorQuery(),readContext(),rows,[acquisition()]));
  const unsafeTuple:[string,unknown]=['safe',null];Object.defineProperty(unsafeTuple,'1',{enumerable:true,get(){calls++;return null;}});
  refused(()=>encodeIdEntries([unsafeTuple]));assert.equal(calls,0);
});

test('projection preflight bounds recursive JSON values and rejects malformed runtime containers',()=>{
  let deep:unknown=null;for(let i=0;i<34;i++)deep={next:deep};
  refused(()=>encodeIdEntries([['deep',deep]]),'INVALID_CONTRACT');
  const cycle:Record<string,unknown>={};cycle.self=cycle;refused(()=>encodeIdEntries([['cycle',cycle]]),'INVALID_CONTRACT');
  for(const value of [NaN,Infinity,-0,1.5,undefined,()=>1,new Date()])refused(()=>encodeIdEntries([['value',value]]));
  const sparse:unknown[]=[];sparse.length=2;refused(()=>buildActorView(actorQuery(),readContext(),sparse,[]));
  const decorated:unknown[]=[];Object.defineProperty(decorated,'extra',{value:1});refused(()=>buildActorView(actorQuery(),readContext(),decorated,[]));
  const hidden=Object.defineProperty({},'secret',{value:1,enumerable:false});refused(()=>encodeIdEntries([['value',hidden]]));
  refused(()=>encodeIdEntries([['value',{[Symbol('secret')]:1}]]));
  refused(()=>encodeIdEntries([['value',JSON.parse('{"__proto__":1}')]]));
  refused(()=>encodeIdEntries([['value',{constructor:1}]]));
  let iterated=false;const iterable={*[Symbol.iterator](){iterated=true;yield ['a',1] as const;}};
  refused(()=>encodeIdEntries(iterable as never));assert.equal(iterated,false);
});

test('projection preflight refuses wide JSON values and bare proxies before any trap executes',()=>{
  refused(()=>encodeIdEntries([['wide',Array.from({length:4097},()=>null)]]),'INVALID_CONTRACT');
  refused(()=>encodeIdEntries([['wide',Object.fromEntries(Array.from({length:4097},(_,i)=>[`k${i}`,null]))]]),'INVALID_CONTRACT');
  let traps=0;const trap=()=>{traps++;throw new Error('proxy trap executed');};
  const proxy=new Proxy(actorQuery(),{get:trap,ownKeys:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap});
  refused(()=>validateActorQuery(proxy,readContext()),'INVALID_CONTRACT');
  refused(()=>encodeIdEntries([['proxy',proxy]]),'INVALID_CONTRACT');
  refused(()=>assertProjectionContract('ActorKnowledgeQuery',proxy),'INVALID_CONTRACT');
  assert.equal(traps,0);
});

test('ID entry encoding preserves scalar special names sorts ASCII and refuses ambiguity',()=>{
  const value={nested:[1,true,null,'text']};
  const input:ReadonlyArray<readonly [string,unknown]>=[['toString',3],['prototype',2],['constructor',value],['Z',0],['a',-2]];
  const before=canonical(input),entries=encodeIdEntries(input);
  assert.deepEqual(entries.map(e=>e.id),['Z','a','constructor','prototype','toString']);
  assert.deepEqual(entries.find(e=>e.id==='constructor')!.value,value);assertDeepFrozen(entries);
  value.nested[0]=99;assert.equal((entries.find(e=>e.id==='constructor')!.value as {nested:unknown[]}).nested[0],1);
  assert.notEqual(canonical(input),before);
  for(const input of [[['duplicate',1],['duplicate',2]],[['__proto__',1]],[['a/b',1]],[['',1]],[['a',1,2]]])refused(()=>encodeIdEntries(input as never));
  refused(()=>encodeIdEntries({a:1} as never));
  refused(()=>assertProjectionContract('IdEntries',[{id:'b',value:1},{id:'a',value:2}]));
  refused(()=>assertProjectionContract('IdEntries',[{id:'a',value:1},{id:'a',value:2}]));
});

test('v1 query adaptation preserves acquisition selectors and never grants authorization',()=>{
  const v1:KnowledgeQuery={schema_version:'1.0.0',scope:projectionScope(),actor_id:'donor',audience:'party',party_id:'party_a',as_of_world_time:20,as_of_sequence:3};
  const before=canonical(v1),adapted=adaptV1KnowledgeQuery(v1,'checkpoint_12','request_from_v1');
  assert.deepEqual(adapted,actorQuery({request_id:'request_from_v1',audience:'party',party_id:'party_a',acquired_through_tick:20,acquired_through_sequence:3}));
  assert.equal(canonical(v1),before);assertDeepFrozen(adapted);assert.notEqual(adapted.scope,v1.scope);
  refused(()=>validateActorQuery(adapted,{...readContext(),policy:null}),'UNAVAILABLE');
  refused(()=>adaptV1KnowledgeQuery({...v1,as_of_world_time:1.5},'checkpoint_12','request_1'));
  refused(()=>adaptV1KnowledgeQuery({...v1,audience:'actor'},'checkpoint_12','request_1'));
  refused(()=>adaptV1KnowledgeQuery(v1,'bad/id','request_1'));
});

test('frozen v1 disclosure still accepts its existing claims under cutoff flags',()=>{
  const v1:KnowledgeView={schema_version:'1.0.0',scope:projectionScope(),actor_id:'donor',audience:'actor',party_id:null,
    as_of_world_time:20,as_of_sequence:3,ontology_blocked:true,engagement_closed:true,
    claims:[{observation:{claim_id:'claim_a',channel:'belief',source_id:PRIVATE_SOURCE,content:'stored v1 knowledge',
      observers:['donor'],party_id:null,occurred_at:15},acquired_at:20,sequence:3,event_id:'event_3'}]};
  const before=canonical(v1);assertContract('KnowledgeView',v1);assertKnowledgeDisclosure(v1);
  assert.equal(v1.claims.length,1);assert.equal(canonical(v1),before);
  refused(()=>assertProjectionContract('ActorKnowledgeView',v1));
  assert.throws(()=>assertContract('KnowledgeView',validView()),ArgoError);
});

test('projection generated declarations match their committed schema without writing files',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  assert.doesNotThrow(()=>execFileSync('python3',['scripts/generate-projection-types.py','--check'],{
    cwd:root,encoding:'utf8',timeout:10000,maxBuffer:64*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin'},
  }));
});

test('projection freeze manifest has the independently reviewed exact byte identity',()=>{
  // Supervisor sets this literal only after independent review of the schema and freeze manifest.
  // This protected test must not derive its expected digest from the same mutable manifest.
  const expected='3f45b293ab32829c6872cfc6221b77d8e66e81d3efa8faf1120f25d691504a28';
  const bytes=readFileSync(new URL('../SYSTEMS/proposals/headless-v2/FREEZE.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);
  const manifest=JSON.parse(bytes.toString('utf8')) as {
    profile:string;schema_id:string;status:string;files:Record<string,string>;
  };
  assert.equal(manifest.profile,'projection/2.0.0');
  assert.equal(manifest.schema_id,'https://argo.local/schemas/projection-v2.json');
  assert.equal(manifest.status,'frozen_local_contract');
  const expectedFiles=[
    'SYSTEMS/proposals/headless-v2/CONTRACT.md',
    'SYSTEMS/proposals/headless-v2/projection-v2.schema.json',
  ];
  assert.ok(manifest.files!==null&&typeof manifest.files==='object'&&!Array.isArray(manifest.files));
  assert.deepEqual(Object.keys(manifest.files).sort(),expectedFiles);
  for(const path of expectedFiles){
    const recorded=manifest.files[path];assert.equal(typeof recorded,'string');
    assert.match(recorded!,/^[a-f0-9]{64}$/);
    const actual=readFileSync(new URL(`../${path}`,import.meta.url));
    assert.equal(createHash('sha256').update(actual).digest('hex'),recorded,path);
  }
});
