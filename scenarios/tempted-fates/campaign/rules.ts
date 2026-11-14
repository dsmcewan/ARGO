/** Pure tabletop previews. Dice and permission to use a result belong to the referee. */
import {types as nodeTypes} from 'node:util';
import {fail} from '@argo/contracts';
import type {
 AbilityResult,CheckInput,CheckResult,CapacityInput,CapacityResult,DamageInput,HealthResult,
 RestInput,MoraleInput,MoraleResult,ProjectInput,ProjectResult,
} from './types.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
const MAX=Number.MAX_SAFE_INTEGER;
/** Inspect descriptors before consuming values; never call accessors/proxy traps. */
function passive(value:unknown,active=new Set<object>(),depth=0,budget={entries:0}):void{
 if(depth>32||++budget.entries>100000)invalid('Rules input exceeds its structural bound');
 if(value===null||typeof value==='boolean'||typeof value==='string')return;
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('Rules require safe integers, excluding negative zero');return;}
 if(typeof value!=='object')invalid('Rules input must contain only JSON data');
 if(nodeTypes.isProxy(value))invalid('Rules input cannot contain a proxy');
 if(active.has(value))invalid('Rules input cannot contain a cycle');
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Rules input requires plain objects and arrays');
 const keys=Reflect.ownKeys(value);
 if(keys.length>100000-budget.entries||keys.some(key=>typeof key!=='string'))invalid('Rules input has too many properties or contains symbols');
 const descriptors=Object.getOwnPropertyDescriptors(value);active.add(value);
 try{
  if(array){
   const length=descriptors.length;
   if(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1)invalid('Rules arrays must be dense and undecorated');
   for(let i=0;i<length.value;i++){
    const entry=descriptors[String(i)];
    if(!entry||!entry.enumerable||!('value'in entry))invalid('Rules array entry is missing or active');
    passive(entry.value,active,depth+1,budget);
   }
  }else for(const key of keys as string[]){
   const entry=descriptors[key];
   if(['__proto__','prototype','constructor'].includes(key)||!entry||!entry.enumerable||!('value'in entry))invalid('Rules object has an unsafe or active property');
   passive(entry.value,active,depth+1,budget);
  }
 }finally{active.delete(value);}
}
function closed(value:unknown,keys:readonly string[]):void{
 passive(value);
 if(value===null||typeof value!=='object'||Array.isArray(value))invalid('Rules input must be a closed object');
 const actual=Object.keys(value);
 if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))invalid('Rules input has missing or unknown fields');
}
function integer(value:unknown,min:number,max=MAX):asserts value is number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||Object.is(value,-0)||value<min||value>max)invalid('Rules integer is outside its allowed range');
}
function checked(value:number):number{integer(value,-MAX);return value;}
function dice(value:unknown,count:number,sides:number):asserts value is readonly number[]{
 if(!Array.isArray(value)||value.length!==count)invalid('Wrong number of explicit dice');
 for(const die of value)integer(die,1,sides);
}
function health(hitPoints:number):HealthResult{
 return {hitPoints,condition:hitPoints>0?'standing':hitPoints===0?'unconscious':'dead'};
}

export function abilityFromDice(input:readonly [number,number,number]):AbilityResult{
 passive(input);dice(input,3,6);const bonus=Math.min(...input);return {bonus,defense:bonus+10};
}
export function resolveCheck(input:CheckInput):CheckResult{
 closed(input,['rolls','mode','bonus','target']);
 if(!['normal','advantage','disadvantage'].includes(input.mode))invalid('Unknown check mode');
 dice(input.rolls,input.mode==='normal'?1:2,20);integer(input.bonus,0,10);integer(input.target,0);
 const die=input.mode==='normal'?input.rolls[0]!:input.mode==='advantage'?Math.max(...input.rolls):Math.min(...input.rolls);
 const total=checked(die+input.bonus);return {die,total,success:total>input.target};
}
export function capacity(input:CapacityInput):CapacityResult{
 closed(input,['constitutionDefense','itemSlots']);integer(input.constitutionDefense,10,20);
 if(!Array.isArray(input.itemSlots)||input.itemSlots.length>1024)invalid('Capacity requires at most 1024 slot entries');
 let occupied=0;
 for(const slots of input.itemSlots){integer(slots,0);occupied=checked(occupied+slots);}
 const remaining=checked(input.constitutionDefense-occupied);
 return {capacity:input.constitutionDefense,occupied,remaining,fits:remaining>=0};
}
export function previewDamage(input:DamageInput):HealthResult{
 closed(input,['hitPoints','damage']);integer(input.hitPoints,-MAX);integer(input.damage,0);
 return health(checked(input.hitPoints-input.damage));
}
export function previewRest(input:RestInput):HealthResult{
 closed(input,['hitPoints','maxHitPoints','constitutionBonus','die']);
 integer(input.maxHitPoints,1);integer(input.hitPoints,0,input.maxHitPoints);integer(input.constitutionBonus,0,10);integer(input.die,1,8);
 // Check the actual arithmetic before capping; a cap must not hide overflow.
 return health(Math.min(input.maxHitPoints,checked(checked(input.hitPoints+input.die)+input.constitutionBonus)));
}
export function resolveMorale(input:MoraleInput):MoraleResult{
 closed(input,['dice','rating']);dice(input.dice,2,6);integer(input.rating,2,12);
 const total=input.dice[0]+input.dice[1];return {total,holds:total<=input.rating};
}
export function previewProject(input:ProjectInput):ProjectResult{
 closed(input,['progress','segments','resources','steps']);
 integer(input.segments,1);integer(input.progress,0,input.segments);integer(input.resources,0);integer(input.steps,1);
 const applied=Math.min(input.steps,input.resources,input.segments-input.progress);
 const progress=checked(input.progress+applied),resources=checked(input.resources-applied);
 return {progress,segments:input.segments,resources,completed:progress===input.segments};
}
