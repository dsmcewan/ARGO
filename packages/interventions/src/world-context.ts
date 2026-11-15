import {Buffer} from 'node:buffer';
import {assertWorldContract,canonical,fail,freezeDto} from '@argo/contracts';
import type {WorldActorView} from '@argo/contracts';

export const WORLD_DIALOGUE_PROFILE='shared-world-dialogue/0.1.0' as const;

/** A scoped reader, not this packet builder, authenticates acquisition and currentness. */
export function worldDialoguePacket(input:WorldActorView,recordId:string){
 assertWorldContract('ActorView',input);
 if(typeof recordId!=='string'||!/^[0-9a-f]{64}$/.test(recordId))fail('INVALID_CONTRACT','Invalid world inbound record identity');
 const view=structuredClone(input),actor=view.query.actor_id,record=view.memories.find(row=>row.record_id===recordId);
 if(view.mythic_closed||view.physical.self.hp<=0||view.profile.activity.busy_until>view.query.cursor.world_time||view.replied_to.includes(recordId)||
  !record||record.payload.type!=='speak'||record.actor_id===null||record.actor_id===actor||record.payload.audience.kind==='self'||!record.payload.audience.addressed_actor_ids.includes(actor))return null;
 if(!view.scene.occupants.some(occupant=>occupant.actor_id===record.actor_id&&occupant.condition==='standing'))return null;
 const {id:_,name:__,location_id:___,...self}=view.physical.self;
 const selected=view.impressions.filter(row=>row.subject_actor_id===record.actor_id);
 const impressions=selected.map(({nature:_,nature_revision,...row})=>({...row,nature_ref:{actor_id:actor,revision:nature_revision}}));
 // Current private definitions appear once. Historical statements stay observations,
 // and unrelated private interpretations are not additional model context.
 const memories=view.memories.filter(row=>!['impress','set_activity','set_knowledge'].includes(row.payload.type));
 const packet={version:WORLD_DIALOGUE_PROFILE,task:'reply' as const,genesis_hash:view.genesis_hash,query:view.query,
  character:{actor_id:actor,profile_revision:view.profile.revision,nature:view.profile.nature,activity:view.profile.activity,
   presentation:view.profile.presentation,response_character_limit:view.profile.max_speech_characters},
  scene:{location_id:view.scene.location_id,name:view.physical.location.name,authored_backdrop:view.scene.description,
   environment:view.scene.environment,current_occupants:view.scene.occupants},
  physical:{self,items:view.physical.items,routes:view.physical.routes,encounter:view.physical.encounter,activity_lock:view.physical.activity_lock},
  focus_record_id:recordId,subject_actor_id:record.actor_id,
  reply_audience:{kind:record.payload.audience.kind,addressed_actor_ids:[record.actor_id]},
  memories,impressions,knowledge:{identity:view.knowledge_source,entries:view.knowledge,source_definitions:view.source_definitions},
  coverage:{view:view.coverage,selected_memories:memories.length,selected_impressions:impressions.length,
   omitted_view_memories:view.memories.length-memories.length,omitted_view_impressions:view.impressions.length-impressions.length}};
 if(Buffer.byteLength(canonical(packet))>131072)fail('INVALID_CONTRACT','World dialogue packet exceeds its byte budget');
 return freezeDto(packet);
}

export type WorldDialoguePacket=NonNullable<ReturnType<typeof worldDialoguePacket>>;
