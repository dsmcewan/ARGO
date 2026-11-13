import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnPromise} from '../src/board/spawn.mjs';
import {readFileSync} from 'node:fs';

const alive=pid=>{try{return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`,'utf8'));}catch{return false;}};
const cleanup=ids=>ids.forEach(pid=>{try{process.kill(pid,'SIGKILL');}catch{}});

test('timeout kills a TERM-ignoring process and descendants while the event loop stays responsive',async()=>{
  const ids=[];
  const code=`import {spawn} from 'node:child_process';process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});console.log(JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  let guard;
  try{
    const result=await Promise.race([
      spawnPromise(process.execPath,['--input-type=module','-e',code],{timeout:150,killGraceMs:25,onStdoutLine:line=>ids.push(...JSON.parse(line))}),
      new Promise((_,reject)=>{guard=setTimeout(()=>reject(new Error('runner hung after timeout')),800);})]);
    assert.equal(result.status,null);
    assert.ok(ticks>5);
    assert.equal(ids.length,2);
    assert.ok(ids.every(pid=>!alive(pid)),'parent or descendant remains alive');
  }finally{clearInterval(timer);clearTimeout(guard);cleanup(ids);}
});

test('output cap counts UTF-8 bytes and cancels the child',async()=>{
  const result=await spawnPromise(process.execPath,['-e',"process.stdout.write('😀'.repeat(100));setInterval(()=>{},1000)"],{maxBuffer:100,timeout:500,killGraceMs:25});
  assert.ok(Buffer.byteLength(result.stdout)<=100);
  assert.equal(result.status,null);
  assert.equal(result.killedFor,'output_limit');
});

test('abort stops an in-flight process promptly and an already aborted call never spawns',async()=>{
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),60);
  try{
    const result=await spawnPromise(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:ctrl.signal,timeout:500,killGraceMs:25});
    assert.equal(result.killedFor,'cancelled');
    await assert.rejects(spawnPromise(process.execPath,['-e','process.exit(0)'],{signal:ctrl.signal}),/abort/i);
  }finally{clearTimeout(timer);}
});
