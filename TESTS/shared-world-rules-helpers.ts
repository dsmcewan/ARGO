import {hash} from '../packages/contracts/src/index.ts';
import type {WorldGenesis,WorldState,WorldAction,WorldPrincipal,WorldCommand,WorldQuery} from '../packages/contracts/src/shared-world-types.ts';
import {worldGenesis} from './shared-world-contract-fixtures.ts';
import {initialWorldState,resolveWorld,worldStateHash} from '../packages/ledger/src/world/rules.ts';
import {withWorldHead} from '../packages/ledger/src/world/rules/ownership.ts';
export function genesis():WorldGenesis{
 const g=worldGenesis();
 for(const [id,location] of [['watcher','harbor'],['remote','ruin']] as const){const a=structuredClone(g.mortal.actors[1]!);a.id=id;a.name=id;a.controller_id=`auth_${id}`;a.location_id=location;g.mortal.actors.push(a);g.profiles.push({...structuredClone(g.profiles[1]!),actor_id:id});}
 return g;
}
export function principal(g:WorldGenesis,id='hero'):WorldPrincipal{
 if(id==='host')return {scope:structuredClone(g.mortal.scope),principal_id:g.mortal.referee_id,role:'referee',actor_id:null};
 const a=g.mortal.actors.find(a=>a.id===id)!;return {scope:structuredClone(g.mortal.scope),principal_id:a.controller_id,role:a.kind,actor_id:id};
}
export function command(s:WorldState,action:WorldAction,id='hero',request=`request_${s.cursor.sequence+1}`):WorldCommand{return {version:s.version,scope:structuredClone(s.scope),request_id:request,actor_id:id==='host'?null:id,expected:{...s.cursor},causation_id:s.cursor.head,action};}
export function query(s:WorldState,id='hero'):WorldQuery{return {version:s.version,scope:structuredClone(s.scope),actor_id:id,cursor:{...s.cursor}};}
export function run(g:WorldGenesis,s:WorldState,a:WorldAction,id='hero',request?:string){return resolveWorld(g,s,command(s,a,id,request),principal(g,id));}
export function commit(g:WorldGenesis,s:WorldState,a:WorldAction,id='hero',request?:string):WorldState{const r=run(g,s,a,id,request);return withWorldHead(r.state,hash({previous:s.cursor.head,state_hash:worldStateHash(r.state),request:request??`request_${r.state.cursor.sequence}`}));}
export function start(g=genesis()){return initialWorldState(g);}
export const speak=(text='Hello',ids:string[]=['raider']):WorldAction=>({type:'speak',text,audience:{kind:'whisper',addressed_actor_ids:ids},in_reply_to:null});
export const offer=(offer_id='lamp_offer',expires_at=600):WorldAction=>({type:'offer_loan',offer_id,policy_id:'lamp_policy',item_id:'lamp',borrower_actor_id:'companion',return_location_id:'harbor',repair_cap_obols:5,expires_at});
export const accept=(s:WorldState):WorldAction=>({type:'accept_loan',offer_id:s.offers.at(-1)!.terms.offer_id,offer_hash:s.offers.at(-1)!.offer_hash});
export const actor=(s:WorldState,id='hero')=>s.physical.actors.find(a=>a.id===id)!;
export const item=(s:WorldState,id='lamp')=>s.physical.items.find(i=>i.id===id)!;
