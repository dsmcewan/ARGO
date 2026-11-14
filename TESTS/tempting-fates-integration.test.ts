import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonical,CHARACTER_PROFILE} from '../packages/contracts/src/index.ts';
import type {Principal,CharacterCommandBody,CharacterNarratorQuery} from '../packages/contracts/src/index.ts';
import type {CampaignPack,CampaignSeedOptions} from '../scenarios/tempted-fates/campaign/types.ts';
import {openLedger,replay,createCharacterAuthority,replayCharacters} from '../packages/ledger/src/index.ts';
import {createCharacterViews} from '../packages/lexi-bridge/src/index.ts';
import {keys,scope,proposal} from './fixtures.ts';

async function components(){
 try{return await import('../scenarios/tempted-fates/index.ts');}
 catch(error){if(error instanceof Error&&'code'in error&&error.code==='ERR_MODULE_NOT_FOUND')assert.fail('The campaign catalog and rules tools are not implemented yet');throw error;}
}
async function pack():Promise<CampaignPack>{return JSON.parse(await readFile(new URL('../scenarios/tempted-fates/campaign/world.json',import.meta.url),'utf8')) as CampaignPack;}
function options(variant:CampaignSeedOptions['variant']='genuine'):CampaignSeedOptions{return {
 scope:structuredClone(scope),privateSeed:'8a'.repeat(32),authorityKeyId:'campaign_test',authorityPublicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),variant,
 travelers:[{actor_id:'pc_a',name:'Ariadne',nature:{description:'Values careful work and freely kept promises.',priorities:['Find paid work','Return borrowed tools']}},{actor_id:'pc_b',name:'Theron',nature:{description:'Distrusts official accounts and protects companions.',priorities:['Find a safe crossing']}}],
};}

test('authored Greek campaign is complete and public extracts exclude referee state',async()=>{
 const api=await components(),world=await pack();api.assertCampaignPack(world);
 assert.equal(world.locations.length,8);assert.equal(world.npcs.length,11);assert.equal(world.factions.length,3);assert.equal(world.rumors.length,12);assert.equal(world.variants.length,3);
 assert.ok(world.encounters.length>=6);assert.ok(world.starting_hooks.length>=3);
 const before=canonical(world),handout=api.getPlayerHandout(world);
 assert.deepEqual(Object.keys(handout).sort(),['introduction','rules_profile','start','subtitle','title','version']);
 assert.equal(handout.title,'Tempting Fates');assert.equal(handout.start.id,'l_harbor');
 for(const rumor of world.rumors){
  const card=api.getRumorCandidate(world,rumor.id);
  assert.deepEqual(Object.keys(card).sort(),['id','lead_location_id','speaker_id','text']);
  assert.equal(card.text,rumor.text);assert.equal(Object.hasOwn(card,'assessment'),false);
 }
 const serialized=JSON.stringify(handout);
 for(const npc of world.npcs)for(const secret of npc.private_knowledge)assert.ok(!serialized.includes(secret),'NPC private knowledge must stay out of the public handout');
 for(const variant of world.variants)assert.ok(!serialized.includes(variant.referee_truth));
 assert.equal(canonical(world),before);
 const exhausted=api.previewProject({progress:0,segments:4,resources:1,steps:100});
 assert.deepEqual(exhausted,{progress:1,segments:4,resources:0,completed:false});
 assert.equal(canonical(world),before,'Project preview never updates authored campaign content');
});

test('world variants remain fixed and seed scopes do not become public campaign truth',async()=>{
 const api=await components(),world=await pack();
 const states=Object.fromEntries((['genuine','counterfeit','legend'] as const).map(variant=>[variant,api.buildCampaignSeed(world,options(variant))]));
 assert.equal(states.genuine!.genesis.items.measure_cup!.custodian_id,'ione');
 assert.equal(states.counterfeit!.genesis.items.measure_cup!.custodian_id,'ione');
 assert.equal(Object.hasOwn(states.legend!.genesis.items,'measure_cup'),false);
 assert.deepEqual(states.genuine!.genesis.parties,{expedition:['pc_a','pc_b']});
 assert.deepEqual(states.genuine!.genesis.scope,scope);
 assert.equal(states.genuine!.profiles.length,13);
 assert.equal(states.genuine!.profiles.some(profile=>profile.actor_id==='system'),false);
 assert.equal(states.genuine!.genesis.actors.pc_a!.time_balance,50*360*86400);
 for(const variant of ['genuine','counterfeit','legend'] as const){
  const before=canonical(states[variant]);
  for(const rumor of world.rumors)api.getRumorCandidate(world,rumor.id);
  assert.equal(canonical(api.buildCampaignSeed(world,options(variant))),before,'Reading every rumor cannot reroll an artifact or its custody');
 }
 const foreign=options();foreign.scope.campaign_id='another_campaign';foreign.scope.rights_lane='homebrew';foreign.scope.workspace_tenant_id='tenant:homebrew:workspace';
 const alternate=api.buildCampaignSeed(world,foreign);
 assert.deepEqual(alternate.genesis.scope,foreign.scope);
 assert.notEqual(canonical(alternate.genesis.scope),canonical(states.genuine!.genesis.scope));
 assert.ok(!JSON.stringify(api.getPlayerHandout(world)).includes(options().privateSeed));
});

test('real ARGO campaign supports private rumors and causal custody while rules previews have no authority',async t=>{
 const api=await components(),world=await pack(),seed=api.buildCampaignSeed(world,options());
 const directory=await mkdtemp(join(tmpdir(),'argo-tempting-fates-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const ledger=await openLedger({directory,genesis:seed.genesis,privateKey:keys.privateKey});
 const principal=(actor_id:string,role:Principal['role']='player'):Principal=>({principal_id:`auth_${actor_id}`,actor_id,role,scope:seed.genesis.scope,confirmed_receipts:[]});
 const system=principal('system','system');
 const authority=await createCharacterAuthority({ledger,systemPrincipal:system,authorizeWitnesses:async request=>({request_hash:request.request_hash,actor_ids:request.actor_id==='pc_a'?['pc_a','melia']:['pc_a'],party_id:null})});
 const views=createCharacterViews({scope:seed.genesis.scope,readProjection:call=>authority.readProjection(call)});
 let serial=0;
 const cursor=async()=>{const s=await ledger.snapshot();return {sequence:s.sequence,head:s.head,world_time:s.world_time};};
 const submit=async(body:CharacterCommandBody,auth=system)=>authority.submit({version:CHARACTER_PROFILE,scope:seed.genesis.scope,request_id:`campaign_${++serial}`,expected_cursor:await cursor(),body},auth);
 for(const profile of seed.profiles)await submit({type:'configure',profile});
 const rumor=world.rumors.find(row=>row.speaker_id==='melia');assert.ok(rumor);
 const card=api.getRumorCandidate(world,rumor.id);
 await submit({type:'speak',text:card.text,addressed_actor_ids:['pc_a']},principal('melia','npc'));
 const ownView=await views.actor({version:CHARACTER_PROFILE,scope:seed.genesis.scope,cursor:await cursor(),actor_id:'pc_a'},principal('pc_a'));
 const otherView=await views.actor({version:CHARACTER_PROFILE,scope:seed.genesis.scope,cursor:await cursor(),actor_id:'pc_b'},principal('pc_b'));
 assert.equal(ownView.experiences[0]!.text,card.text);assert.deepEqual(otherView.experiences,[]);
 await submit({type:'speak',text:'I will return the lamp at our next harbor visit.',addressed_actor_ids:['melia']},principal('pc_a'));
 const partyQuery:CharacterNarratorQuery={version:CHARACTER_PROFILE,scope:seed.genesis.scope,cursor:await cursor(),traveler_id:'pc_a',actor_id:'pc_b',audience:'party',party_id:'expedition',after_sequence:0,limit:32};
 assert.deepEqual((await views.narrator(partyQuery,principal('pc_b'))).records,[],'Party membership alone never publishes a private promise');
 const transfer=await ledger.submit(proposal(await ledger.snapshot(),{type:'move_item',item_id:'traveler_lamp',to_actor_id:'pc_a'},'melia','lamp_loan'),principal('melia','npc'));
 await submit({type:'witness_action',record_id:transfer.event_hash});
 const state=await ledger.snapshot();assert.equal(state.items.traveler_lamp!.custodian_id,'pc_a');assert.equal(state.items.measure_cup!.custodian_id,'ione');
 const before=canonical(state),count=(await ledger.events()).length;
 assert.deepEqual(api.abilityFromDice([2,2,6]),{bonus:2,defense:12});
 assert.deepEqual(api.resolveCheck({rolls:[13],mode:'normal',bonus:2,target:15}),{die:13,total:15,success:false});
 assert.deepEqual(api.resolveCheck({rolls:[14],mode:'normal',bonus:2,target:15}),{die:14,total:16,success:true});
 assert.deepEqual(api.previewDamage({hitPoints:6,damage:10}),{hitPoints:-4,condition:'dead'});
 assert.equal(canonical(await ledger.snapshot()),before,'Tabletop arithmetic cannot kill an authoritative actor');
 const unsupported={...proposal(state,{type:'move_item',item_id:'traveler_lamp',to_actor_id:null},'pc_a','unsupported_attack'),action:{type:'attack',target_id:'pc_b',damage:10}};
 await assert.rejects(ledger.submit(unsupported as never,principal('pc_a')));
 assert.equal((await ledger.events()).length,count);assert.equal((await ledger.snapshot()).actors.pc_a!.alive,true);assert.equal((await ledger.snapshot()).transfers.length,0);assert.deepEqual((await ledger.snapshot()).cutoffs,{});
 const events=await ledger.events();assert.equal(canonical(replay(seed.genesis,events)),canonical(await ledger.snapshot()));
 assert.equal(canonical(replayCharacters(seed.genesis,events,system)),canonical(await authority.readProjection()));
 const reopened=await openLedger({directory,genesis:seed.genesis,privateKey:keys.privateKey});
 assert.equal(canonical(await reopened.snapshot()),before);
});

test('playable book links and retained first-edition attribution inputs resolve',async()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 for(const name of ['README','PLAYER_GUIDE','QUICKSTART','RULES','CHARACTER_SHEET','ATTRIBUTION','ATLAS','ENCOUNTERS','REFEREE_GUIDE']){
  const path=join(root,'CAMPAIGNS/Tempting_Fates',name+'.md'),text=await readFile(path,'utf8');
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
   const target=match[1]!;if(/^(?:https?:|#)/.test(target))continue;
   await readFile(resolve(dirname(path),target.split('#')[0]!));
  }
 }
 const pdf=await readFile(join(root,'docs/design/headless-2026-11-13/evidence/knave-1e/knave-1e.pdf'));
 assert.equal(createHash('sha256').update(pdf).digest('hex'),'fc2ff96175f6b60ddbbf02b6139a5da569752155948371613e201d21cf92bc78');
});

test('Phase 2 tabletop state grammar remains explicit, closed and non-authoritative',async()=>{
 const {Ajv2020}=await import('ajv/dist/2020.js');
 const schema=JSON.parse(await readFile(new URL('../docs/tempting-fates/phase2/tabletop-state.schema.json',import.meta.url),'utf8'));
 const legacy=JSON.parse(await readFile(new URL('../SYSTEMS/argo-v1.schema.json',import.meta.url),'utf8'));
 const example=JSON.parse(await readFile(new URL('../docs/tempting-fates/phase2/example-state.json',import.meta.url),'utf8'));
 const {exampleState}=await import('../docs/tempting-fates/phase2/example-state.ts');assert.equal(canonical(exampleState),canonical(example));
 const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);const validate=ajv.compile(schema);
 assert.equal(validate(example),true,JSON.stringify(validate.errors));
 const wrongAuthority=structuredClone(example);wrongAuthority.authoritative=true;assert.equal(validate(wrongAuthority),false);
 const negativeSupply=structuredClone(example);negativeSupply.actors[0].resources.rations=-1;assert.equal(validate(negativeSupply),false);
 const sourceOverride=structuredClone(example);sourceOverride.actors[0].fate_role='atropos';assert.equal(validate(sourceOverride),false);
 const noScope=structuredClone(example);delete noScope.scope;assert.equal(validate(noScope),false);
 assert.equal(Object.hasOwn(example.actors[0],'alive'),false,'No duplicate alive flag competes with HP or frozen authoritative life');
});
