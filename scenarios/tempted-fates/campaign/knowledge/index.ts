import {assertCharacterContract,canonical,fail,freezeDto,hash} from '@argo/contracts';
import type {CharacterActorQuery} from '@argo/contracts';
import {assertAuthoredKnowledgeContract,assertKnowledgeActivationRegistration,assertKnowledgeCatalogIdentity,assertKnowledgeReadBinding,assertKnowledgeViewBinding} from '../../../../packages/contracts/src/dialogue-knowledge.ts';
import type {AuthoredKnowledgeCatalog,AuthoredSourceManifest,TrustedKnowledgeIdentity,AuthoredKnowledgeActivation,AuthoredKnowledgeRead,AuthoredKnowledgeView,DialogueSupplementV2} from '../../../../packages/contracts/src/dialogue-knowledge-types.ts';
import {assertCampaignPack} from '../catalog.ts';
import {buildCampaignDialogueSupplement} from '../dialogue.ts';
import type {CampaignPack} from '../types.ts';
import catalogData from './catalog.json' with {type:'json'};
import sourceData from './sources.json' with {type:'json'};
import identityData from './identity.json' with {type:'json'};

// These reviewed bundled identities are never selected by a caller or model.
// Source bytes and this package-local mirror are checked by content tests.
assertAuthoredKnowledgeContract('AuthoredKnowledgeCatalog',catalogData);
assertAuthoredKnowledgeContract('AuthoredSourceManifest',sourceData);
assertAuthoredKnowledgeContract('TrustedKnowledgeIdentity',identityData);
assertKnowledgeCatalogIdentity(catalogData,sourceData,identityData);
export const campaignKnowledgeCatalog:AuthoredKnowledgeCatalog=freezeDto(structuredClone(catalogData));
export const campaignKnowledgeSourceManifest:AuthoredSourceManifest=freezeDto(structuredClone(sourceData));
export const campaignKnowledgeIdentity:TrustedKnowledgeIdentity=freezeDto(structuredClone(identityData));

function checkedPack(pack:CampaignPack):void{
 assertCampaignPack(pack);
 if(hash(pack)!==campaignKnowledgeIdentity.pack_hash)fail('INVALID_CONTRACT','Authored knowledge is pinned to a different campaign pack');
 // Policies name authored entities; this establishes no live presence/custody.
 for(const entry of campaignKnowledgeCatalog.entries){
  if(!pack.npcs.some(row=>row.id===entry.owner_actor_id)||!pack.items.some(row=>row.id===entry.subject_item_id))fail('INVALID_CONTRACT','Authored knowledge names an unknown campaign actor or item');
 }
}

/** Pure registration preparation. The authenticated host must persist this once
 * at its verified current cursor; reads never create or backdate activation. */
export function createCampaignKnowledgeActivation(pack:CampaignPack,currentQuery:CharacterActorQuery,activationId:string,knowledgeIds:string[]):AuthoredKnowledgeActivation{
 checkedPack(pack);assertCharacterContract('CharacterActorQuery',currentQuery);
 const value:AuthoredKnowledgeActivation={version:'authored-knowledge-activation/1.0.0',activation_id:activationId,scope:currentQuery.scope,owner_actor_id:currentQuery.actor_id,catalog_hash:campaignKnowledgeIdentity.catalog_hash,source_manifest_hash:campaignKnowledgeIdentity.source_manifest_hash,acquired_at:currentQuery.cursor,knowledge_ids:knowledgeIds};
 assertKnowledgeActivationRegistration(campaignKnowledgeCatalog,campaignKnowledgeSourceManifest,campaignKnowledgeIdentity,value,currentQuery);
 return freezeDto(structuredClone(value));
}

/** Pure selection from pinned content. The host authenticates this exact query,
 * its persisted activation and the current entitlement/ancestry attestation. */
export function buildCampaignKnowledgeView(pack:CampaignPack,read:AuthoredKnowledgeRead):AuthoredKnowledgeView|null{
 checkedPack(pack);assertKnowledgeReadBinding(campaignKnowledgeCatalog,campaignKnowledgeSourceManifest,campaignKnowledgeIdentity,read);
 const activation=read.activation,grant=read.disclosure;
 if(activation===null||grant===null||grant.knowledge_ids.length===0)return null;
 const ids=new Set(grant.knowledge_ids),claims=campaignKnowledgeCatalog.entries.filter(row=>ids.has(row.knowledge_id));
 const referenced=new Set(claims.flatMap(row=>row.provenance.source_ids));
 const result:AuthoredKnowledgeView={version:'authored-knowledge-view/1.0.0',query:read.query,source:campaignKnowledgeIdentity,activation:{activation_id:activation.activation_id,activation_hash:hash(activation),acquired_at:activation.acquired_at},claims,source_definitions:campaignKnowledgeSourceManifest.sources.filter(row=>referenced.has(row.source_id))};
 assertKnowledgeViewBinding(result,campaignKnowledgeCatalog,campaignKnowledgeSourceManifest,campaignKnowledgeIdentity,read);
 return freezeDto(structuredClone(result));
}

/** Opt-in dialogue 0.2 composition; no grant inference from NPC home, pack
 * inclusion or prior dialogue. No journal, filesystem or provider side effects. */
export function buildCampaignKnowledgeDialogueSupplement(pack:CampaignPack,read:AuthoredKnowledgeRead,locationGrant:{location_id:string|null}):DialogueSupplementV2{
 const knowledge=buildCampaignKnowledgeView(pack,read);
 const previous=buildCampaignDialogueSupplement(pack,read.query,locationGrant);
 const result:DialogueSupplementV2={...previous,version:'character-dialogue/0.2.0',actor_knowledge:knowledge};
 assertAuthoredKnowledgeContract('DialogueSupplementV2',result);
 // The generic DTO guard is deliberately separate from content authentication.
 if(canonical(result.query)!==canonical(read.query))fail('INVALID_CONTRACT','Campaign dialogue differs from authorized knowledge query');
 return freezeDto(result);
}
