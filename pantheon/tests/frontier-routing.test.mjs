import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frontierCandidates,readPools} from '../src/route/frontier.mjs';
import {modelId} from '../src/config/models.mjs';

test('frontier seats match requested providers and model IDs',()=>{
  const expected={planner:['anthropic',modelId('anthropic','fable')],implementer:['openai',modelId('openai','astra')],
    scout:['xai',modelId('xai','grok-4.3')],reviewer:['xai',modelId('xai','grok-4.7')],
    synthesis:['agy_google',modelId('google','carbon')],fast_loop:['agy_google',modelId('google','argon')]};
  for(const [role,[vendor,model]]of Object.entries(expected)){
    const first=frontierCandidates(role)[0];assert.equal(first.vendor,vendor);assert.equal(first.model,model);assert.equal(first.transport,'api');
  }
  assert.deepEqual(frontierCandidates('controller'),[]);
});

test('four explicit pools keep credential identity and do not count shared credentials twice',()=>{
  const rows=Array.from({length:4},(_,i)=>({id:`fable-${i}`,vendor:'anthropic',auth:'oauth',credential_env:`FABLE_POOL_${i}`}));
  const env=Object.fromEntries(rows.map((r,i)=>[r.credential_env,`test-credential-${i}`]));
  const pools=readPools({rows,env});
  assert.deepEqual(frontierCandidates('planner',{pools}).filter(c=>c.vendor==='anthropic').map(c=>c.pool),rows.map(r=>r.id));
  assert.throws(()=>readPools({rows,env:{...env,FABLE_POOL_1:env.FABLE_POOL_0}}),/same credential/i);
  assert.throws(()=>readPools({rows,env:{}}),/missing credential/i);
  assert.ok(!JSON.stringify(pools).includes('test-credential'));
});

test('an implementer pin resolves its own vendor, never the first candidate vendor',()=>{
  const pin=modelId('anthropic','fable');
  const first=frontierCandidates('implementer',{pin})[0];
  assert.equal(first.vendor,'anthropic');assert.equal(first.model,pin);
  assert.throws(()=>frontierCandidates('implementer',{pin:'unregistered-model'}),/model/i);
});
