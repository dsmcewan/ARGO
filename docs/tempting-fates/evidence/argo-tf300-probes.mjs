import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
const root=resolve(process.argv[2]);
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const api=await load('scenarios/tempted-fates/campaign/catalog.ts');
const {ArgoError,canonical}=await load('packages/contracts/src/index.ts');
const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString();
const privateKey=keys.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const other=generateKeyPairSync('ed448').publicKey.export({format:'pem',type:'spki'}).toString();
let checks=0;
const invalid=e=>e instanceof ArgoError&&e.code==='INVALID_CONTRACT';
const deny=fn=>{assert.throws(fn,invalid);checks++;};
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
function pack(){
 const roles=['clotho','lachesis','atropos'];
 const npc=(id,role)=>({id,name:id,occupation:'Work',location_id:role?'loom':'port',nature:{description:'A quiet observer.',priorities:['Keep a promise']},activity:{description:'Working.',busy_until:0},speech_policy:{max_characters:80,minimum_interval:1},age_years:30,remaining_years:40,fate_role:role,public_description:'At work.',private_knowledge:['DO_NOT_EXPORT_NPC'],wants:'Peace',will_not:'Coerce',speech_example:'Go carefully.'});
 return {version:'tempting-fates-pack/0.1.0',title:'Tempting Fates',subtitle:'A coast',tone_note:'Dark tragic myth.',adaptation_note:'Original continuity.',public_intro:'The coast is still.',start_location_id:'port',calendar:{seconds_per_day:86400,days_per_year:360,exploration_turn_seconds:600,combat_round_seconds:6,watch_seconds:14400},locations:[{id:'port',name:'Port',mythic_influence:'Hospitality',public_description:'Boats are moored.',referee_notes:'DO_NOT_EXPORT_PORT',occupant_ids:['keeper'],route_ids:[],is_loom:false},{id:'loom',name:'Loom',mythic_influence:'Fate',public_description:'Three work.',referee_notes:'DO_NOT_EXPORT_LOOM',occupant_ids:roles,route_ids:[],is_loom:true}],routes:[],npcs:[npc('keeper',null),...roles.map(role=>npc(role,role))],factions:[],rumors:[{id:'rumor',speaker_id:'keeper',location_id:'port',text:'A vessel might remain.',lead_location_id:'port',assessment:{genuine:'true',counterfeit:'false',legend:'outdated'},referee_basis:'DO_NOT_EXPORT_RUMOR'}],items:[{id:'true_vessel',name:'Vessel',description:'DO_NOT_EXPORT_TRUE',custodian_id:null,slots:1,variants:['genuine'],secret:true},{id:'false_vessel',name:'Vessel',description:'DO_NOT_EXPORT_FALSE',custodian_id:'keeper',slots:1,variants:['counterfeit'],secret:true},{id:'rope',name:'Rope',description:'A coil.',custodian_id:'keeper',slots:1,variants:['genuine','counterfeit','legend'],secret:false}],encounters:[],variants:[{id:'genuine',referee_truth:'DO_NOT_EXPORT_GENUINE',artifact_item_id:'true_vessel'},{id:'counterfeit',referee_truth:'DO_NOT_EXPORT_COUNTERFEIT',artifact_item_id:'false_vessel'},{id:'legend',referee_truth:'DO_NOT_EXPORT_LEGEND',artifact_item_id:null}],starting_hooks:[]};
}
function options(variant='genuine') {return {scope:{tenant_id:'private',rights_lane:'private_upload',workspace_id:'myth',workspace_tenant_id:'private:private_upload:myth',campaign_id:'coast',world_id:'world',branch_id:'branch'},privateSeed:'f0'.repeat(32),authorityKeyId:'public_signer',authorityPublicKey:publicKey,variant,travelers:[{actor_id:'traveler',name:'Traveler',nature:{description:'Curious.',priorities:['Learn']}}]};}
api.assertCampaignPack(pack());checks++;
for(const target of [p=>p,p=>p.npcs[0].nature,p=>p.locations[0],p=>p.rumors[0].assessment])for(const key of ['__proto__','constructor','prototype','toJSON']){
 const p=pack();Object.defineProperty(target(p),key,{value:{injected:true},enumerable:true});deny(()=>api.assertCampaignPack(p));
}
let called=0;
for(const path of ['root','nested','options','scope']){
 const p=pack(),o=options(),trap={ownKeys(){called++;throw new Error('trap');},get(){called++;throw new Error('trap');},getPrototypeOf(){called++;throw new Error('trap');}};
 if(path==='root')deny(()=>api.assertCampaignPack(new Proxy(p,trap)));
 if(path==='nested'){p.items[0]=new Proxy(p.items[0],trap);deny(()=>api.assertCampaignPack(p));}
 if(path==='options')deny(()=>api.buildCampaignSeed(p,new Proxy(o,trap)));
 if(path==='scope'){o.scope=new Proxy(o.scope,trap);deny(()=>api.buildCampaignSeed(p,o));}
}
eq(called,0);
for(const field of ['authorityPublicKey','travelers','scope']){
 const o=options();Object.defineProperty(o,field,{get(){called++;return undefined;},enumerable:true});deny(()=>api.buildCampaignSeed(pack(),o));
}
eq(called,0);
for(const key of [privateKey,publicKey+privateKey,privateKey+publicKey,other,'-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----']){const o=options();o.authorityPublicKey=key;deny(()=>api.buildCampaignSeed(pack(),o));}
for(const variant of ['genuine','counterfeit','legend']){
 const p=pack(),o=options(variant),before=canonical({p,o});
 // Throw on process time/randomness: construction must depend only on inputs.
 const random=Math.random,now=Date.now;Math.random=()=>{throw new Error('No randomness');};Date.now=()=>{throw new Error('No wall clock');};
 let result;try{result=api.buildCampaignSeed(p,o);}finally{Math.random=random;Date.now=now;}
 eq(canonical({p,o}),before);
 eq(Object.keys(result.genesis.items).sort(),(variant==='legend'?['rope']:['rope',variant==='genuine'?'true_vessel':'false_vessel']).sort());
 eq(result.genesis.scope,o.scope);eq(result.genesis.parties,{expedition:['traveler']});
 eq(result.profiles.map(row=>row.actor_id),['keeper','clotho','lachesis','atropos','traveler']);
 eq(result.genesis.actors.traveler,{alive:true,time_balance:1555200000,age_ticks:777600000,fate_role:null,thread:'present'});
 const h=api.getPlayerHandout(p),r=api.getRumorCandidate(p,'rumor');
 assert(!JSON.stringify([h,r,result.manifest]).includes('DO_NOT_EXPORT'));checks++;
 eq(Object.keys(h).sort(),['version','title','subtitle','introduction','start','rules_profile'].sort());eq(Object.keys(r).sort(),['id','speaker_id','text','lead_location_id'].sort());
}
const shared=pack(),sharedOptions=options();shared.npcs[1].nature=shared.npcs[0].nature;sharedOptions.travelers[0].nature=shared.npcs[0].nature;
const seed=api.buildCampaignSeed(shared,sharedOptions);seed.profiles[0].nature.priorities.push('Output only');
eq(shared.npcs[0].nature.priorities,['Keep a promise']);eq(seed.profiles[1].nature.priorities,['Keep a promise']);eq(seed.profiles.at(-1).nature.priorities,['Keep a promise']);
const leak=pack();leak.items[0].variants.push('legend');deny(()=>api.assertCampaignPack(leak));
const malformed=pack();malformed.locations[0].occupant_ids.push('clotho');deny(()=>api.assertCampaignPack(malformed));
const o=options();o.scope.workspace_tenant_id='public:open_license:myth';deny(()=>api.buildCampaignSeed(pack(),o));
console.log(JSON.stringify({status:'pass',ordinary_process:true,checks,proxy_or_getter_invocations:called,cases:['closed DTO magic properties','nested and root proxy rejection before traps','option accessor rejection','private/mixed/wrong-algorithm key rejection','explicit variant exclusivity','deterministic scoped defaults with random/clock disabled','no referee-only fields in extract outputs','cross-output alias detachment','occupant conflict and artifact leak rejection']}));
