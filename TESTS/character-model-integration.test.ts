import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHARACTER_PROFILE,canonical} from '@argo/contracts';
import type {CharacterCommandBody,CharacterProfile,CharacterActorQuery} from '@argo/contracts';
import {openLedger,createCharacterAuthority,replayCharacters} from '@argo/ledger';
import {createCharacterViews} from '@argo/lexi-bridge';
import {createCharacterBridge} from '@argo/telos-bridge';
import {createModelCharacterAgent} from '@argo/interventions';
import {genesis,keys,principal} from './fixtures.ts';

test('model speech reaches the signed journal only through the authenticated bridge and replays without generation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-model-dialogue-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),system=principal('system','system'),who=principal('outsider','npc');
 const ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 const authority=await createCharacterAuthority({ledger,systemPrincipal:system,authorizeWitnesses:async request=>({request_hash:request.request_hash,actor_ids:['outsider'],party_id:null})});
 const bridge=createCharacterBridge({scope:seed.scope,transport:(command,auth,call)=>authority.submit(command,auth,call)});
 const views=createCharacterViews({scope:seed.scope,readProjection:call=>authority.readProjection(call)});
 let request=0;
 const send=async(body:CharacterCommandBody,auth=system)=>bridge.submit({version:CHARACTER_PROFILE,scope:seed.scope,request_id:`setup_${++request}`,expected_cursor:(await authority.readProjection()).cursor,body},auth);
 const profile=(actor_id:string):CharacterProfile=>({actor_id,revision:1,nature:{description:'Reserved, practical and attentive to promises.',priorities:['finish the work']},activity:{description:'Mending a lamp',busy_until:0},speech_policy:{max_characters:240,minimum_interval:0}});
 await send({type:'configure',profile:profile('outsider')});await send({type:'configure',profile:profile('traveler')});
 await send({type:'speak',text:'May I leave this lamp with you?',addressed_actor_ids:['outsider']},principal('traveler'));
 const projection=await authority.readProjection(),incoming=projection.records.at(-1)!.experience;
 const query:CharacterActorQuery={version:CHARACTER_PROFILE,scope:seed.scope,cursor:projection.cursor,actor_id:'outsider'};
 let generations=0;
 const agent=createModelCharacterAgent({scope:seed.scope,actorId:'outsider',sessionId:'integration',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],
  refreshContext:(q,call)=>views.actor(q,who,call),
  clientFor:()=>({responses:{create:async(request:unknown)=>{generations++;assert.ok(JSON.stringify(request).includes('May I leave this lamp with you?'));return {id:'generated',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text:'Beside the bench. I will mend it when this one is done.'})}]}]};}}})});
 const before=(await ledger.events()).length;
 const command=await agent.respond(query,incoming.record_id,'generated_reply');assert.ok(command);
 assert.equal((await ledger.events()).length,before,'Generation cannot append history');
 const receipt=await bridge.submit(command,who);assert.equal(receipt.kind,'speak');assert.equal((await ledger.events()).length,before+1);
 const after=await authority.readProjection();assert.equal(after.records.at(-1)!.experience.actor_id,'outsider');
 assert.equal(after.records.at(-1)!.experience.text,'Beside the bench. I will mend it when this one is done.');
 assert.equal(canonical(replayCharacters(seed,await ledger.events(),system)),canonical(after));assert.equal(generations,1);
 const repeated=await bridge.submit(command,who);assert.equal(canonical(repeated),canonical(receipt));assert.equal((await ledger.events()).length,before+1);
});
