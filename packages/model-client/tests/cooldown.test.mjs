import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {openCooldownStore} from '../cooldown.mjs';

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
    assert.equal(await store.get('pool-2'),null);
    assert.ok(await store.get('pool-3'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
