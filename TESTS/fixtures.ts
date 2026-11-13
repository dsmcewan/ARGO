import {generateKeyPairSync} from 'node:crypto';
import type {Genesis,Scope,Principal,Snapshot,Action,IntentProposal} from '../packages/contracts/src/generated.ts';
export const keys=generateKeyPairSync('ed25519');
export const scope:Scope={tenant_id:'tenant',rights_lane:'private_upload',workspace_id:'workspace',workspace_tenant_id:'tenant:private_upload:workspace',campaign_id:'campaign',world_id:'world',branch_id:'main'};
const actor=(fate_role: 'clotho'|'lachesis'|'atropos'|null=null)=>({alive:true,time_balance:1000,age_ticks:200,fate_role,thread:'present' as const});
export function genesis():Genesis{return {schema_version:'1.0.0',scope:structuredClone(scope),ruleset_version:'tempted-fates/1.0.0',world_time:10,seed:'ab'.repeat(32),authority_key_id:'test_key',authority_public_key:keys.publicKey.export({format:'pem',type:'spki'}).toString(),actors:{system:actor(),donor:actor(),traveler:actor(),outsider:actor(),proxy:actor(),clotho:actor('clotho'),lachesis:actor('lachesis'),atropos:actor('atropos')},items:{lamp:{custodian_id:'donor',destroyed:false}},parties:{party:['donor','traveler']}};}
export function principal(actor_id='donor',role:Principal['role']='player'):Principal{return {principal_id:`auth_${actor_id}`,actor_id,role,scope:structuredClone(scope),confirmed_receipts:[]};}
let next=0;
export function proposal(state:Snapshot,action:Action,actor_id='donor',id=`proposal_${++next}`):IntentProposal{return {schema_version:'1.0.0',ruleset_version:'tempted-fates/1.0.0',proposal_id:id,scope:structuredClone(state.genesis.scope),actor_id,expected_head:state.head,expected_sequence:state.sequence,world_time:action.type==='advance_time'?action.to_time:state.world_time,causal_parents:state.head?[state.head]:[],proxy_grant_id:null,action};}
