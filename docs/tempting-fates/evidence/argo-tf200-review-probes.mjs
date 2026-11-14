import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]??'.');
const r=await import(pathToFileURL(root+'/scenarios/tempted-fates/campaign/rules.ts').href);
let assertions=0;
const check=(value)=>{assert.ok(value);assertions++;};
for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++){
 const out=r.abilityFromDice([a,b,c]);check([a,b,c].includes(out.bonus));check([a,b,c].every(d=>d>=out.bonus));check(out.defense-out.bonus===10);
}
for(let bonus=0;bonus<=10;bonus++)for(let target=0;target<=31;target++){
 let previous=false;
 for(let die=1;die<=20;die++){
  const out=r.resolveCheck({rolls:[die],mode:'normal',bonus,target});
  check(out.die===die&&out.total===die+bonus);
  check(out.success===(out.total>target));check(!previous||out.success);previous=out.success;
 }
}
for(let hp=-30;hp<=30;hp++)for(let damage=0;damage<=40;damage++){
 const out=r.previewDamage({hitPoints:hp,damage});check(out.hitPoints+damage===hp);check(out.hitPoints<=hp);
 check(out.condition===(out.hitPoints>0?'standing':out.hitPoints===0?'unconscious':'dead'));
}
for(let segments=1;segments<=6;segments++)for(let progress=0;progress<=segments;progress++)for(let resources=0;resources<=8;resources++)for(let steps=1;steps<=8;steps++){
 const out=r.previewProject({progress,segments,resources,steps});
 check(out.progress>=progress&&out.progress<=segments);check(out.resources>=0&&out.resources<=resources);
 check(out.progress-progress===resources-out.resources);check(out.progress-progress<=steps);
 check(out.completed===(out.progress===segments));
 if(out.progress-progress<steps)check(out.completed||out.resources===0);
}
const bad=fn=>{assert.throws(fn,e=>e?.code==='INVALID_CONTRACT');assertions++;};
let accessed=0;
const trap=()=>{accessed++;throw Error('active value executed');};
const deep={hitPoints:5,damage:2};Object.defineProperty(deep,'hitPoints',{enumerable:true,get:trap});bad(()=>r.previewDamage(deep));
const revoked=Proxy.revocable([1,2,3],{});revoked.revoke();bad(()=>r.abilityFromDice(revoked.proxy));
for(const key of ['constructor','prototype','__proto__']){
 const value=Object.assign(Object.create(null),{hitPoints:5,damage:2});Object.defineProperty(value,key,{enumerable:true,get:trap});bad(()=>r.previewDamage(value));
}
let deepArray=[1];for(let i=0;i<40;i++)deepArray=[deepArray];bad(()=>r.capacity({constitutionDefense:12,itemSlots:deepArray}));
bad(()=>r.capacity({constitutionDefense:12,itemSlots:Array(100000).fill(0)}));
check(accessed===0);
const n=Number.MAX_SAFE_INTEGER;
bad(()=>r.previewDamage({hitPoints:-n,damage:1}));
bad(()=>r.previewRest({hitPoints:n,maxHitPoints:n,constitutionBonus:0,die:1}));
bad(()=>r.capacity({constitutionDefense:12,itemSlots:[n,1]}));
const previousRandom=Math.random;Math.random=()=>{throw Error('Unexpected RNG');};
try{check(r.resolveMorale({dice:[3,4],rating:7}).holds);check(r.previewRest({hitPoints:0,maxHitPoints:8,constitutionBonus:1,die:2}).hitPoints===3);}finally{Math.random=previousRandom;}
console.log(JSON.stringify({assertions,passive_side_effects:accessed,rule_exports:Object.keys(r),status:'PASS'},null,2));
