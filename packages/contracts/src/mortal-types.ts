import type {Scope} from './generated.ts';
export const MORTAL_PROFILE='mortal-rules/0.2.0' as const;
export type MortalAbility='strength'|'dexterity'|'constitution'|'intelligence'|'wisdom'|'charisma';
export type MortalResources={rations:number;water:number;oil:number;obols:number;ammo:number};
export type MortalResource=keyof MortalResources;
export type MortalActor={id:string;name:string;controller_id:string;kind:'player'|'npc';location_id:string;hp:number;max_hp:number;abilities:Record<MortalAbility,number>;resources:MortalResources;active_seconds:number;fed_until:number;next_rest_at:number;discoveries:string[]};
export type MortalItem={id:string;name:string;kind:'weapon'|'armor'|'tool'|'loot';owner_id:string|null;location_id:string|null;slots:number;equipped:boolean;damage_die:0|4|6|8;attack_ability:'strength'|'wisdom'|null;armor_defense:number;tool:'lamp'|'firekit'|null};
export type MortalLocation={id:string;name:string;safe_rest:boolean};
export type MortalHazard={ability:MortalAbility;target:number;damage_die:4|6|8};
export type MortalRoute={id:string;from:string;to:string;turns:number;requires_light:boolean;hazard:MortalHazard|null};
export type MortalOpportunity={id:string;location_id:string;kind:'search'|'forage';ability:MortalAbility;target:number;turns:number;requires_light:boolean;remaining:number;reward_resource:MortalResource;reward_units:number;failure_damage_die:0|4|6|8};
export type MortalStock={id:string;location_id:string;resource:MortalResource;price:number;remaining:number;treasury:number};
export type MortalGenesis={version:typeof MORTAL_PROFILE;scope:Scope;pack_hash:string;seed:string;authority_key_id:string;authority_public_key:string;referee_id:string;world_time:number;actors:MortalActor[];items:MortalItem[];locations:MortalLocation[];routes:MortalRoute[];opportunities:MortalOpportunity[];stocks:MortalStock[]};
export type MortalPrincipal={scope:Scope;principal_id:string;role:'player'|'npc'|'referee';actor_id:string|null};
export type MortalCursor={sequence:number;head:string};
export type MortalAction=
 |{type:'travel';route_id:string}
 |{type:'explore';opportunity_id:string}
 |{type:'rest'}
 |{type:'wait';turns:number}
 |{type:'equip';item_id:string;equipped:boolean}
 |{type:'transfer_item';item_id:string;to_actor_id:string|null}
 |{type:'pickup';item_id:string}
 |{type:'loot';item_id:string}
 |{type:'give';to_actor_id:string;resource:MortalResource;units:number}
 |{type:'buy';stock_id:string;units:number}
 |{type:'begin_encounter';encounter_id:string;side_a:string[];side_b:string[];escape_allowed:boolean}
 |{type:'attack';target_id:string;weapon_id:string}
 |{type:'defend'}
 |{type:'retreat'}
 |{type:'pass'};
export type MortalCommand={version:typeof MORTAL_PROFILE;scope:Scope;request_id:string;actor_id:string|null;expected:MortalCursor;causation_id:string|null;action:MortalAction};
export type MortalEncounter={id:string;side_a:string[];side_b:string[];order:string[];turn:number;round:number;escaped:string[];defended:string[];escape_allowed:boolean};
export type MortalState={version:typeof MORTAL_PROFILE;scope:Scope;genesis_hash:string;sequence:number;head:string;world_time:number;rng_counter:number;actors:MortalActor[];items:MortalItem[];opportunities:MortalOpportunity[];stocks:MortalStock[];encounter:MortalEncounter|null};
export type MortalDraw={index:number;purpose:string;sides:number;value:number};
export type MortalEffect={kind:string;actor_id:string|null;subject_id:string|null;amount:number};
export type MortalResolution={state:MortalState;draws:MortalDraw[];effects:MortalEffect[]};
export type MortalEvent={version:typeof MORTAL_PROFILE;scope:Scope;genesis_hash:string;sequence:number;previous_hash:string;command:MortalCommand;principal:MortalPrincipal;before_hash:string;after_hash:string;draws:MortalDraw[];effects:MortalEffect[];signature:string;hash:string};
export type MortalReceipt={version:typeof MORTAL_PROFILE;scope:Scope;request_id:string;request_hash:string;event_hash:string;cursor:MortalCursor;state_hash:string;effects:MortalEffect[]};
export type MortalContractMap={Genesis:MortalGenesis;Principal:MortalPrincipal;Command:MortalCommand;State:MortalState;Event:MortalEvent;Receipt:MortalReceipt};
