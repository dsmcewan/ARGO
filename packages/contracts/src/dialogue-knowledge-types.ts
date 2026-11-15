import type {Scope} from './generated.ts';
import type {CharacterActorQuery,CharacterCursor} from './character-types.ts';

export type AuthoredKnowledgeSource = {
 source_id:string;document_path:string;document_sha256:string;
 locator:{start_line:number;end_line:number};excerpt_sha256:string;
};
export type AuthoredSourceManifest = {
 version:'authored-knowledge-sources/1.0.0';manifest_id:string;revision:string;sources:AuthoredKnowledgeSource[];
};
export type AuthoredSourceDocument = {document_path:string;content:string};
export type AuthoredLoanTerms = {
 loan_fee_obols:number;advance_deposit_obols:number;replacement_value_obols:number;
 repair_basis:'actual_damage_by_explicit_agreement';repair_cap_obols:number;
 oil_supplied_by:'borrower';oil_price_obols:number;oil_duration_exploration_turns:number;
 return_checkpoint:'explicit_agreement_normally_next_harbor_return';compulsory_service:false;oath_required:false;
};
export type AuthoredKnowledgeEntry = {
 knowledge_id:string;owner_actor_id:string;kind:'offer_policy';subject_item_id:string;text:string;
 terms:AuthoredLoanTerms;validity:{from_tick:number;until_tick:number|null};
 provenance:{kind:'authored_actor_policy';source_ids:string[]};
 disclosure:'owner_context_may_express_in_addressed_speech';
};
export type AuthoredKnowledgeCatalog = {
 version:'authored-knowledge/1.0.0';catalog_id:string;revision:string;
 pack_hash:string;source_manifest_hash:string;entries:AuthoredKnowledgeEntry[];
};
/** Pins are supplied by trusted bundled configuration/verified content, never a worker. */
export type TrustedKnowledgeIdentity = {pack_hash:string;catalog_hash:string;source_manifest_hash:string};
/** Persist this once at registration. Reading must not create or re-date activation. */
export type AuthoredKnowledgeActivation = {
 version:'authored-knowledge-activation/1.0.0';activation_id:string;scope:Scope;owner_actor_id:string;
 catalog_hash:string;source_manifest_hash:string;acquired_at:CharacterCursor;knowledge_ids:string[];
};
/** This host attestation is not a signature or proof supplied by JSON shape. */
export type AuthoredKnowledgeDisclosure = {
 version:'authored-knowledge-disclosure/1.0.0';query:CharacterActorQuery;
 catalog_hash:string;source_manifest_hash:string;activation_hash:string;knowledge_ids:string[];
 basis:'host_current_entitlement_and_ancestor_membership';
};
export type AuthoredKnowledgeRead = {
 version:'authored-knowledge-read/1.0.0';query:CharacterActorQuery;
 activation:AuthoredKnowledgeActivation|null;disclosure:AuthoredKnowledgeDisclosure|null;
};
export type AuthoredKnowledgeView = {
 version:'authored-knowledge-view/1.0.0';query:CharacterActorQuery;source:TrustedKnowledgeIdentity;
 activation:{activation_id:string;activation_hash:string;acquired_at:CharacterCursor};
 claims:AuthoredKnowledgeEntry[];source_definitions:AuthoredKnowledgeSource[];
};
export type DialogueSupplementV2 = {
 version:'character-dialogue/0.2.0';query:CharacterActorQuery;
 source:{content_hash:string;revision:string};
 actor:{actor_id:string;name:string;occupation:string;wants:string;will_not:string}|null;
 scene:{location_id:string;name:string;description:string}|null;
 actor_knowledge:AuthoredKnowledgeView|null;
};
export interface AuthoredKnowledgeContractMap {
 AuthoredKnowledgeSource:AuthoredKnowledgeSource;
 AuthoredSourceManifest:AuthoredSourceManifest;
 AuthoredSourceDocument:AuthoredSourceDocument;
 AuthoredLoanTerms:AuthoredLoanTerms;
 AuthoredKnowledgeEntry:AuthoredKnowledgeEntry;
 AuthoredKnowledgeCatalog:AuthoredKnowledgeCatalog;
 TrustedKnowledgeIdentity:TrustedKnowledgeIdentity;
 AuthoredKnowledgeActivation:AuthoredKnowledgeActivation;
 AuthoredKnowledgeDisclosure:AuthoredKnowledgeDisclosure;
 AuthoredKnowledgeRead:AuthoredKnowledgeRead;
 AuthoredKnowledgeView:AuthoredKnowledgeView;
 DialogueSupplementV2:DialogueSupplementV2;
}
