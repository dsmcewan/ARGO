import type {Principal, Scope} from '../packages/contracts/src/generated.ts';
import type {
  ProjectionAcquisition, ProjectionActorKnowledgeQuery, ProjectionCanonicalHistoryQuery,
  ProjectionCanonicalRelationVersion, ProjectionCommonCheckpoint, ProjectionEpistemicClaim,
  ProjectionPrefix, ProjectionReadPolicy,
} from '../packages/contracts/src/projection-generated.ts';
import type {ProjectionReadContext} from '../packages/contracts/src/projection-v2.ts';

export const HEAD_A = 'a'.repeat(64);
export const HEAD_B = 'b'.repeat(64);
export const EVENT_HASH = 'e'.repeat(64);
export const PRIVATE_SOURCE = 'private_source_do_not_release';
export function projectionScope(): Scope {
  return {tenant_id:'tenant', rights_lane:'private_upload', workspace_id:'workspace',
    workspace_tenant_id:'tenant:private_upload:workspace', campaign_id:'campaign', world_id:'world', branch_id:'main'};
}
export function prefix(sequence=12, world_time=40): ProjectionPrefix {
  return {scope:projectionScope(), sequence, head:sequence===0 ? null : HEAD_A, world_time};
}
export function checkpoint(sequence=12, world_time=40): ProjectionCommonCheckpoint {
  const p=prefix(sequence,world_time);
  return {schema_version:'2.0.0', checkpoint_id:'checkpoint_12', genesis_ref:'genesis_1', prefix:p,
    canonical:{plane:'canonical',prefix:structuredClone(p),projector_version:'canonical_1',store_generation:'store_1',state_digest:HEAD_A},
    epistemic:{plane:'epistemic',prefix:structuredClone(p),projector_version:'epistemic_1',store_generation:'store_1',state_digest:HEAD_B}};
}
export function readPolicy(p=prefix()): ProjectionReadPolicy {
  return {schema_version:'2.0.0',policy_id:'policy_1',prefix:structuredClone(p),actor_id:'donor',actor_authorized:true,
    party_ids:['party_a','party_b'],canonical_read:false,ontology_blocked:false,engagement_closed:false};
}
export function readContext(system=false): ProjectionReadContext {
  const c=checkpoint();
  const principal:Principal={principal_id:'principal_donor',actor_id:'donor',role:system?'system':'player',scope:projectionScope(),confirmed_receipts:[]};
  const policy=readPolicy(c.prefix);policy.canonical_read=system;
  return {checkpoint:c,policy,principal,genesis_world_time:10};
}
export function actorQuery(overrides:Partial<ProjectionActorKnowledgeQuery>={}): ProjectionActorKnowledgeQuery {
  return {schema_version:'2.0.0',request_id:'request_1',scope:projectionScope(),checkpoint_id:'checkpoint_12',actor_id:'donor',
    audience:'actor',party_id:null,acquired_through_tick:40,acquired_through_sequence:12,...overrides};
}
export function canonicalQuery(overrides:Partial<ProjectionCanonicalHistoryQuery>={}): ProjectionCanonicalHistoryQuery {
  return {schema_version:'2.0.0',request_id:'canonical_request_1',scope:projectionScope(),checkpoint_id:'checkpoint_12',valid_at_tick:40,...overrides};
}
export function claim(claim_id='claim_a',overrides:Partial<ProjectionEpistemicClaim>={}): ProjectionEpistemicClaim {
  return {scope:projectionScope(),claim_id,channel:'belief',source_id:PRIVATE_SOURCE,content:`Content of ${claim_id}`,
    occurred_at_tick:15,source:{kind:'event',sequence:2,event_hash:EVENT_HASH},...overrides};
}
export function acquisition(acquisition_id='acq_a',claim_id='claim_a',overrides:Partial<ProjectionAcquisition>={}): ProjectionAcquisition {
  return {scope:projectionScope(),acquisition_id,claim_id,knower_id:'donor',acquired_at_tick:20,acquired_at_sequence:3,
    party_id:null,source:{kind:'event',sequence:3,event_hash:EVENT_HASH},...overrides};
}
export function relation(overrides:Partial<ProjectionCanonicalRelationVersion>={}): ProjectionCanonicalRelationVersion {
  return {scope:projectionScope(),relation_id:'relation_a',revision_id:'revision_old',subject_id:'lamp',predicate:'held_by',
    object_ref:{kind:'entity',entity_id:'donor'},valid_from_tick:10,valid_to_tick:null,
    recorded_from_sequence:1,recorded_to_sequence:null,source:{kind:'event',sequence:1,event_hash:EVENT_HASH},...overrides};
}
