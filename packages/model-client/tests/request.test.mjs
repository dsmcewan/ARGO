import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRequest, checkBudget, cacheKey, compactConversation } from '../request.mjs';

const scope = { tenant_id: 't1', rights_lane: 'private_upload', workspace_id: 'w1',
  workspace_tenant_id: 't1:private_upload:w1', campaign_id: 'c1', world_id: 'world1', branch_id: 'main', actor_id: 'a1' };
const call = (vendor, model, more = {}) => ({ vendor, model, prompt: 'Implement the scoped contract.', scope, sessionId: 's1', ...more });

test('Fable removes every rejected sampling/thinking/forced-tool field without mutating caller data', () => {
  const extra = { temperature: 0, top_p: 0.8, top_k: 2, thinking: { type: 'disabled' },
    tool_choice: { type: 'tool', name: 'answer' }, max_tokens: 4096, tools: [{ name: 'answer', input_schema: { type: 'object' } }] };
  const before = structuredClone(extra);
  const { request } = prepareRequest(call('anthropic', 'claude-fable-5-2', { extra }));
  for (const k of ['temperature','top_p','top_k','thinking','tool_choice']) assert.equal(k in request, false, k);
  assert.equal(request.output_config.effort, 'high');
  assert.equal(request.max_tokens, 4096);
  assert.deepEqual(extra, before);
  assert.equal(prepareRequest(call('anthropic','claude-fable-5-2',{architecture:true})).request.output_config.effort,'xhigh');
});

test('reserved transport identity and invalid effort cannot be overridden through extra', () => {
  assert.throws(() => prepareRequest(call('anthropic','claude-fable-5-2',{extra:{model:'foreign'}})), /reserved/i);
  assert.throws(() => prepareRequest(call('anthropic','claude-fable-5-2',{effort:'ultra'})), /effort/i);
  assert.throws(() => prepareRequest(call('openai','gpt-6-astra',{extra:{max_output_tokens:0}})), /token/i);
});

test('Carbon/Argon raise old combined budgets and reject impossible thinking levels', () => {
  for (const model of ['gemini-4-carbon','gemini-4-argon']) {
    const { request }=prepareRequest(call('agy_google',model,{extra:{config:{maxOutputTokens:2000,thinkingConfig:{thinkingBudget:1024,thinkingLevel:'MINIMAL'},cachedContent:'old'}}}));
    assert.equal(request.config.maxOutputTokens,65536);
    assert.deepEqual(request.config.thinkingConfig,{thinkingLevel:'LOW'});
    assert.equal('cachedContent' in request.config,false);
    assert.throws(()=>prepareRequest(call('agy_google',model,{effort:'xhigh'})),/effort/i);
  }
});

test('Astra token guard counts the complete request and rejects at 250000 before generation',async()=>{
  const prepared=prepareRequest(call('openai','gpt-6-astra',{contractHeader:'PINNED CONTRACT',extra:{tools:[{type:'function',name:'act',parameters:{type:'object'}}]}}));
  let seen;
  await checkBudget(prepared,async req=>{seen=req;return 249999;});
  assert.deepEqual(seen,prepared.request);
  assert.ok(JSON.stringify(seen).indexOf('PINNED CONTRACT')<JSON.stringify(seen).indexOf('Implement the scoped contract'));
  await assert.rejects(checkBudget(prepared,async()=>250000),/250000/);
  await assert.rejects(checkBudget(prepared),/token count/i);
  await assert.rejects(checkBudget(prepared,async()=>NaN),/token count/i);
});

test('Google combined input plus requested thinking/output cannot exceed the unified window',async()=>{
  const p=prepareRequest(call('agy_google','gemini-4-carbon'));
  await checkBudget(p,async()=>1048576-65536);
  await assert.rejects(checkBudget(p,async()=>1048576-65536+1),/window/i);
});

test('Grok replay preserves encrypted reasoning/tool item order and applies a scoped cache key',()=>{
  const history=[{role:'user',content:'question'}, {type:'reasoning',id:'r1',encrypted_content:'opaque\u0000bytes=='},
    {type:'function_call',call_id:'c1',name:'lookup',arguments:'{}'},{type:'function_call_output',call_id:'c1',output:'done'}];
  const {request}=prepareRequest(call('xai','grok-4.7',{history,continuity:'replay'}));
  assert.deepEqual(request.input.slice(0,-1),history);
  assert.ok(request.include.includes('reasoning.encrypted_content'));
  assert.equal(request.store,false);
  assert.equal(request.prompt_cache_key,cacheKey({scope,sessionId:'s1',vendor:'xai',model:'grok-4.7'}));
  assert.notEqual(request.prompt_cache_key,cacheKey({scope:{...scope,rights_lane:'open_license'},sessionId:'s1',vendor:'xai',model:'grok-4.7'}));
});

test('compaction requests a summary, retains its signed block unchanged, and carries the beta forward',async()=>{
  const block={type:'compaction',content:'summary',signature:'signed-content=='};
  let sent,options;
  const client={messages:{create:async(req,opts)=>{sent=req;options=opts;return {stop_reason:'compaction',content:[block]};}}};
  const prior=[{role:'user',content:'one'},{role:'assistant',content:'two'}];
  const result=await compactConversation({client,model:'claude-fable-5-2',history:prior,system:'stable system',tools:[]});
  assert.deepEqual(sent.compaction,{type:'summarize'});
  assert.equal(sent.system,'stable system');
  assert.match(options.headers['anthropic-beta'],/compact-2026-09-04/);
  assert.deepEqual(result,[{role:'assistant',content:[block]}]);
  const next=prepareRequest(call('anthropic','claude-fable-5-2',{history:result,extra:{system:'stable system'}}));
  assert.deepEqual(next.request.messages[0].content[0],block);
  assert.match(next.options.headers['anthropic-beta'],/compact-2026-09-04/);
  client.messages.create=async()=>({stop_reason:'max_tokens',content:[{type:'text',text:'partial'}]});
  await assert.rejects(compactConversation({client,model:'claude-fable-5-2',history:prior}),/compaction/i);
});

test('cross-provider legacy output fields normalize and unknown parameters never reach an API',()=>{
 const gem=prepareRequest(call('agy_google','gemini-4-carbon',{extra:{max_tokens:1000}}));
 assert.equal(gem.request.config.maxOutputTokens,65536);assert.equal('max_tokens' in gem.request,false);
 const fable=prepareRequest(call('anthropic','claude-fable-5-2',{extra:{max_output_tokens:8192}}));
 assert.equal(fable.request.max_tokens,8192);assert.equal('max_output_tokens' in fable.request,false);
 assert.throws(()=>prepareRequest(call('openai','gpt-6-astra',{extra:{made_up_legacy_field:1}})),/unsupported/i);
 assert.throws(()=>prepareRequest(call('agy_google','gemini-4-carbon',{extra:{background:true}})),/unsupported/i);
});

test('compaction preserves required authentication betas and refuses an unresolved tool turn',async()=>{
 let seen;const client={argoBetaHeaders:['oauth-required'],messages:{create:async(_,options)=>{seen=options;return {stop_reason:'compaction',content:[{type:'compaction',content:'s',signature:'sig'}]};}}};
 await compactConversation({client,model:'claude-fable-5-2',history:[{role:'user',content:'hello'}]});
 assert.match(seen.headers['anthropic-beta'],/oauth-required/);
 await assert.rejects(compactConversation({client,model:'claude-fable-5-2',history:[{role:'assistant',content:[{type:'tool_use',id:'t',name:'write',input:{}}]}]}),/unresolved tool/i);
});

test('Google caller config cannot replace counted contents, cache scope or protected budgets at serialization',()=>{
 assert.throws(()=>prepareRequest(call('agy_google','gemini-4-carbon',{extra:{config:{httpOptions:{extraBody:{contents:[{role:'user',parts:[{text:'uncounted'}]}],cachedContent:'foreign',generationConfig:{maxOutputTokens:2000000,temperature:0.5}}}}}})),/unsupported|transport/i);
});
