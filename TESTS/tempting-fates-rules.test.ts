import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArgoError} from '../packages/contracts/src/index.ts';
import type {CampaignRules} from '../scenarios/tempted-fates/campaign/types.ts';
import * as implementation from '../scenarios/tempted-fates/campaign/rules.ts';

const rules:CampaignRules=implementation;
const invalid=(fn:()=>unknown)=>assert.throws(fn,error=>error instanceof ArgoError&&error.code==='INVALID_CONTRACT');
const max=Number.MAX_SAFE_INTEGER;

test('ability generation uses the lowest of exactly three d6 and adds ten for defense',()=>{
 assert.deepEqual(rules.abilityFromDice([6,2,5]),{bonus:2,defense:12});
 assert.deepEqual(rules.abilityFromDice([1,1,1]),{bonus:1,defense:11});
 assert.deepEqual(rules.abilityFromDice([6,6,6]),{bonus:6,defense:16});
 for(const dice of [[],[1,2],[1,2,3,4],[0,2,3],[7,2,3],[1.5,2,3],['1',2,3]])invalid(()=>rules.abilityFromDice(dice as any));
});
test('normal checks exceed the target strictly; DEX+2 fails on thirteen and passes on fourteen',()=>{
 assert.deepEqual(rules.resolveCheck({rolls:[13],mode:'normal',bonus:2,target:15}),{die:13,total:15,success:false});
 assert.deepEqual(rules.resolveCheck({rolls:[14],mode:'normal',bonus:2,target:15}),{die:14,total:16,success:true});
 assert.deepEqual(rules.resolveCheck({rolls:[20],mode:'normal',bonus:10,target:30}),{die:20,total:30,success:false});
 assert.deepEqual(rules.resolveCheck({rolls:[1],mode:'normal',bonus:0,target:0}),{die:1,total:1,success:true});
 assert.deepEqual(rules.resolveCheck({rolls:[20],mode:'normal',bonus:10,target:max}),{die:20,total:30,success:false});
});
test('advantage and disadvantage select the supplied high and low dice with exact dice counts',()=>{
 assert.deepEqual(rules.resolveCheck({rolls:[3,18],mode:'advantage',bonus:2,target:15}),{die:18,total:20,success:true});
 assert.deepEqual(rules.resolveCheck({rolls:[18,3],mode:'disadvantage',bonus:2,target:15}),{die:3,total:5,success:false});
 assert.deepEqual(rules.resolveCheck({rolls:[9,9],mode:'advantage',bonus:1,target:10}),{die:9,total:10,success:false});
 for(const patch of [{rolls:[]},{rolls:[1,2]},{rolls:[0]},{rolls:[21]},{mode:'secret'},{bonus:-1},{bonus:11},{target:-1},{target:max+1},{target:NaN},{bonus:'2'},{mode:'advantage',rolls:[12]},{mode:'disadvantage',rolls:[1,2,3]}])invalid(()=>rules.resolveCheck({...{rolls:[10],mode:'normal',bonus:2,target:15},...patch} as any));
});
test('capacity reports exact fit and negative remaining without discarding any possessions',()=>{
 assert.deepEqual(rules.capacity({constitutionDefense:12,itemSlots:[3,2,1,6]}),{capacity:12,occupied:12,remaining:0,fits:true});
 assert.deepEqual(rules.capacity({constitutionDefense:12,itemSlots:[3,2,1,7]}),{capacity:12,occupied:13,remaining:-1,fits:false});
 assert.deepEqual(rules.capacity({constitutionDefense:10,itemSlots:[]}),{capacity:10,occupied:0,remaining:10,fits:true});
 assert.deepEqual(rules.capacity({constitutionDefense:20,itemSlots:Array(1024).fill(0)}),{capacity:20,occupied:0,remaining:20,fits:true});
 assert.deepEqual(rules.capacity({constitutionDefense:10,itemSlots:[max]}),{capacity:10,occupied:max,remaining:-9007199254740981,fits:false});
 for(const input of [{constitutionDefense:9,itemSlots:[]},{constitutionDefense:21,itemSlots:[]},{constitutionDefense:12,itemSlots:[-1]},{constitutionDefense:12,itemSlots:[max,1]},{constitutionDefense:12,itemSlots:Array(1025).fill(0)}])invalid(()=>rules.capacity(input));
});
test('damage preserves exact zero unconscious and negative dead boundaries',()=>{
 assert.deepEqual(rules.previewDamage({hitPoints:5,damage:4}),{hitPoints:1,condition:'standing'});
 assert.deepEqual(rules.previewDamage({hitPoints:5,damage:5}),{hitPoints:0,condition:'unconscious'});
 assert.deepEqual(rules.previewDamage({hitPoints:5,damage:6}),{hitPoints:-1,condition:'dead'});
 assert.deepEqual(rules.previewDamage({hitPoints:-3,damage:2}),{hitPoints:-5,condition:'dead'});
 assert.deepEqual(rules.previewDamage({hitPoints:-max,damage:0}),{hitPoints:-max,condition:'dead'});
 invalid(()=>rules.previewDamage({hitPoints:-max,damage:1}));invalid(()=>rules.previewDamage({hitPoints:5,damage:-1}));
});
test('ordinary rest previews d8 plus Constitution, caps HP and never resurrects',()=>{
 assert.deepEqual(rules.previewRest({hitPoints:0,maxHitPoints:8,constitutionBonus:2,die:3}),{hitPoints:5,condition:'standing'});
 assert.deepEqual(rules.previewRest({hitPoints:7,maxHitPoints:8,constitutionBonus:10,die:8}),{hitPoints:8,condition:'standing'});
 assert.deepEqual(rules.previewRest({hitPoints:0,maxHitPoints:1,constitutionBonus:0,die:1}),{hitPoints:1,condition:'standing'});
 for(const patch of [{hitPoints:-1},{hitPoints:9},{maxHitPoints:0},{constitutionBonus:-1},{constitutionBonus:11},{die:0},{die:9},{die:2.5},{hitPoints:max,maxHitPoints:max}])invalid(()=>rules.previewRest({...{hitPoints:1,maxHitPoints:8,constitutionBonus:2,die:4},...patch}));
});
test('morale holds on a tie and fails only above its rating',()=>{
 assert.deepEqual(rules.resolveMorale({dice:[3,4],rating:7}),{total:7,holds:true});
 assert.deepEqual(rules.resolveMorale({dice:[4,4],rating:7}),{total:8,holds:false});
 assert.deepEqual(rules.resolveMorale({dice:[1,1],rating:2}),{total:2,holds:true});
 assert.deepEqual(rules.resolveMorale({dice:[6,6],rating:12}),{total:12,holds:true});
 for(const input of [{dice:[1],rating:7},{dice:[1,1,1],rating:7},{dice:[0,2],rating:7},{dice:[7,2],rating:7},{dice:[1,2],rating:1},{dice:[1,2],rating:13}])invalid(()=>rules.resolveMorale(input as any));
});
test('finite project advances are limited independently by requested steps, resources and remaining segments',()=>{
 assert.deepEqual(rules.previewProject({progress:1,segments:6,resources:8,steps:2}),{progress:3,segments:6,resources:6,completed:false});
 assert.deepEqual(rules.previewProject({progress:1,segments:6,resources:2,steps:8}),{progress:3,segments:6,resources:0,completed:false});
 assert.deepEqual(rules.previewProject({progress:5,segments:6,resources:8,steps:7}),{progress:6,segments:6,resources:7,completed:true});
 assert.deepEqual(rules.previewProject({progress:6,segments:6,resources:8,steps:7}),{progress:6,segments:6,resources:8,completed:true});
 assert.deepEqual(rules.previewProject({progress:1,segments:6,resources:0,steps:7}),{progress:1,segments:6,resources:0,completed:false});
 assert.deepEqual(rules.previewProject({progress:0,segments:max,resources:max,steps:max}),{progress:max,segments:max,resources:0,completed:true});
 for(const patch of [{progress:-1},{progress:7},{segments:0},{resources:-1},{steps:0},{steps:max+1}])invalid(()=>rules.previewProject({...{progress:1,segments:6,resources:2,steps:1},...patch}));
});

const fixtures:Record<keyof CampaignRules,unknown>={
 abilityFromDice:[2,3,4],resolveCheck:{rolls:[14],mode:'normal',bonus:2,target:15},
 capacity:{constitutionDefense:12,itemSlots:[1,2]},previewDamage:{hitPoints:5,damage:2},
 previewRest:{hitPoints:1,maxHitPoints:8,constitutionBonus:2,die:3},resolveMorale:{dice:[3,4],rating:7},
 previewProject:{progress:1,segments:6,resources:2,steps:1},
};
const invoke=(name:keyof CampaignRules,value:unknown):unknown=>(rules[name] as (input:unknown)=>unknown)(value);
test('all calculators reject unclosed and active inputs before reading a getter or proxy trap',()=>{
 let reads=0;const get=()=>{reads++;throw new Error('Getter executed');};
 for(const [key,value] of Object.entries(fixtures)){
  const name=key as keyof CampaignRules;
  invalid(()=>invoke(name,new Proxy(value as object,{get(){reads++;throw Error('Proxy get');},ownKeys(){reads++;throw Error('Proxy keys');},getPrototypeOf(){reads++;throw Error('Proxy prototype');}})));
  const decorated=structuredClone(value) as Record<string,unknown>;Object.defineProperty(decorated,'trap',{enumerable:true,get});invalid(()=>invoke(name,decorated));
  const unknown=structuredClone(value) as Record<string,unknown>;unknown.extra=true;invalid(()=>invoke(name,unknown));
  for(const bad of [null,undefined,'1',1,true,new Date(),Object.create({inherited:true})])invalid(()=>invoke(name,bad));
 }
 invalid(()=>rules.resolveCheck({rolls:new Proxy([14],{get(){reads++;throw Error();}}),mode:'normal',bonus:2,target:15}));
 const dice=[1,2,3];Object.defineProperty(dice,'0',{enumerable:true,get});invalid(()=>rules.abilityFromDice(dice as any));assert.equal(reads,0);
 const field={damage:1};Object.defineProperty(field,'hitPoints',{enumerable:true,get});invalid(()=>rules.previewDamage(field as any));
 const revoked=Proxy.revocable({hitPoints:1,damage:0},{});revoked.revoke();invalid(()=>rules.previewDamage(revoked.proxy));assert.equal(reads,0);
});
test('nested malformed arrays, symbols, hidden properties, cycles and hostile numbers are rejected',()=>{
 const badArrays:unknown[]=[Array(3),[1,,3],Object.assign([1,2,3],{extra:0}),new Uint8Array([1,2,3])];
 const symbol=[1,2,3];Object.defineProperty(symbol,Symbol('hidden'),{value:1});badArrays.push(symbol);
 const hidden=[1,2,3];Object.defineProperty(hidden,'secret',{value:1});badArrays.push(hidden);
 const cyc:any[]=[1,2];cyc.push(cyc);badArrays.push(cyc);
 for(const bad of badArrays)invalid(()=>rules.abilityFromDice(bad as any));
 for(const bad of [-0,NaN,Infinity,-Infinity,max+1,0.5,undefined,null,'1',1n]){
  invalid(()=>rules.previewDamage({hitPoints:bad,damage:1} as any));
  invalid(()=>rules.resolveCheck({rolls:[14],mode:'normal',bonus:2,target:bad} as any));
 }
 const input={hitPoints:1,damage:0};Object.defineProperty(input,'hidden',{value:0});invalid(()=>rules.previewDamage(input));
 const withSymbol={hitPoints:1,damage:0,[Symbol('hidden')]:0};invalid(()=>rules.previewDamage(withSymbol));
});
test('plain null-prototype input is accepted without coercion',()=>{
 const input=Object.assign(Object.create(null),{hitPoints:5,damage:2});assert.deepEqual(rules.previewDamage(input),{hitPoints:3,condition:'standing'});
});
test('every calculator preserves caller input and returns fresh detached output',()=>{
 for(const [key,value] of Object.entries(fixtures)){
  const name=key as keyof CampaignRules,copy=structuredClone(value),before=JSON.stringify(copy);
  if(Array.isArray(copy))Object.freeze(copy);else for(const child of Object.values(copy as object))if(Array.isArray(child))Object.freeze(child);
  Object.freeze(copy);const first=invoke(name,copy),second=invoke(name,copy);
  assert.deepEqual(first,second,name);assert.notEqual(first,second,name);assert.equal(JSON.stringify(copy),before,name);
  (first as Record<string,unknown>).changed=true;assert.ok(!Object.hasOwn(second as object,'changed'),name);
 }
});
