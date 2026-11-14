/** Fresh authored initialization only; never accepts a live v2 state or journal. */
import {assertMortalV3Genesis,hash,MORTAL_V3_PROFILE} from '@argo/contracts';
import type {MortalV3Genesis} from '@argo/contracts';
import {buildMortalCampaign} from './runtime.ts';
import type {MortalCampaignOptions} from './runtime.ts';

export type MortalV3CampaignSeed={genesis:MortalV3Genesis;manifest:{adapter:'tempting-fates-mortal/0.3.0';pack_hash:string;genesis_hash:string;variant:MortalCampaignOptions['variant'];hp_mode:MortalCampaignOptions['hp_mode']}};

export function buildMortalV3Campaign(value:unknown,input:MortalCampaignOptions):MortalV3CampaignSeed{
 // Reuse the established authored roster/equipment and deterministic creation
 // rolls. Neither a storage handle nor an existing world is opened or migrated.
 const authored=buildMortalCampaign(value,input);
 const genesis:MortalV3Genesis={...authored.genesis,version:MORTAL_V3_PROFILE};
 assertMortalV3Genesis(genesis);
 return {genesis,manifest:{...authored.manifest,adapter:'tempting-fates-mortal/0.3.0',genesis_hash:hash(genesis)}};
}
