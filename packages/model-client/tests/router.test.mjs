import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeCall} from '../router.mjs';

const candidates=[{vendor:'anthropic',model:'fixture',pool:'pool-1'},{vendor:'anthropic',model:'fixture',pool:'pool-2'}];
const http=(status,retryAfter)=>Object.assign(new Error('fixture failure'),{status,headers:new Headers(retryAfter==null?{}:{'retry-after':String(retryAfter)})});

test('400 and auth failures are terminal on first call and after a retryable error',async()=>{
  for(const status of [400,401,403,404]){
    let calls=0;
    await assert.rejects(routeCall({candidates,invoke:async()=>{calls++;throw http(status);}}),e=>e.status===status);
    assert.equal(calls,1);
    calls=0;
    await assert.rejects(routeCall({candidates,invoke:async()=>{calls++;throw calls===1?http(429,0.001):http(status);}}),e=>e.status===status);
    assert.equal(calls,2);
  }
});

test('quota refusal advances only to a separately configured pool and returns actual identity',async()=>{
  const seen=[];
  const result=await routeCall({candidates:[candidates[0],{...candidates[0],model:'same-pool'},candidates[1]],invoke:async seat=>{seen.push(seat.pool);if(seat.pool==='pool-1')throw http(429);return 'ok';}});
  assert.deepEqual(seen,['pool-1','pool-2']);
  assert.equal(result.value,'ok');assert.equal(result.seat.pool,'pool-2');
});

test('Retry-After is not truncated into an early same-pool retry',async()=>{
  const seen=[];
  const result=await routeCall({candidates,deadline:Date.now()+500,invoke:async seat=>{seen.push(seat.pool);if(seat.pool==='pool-1')throw http(429,120);return 'fallback';}});
  assert.deepEqual(seen,['pool-1','pool-2']);assert.equal(result.value,'fallback');
});

test('cancellation and deadlines bound hung injected transports without starting another seat',async()=>{
  let calls=0;
  await assert.rejects(routeCall({candidates,deadline:Date.now()+25,invoke:async()=>{calls++;return new Promise(()=>{});}}),/deadline|timeout/i);
  assert.equal(calls,1);
  const controller=new AbortController();controller.abort();
  await assert.rejects(routeCall({candidates,signal:controller.signal,invoke:async()=>{calls++;}}),/abort/i);
  assert.equal(calls,1);
});
