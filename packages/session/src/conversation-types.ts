import type {WorldGenesis,WorldPrincipal,WorldLedger,WorldQuery,WorldCommand,WorldReceipt,Scope} from '@argo/contracts';
import type {Vendor,TokenCounter,Cooldown} from '@argo/model-client';
export const CONVERSATION_VERSION='world-conversation/0.1.0' as const;
export type ConversationCandidate={vendor:Vendor;model:string;pool:string};
export type ConversationPolicy={provider_policy_id:string;generation_mode:'injected'|'offline_fixture';candidates:ConversationCandidate[];effort:string;timeout_ms:number;max_context_bytes:number;max_output_tokens:number};
export type PlayerPrincipal=WorldPrincipal&{role:'player';actor_id:string};
export type NpcPrincipal=WorldPrincipal&{role:'npc';actor_id:string};
export type ConversationBinding={version:typeof CONVERSATION_VERSION;scope:Scope;genesis_hash:string;authority_key_id:string;authority_public_key:string;player:PlayerPrincipal;npc:NpcPrincipal;policy:ConversationPolicy;dialogue_profile:'shared-world-dialogue/0.1.0';audience:'whisper';max_attempts_per_pool:1;communication_goal:null};
export type OpenConversationStoreOptions={path:string;mode:'create'|'open';genesis:WorldGenesis;player:PlayerPrincipal;npc:NpcPrincipal;policy:ConversationPolicy};
export interface WorldConversationStore{readonly binding:ConversationBinding;close():Promise<void>}
export type ConversationCallContext={turn_id:string;attempt_id:string;binding_hash:string};
export type ConversationModelInjection={clientFor:(candidate:ConversationCandidate,turn:ConversationCallContext)=>unknown;countTokensFor?:(candidate:ConversationCandidate,turn:ConversationCallContext)=>TokenCounter|undefined;cooldown?:Cooldown};
export type CreateConversationOptions={store:WorldConversationStore;ledger:WorldLedger;model:ConversationModelInjection};
export type TurnInput={turn_id:string;text:string};
export type TurnRef={turn_id:string};
export type WaitOptions={signal?:AbortSignal};
export type Phase='accepted'|'input_pending'|'input_committed'|'generating'|'reply_pending'|'settled';
export type Attempt={attempt_id:string;owner_id:string;query:WorldQuery;started_at_ms:number;deadline_at_ms:number};
export type RejectionProof={sequence:number;previous_hash:string;event_hash:string;request_id:string;request_hash:string};
export type Terminal={outcome:'replied'|'no_reply'|'cancelled'|'generation_uncertain'|'generation_failed'|'input_rejected'|'reply_rejected';reason:'completed'|'unavailable_context'|'adapter_null'|'cancelled'|'attempt_expired'|'attempt_failed'|'invalid_proposal'|'occupied_sequence';rejection_proof:RejectionProof|null};
export type TurnRow={version:typeof CONVERSATION_VERSION;binding_hash:string;turn_id:string;turn_key:string;input_hash:string;text:string;revision:number;phase:Phase;cancel_requested:boolean;created_at_ms:number;updated_at_ms:number;input_command:WorldCommand|null;input_receipt:WorldReceipt|null;inbound_record_id:string|null;attempt:Attempt|null;reply_command:WorldCommand|null;reply_receipt:WorldReceipt|null;terminal:Terminal|null};
export type TurnResult={version:typeof CONVERSATION_VERSION;turn_id:string;phase:Phase;revision:number;cancel_requested:boolean;generation_mode:ConversationPolicy['generation_mode'];outcome:Terminal['outcome']|null;input_receipt:WorldReceipt|null;reply_receipt:WorldReceipt|null;delivery:null|{delivery_id:string;record_id:string;speaker_id:string;text:string}};
export interface WorldConversation{turn(input:TurnInput,wait?:WaitOptions):Promise<TurnResult>;resume(input:TurnRef,wait?:WaitOptions):Promise<TurnResult>;read(input:TurnRef,wait?:WaitOptions):Promise<TurnResult|null>;cancel(input:TurnRef,wait?:WaitOptions):Promise<TurnResult>;close():Promise<void>}
export type Mutation={type:'save_input';command:WorldCommand}|{type:'confirm_input';receipt:WorldReceipt}|{type:'claim_generation';attempt:Attempt}|{type:'save_reply';command:WorldCommand;attempt_id:string}|{type:'confirm_reply';receipt:WorldReceipt}|{type:'settle';terminal:Terminal}|{type:'cancel'};
export type AdvanceResult={changed:boolean;row:TurnRow};
