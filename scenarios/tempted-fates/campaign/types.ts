// Additive campaign-kit interface. This file exports types only, never authority.
import type {CharacterActivity,CharacterNature,CharacterProfile,CharacterSpeechPolicy,Genesis,Scope} from '@argo/contracts';

export type Variant = 'genuine'|'counterfeit'|'legend';
export type Assessment = 'true'|'partial'|'outdated'|'false';
export type FateRole = 'clotho'|'lachesis'|'atropos';
export type CampaignCalendar = {
 seconds_per_day:86400; days_per_year:360; exploration_turn_seconds:600;
 combat_round_seconds:6; watch_seconds:14400;
};
export type CampaignLocation = {
 id:string; name:string; mythic_influence:string; public_description:string;
 referee_notes:string; occupant_ids:string[]; route_ids:string[]; is_loom:boolean;
};
export type CampaignRoute = {
 id:string; from:string; to:string; travel_turns:number; condition:string;
 sign:string; access:'ordinary'|'conditional';
};
export type CampaignNpc = {
 id:string; name:string; occupation:string; location_id:string;
 nature:CharacterNature; activity:CharacterActivity; speech_policy:CharacterSpeechPolicy;
 age_years:number; remaining_years:number; fate_role:FateRole|null;
 public_description:string; private_knowledge:string[]; wants:string; will_not:string;
 speech_example:string;
};
export type CampaignClock = {
 name:string; segments:number; progress:number; advance_trigger:string;
 completion:string; visible_sign:string; interruption:string;
};
export type CampaignFaction = {
 id:string; name:string; members:string[]; goal:string; resources:number;
 clock:CampaignClock; approaches:string[];
};
export type CampaignRumor = {
 id:string; speaker_id:string; location_id:string; text:string; lead_location_id:string;
 assessment:Record<Variant,Assessment>; referee_basis:string;
};
export type CampaignItem = {
 id:string; name:string; description:string; custodian_id:string|null;
 slots:number; variants:Variant[]; secret:boolean;
};
export type CampaignEncounter = {
 id:string; location_id:string; title:string; visible_situation:string;
 participants:string[]; approaches:string[]; if_ignored:string; costs:string[];
 clue:string; exit:string;
};
export type CampaignVariant = {id:Variant; referee_truth:string; artifact_item_id:string|null};
export type CampaignHook = {
 id:string; title:string; prompt:string; location_id:string;
 possible_actions:string[]; decline_consequence:string;
};
export type CampaignPack = {
 version:'tempting-fates-pack/0.1.0'; title:string; subtitle:string; tone_note:string;
 adaptation_note:string; public_intro:string; start_location_id:string;
 calendar:CampaignCalendar; locations:CampaignLocation[]; routes:CampaignRoute[];
 npcs:CampaignNpc[]; factions:CampaignFaction[]; rumors:CampaignRumor[];
 items:CampaignItem[]; encounters:CampaignEncounter[]; variants:CampaignVariant[];
 starting_hooks:CampaignHook[];
};

// Public outputs deliberately omit referee-only assessment, variant and seed data.
export type PlayerHandout = {
 version:CampaignPack['version']; title:string; subtitle:string; introduction:string;
 start:{id:string;name:string;description:string}; rules_profile:'tempting-fates-rules/0.1.0';
};
export type RumorCandidate = {id:string;speaker_id:string;text:string;lead_location_id:string};
export type CampaignTraveler = {actor_id:string;name:string;nature:CharacterNature};
export type CampaignSeedOptions = {
 scope:Scope; privateSeed:string; authorityKeyId:string; authorityPublicKey:string;
 variant:Variant; travelers:CampaignTraveler[];
};
export type CampaignSeed = {
 genesis:Genesis; profiles:CharacterProfile[];
 manifest:{pack_version:CampaignPack['version'];pack_hash:string;variant:Variant};
};
export interface CampaignCatalog {
 assertCampaignPack(value:unknown):asserts value is CampaignPack;
 getPlayerHandout(pack:CampaignPack):PlayerHandout;
 getRumorCandidate(pack:CampaignPack,rumorId:string):RumorCandidate;
 buildCampaignSeed(pack:CampaignPack,options:CampaignSeedOptions):CampaignSeed;
}

export type AbilityResult = {bonus:number;defense:number};
export type CheckInput = {rolls:readonly number[];mode:'normal'|'advantage'|'disadvantage';bonus:number;target:number};
export type CheckResult = {die:number;total:number;success:boolean};
export type CapacityInput = {constitutionDefense:number;itemSlots:readonly number[]};
export type CapacityResult = {capacity:number;occupied:number;remaining:number;fits:boolean};
export type HealthResult = {hitPoints:number;condition:'standing'|'unconscious'|'dead'};
export type DamageInput = {hitPoints:number;damage:number};
export type RestInput = {hitPoints:number;maxHitPoints:number;constitutionBonus:number;die:number};
export type MoraleInput = {dice:readonly [number,number];rating:number};
export type MoraleResult = {total:number;holds:boolean};
export type ProjectInput = {progress:number;segments:number;resources:number;steps:number};
export type ProjectResult = {progress:number;segments:number;resources:number;completed:boolean};
export interface CampaignRules {
 abilityFromDice(dice:readonly [number,number,number]):AbilityResult;
 resolveCheck(input:CheckInput):CheckResult;
 capacity(input:CapacityInput):CapacityResult;
 previewDamage(input:DamageInput):HealthResult;
 previewRest(input:RestInput):HealthResult;
 resolveMorale(input:MoraleInput):MoraleResult;
 previewProject(input:ProjectInput):ProjectResult;
}
