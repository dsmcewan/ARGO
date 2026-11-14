import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root='/workspace/ARGO/.board/rpg-phase2/worktrees/RP-900-1-42f995f361';
const mod=path=>import(pathToFileURL(root+'/'+path));
const {buildMortalCampaign}=await mod('scenarios/tempted-fates/runtime.ts');
const {viewMortalActor}=await mod('packages/ledger/src/mortal/view.ts');
const {hash,canonical,assertMortalGenesis,assertMortalContract}=await mod('packages/contracts/src/index.ts');
const {keys,scope}=await mod('TESTS/fixtures.ts');
const pack=JSON.parse(readFileSync(root+'/scenarios/tempted-fates/campaign/world.json'));
function options(variant='legend'){return {scope:{...scope,world_id:'rp900_review'},seed:'87'.repeat(32),authority_key_id:'review_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),referee_id:'host',npc_controller_id:'host_npcs',variant,hp_mode:'classic',travelers:[{id:'hero',name:'Ariadne',controller_id:'auth_hero',weapon:'spear'},{id:'companion',name:'Theron',controller_id:'auth_companion',weapon:'sling'}]};}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const checks=[];
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
check('frozen input and pack stay unchanged; returned genesis is deterministic',()=>{
 const o=freeze(options()),p=freeze(structuredClone(pack)),before=canonical({p,o});
 const one=buildMortalCampaign(p,o),two=buildMortalCampaign(p,o);assert.deepEqual(one,two);assert.equal(canonical({p,o}),before);assertMortalGenesis(one.genesis);
 assert.equal(one.manifest.pack_hash,hash(pack));assert.equal(one.manifest.genesis_hash,hash(one.genesis));
 one.genesis.scope.world_id='mutated';one.genesis.actors[0].resources.obols=123;
 assert.notEqual(two.genesis.scope.world_id,'mutated');assert.equal(two.genesis.actors[0].resources.obols,5);
});
check('physical selection and identity bind all three fixed variants',()=>{
 const all=['genuine','counterfeit','legend'].map(v=>buildMortalCampaign(pack,options(v)));
 assert.equal(new Set(all.map(x=>x.manifest.genesis_hash)).size,3);
 assert.equal(all[0].genesis.items.find(i=>i.id==='measure_cup').owner_id,'ione');
 assert.equal(all[1].genesis.items.find(i=>i.id==='measure_cup').owner_id,'ione');
 assert(!all[2].genesis.items.some(i=>i.id==='measure_cup'));
 for(const {genesis:g} of all){
  assert.equal(g.actors.length,10);assert.equal(g.locations.length,7);
  assert(!g.actors.some(a=>['clotho','lachesis','atropos'].includes(a.id)));
  assert(!g.locations.some(l=>l.id==='l_loom'));
  assert(g.routes.every(r=>!r.requires_light&&r.hazard===null));
  assert(g.actors.every(a=>a.hp>0&&a.active_seconds===0&&a.fed_until===0&&a.next_rest_at===0&&a.discoveries.length===0));
 }
});
check('creation is deterministic across HP modes with exact starter inventory and bounds',()=>{
 const classic=buildMortalCampaign(pack,options()).genesis;
 const floor=buildMortalCampaign(pack,{...options(),hp_mode:'floor4'}).genesis;
 for(const a of classic.actors.filter(x=>x.kind==='player')){
  const b=floor.actors.find(x=>x.id===a.id);assert.deepEqual(a.abilities,b.abilities);assert.equal(b.max_hp,Math.max(4,a.max_hp));
  assert(a.max_hp>=1&&a.max_hp<=8);assert(Object.values(a.abilities).every(n=>n>=1&&n<=6));
  assert.deepEqual(a.resources,{rations:2,water:2,oil:6,obols:20,ammo:a.id==='companion'?20:0});
 }
 assert.equal(classic.items.find(x=>x.id==='companion_weapon').attack_ability,'wisdom');
 assert.equal(classic.items.find(x=>x.id==='hero_weapon').damage_die,6);
 assert.notDeepEqual(classic.actors.filter(x=>x.kind==='player').map(x=>x.abilities),buildMortalCampaign(pack,{...options(),seed:'88'.repeat(32)}).genesis.actors.filter(x=>x.kind==='player').map(x=>x.abilities));
});
check('options reject proxy/accessor execution and hidden, exotic or malformed data',()=>{
 let traps=0;const p=new Proxy(options(),{get(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');}});
 assert.throws(()=>buildMortalCampaign(pack,p),e=>e.code==='INVALID_CONTRACT');assert.equal(traps,0);
 const getter=options();Object.defineProperty(getter.travelers[0],'name',{get(){traps++;throw Error('getter');},enumerable:true});
 assert.throws(()=>buildMortalCampaign(pack,getter),e=>e.code==='INVALID_CONTRACT');assert.equal(traps,0);
 for(const alter of [
  o=>Object.defineProperty(o,'hidden',{value:1,enumerable:false}),
  o=>({...o,seed:o.seed+'\n'}),
  o=>({...o,travelers:[{...o.travelers[0],id:'hero\n'}]}),
  o=>({...o,authority_public_key:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()}),
  o=>({...o,referee_id:'hero'}),
  o=>({...o,travelers:[o.travelers[0],{...o.travelers[1],id:'hero_weapon'}]}),
  o=>({...o,travelers:[{...o.travelers[0],id:'clotho'}]}),
  o=>({...o,hp_mode:'invincible'}),
  o=>({...o,scope:{...o.scope,tenant_id:'different'}})
 ])assert.throws(()=>buildMortalCampaign(pack,alter(options())),e=>e.code==='INVALID_CONTRACT'||e.code==='SCOPE_MISMATCH'||e.code==='SCOPE_DENIED');
});
const g=buildMortalCampaign(pack,options()).genesis;
const h=hash(g);
// Literal contract-shaped initial state: no mechanics or encounter transition is synthesized.
const state={version:g.version,scope:structuredClone(g.scope),genesis_hash:h,sequence:0,head:h,world_time:0,rng_counter:0,actors:structuredClone(g.actors),items:structuredClone(g.items),opportunities:structuredClone(g.opportunities),stocks:structuredClone(g.stocks),encounter:null};
assertMortalContract('State',state);
const principal={scope:structuredClone(g.scope),principal_id:'auth_hero',actor_id:'hero',role:'player'};
check('initial actor view has exact public keys and only self inventory/local routes',()=>{
 const view=viewMortalActor(g,state,principal);assertMortalContract('ActorView',view);
 assert.deepEqual(Object.keys(view).sort(),['version','scope','cursor','world_time','self','items','location','routes','encounter'].sort());
 assert(!Object.hasOwn(view.self,'kind'));assert(!Object.hasOwn(view.self,'controller_id'));assert.equal(view.self.id,'hero');
 assert.deepEqual(view.items.map(x=>x.id).sort(),['hero_weapon','hero_lamp','hero_firekit'].sort());
 assert.deepEqual(view.routes.map(x=>x.id).sort(),['r_harbor_market','r_harbor_causeway'].sort());assert.equal(view.encounter,null);
 for(const forbidden of ['seed','variant','pack_hash','authority_public_key','authority_key_id','opportunities','stocks','rng_counter','actors'])assert(!Object.hasOwn(view,forbidden));
 assert(!canonical(view).includes(g.seed));assert(!canonical(view).includes('auth_companion'));assert(!canonical(view).includes('measure_cup'));
});
check('scope, controller, actor kind, referee and genesis mismatches fail closed',()=>{
 for(const p of [
  {...principal,actor_id:'companion'},
  {...principal,principal_id:'attacker'},
  {...principal,role:'npc'},
  {...principal,scope:{...principal.scope,world_id:'other'}},
  {...principal,actor_id:'missing'},
  {scope:principal.scope,principal_id:g.referee_id,role:'referee',actor_id:null}
 ])assert.throws(()=>viewMortalActor(g,state,p));
 assert.throws(()=>viewMortalActor(g,{...state,genesis_hash:'12'.repeat(32)},principal));
 assert.throws(()=>viewMortalActor(g,{...state,scope:{...state.scope,world_id:'other'}},principal));
 const npc=g.actors.find(a=>a.id==='ione');assert.equal(viewMortalActor(g,state,{scope:g.scope,principal_id:npc.controller_id,actor_id:npc.id,role:'npc'}).self.id,'ione');
});
check('returned actor view is deeply detached from host genesis/state and principal',()=>{
 const before=canonical({g,state,principal}),view=viewMortalActor(g,state,principal);
 view.scope.world_id='changed';view.self.resources.obols=999;view.self.discoveries.push('invented');view.items[0].name='changed';view.location.name='changed';view.routes[0].to='changed';
 assert.equal(canonical({g,state,principal}),before);
});
check('view rejects active principal without executing traps',()=>{
 let called=0;const p=new Proxy(principal,{ownKeys(){called++;throw Error('trap');},get(){called++;throw Error('trap');}});
 assert.throws(()=>viewMortalActor(g,state,p),e=>e.code==='INVALID_CONTRACT');assert.equal(called,0);
});
const hashes={};
for(const file of ['SYSTEMS/mortal-v2/CONTRACT.md','SYSTEMS/mortal-v2/mortal.schema.json','packages/contracts/src/mortal-types.ts','packages/contracts/src/mortal.ts','scenarios/tempted-fates/runtime.ts','packages/ledger/src/mortal/view.ts','TESTS/mortal-integration.test.ts']){
 hashes[file]=createHash('sha256').update(readFileSync(root+'/'+file)).digest('hex');
}
writeFileSync('/tmp/argo-rp900-review-probes.json',JSON.stringify({checks,source_hashes:hashes,fixture_scope:'Literal schema-validated initial state; no shadow mechanics, generated histories or fabricated accepted encounters',passed:true},null,2)+'\n');
console.log('PASS all '+checks.length+' independent probe groups');

