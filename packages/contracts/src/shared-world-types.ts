/** New-world authority only; imported historical profile definitions are unchanged. */
import type {KeyObject} from 'node:crypto';
import type {Scope} from './generated.ts';
import type {CharacterNature,CharacterActivity} from './character-types.ts';
import type {AuthoredKnowledgeCatalog,AuthoredSourceManifest,AuthoredKnowledgeEntry,AuthoredKnowledgeSource,TrustedKnowledgeIdentity} from './dialogue-knowledge-types.ts';
import type {MortalV3Genesis,MortalV3State,MortalV3Principal,MortalV3Action,MortalV3ActorView,MortalV3Draw,MortalV3Effect} from './mortal-v3-types.ts';

export const WORLD_PROFILE='shared-world/0.1.0' as const;
export type WorldCursor={sequence:number;head:string;world_time:number};
export type WorldPrincipal=MortalV3Principal;
export type WorldPhysical=Pick<MortalV3State,'actors'|'items'|'opportunities'|'stocks'|'encounter'|'rng_counter'>;
export type WorldProfile={actor_id:string;revision:number;nature:CharacterNature;activity:CharacterActivity;max_speech_characters:number;
 presentation:{occupation:string;wants:string;will_not:string}};
export type WorldScene={location_id:string;description:string};
export type WorldGenesis={version:typeof WORLD_PROFILE;mortal:MortalV3Genesis;environment:'day'|'night';profiles:WorldProfile[];scenes:WorldScene[];
 knowledge_catalog:AuthoredKnowledgeCatalog;source_manifest:AuthoredSourceManifest;initial_knowledge_ids:string[]};
export type WorldAudience={kind:'self';addressed_actor_ids:[]}|{kind:'whisper'|'room';addressed_actor_ids:string[]};
export type WorldAction=
 |{type:'mortal';action:MortalV3Action}
 |{type:'speak';text:string;audience:WorldAudience;in_reply_to:string|null}
 |{type:'impress';subject_actor_id:string;evidence_ids:string[];interpretation:string;previous_impression_id:string|null}
 |{type:'set_activity';activity:CharacterActivity}
 |{type:'offer_loan';offer_id:string;policy_id:string;item_id:string;borrower_actor_id:string;return_location_id:string;repair_cap_obols:number;expires_at:number}
 |{type:'withdraw_loan_offer';offer_id:string}
 |{type:'accept_loan';offer_id:string;offer_hash:string}
 |{type:'return_loan';loan_id:string}
 |{type:'set_knowledge';knowledge_id:string;active:boolean}
 |{type:'close_mythic_engagement'};
export type WorldCommand={version:typeof WORLD_PROFILE;scope:Scope;request_id:string;actor_id:string|null;expected:WorldCursor;causation_id:string;action:WorldAction};
/** Immutable offer body; its hash excludes lifecycle status and binds this genesis. */
export type WorldLoanTerms={genesis_hash:string;offer_id:string;policy_id:string;item_id:string;lender_actor_id:string;borrower_actor_id:string;
 return_location_id:string;loan_fee_obols:0;advance_deposit_obols:0;repair_basis:'actual_damage_by_explicit_agreement';repair_cap_obols:number;
 oil_supplied_by:'borrower';expires_at:number;issued_sequence:number;issued_at:number};
export type WorldLoanOffer={terms:WorldLoanTerms;offer_hash:string;status:'open'|'withdrawn'|'accepted';closed_sequence:number|null};
/** loan_id equals offer_id. No automatic monetary debt is represented. */
export type WorldLoan={loan_id:string;offer_id:string;offer_hash:string;item_id:string;lender_actor_id:string;borrower_actor_id:string;
 accepted_sequence:number;accepted_at:number;status:'open'|'returned';returned_sequence:number|null};
export type WorldKnowledgeAcquisition={knowledge_id:string;origin:'genesis'|'event';sequence:number;world_time:number;active:boolean};
export type WorldMemoryPayload=
 |{type:'speak';text:string;audience:WorldAudience;in_reply_to:string|null}
 |{type:'impress';subject_actor_id:string;interpretation:string;impression_id:string}
 |{type:'set_activity';activity:CharacterActivity}
 |{type:'loan_offered';terms:WorldLoanTerms;offer_hash:string}
 |{type:'loan_withdrawn';offer_id:string;lender_actor_id:string;borrower_actor_id:string}
 |{type:'loan_accepted';loan_id:string;offer_id:string;offer_hash:string;item_id:string;lender_actor_id:string;borrower_actor_id:string}
 |{type:'loan_returned';loan_id:string;offer_id:string;item_id:string;lender_actor_id:string;borrower_actor_id:string;holder_actor_id:string;via_mortal:'transfer_item'|'pickup'|'loot'|null}
 |{type:'mortal';action:MortalV3Action['type'];actor_ids:string[];item_ids:string[];location_ids:string[]}
 |{type:'set_knowledge';knowledge_id:string;owner_actor_id:string;active:boolean}
 |{type:'close_mythic_engagement'};
export type WorldMemory={record_id:string;request_id:string;sequence:number;world_time:number;actor_id:string|null;acquired_by:string[];payload:WorldMemoryPayload};
export type WorldVisibleMemoryPayload=WorldMemoryPayload|{type:'custody_returned';item_id:string;from_actor_id:string;to_actor_id:string};
/** Request identities and acquisition rosters are host-private. */
export type WorldVisibleMemory=Omit<WorldMemory,'acquired_by'|'request_id'|'payload'>&{payload:WorldVisibleMemoryPayload};
export type WorldImpression={impression_id:string;owner_actor_id:string;subject_actor_id:string;evidence_ids:string[];sequence:number;world_time:number;
 nature_revision:number;nature:CharacterNature;interpretation:string;previous_impression_id:string|null};
export type WorldState={version:typeof WORLD_PROFILE;scope:Scope;genesis_hash:string;cursor:WorldCursor;physical:WorldPhysical;profiles:WorldProfile[];
 memories:WorldMemory[];impressions:WorldImpression[];knowledge:WorldKnowledgeAcquisition[];offers:WorldLoanOffer[];loans:WorldLoan[];mythic_closed:boolean};
export type WorldQuery={version:typeof WORLD_PROFILE;scope:Scope;actor_id:string;cursor:WorldCursor};
export type WorldPhysicalView=Omit<MortalV3ActorView,'version'|'scope'|'cursor'|'world_time'>;
export type WorldActorView={version:typeof WORLD_PROFILE;genesis_hash:string;query:WorldQuery;profile:WorldProfile;physical:WorldPhysicalView;
 scene:WorldScene&{environment:'day'|'night';occupants:{actor_id:string;name:string;condition:'standing'|'unconscious'|'dead'}[]};
 memories:WorldVisibleMemory[];impressions:WorldImpression[];knowledge:{entry:AuthoredKnowledgeEntry;acquisition:WorldKnowledgeAcquisition}[];
 knowledge_source:TrustedKnowledgeIdentity;source_definitions:AuthoredKnowledgeSource[];replied_to:string[];
 coverage:{memory_total:number;memory_returned:number;impressions_total:number;impressions_returned:number;complete:boolean};mythic_closed:boolean};
export type WorldResolution={state:WorldState;draws:MortalV3Draw[];effects:MortalV3Effect[];memory:WorldMemory};
/** Signed host artifact; never return the raw event as actor narration. */
export type WorldEvent={version:typeof WORLD_PROFILE;scope:Scope;genesis_hash:string;sequence:number;previous_hash:string;world_time:number;
 command:WorldCommand;principal:WorldPrincipal;before_hash:string;after_hash:string;draws:MortalV3Draw[];effects:MortalV3Effect[];memory:WorldMemory;signature:string;hash:string};
export type WorldReceipt={version:typeof WORLD_PROFILE;scope:Scope;genesis_hash:string;authority_key_id:string;signature:string;request_id:string;
 request_hash:string;event_hash:string;cursor:WorldCursor;state_hash:string};
export type WorldReceiptTrust={scope:Scope;genesis_hash:string;authority_key_id:string;authority_public_key:string};
export type WorldLedgerOptions={path:string;genesis:WorldGenesis;privateKey:KeyObject;expectedHead?:WorldCursor};
export interface WorldLedger {
 snapshot():Promise<WorldState>;
 events(options?:{after:number;limit:number}):Promise<WorldEvent[]>;
 submit(command:WorldCommand,principal:WorldPrincipal):Promise<WorldReceipt>;
 close():Promise<void>;
}
export interface WorldContractMap {
 Genesis:WorldGenesis;Physical:WorldPhysical;Profile:WorldProfile;Principal:WorldPrincipal;Cursor:WorldCursor;Action:WorldAction;Command:WorldCommand;
 State:WorldState;Query:WorldQuery;ActorView:WorldActorView;Memory:WorldMemory;Impression:WorldImpression;LoanTerms:WorldLoanTerms;LoanOffer:WorldLoanOffer;
 Loan:WorldLoan;KnowledgeAcquisition:WorldKnowledgeAcquisition;Resolution:WorldResolution;Event:WorldEvent;Receipt:WorldReceipt;ReceiptTrust:WorldReceiptTrust;
}
