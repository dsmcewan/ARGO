import {randomUUID} from 'node:crypto';
import {fail,freezeDto,serviceCall} from '@argo/contracts';
import type {IntentProposal,Principal,Snapshot} from '@argo/contracts';
import {assertObservationWitnessGrant,createObservationAdmissionRequest} from '../../contracts/src/observation-admission.ts';
import type {ObservationAdmissionRequest,ObservationWitnessGrant,ObservationWitnessVerifier} from '../../contracts/src/observation-admission.ts';

export interface ObservationAuthorization {request:ObservationAdmissionRequest;grant:ObservationWitnessGrant}
export function observationRemaining(deadlineMs:number,signal:AbortSignal|undefined):number{
 if(signal?.aborted)fail('CANCELLED','Observation admission cancelled');
 const remaining=deadlineMs-Date.now();if(remaining<=0)fail('EXPIRED','Observation admission deadline elapsed');return remaining;
}
export function checkObservationLive(authorization:ObservationAuthorization,signal:AbortSignal|undefined):void{
 observationRemaining(authorization.request.attempt.deadline_ms,signal);
 if(Date.now()<authorization.request.attempt.issued_at_ms)fail('EXPIRED','Observation admission clock precedes its attempt');
}
/** Called only after preflight has released the writer lock. This host grant
 * authorizes this attempt; frozen v1 events do not persist it as replay proof. */
export async function requestObservationAuthorization(
 proposal:IntentProposal,principal:Principal,state:Snapshot,verifier:ObservationWitnessVerifier|undefined,
 deadlineMs:number,signal:AbortSignal|undefined,
):Promise<ObservationAuthorization>{
 if(!verifier)fail('UNAUTHORIZED','Trusted observation witness authorization required');
 observationRemaining(deadlineMs,signal);
 const request=createObservationAdmissionRequest(proposal,principal,{attempt_id:randomUUID(),issued_at_ms:Date.now(),deadline_ms:deadlineMs});
 const snapshot=freezeDto(structuredClone(state));
 // Cloning, preflight and both lock waits consume the original call budget.
 const received=await serviceCall(linked=>verifier(request,snapshot,{signal:linked}),observationRemaining(deadlineMs,signal),signal?{signal}:{});
 observationRemaining(deadlineMs,signal);
 if(received===null)fail('UNAUTHORIZED','Observation witnesses were not authorized');
 assertObservationWitnessGrant(received,request,Date.now());
 return {request,grant:freezeDto(structuredClone(received))};
}
