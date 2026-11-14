import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertMortalGenesis,assertMortalV3Genesis,hash,MORTAL_V3_PROFILE} from '@argo/contracts';
import {keys,scope} from './fixtures.ts';
import type {MortalCampaignOptions} from '../scenarios/tempted-fates/runtime.ts';
const modulePath='../scenarios/tempted-fates/index.ts';
const pack=async()=>JSON.parse(await readFile(new URL('../scenarios/tempted-fates/campaign/world.json',import.meta.url),'utf8'));
function options():MortalCampaignOptions{return {scope:{...scope,world_id:'fresh_v3_campaign'},seed:'87'.repeat(32),authority_key_id:'v3_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),referee_id:'host',npc_controller_id:'npc_host',variant:'legend',hp_mode:'floor4',travelers:[{id:'hero',name:'Ariadne',controller_id:'auth_hero',weapon:'spear'}]};}

test('public campaign builder explicitly selects a fresh v3 identity without changing v2 initialization',async()=>{
 const api=await import(modulePath);assert.equal(typeof api.buildMortalV3Campaign,'function');
 const content=await pack(),input=options(),before=hash({content,input});
 const current=api.buildMortalV3Campaign(content,input),legacy=api.buildMortalCampaign(content,input);
 assertMortalV3Genesis(current.genesis);assertMortalGenesis(legacy.genesis);
 assert.equal(current.genesis.version,MORTAL_V3_PROFILE);assert.notEqual(hash(current.genesis),hash(legacy.genesis));
 assert.equal(current.manifest.adapter,'tempting-fates-mortal/0.3.0');assert.equal(current.manifest.genesis_hash,hash(current.genesis));
 assert.deepEqual(current.genesis.actors,legacy.genesis.actors,'scheduling repair does not rebalance creation');
 assert.equal(hash({content,input}),before,'caller content and options stay detached');
 assert.deepEqual(api.buildMortalV3Campaign(content,input),current);
 assert.throws(()=>assertMortalGenesis(current.genesis));assert.throws(()=>assertMortalV3Genesis(legacy.genesis));
});

test('fresh v3 campaign builder is not an import or continuation endpoint',async()=>{
 const api=await import(modulePath);assert.equal(typeof api.buildMortalV3Campaign,'function');
 const content=await pack(),input=options(),legacy=api.buildMortalCampaign(content,input);
 assert.throws(()=>api.buildMortalV3Campaign(legacy.genesis,input));
 assert.throws(()=>api.buildMortalV3Campaign(content,{...input,previous_genesis:legacy.genesis}));
 let invoked=0;const active=Object.defineProperty({...input},'seed',{enumerable:true,get(){invoked++;return input.seed;}});
 assert.throws(()=>api.buildMortalV3Campaign(content,active));assert.equal(invoked,0);
});
