import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import type {CampaignPack,PlayerHandout,RumorCandidate} from '../scenarios/tempted-fates/campaign/types.ts';

const root=new URL('../',import.meta.url);
const profile='scenarios/tempted-fates/campaign/';
async function validator(definition?:string){
 const schema=JSON.parse(await readFile(new URL(profile+'content.schema.json',root),'utf8'));
 const ajv=new Ajv2020({strict:true,allErrors:true});
 assert.equal(ajv.validateSchema(schema),true);
 ajv.addSchema(schema);
 return ajv.compile({$ref:schema.$id+(definition?'#/$defs/'+definition:'')});
}

// Independent small fixture: production's eight-site minimum belongs to pack integration,
// while these two sites exercise the reusable grammar without importing its catalog.
function pack():CampaignPack{
 const npc=(id:string,fate_role:'clotho'|'lachesis'|'atropos'|null)=>({id,name:id,occupation:'Works quietly',location_id:fate_role?'loom':'harbor',nature:{description:'Patient',priorities:['Work']},activity:{description:'Working',busy_until:0},speech_policy:{max_characters:240,minimum_interval:60},age_years:25,remaining_years:50,fate_role,public_description:'Occupied with a task.',private_knowledge:['A private fact.'],wants:'Finish the work.',will_not:'Abandon the task.',speech_example:'Later.'});
 return {
  version:'tempting-fates-pack/0.1.0',title:'Tempting Fates',subtitle:'A test coast',tone_note:'Institutional decline, no morality score.',adaptation_note:'Original campaign using adapted Knave1e mechanics.',public_intro:'You arrive at the harbor.',start_location_id:'harbor',
  calendar:{seconds_per_day:86400,days_per_year:360,exploration_turn_seconds:600,combat_round_seconds:6,watch_seconds:14400},
  locations:[{id:'harbor',name:'Harbor',mythic_influence:'Hospitality',public_description:'Boats need repairs.',referee_notes:'Some debts are disputed.',occupant_ids:['keeper'],route_ids:[],is_loom:false},{id:'loom',name:'Loom',mythic_influence:'The three Fates',public_description:'Thread and work.',referee_notes:'No guaranteed ordinary road.',occupant_ids:['clotho','lachesis','atropos'],route_ids:[],is_loom:true}],
  routes:[],npcs:[npc('keeper',null),npc('clotho','clotho'),npc('lachesis','lachesis'),npc('atropos','atropos')],
  factions:[{id:'pilots',name:'Pilots',members:['keeper'],goal:'Repair the quay',resources:2,clock:{name:'Quay repair',segments:4,progress:1,advance_trigger:'One authorized watch of work',completion:'The quay reopens',visible_sign:'New planks',interruption:'Missing timber halts work'},approaches:['Trade timber']}],
  rumors:[{id:'old_cup',speaker_id:'keeper',location_id:'harbor',text:'A cup may be beneath the shrine.',lead_location_id:'harbor',assessment:{genuine:'partial',counterfeit:'false',legend:'outdated'},referee_basis:'The cup has moved.'}],
  items:[{id:'cup',name:'Cup',description:'A copper cup.',custodian_id:'keeper',slots:1,variants:['genuine','counterfeit'],secret:true}],
  encounters:[{id:'quay_dispute',location_id:'harbor',title:'A disputed payment',visible_situation:'Two workers disagree.',participants:['keeper'],approaches:['Listen','Leave'],if_ignored:'Work remains paused.',costs:['Time spent talking'],clue:'The timber receipt is missing.',exit:'Walk back to the square.'}],
  variants:[{id:'genuine',referee_truth:'The cup is genuine.',artifact_item_id:'cup'},{id:'counterfeit',referee_truth:'The cup is an imitation.',artifact_item_id:'cup'},{id:'legend',referee_truth:'The cup never existed.',artifact_item_id:null}],
  starting_hooks:[{id:'repair_offer',title:'The quay',prompt:'The keeper offers work.',location_id:'harbor',possible_actions:['Ask the terms','Decline'],decline_consequence:'Another crew may take the work.'}],
 };
}

test('campaign grammar accepts a bounded referee pack without requiring production content counts',async()=>{
 const validate=await validator();assert.equal(validate(pack()),true,JSON.stringify(validate.errors));
});
test('campaign grammar rejects unknown authorizing fields and malformed reference identities',async()=>{
 const validate=await validator();
 for(const mutate of [
  (p:any)=>{p.authority_key='secret';},
  (p:any)=>{p.npcs[0].consent=true;},
  (p:any)=>{p.rumors[0].assessment.public_truth=true;},
  (p:any)=>{p.items[0].slots=-1;},
  (p:any)=>{p.start_location_id='../harbor';},
  (p:any)=>{p.routes=[{id:'road',from:'harbor',to:'prototype',travel_turns:1,condition:'Open',sign:'Tracks',access:'ordinary'}];},
  (p:any)=>{p.locations[0].occupant_ids=['keeper','keeper'];},
  (p:any)=>{p.npcs[0].id='constructor';},
  (p:any)=>{p.items[0].custodian_id='__proto__';},
  (p:any)=>{p.factions[0].members=[''];},
  (p:any)=>{p.npcs[0].nature.priorities=[];},
  (p:any)=>{p.npcs[0].speech_policy.max_characters=8193;},
 ]){const value=pack();mutate(value);assert.equal(validate(value),false,JSON.stringify(value));}
});
test('campaign grammar rejects version drift, unsafe arithmetic inputs and unknown variant assessments',async()=>{
 const validate=await validator();
 for(const mutate of [
  (p:any)=>{p.version='tempted-fates/1.0.0';},
  (p:any)=>{p.calendar.days_per_year=365;},
  (p:any)=>{p.npcs[0].age_years=1.5;},
  (p:any)=>{p.npcs[0].remaining_years=0;},
  (p:any)=>{p.factions[0].resources=Number.MAX_SAFE_INTEGER+1;},
  (p:any)=>{p.rumors[0].assessment.genuine='maybe';},
  (p:any)=>{p.variants[0].id='random';},
  (p:any)=>{p.items[0].variants=[];},
 ]){const value=pack();mutate(value);assert.equal(validate(value),false);}
});
test('public handout and rumor candidate grammar refuses referee secrets and automatic delivery metadata',async()=>{
 const handout=await validator('PlayerHandout');
 const visible:PlayerHandout={version:'tempting-fates-pack/0.1.0',title:'Tempting Fates',subtitle:'A test coast',introduction:'You arrive.',start:{id:'harbor',name:'Harbor',description:'Boats need repairs.'},rules_profile:'tempting-fates-rules/0.1.0'};
 assert.equal(handout(visible),true);
 for(const key of ['variant','seed','private_knowledge','referee_truth','assessment'])assert.equal(handout({...visible,[key]:'hidden'}),false);
 const candidate=await validator('RumorCandidate');
 const rumor:RumorCandidate={id:'old_cup',speaker_id:'keeper',text:'A cup may exist.',lead_location_id:'harbor'};
 assert.equal(candidate(rumor),true);
 for(const key of ['assessment','referee_basis','observers','delivered','acquired_at','consent'])assert.equal(candidate({...rumor,[key]:true}),false);
});
test('campaign schema and typed API freeze pins the complete shared interface',async()=>{
 const freeze=JSON.parse(await readFile(new URL(profile+'FREEZE.json',root),'utf8'));
 assert.equal(freeze.profile_version,'tempting-fates-pack/0.1.0');
 assert.deepEqual(Object.keys(freeze.files).sort(),[profile+'CONTRACT.md',profile+'content.schema.json',profile+'types.ts'].sort());
 for(const [path,digest] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(await readFile(new URL(path,root))).digest('hex'),digest,path);
});
