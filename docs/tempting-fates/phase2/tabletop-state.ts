// Proposed Phase 2 input model for isolated referee records, not ledger state.
import type {Scope} from '@argo/contracts';
import type {Variant} from '../../../scenarios/tempted-fates/campaign/types.ts';
export type TabletopItem = {item_id:string;slots:number;destroyed:boolean} & (
 {custodian_actor_id:string;location_id:null} | {custodian_actor_id:null;location_id:string}
);
export type TabletopState = {
 version:'tempting-fates-tabletop/0.1.0'; source:'human_referee'; authoritative:false;
 rules_profile:'tempting-fates-rules/0.1.0'; scope:Scope; pack_hash:string; variant:Variant;
 revision:number; world_time:number;
 actors:{actor_id:string;location_id:string;hit_points:number;max_hit_points:number;
  abilities:{strength:number;dexterity:number;constitution:number;intelligence:number;wisdom:number;charisma:number};
  armor_defense:number;equipped_item_ids:string[];
  resources:{rations:number;water_units:number;oil_turns:number;obols:number};
  conditions:{condition_id:string;source_record_id:string;expires_at:number|null}[];
 }[];
 items:TabletopItem[];
 projects:{project_id:string;faction_id:string;progress:number;segments:number;resources:number}[];
 rulings:{ruling_id:string;actor_id:string;world_time:number;procedure:string;
  supplied_dice:number[];stated_risk:string;result:string}[];
};
