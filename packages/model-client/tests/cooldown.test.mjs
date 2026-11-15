import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {openCooldownStore} from '../cooldown.mjs';
import {routeCall} from '../router.mjs';

test('independent processes cannot lose distinct pool updates',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'argo-pools-'));
  try{
    const module=new URL('../cooldown.mjs',import.meta.url).href;
    await Promise.all(Array.from({length:8},(_,i)=>new Promise((resolve,reject)=>{
      const code=`import {openCooldownStore} from ${JSON.stringify(module)};await openCooldownStore(${JSON.stringify(directory)}).refuse('pool-${i}',{until:Date.now()+120000,reason:'quota'});`;
      const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','ignore','pipe']});
      let stderr='';child.stderr.on('data',d=>stderr+=d);
      child.on('error',reject);child.on('exit',n=>n===0?resolve():reject(new Error(stderr)));
    })));
    const store=openCooldownStore(directory);
    for(let i=0;i<8;i++)assert.ok((await store.get(`pool-${i}`)).until>Date.now());
    await store.success('pool-2');
    assert.ok((await store.get('pool-2')).until>Date.now());
    assert.ok(await store.get('pool-3'));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an older successful call cannot clear a newer refusal for the same pool',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'argo-pool-order-'));
  try{
    const cooldown=openCooldownStore(directory);
    const candidates=[{vendor:'xai',model:'grok-4.7',pool:'shared'}];
    const started=Promise.withResolvers(),response=Promise.withResolvers();
    const older=routeCall({candidates,cooldown,invoke:()=>{started.resolve();return response.promise;}});
    await started.promise;
    try{
      await assert.rejects(routeCall({candidates,cooldown,maxAttempts:1,invoke:async()=>{
        throw Object.assign(new Error('fixture rate limit'),{status:429,headers:{'retry-after':'120'}});
      }}),{code:'POOLS_UNAVAILABLE'});
    }finally{response.resolve('older response');await older;}
    let freshCalls=0;
    await assert.rejects(routeCall({candidates,cooldown,invoke:async()=>{freshCalls++;return 'too early';}}),{code:'POOLS_UNAVAILABLE'});
    assert.equal(freshCalls,0);
    assert.ok((await cooldown.get('shared')).until>Date.now());
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a retry rereads a refusal extended by another pool writer',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'argo-pool-retry-'));
  try{
    const store=openCooldownStore(directory),peer=openCooldownStore(directory);
    const cooldown={...store,refuse:async(pool,value)=>{
      await store.refuse(pool,value);
      // Another worker extends the deadline after this request's short Retry-After.
      await peer.refuse(pool,{until:Date.now()+120000,reason:'quota'});
    }};
    const candidates=[{vendor:'xai',model:'grok-4.7',pool:'shared'},{vendor:'xai',model:'grok-4.7',pool:'other'}];
    const seen=[];
    const result=await routeCall({candidates,cooldown,invoke:async seat=>{
      seen.push(seat.pool);
      if(seen.length===1)throw Object.assign(new Error('short rate limit'),{status:429,headers:{'retry-after':'0.001'}});
      return 'complete';
    }});
    assert.deepEqual(seen,['shared','other']);
    assert.equal(result.seat.pool,'other');
    assert.ok((await store.get('shared')).until>Date.now());
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a pool can retry successfully after its own cooldown expires',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'argo-pool-expiry-'));
  try{
    const cooldown=openCooldownStore(directory);
    const candidates=[{vendor:'xai',model:'grok-4.7',pool:'shared'}];
    let calls=0;
    const result=await routeCall({candidates,cooldown,invoke:async()=>{
      if(++calls===1)throw Object.assign(new Error('retry now'),{status:429,headers:{'retry-after':'0'}});
      return 'complete';
    }});
    assert.equal(result.value,'complete');assert.equal(calls,2);
    assert.equal(await cooldown.get('shared'),null);
  }finally{await rm(directory,{recursive:true,force:true});}
});
