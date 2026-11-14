/** Actor projection of one verified shared prefix; no state or policy mutation. */
import {assertWorldContract} from '../../../contracts/src/shared-world.ts';
import {canonical,hash,fail,freezeDto} from '../../../contracts/src/index.ts';
import type {WorldGenesis,WorldState,WorldQuery,WorldPrincipal,WorldActorView,WorldVisibleMemory} from '../../../contracts/src/shared-world-types.ts';
import {viewMortalV3Actor} from '../mortal-v3/view.ts';
import {readWorld,mortalProjection} from './rules/engine.ts';

export function viewWorldActor(inputGenesis:WorldGenesis,inputState:WorldState,inputQuery:WorldQuery,inputPrincipal:WorldPrincipal):WorldActorView{
 const context=readWorld(inputGenesis,inputState),{genesis:g,state:s}=context;
 assertWorldContract('Query',inputQuery);assertWorldContract('Principal',inputPrincipal);
 if(canonical(inputQuery.scope)!==canonical(s.scope)||canonical(inputPrincipal.scope)!==canonical(s.scope))fail('SCOPE_DENIED','World view scope differs');
 if(canonical(inputQuery.cursor)!==canonical(s.cursor))fail('CONFLICT','World query requires the exact shared cursor');
 const id=inputQuery.actor_id,a=s.physical.actors.find(a=>a.id===id);
 if(!a||inputPrincipal.role==='referee'||inputPrincipal.actor_id!==id||inputPrincipal.principal_id!==a.controller_id||inputPrincipal.role!==a.kind)fail('UNAUTHORIZED','World view requires the direct actor controller');
 const query=structuredClone(inputQuery),profile=s.profiles.find(p=>p.actor_id===id)!;
 const {version:_,scope:__,cursor:___,world_time:____,...physical}=viewMortalV3Actor(g.mortal,mortalProjection(g,s),inputPrincipal);
 const acquired=s.mythic_closed?[]:context.acquired(id),latest=s.mythic_closed?[]:context.latest(id).slice().sort((a,b)=>a.sequence-b.sequence);
 const memories:WorldVisibleMemory[]=acquired.slice(-32).map(row=>{
  const {request_id:_,acquired_by:__,...visible}=row;const p=row.payload;
  if(p.type==='loan_returned'&&id!==p.lender_actor_id&&id!==p.borrower_actor_id)return {...visible,payload:{type:'custody_returned',item_id:p.item_id,from_actor_id:p.holder_actor_id,to_actor_id:p.lender_actor_id}};
  return visible;
 });
 const impressions=latest.slice(-32);
 const knowledge=s.mythic_closed?[]:g.knowledge_catalog.entries.flatMap(entry=>{
  const acquisition=s.knowledge.find(k=>k.knowledge_id===entry.knowledge_id);
  return entry.owner_actor_id===id&&acquisition?.active&&entry.validity.from_tick<=s.cursor.world_time&&(entry.validity.until_tick===null||entry.validity.until_tick>s.cursor.world_time)?[{entry,acquisition}]:[];
 });
 const usedSources=new Set(knowledge.flatMap(k=>k.entry.provenance.source_ids));
 const replied_to=a.kind==='npc'?memories.filter(r=>r.payload.type==='speak'&&r.actor_id!==id&&(r.payload.audience.addressed_actor_ids as readonly string[]).includes(id)&&context.replied(id,r.record_id)).map(r=>r.record_id):[];
 const result:WorldActorView={version:s.version,genesis_hash:s.genesis_hash,query,profile,physical,
  scene:{...g.scenes.find(scene=>scene.location_id===a.location_id)!,environment:g.environment,occupants:s.physical.actors.filter(other=>other.location_id===a.location_id).map(other=>({actor_id:other.id,name:other.name,condition:other.hp>0?'standing':other.hp===0?'unconscious':'dead'}))},
  memories,impressions,knowledge,knowledge_source:{pack_hash:g.mortal.pack_hash,catalog_hash:hash(g.knowledge_catalog),source_manifest_hash:hash(g.source_manifest)},source_definitions:g.source_manifest.sources.filter(source=>usedSources.has(source.source_id)),replied_to,
  coverage:{memory_total:acquired.length,memory_returned:memories.length,impressions_total:latest.length,impressions_returned:impressions.length,complete:acquired.length===memories.length&&latest.length===impressions.length},mythic_closed:s.mythic_closed};
 assertWorldContract('ActorView',result,g);return freezeDto(result);
}
