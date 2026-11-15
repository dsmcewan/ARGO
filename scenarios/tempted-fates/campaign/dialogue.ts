import {types as nodeTypes} from 'node:util';
import {assertCharacterContract, fail, freezeDto, hash} from '@argo/contracts';
import type {CharacterActorQuery} from '@argo/contracts';
import type {DialogueSupplement} from '@argo/interventions';
import {assertCampaignPack} from './catalog.ts';
import type {CampaignPack} from './types.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function exactId(value:unknown):asserts value is string {
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$(?![\s\S])/.test(value)||['__proto__','prototype','constructor'].includes(value))
  invalid('Invalid dialogue content identity');
}
function bounded(value:string,limit:number):string {
 if([...value].length>limit)invalid('Campaign field exceeds its dialogue presentation limit');
 return value;
}

/** This closed grant contains a scalar only. Inspect descriptors before reading
 * it, so getters, proxies, hidden properties and inherited grants cannot run. */
function locationGrant(value:unknown):string|null {
 if(value===null||typeof value!=='object'||nodeTypes.isProxy(value))invalid('Dialogue room grant requires passive data');
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)invalid('Dialogue room grant requires a plain object');
 const keys=Reflect.ownKeys(value);
 if(keys.length!==1||keys[0]!=='location_id')invalid('Dialogue room grant requires only location_id');
 const descriptor=Object.getOwnPropertyDescriptor(value,'location_id');
 if(!descriptor?.enumerable||!('value'in descriptor))invalid('Dialogue room grant cannot contain an accessor');
 if(descriptor.value===null)return null;
 exactId(descriptor.value);return descriptor.value;
}

/** Pure authored-content projection, not authentication or perception. The host
 * grants the room for this exact actor/cursor; seed occupancy grants nothing.
 * The model receives neither the pack nor its referee/private/sample fields. */
export function buildCampaignDialogueSupplement(
 pack:CampaignPack,query:CharacterActorQuery,grant:{location_id:string|null},
):DialogueSupplement {
 // Both validators reject active nested data before traversing caller fields.
 assertCampaignPack(pack);assertCharacterContract('CharacterActorQuery',query);
 const locationId=locationGrant(grant);exactId(query.actor_id);
 const npc=pack.npcs.find(row=>row.id===query.actor_id);
 const room=locationId===null?null:pack.locations.find(row=>row.id===locationId);
 if(locationId!==null&&!room)invalid('Unknown disclosed campaign room');
 const result:DialogueSupplement={
  version:'character-dialogue/0.1.0',query:structuredClone(query),
  source:{content_hash:hash(pack),revision:pack.version},
  actor:npc?{actor_id:npc.id,name:bounded(npc.name,256),occupation:bounded(npc.occupation,512),wants:bounded(npc.wants,2048),will_not:bounded(npc.will_not,2048)}:null,
  scene:room?{location_id:room.id,name:bounded(room.name,256),description:bounded(room.public_description,8192)}:null,
 };
 return freezeDto(result);
}
