/** Fresh-world mortal v3 contracts; v2 history is never reinterpreted. */
import type {Scope} from './generated.ts';
export const MORTAL_V3_PROFILE='mortal-rules/0.3.0' as const;
export type MortalV3Ability='strength'|'dexterity'|'constitution'|'intelligence'|'wisdom'|'charisma';
export type MortalV3Resources={rations:number;water:number;oil:number;obols:number;ammo:number};
export type MortalV3Resource=keyof MortalV3Resources;
export type MortalV3Actor={id:string;name:string;controller_id:string;kind:'player'|'npc';location_id:string;hp:number;max_hp:number;abilities:Record<MortalV3Ability,number>;resources:MortalV3Resources;active_seconds:number;fed_until:number;next_rest_at:number;discoveries:string[]};
export type MortalV3Item={id:string;name:string;slots:number} & (
 |{owner_id:string;location_id:null;equipped:boolean}
 |{owner_id:null;location_id:string;equipped:false}
) & (
 |{kind:'weapon';damage_die:4|6|8;attack_ability:'strength'|'wisdom';armor_defense:0;tool:null}
 |{kind:'armor';damage_die:0;attack_ability:null;armor_defense:number;tool:null}
 |{kind:'tool';equipped:false;damage_die:0;attack_ability:null;armor_defense:0;tool:'lamp'|'firekit'|null}
 |{kind:'loot';equipped:false;damage_die:0;attack_ability:null;armor_defense:0;tool:null}
);
export type MortalV3Location={id:string;name:string;safe_rest:boolean};
export type MortalV3Hazard={ability:MortalV3Ability;target:number;damage_die:4|6|8};
export type MortalV3Route={id:string;from:string;to:string;turns:number;requires_light:boolean;hazard:MortalV3Hazard|null};
export type MortalV3Opportunity={id:string;location_id:string;kind:'search'|'forage';ability:MortalV3Ability;target:number;turns:number;requires_light:boolean;remaining:number;reward_resource:MortalV3Resource;reward_units:number;failure_damage_die:0|4|6|8};
export type MortalV3Stock={id:string;location_id:string;resource:Exclude<MortalV3Resource,'obols'>;price:number;remaining:number;treasury:number};
export type MortalV3Genesis={version:typeof MORTAL_V3_PROFILE;scope:Scope;pack_hash:string;variant:'genuine'|'counterfeit'|'legend';seed:string;authority_key_id:string;authority_public_key:string;referee_id:string;world_time:number;actors:MortalV3Actor[];items:MortalV3Item[];locations:MortalV3Location[];routes:MortalV3Route[];opportunities:MortalV3Opportunity[];stocks:MortalV3Stock[]};
export type MortalV3Principal={scope:Scope;principal_id:string} & ({role:'player'|'npc';actor_id:string}|{role:'referee';actor_id:null});
export type MortalV3Cursor={sequence:number;head:string};
export type MortalV3Action=
 |{type:'travel';route_id:string}
 |{type:'explore';opportunity_id:string}
 |{type:'rest'}
 |{type:'wait';turns:number}
 |{type:'equip';item_id:string;equipped:boolean}
 |{type:'transfer_item';item_id:string;to_actor_id:string|null}
 |{type:'pickup';item_id:string}
 |{type:'loot';item_id:string}
 |{type:'give';to_actor_id:string;resource:MortalV3Resource;units:number}
 |{type:'buy';stock_id:string;units:number}
 |{type:'begin_encounter';encounter_id:string;side_a:string[];side_b:string[];escape_allowed:boolean}
 |{type:'attack';target_id:string;weapon_id:string}
 |{type:'defend'}
 |{type:'retreat'}
 |{type:'pass'}
 |{type:'recover_encounter';encounter_id:string;turn_started_sequence:number;resolution:'pass'|'close';reason:string};
export type MortalV3Command={version:typeof MORTAL_V3_PROFILE;scope:Scope;request_id:string;actor_id:string|null;expected:MortalV3Cursor;causation_id:string|null;action:MortalV3Action};
export type MortalV3Encounter={id:string;location_id:string;turn_started_sequence:number;side_a:string[];side_b:string[];order:string[];turn:number;round:number;round_participants:string[];escaped:string[];defended:string[];escape_allowed:boolean};
export type MortalV3State={version:typeof MORTAL_V3_PROFILE;scope:Scope;genesis_hash:string;sequence:number;head:string;world_time:number;rng_counter:number;actors:MortalV3Actor[];items:MortalV3Item[];opportunities:MortalV3Opportunity[];stocks:MortalV3Stock[];encounter:MortalV3Encounter|null};
export type MortalV3Draw={index:number;purpose:string;sides:number;value:number};
export type MortalV3Effect={kind:string;actor_id:string|null;subject_id:string|null;amount:number};
export type MortalV3Resolution={state:MortalV3State;draws:MortalV3Draw[];effects:MortalV3Effect[]};
export type MortalV3Event={version:typeof MORTAL_V3_PROFILE;scope:Scope;genesis_hash:string;sequence:number;previous_hash:string;command:MortalV3Command;principal:MortalV3Principal;before_hash:string;after_hash:string;draws:MortalV3Draw[];effects:MortalV3Effect[];signature:string;hash:string};
export type MortalV3Receipt={version:typeof MORTAL_V3_PROFILE;scope:Scope;genesis_hash:string;authority_key_id:string;signature:string;request_id:string;request_hash:string;event_hash:string;cursor:MortalV3Cursor;state_hash:string;effects:MortalV3Effect[]};
export type MortalV3ReceiptTrust={scope:Scope;genesis_hash:string;authority_key_id:string;authority_public_key:string};
export type MortalV3ActivityLock={encounter_id:string;location_id:string;reason:'roster'|'site'};
export type MortalV3ActorView={version:typeof MORTAL_V3_PROFILE;scope:Scope;cursor:MortalV3Cursor;world_time:number;
 activity_lock:MortalV3ActivityLock|null;
 self:Omit<MortalV3Actor,'controller_id'|'kind'>;items:MortalV3Item[];location:MortalV3Location;routes:MortalV3Route[];
 encounter:null|{id:string;round:number;acting_id:string;your_turn:boolean;escape_allowed:boolean;
  participants:{id:string;side:'a'|'b';condition:'standing'|'unconscious'|'dead';escaped:boolean}[]};
};
export interface MortalV3Ledger {
 snapshot():Promise<MortalV3State>;
 events(options?:{after:number;limit:number}):Promise<MortalV3Event[]>;
 submit(command:MortalV3Command,principal:MortalV3Principal):Promise<MortalV3Receipt>;
 close():Promise<void>;
}
export type MortalV3ContractMap={Genesis:MortalV3Genesis;Principal:MortalV3Principal;Command:MortalV3Command;State:MortalV3State;Event:MortalV3Event;Receipt:MortalV3Receipt;ActorView:MortalV3ActorView};
