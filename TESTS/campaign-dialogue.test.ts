import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as campaign from '@argo/tempted-fates';
import {ArgoError, canonical} from '@argo/contracts';
import type {CharacterActorQuery} from '@argo/contracts';
import type {DialogueSupplement} from '@argo/interventions';
import type {CampaignPack} from '../scenarios/tempted-fates/campaign/types.ts';
import world from '../scenarios/tempted-fates/campaign/world.json' with {type:'json'};
import {characterActorQuery} from './character-fixtures.ts';

type Builder = (pack:CampaignPack, query:CharacterActorQuery, grant:{location_id:string|null})=>DialogueSupplement;
function build(pack:CampaignPack, query:CharacterActorQuery, grant:{location_id:string|null}):DialogueSupplement {
 const implementation=(campaign as unknown as {buildCampaignDialogueSupplement:Builder}).buildCampaignDialogueSupplement;
 assert.equal(typeof implementation,'function','Public campaign entry point must export the dialogue projector');
 return implementation(pack,query,grant);
}
const pack=():CampaignPack=>structuredClone(world) as CampaignPack;
const query=(actor_id='melia'):CharacterActorQuery=>({...characterActorQuery(),actor_id});
const invalid=(error:unknown)=>error instanceof ArgoError&&error.code==='INVALID_CONTRACT';

test('campaign dialogue exports only the queried NPC disposition and explicitly disclosed room',()=>{
 const content=pack(),actor=content.npcs.find(row=>row.id==='melia')!,room=content.locations.find(row=>row.id==='l_harbor')!;
 Object.assign(actor,{name:'Melia',occupation:'Potter',wants:'Finish the lamp.',will_not:'Make a guest owe a favor.',private_knowledge:['PRIVATE_OBSERVER_SECRET'],speech_example:'CANNED_SAMPLE_REPLY'});
 room.public_description='Stone walls, a low ceiling and a burning brazier.';room.referee_notes='PRIVATE_ROOM_TRUTH';
 content.variants[0]!.referee_truth='PRIVATE_VARIANT_TRUTH';
 const input=query(),result=build(content,input,{location_id:'l_harbor'});
 assert.deepEqual(result,{
  version:'character-dialogue/0.1.0',query:input,
  source:{content_hash:createHash('sha256').update(canonical(content)).digest('hex'),revision:'tempting-fates-pack/0.1.0'},
  actor:{actor_id:'melia',name:'Melia',occupation:'Potter',wants:'Finish the lamp.',will_not:'Make a guest owe a favor.'},
  scene:{location_id:'l_harbor',name:'Kymene harbor',description:'Stone walls, a low ceiling and a burning brazier.'},
 });
 for(const secret of ['PRIVATE_OBSERVER_SECRET','CANNED_SAMPLE_REPLY','PRIVATE_ROOM_TRUTH','PRIVATE_VARIANT_TRUTH'])assert(!JSON.stringify(result).includes(secret));
});

test('null location grants disclose no room despite seed NPC occupancy',()=>{
 const content=pack();assert.equal(content.npcs.find(row=>row.id==='melia')!.location_id,'l_harbor');
 assert.equal(build(content,query(),{location_id:null}).scene,null);
});

test('the host selected room is projected without inferring presence from seed occupancy',()=>{
 const content=pack(),selected=content.locations.find(row=>row.id==='l_market')!;
 const result=build(content,query(),{location_id:'l_market'});
 assert.deepEqual(result.scene,{location_id:'l_market',name:selected.name,description:selected.public_description});
 assert.equal(result.actor!.actor_id,'melia');
});

test('travelers receive no NPC disposition even when a room is explicitly disclosed',()=>{
 const result=build(pack(),query('traveler_7'),{location_id:'l_harbor'});
 assert.equal(result.actor,null);assert.equal(result.scene!.location_id,'l_harbor');
 assert.equal(result.query.actor_id,'traveler_7');
});

test('two characters share authored room facts while retaining only their own goals',()=>{
 const content=pack(),melia=content.npcs.find(row=>row.id==='melia')!,dion=content.npcs.find(row=>row.id==='dion')!;
 melia.wants='Remain beside the warm kiln.';dion.wants='Get back into the open air.';
 const a=build(content,query('melia'),{location_id:'l_harbor'}),b=build(content,query('dion'),{location_id:'l_harbor'});
 assert.deepEqual(a.scene,b.scene);assert.notEqual(a.scene,b.scene);
 assert.equal(a.source.content_hash,b.source.content_hash);
 assert.equal(a.actor!.wants,'Remain beside the warm kiln.');assert.equal(b.actor!.wants,'Get back into the open air.');
 assert(!JSON.stringify(a).includes(dion.wants));assert(!JSON.stringify(b).includes(melia.wants));
});

test('the content identity changes with a revision of authored scene content',()=>{
 const content=pack(),before=build(content,query(),{location_id:'l_harbor'});
 content.locations.find(row=>row.id==='l_harbor')!.public_description='A newly repaired wall.';
 const after=build(content,query(),{location_id:'l_harbor'});
 assert.notEqual(after.source.content_hash,before.source.content_hash);
 assert.equal(after.scene!.description,'A newly repaired wall.');
});

test('results are detached deeply frozen data and inputs remain unchanged',()=>{
 const content=pack(),input=query(),grant={location_id:'l_harbor'},originalContent=structuredClone(content),originalQuery=structuredClone(input);
 const result=build(content,input,grant);
 assert.deepEqual(content,originalContent);assert.deepEqual(input,originalQuery);assert.deepEqual(grant,{location_id:'l_harbor'});
 assert.notEqual(result.query,input);assert.notEqual(result.query.scope,input.scope);assert.notEqual(result.query.cursor,input.cursor);
 assert.throws(()=>{result.scene!.description='Different room';},TypeError);
 assert.throws(()=>{result.actor!.wants='Expose everything';},TypeError);
 assert.throws(()=>{result.query.scope.world_id='other';},TypeError);
 input.cursor.world_time=999;content.npcs.find(row=>row.id==='melia')!.name='Changed outside';
 assert.equal(result.query.cursor.world_time,originalQuery.cursor.world_time);assert.equal(result.actor!.name,'Melia');
});

test('unknown and malformed location grants fail rather than falling back to an NPC home',()=>{
 for(const location_id of ['missing_room','l_harbor\n','../l_harbor','constructor','',7,undefined]){
  assert.throws(()=>build(pack(),query(),{location_id} as {location_id:string|null}),invalid);
 }
 for(const grant of [null,[],{},()=>({location_id:null}),{location_id:null,actor_id:'dion'},{location_id:null,scene:{description:'Invented'}}]){
  assert.throws(()=>build(pack(),query(),grant as {location_id:string|null}),invalid);
 }
 const grant=Object.assign(Object.create(null),{location_id:null});
 assert.equal(build(pack(),query(),grant).scene,null);
});

test('malformed query identities, scopes and cursors are refused before disclosure',()=>{
 for(const mutate of [
  (q:any)=>{delete q.actor_id;},(q:any)=>{q.actor_id='melia\n';},
  (q:any)=>{q.version='mortal-rules/0.2.0';},(q:any)=>{q.scope.workspace_tenant_id='different';},
  (q:any)=>{q.cursor.head=null;},(q:any)=>{q.cursor.sequence=-1;},(q:any)=>{q.omniscient=true;},
 ]){const input=query();mutate(input);assert.throws(()=>build(pack(),input,{location_id:'l_harbor'}),error=>error instanceof ArgoError);}
});

test('accessor input is rejected without evaluating pack, query or grant getters',()=>{
 for(const slot of ['pack','query','grant'] as const){
  let hits=0;const content=pack(),input=query(),grant={location_id:null};
  const target=slot==='pack'?content:slot==='query'?input:grant,key=slot==='pack'?'version':slot==='query'?'actor_id':'location_id';
  Object.defineProperty(target,key,{enumerable:true,get(){hits++;throw Error('Active input executed');}});
  assert.throws(()=>build(content,input,grant),invalid);assert.equal(hits,0);
 }
});

test('active and revoked proxies are refused without triggering proxy traps',()=>{
 for(const slot of ['pack','query','grant'] as const){
  let traps=0;const raw=slot==='pack'?pack():slot==='query'?query():{location_id:null};
  const active=new Proxy(raw,{get(){traps++;throw Error('Proxy accessed');},ownKeys(){traps++;throw Error('Proxy inspected');}});
  const revocable=Proxy.revocable(raw,{});revocable.revoke();
  for(const value of [active,revocable.proxy]){
   assert.throws(()=>build((slot==='pack'?value:pack()) as CampaignPack,(slot==='query'?value:query()) as CharacterActorQuery,(slot==='grant'?value:{location_id:null}) as {location_id:string|null}),invalid);
  }
  assert.equal(traps,0);
 }
});

test('cycles, symbol and hidden grant properties cannot bypass passive disclosure validation',()=>{
 const cyclic:any={location_id:null};cyclic.location_id=cyclic;
 const symbolic:any={location_id:null};symbolic[Symbol('secret')]='hidden';
 const hidden={location_id:null};Object.defineProperty(hidden,'secret',{value:'hidden'});
 for(const grant of [cyclic,symbolic,hidden])assert.throws(()=>build(pack(),query(),grant),invalid);
 const content:any=pack();content.extra=content;assert.throws(()=>build(content,query(),{location_id:null}),invalid);
 const input:any=query();input.extra=input;assert.throws(()=>build(pack(),input,{location_id:null}),invalid);
});

test('actor disposition limits count Unicode characters and reject excess without truncation',()=>{
 for(const [field,limit] of [['occupation',512],['wants',2048],['will_not',2048]] as const){
  const content=pack(),actor=content.npcs.find(row=>row.id==='melia')!;
  actor[field]='𐀀'.repeat(limit);
  assert.equal(build(content,query(),{location_id:null}).actor![field],actor[field]);
  actor[field]+='𐀀';const before=actor[field];
  assert.throws(()=>build(content,query(),{location_id:null}),invalid);assert.equal(actor[field],before);
 }
});

test('long private disposition on another NPC does not enter or block the selected actor context',()=>{
 const content=pack();content.npcs.find(row=>row.id==='dion')!.wants='x'.repeat(3000);
 assert.equal(build(content,query(),{location_id:null}).actor!.actor_id,'melia');
 assert.throws(()=>build(content,query('dion'),{location_id:null}),invalid);
});

test('room prose honors the authored Unicode limit without leaking other room data',()=>{
 const content=pack(),room=content.locations.find(row=>row.id==='l_harbor')!;
 room.public_description='𐀀'.repeat(8192);
 assert.equal(build(content,query(),{location_id:'l_harbor'}).scene!.description,room.public_description);
 room.public_description+='𐀀';assert.throws(()=>build(content,query(),{location_id:'l_harbor'}),invalid);
});
