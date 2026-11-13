import {mkdir,readFile,writeFile,rename,unlink,open} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Version 2 stores one record per credential pool. Its locks are shared by all writers.
// Legacy LEXI's unlocked v1 aggregate is intentionally not presented as a transactional store.
export function openCooldownStore(directory){
  const path=pool=>join(directory,createHash('sha256').update(pool).digest('hex')+'.json');
  const read=async pool=>{
    try{
      const record=JSON.parse(await readFile(path(pool),'utf8'));
      if(record.version!==2||record.pool!==pool||!Number.isFinite(record.until))throw new Error('Invalid cooldown record');
      return record;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  };
  const transaction=async(pool,fn)=>{
    if(typeof pool!=='string'||!pool)throw new Error('Pool identity required');
    await mkdir(directory,{recursive:true,mode:0o700});
    const lock=path(pool)+'.lock',deadline=Date.now()+5000;
    let handle;
    while(!handle){
      try{handle=await open(lock,'wx',0o600);}
      catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()>=deadline)throw new Error('Cooldown lock unavailable');await delay(10);}
    }
    try{return await fn();}finally{await handle.close();await unlink(lock);}
  };
  return {
    get:read,
    refuse:(pool,{until,reason})=>transaction(pool,async()=>{
      if(!Number.isFinite(until))throw new Error('Invalid cooldown deadline');
      const old=await read(pool);
      const row={version:2,pool,until:Math.max(until,old?.until??0),reason:String(reason).slice(0,80)};
      const temporary=path(pool)+'.'+randomUUID()+'.tmp';
      try{await writeFile(temporary,JSON.stringify(row),{mode:0o600});await rename(temporary,path(pool));}
      finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      return row;
    }),
    success:pool=>transaction(pool,async()=>{
      // Concurrent calls may finish out of order. Success is not permission to cancel a
      // provider's still-active Retry-After, including one written by a newer request.
      const current=await read(pool);
      if(current&&current.until<=Date.now())await unlink(path(pool));
    }),
  };
}
