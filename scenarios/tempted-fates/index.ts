import {fail,assertContract} from '@argo/contracts';import type {Action,IntentProposal} from '@argo/contracts';
import {proposalFromAction} from '@argo/argo-dm';import {createProposalSubscriber} from '@argo/interventions';import type {DerivedContext} from '@argo/interventions';
export type FateRole='clotho'|'lachesis'|'atropos';
export type Choice={choice:'leave'|'refuse'}|{choice:'act';action:Action;proposalId:string};
export function createFates(ids:Record<FateRole,string>){
 if(new Set(Object.values(ids)).size!==3)fail('INVALID_CONTRACT','Fates require three independent actors');
 return (['clotho','lachesis','atropos'] as const).map(role=>Object.freeze({role,actorId:ids[role],
  propose:async(context:DerivedContext,choice:Choice):Promise<readonly IntentProposal[]>=>{
   const subscriber=createProposalSubscriber({actorId:ids[role],plan:async({view,checkpoint})=>{
    if(choice.choice!=='act'||view.engagement_closed)return [];
    assertContract('Action',choice.action);
    const allowed=choice.action.type==='observe_claim'||role==='clotho'&&choice.action.type==='name_anomaly'||role==='atropos'&&choice.action.type==='end_thread';
    if(!allowed)fail('UNAUTHORIZED','Proposal is outside this Fate jurisdiction');
    return [proposalFromAction(checkpoint,ids[role],choice.action,choice.proposalId)];
   }});
   return subscriber.onView(context);
  }
 }));
}

// Additive campaign authoring and tabletop preview tools; no new world writer.
export type * from './campaign/types.ts';
export * from './campaign/catalog.ts';
export * from './campaign/rules.ts';

// Fresh-world versioned mortal initialization; old Fate authority is unchanged.
export * from './runtime.ts';
