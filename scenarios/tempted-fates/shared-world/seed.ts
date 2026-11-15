/** Fresh pinned campaign initialization. No storage, migration or implicit grant. */
import {fail,freezeDto,hash} from '@argo/contracts';
import type {CharacterNature} from '@argo/contracts';
import {WORLD_PROFILE} from '../../../packages/contracts/src/shared-world-types.ts';
import type {WorldGenesis,WorldProfile} from '../../../packages/contracts/src/shared-world-types.ts';
import {assertWorldContract,assertWorldData,assertWorldGenesis} from '../../../packages/contracts/src/shared-world.ts';
import {assertKnowledgeCatalogIdentity} from '../../../packages/contracts/src/dialogue-knowledge.ts';
import {buildMortalV3Campaign} from '../runtime-v3.ts';
import type {MortalCampaignOptions} from '../runtime.ts';
import {assertCampaignPack} from '../campaign/catalog.ts';
import type {CampaignPack} from '../campaign/types.ts';
import {campaignKnowledgeCatalog,campaignKnowledgeSourceManifest,campaignKnowledgeIdentity} from '../campaign/knowledge/index.ts';

export type SharedWorldTraveler=MortalCampaignOptions['travelers'][number]&{
 nature:CharacterNature;presentation:WorldProfile['presentation'];max_speech_characters:number;
};
export type SharedWorldCampaignOptions=Omit<MortalCampaignOptions,'travelers'>&{
 environment:'day'|'night';starting_kit:'standard'|'borrowed_lamp';initial_knowledge_ids:string[];
 travelers:SharedWorldTraveler[];
};
/** Safe source metadata: never a seed, signing key, controller map or private prose. */
export type SharedWorldCampaignManifest={
 adapter:'tempting-fates-shared/0.1.0';pack_hash:string;genesis_hash:string;mortal_genesis_hash:string;
 catalog_hash:string;source_manifest_hash:string;variant:SharedWorldCampaignOptions['variant'];
 hp_mode:SharedWorldCampaignOptions['hp_mode'];environment:SharedWorldCampaignOptions['environment'];
 starting_kit:SharedWorldCampaignOptions['starting_kit'];initial_knowledge_ids:string[];
};
export type SharedWorldCampaignSeed={genesis:WorldGenesis;manifest:SharedWorldCampaignManifest};

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function closed(value:unknown,fields:string[]):void{
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key)))invalid('Shared campaign host options must have exactly the declared fields');
}
function exactId(value:unknown):asserts value is string{
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$(?![\s\S])/.test(value)||['__proto__','constructor','prototype'].includes(value))invalid('Invalid shared campaign identity');
}
function travelerProfile(value:SharedWorldTraveler):WorldProfile{
 return {actor_id:value.id,revision:1,nature:value.nature,activity:{description:'Following their own course.',busy_until:0},max_speech_characters:value.max_speech_characters,presentation:value.presentation};
}

/** Generate one fresh authority genesis. The caller selects the rights scope,
 * controllers and initial grants; this function does not authenticate that host.
 * Day/night is fixed authored initialization, not a running weather/time system. */
export function buildSharedWorldCampaign(pack:CampaignPack,input:SharedWorldCampaignOptions):SharedWorldCampaignSeed{
 // Validate all caller data before destructuring or reading nested properties.
 assertCampaignPack(pack);assertWorldData(input);
 closed(input,['scope','seed','authority_key_id','authority_public_key','referee_id','npc_controller_id','variant','hp_mode','travelers','environment','starting_kit','initial_knowledge_ids']);
 if(!['day','night'].includes(input.environment)||!['standard','borrowed_lamp'].includes(input.starting_kit))invalid('Explicit supported environment and starting kit are required');
 if(!Array.isArray(input.travelers)||input.travelers.length<1||input.travelers.length>6)invalid('Shared campaign requires one to six travelers');
 if(!Array.isArray(input.initial_knowledge_ids)||input.initial_knowledge_ids.length>64||new Set(input.initial_knowledge_ids).size!==input.initial_knowledge_ids.length)invalid('Initial knowledge must be a bounded unique selection');
 assertKnowledgeCatalogIdentity(campaignKnowledgeCatalog,campaignKnowledgeSourceManifest,campaignKnowledgeIdentity);
 if(hash(pack)!==campaignKnowledgeIdentity.pack_hash)invalid('Shared campaign requires the exact pinned authored pack');
 const policies=new Set(campaignKnowledgeCatalog.entries.map(row=>row.knowledge_id));
 for(const id of input.initial_knowledge_ids){exactId(id);if(!policies.has(id))invalid('Initial shared knowledge is not in the pinned catalog');}

 // Reserve authored identities across variants and generated equipment before
 // calling the old factory. A kit cannot hide an ID collision by deleting it.
 const reserved=new Set<string>();
 const reserve=(id:string):void=>{exactId(id);if(reserved.has(id))invalid('Shared campaign actor/item identity collision');reserved.add(id);};
 for(const npc of pack.npcs)reserve(npc.id);
 for(const item of pack.items)reserve(item.id);
 for(const traveler of input.travelers){
  closed(traveler,['id','name','controller_id','weapon','nature','presentation','max_speech_characters']);
  reserve(traveler.id);assertWorldContract('Profile',travelerProfile(traveler));
 }
 for(const npc of pack.npcs.filter(row=>row.fate_role===null))reserve(`${npc.id}_work_knife`);
 for(const traveler of input.travelers)for(const suffix of ['weapon','lamp','firekit'])reserve(`${traveler.id}_${suffix}`);

 const {environment,starting_kit,initial_knowledge_ids,travelers,...base}=input;
 const authored=buildMortalV3Campaign(pack,{...base,travelers:travelers.map(({id,name,controller_id,weapon})=>({id,name,controller_id,weapon}))});
 const mortal=authored.genesis;
 for(const route of mortal.routes)route.requires_light=environment==='night';
 if(starting_kit==='borrowed_lamp'){
  const personalLamps=new Set(travelers.map(actor=>`${actor.id}_lamp`));
  mortal.items=mortal.items.filter(item=>!personalLamps.has(item.id));
 }
 const profiles:WorldProfile[]=mortal.actors.map(actor=>{
  const npc=pack.npcs.find(row=>row.id===actor.id);
  if(npc)return {actor_id:npc.id,revision:1,nature:npc.nature,activity:npc.activity,max_speech_characters:npc.speech_policy.max_characters,presentation:{occupation:npc.occupation,wants:npc.wants,will_not:npc.will_not}};
  const traveler=travelers.find(row=>row.id===actor.id);if(!traveler)invalid('Shared campaign is missing its actor profile');
  return travelerProfile(traveler);
 });
 const genesis:WorldGenesis={version:WORLD_PROFILE,mortal,environment,profiles,
  scenes:mortal.locations.map(location=>{const authored=pack.locations.find(row=>row.id===location.id);if(!authored)invalid('Shared campaign is missing its authored scene');return {location_id:location.id,description:authored.public_description};}),
  knowledge_catalog:campaignKnowledgeCatalog,source_manifest:campaignKnowledgeSourceManifest,initial_knowledge_ids};
 assertWorldGenesis(genesis);
 const manifest:SharedWorldCampaignManifest={adapter:'tempting-fates-shared/0.1.0',pack_hash:campaignKnowledgeIdentity.pack_hash,genesis_hash:hash(genesis),mortal_genesis_hash:hash(mortal),catalog_hash:campaignKnowledgeIdentity.catalog_hash,source_manifest_hash:campaignKnowledgeIdentity.source_manifest_hash,variant:input.variant,hp_mode:input.hp_mode,environment,starting_kit,initial_knowledge_ids};
 // Never freeze caller-owned nature, presentation or selection arrays.
 return freezeDto(structuredClone({genesis,manifest}));
}
