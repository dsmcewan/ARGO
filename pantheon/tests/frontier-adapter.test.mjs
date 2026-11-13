import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendTurn} from '../src/sdk/adapter.mjs';
import {modelId} from '../src/config/models.mjs';

test('active Pantheon Fable path strips forbidden fields and detects unary max_tokens',async()=>{
  let request;
  const client={messages:{create:async req=>{request=req;return {stop_reason:'max_tokens',content:[{type:'text',text:'partial'}]};}}};
  const result=await sendTurn({client,vendor:'anthropic',model:modelId('anthropic','fable'),prompt:'code',extra:{temperature:0,tool_choice:{type:'any'}}});
  assert.equal('temperature' in request,false);
  assert.equal('tool_choice' in request,false);
  assert.equal(result.complete,false);
  assert.equal(result.usable_for_resume,false);
});

test('active Astra path refuses an expensive request before creating a response',async()=>{
  let generations=0;
  const client={responses:{inputTokens:{count:async()=>({input_tokens:250000})},create:async()=>{generations++;return {id:'x'};}}};
  await assert.rejects(sendTurn({client,vendor:'openai',model:modelId('openai','astra'),prompt:'code'}),/250000/);
  assert.equal(generations,0);
});

test('active Google path budgets thinking/output and retains thought signatures',async()=>{
  let request;
  const part={text:'complete code',thoughtSignature:'opaque-google-signature'};
  const client={models:{countTokens:async()=>({totalTokens:10}),generateContent:async req=>{request=req;return {candidates:[{finishReason:'STOP',content:{role:'model',parts:[part]}}]};}}};
  const result=await sendTurn({client,vendor:'agy_google',model:modelId('google','carbon'),prompt:'code',extra:{config:{maxOutputTokens:2000}}});
  assert.equal(request.config.maxOutputTokens,65536);
  assert.deepEqual(result.history.at(-1).parts,[part]);
  assert.equal(result.complete,true);
});

test('Fable message_stop after max_tokens is incomplete on the streaming path too',async()=>{
  const client={messages:{create:async function*(){
    yield {type:'content_block_start',index:0,content_block:{type:'text',text:''}};
    yield {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'partial'}};
    yield {type:'message_delta',delta:{stop_reason:'max_tokens'}};
    yield {type:'message_stop'};
  }}};
  const result=await sendTurn({client,vendor:'anthropic',model:modelId('anthropic','fable'),prompt:'code',onEvent:()=>{}});
  assert.equal(result.complete,false);
  assert.equal(result.usable_for_resume,false);
});

test('Grok streamed encrypted output survives the next tool turn byte-for-byte',async()=>{
  const encrypted={type:'reasoning',id:'reason1',encrypted_content:'opaque\u0000do-not-edit=='};
  const output=[encrypted,{type:'function_call',name:'lookup',call_id:'tool1',arguments:'{}'}];
  const requests=[];
  const client={responses:{create:async function*(req){requests.push(req);yield {type:'response.completed',response:{id:'r1',status:'completed',output}};}}};
  const first=await sendTurn({client,vendor:'xai',model:modelId('xai','grok-4.7'),prompt:'look',continuity:'replay',onEvent:()=>{}});
  const history=[...first.history,{type:'function_call_output',call_id:'tool1',output:'found'}];
  await sendTurn({client,vendor:'xai',model:modelId('xai','grok-4.7'),prompt:'continue',history,continuity:'replay',onEvent:()=>{}});
  assert.deepEqual(requests[1].input.slice(0,-1),history);
  assert.ok(requests[1].include.includes('reasoning.encrypted_content'));
});
