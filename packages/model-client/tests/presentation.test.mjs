import test from 'node:test';
import assert from 'node:assert/strict';
import {sendModelTurn} from '../index.mjs';

const options={vendor:'openai',model:'gpt-6-astra',prompt:'A scoped dialogue task.',outputBudgetPolicy:'explicit',extra:{max_output_tokens:800}};
const text='{"text":"Leave the lamp here."}';

test('generation preflight follows token counting and can prevent provider invocation',async()=>{
 const order=[];
 await assert.rejects(sendModelTurn({...options,client:{responses:{create:async()=>{order.push('generate');}}},
  countTokens:async()=>{order.push('count');return 20;},beforeGenerate:async()=>{order.push('disclosure');throw new Error('stale context');}}),/stale context/);
 assert.deepEqual(order,['count','disclosure']);
});

test('text-only presentation refuses unsupported content on every response surface',async()=>{
 const fixtures=[
  {vendor:'openai',model:'gpt-6-astra',client:{responses:{create:async()=>({id:'r',status:'completed',output:[{type:'message',content:[{type:'output_text',text},{type:'refusal',refusal:'refused'}]}]})}}},
  {vendor:'xai',model:'grok-4.7',client:{responses:{create:async()=>({id:'r',status:'completed',output:[{type:'message',content:[{type:'output_text',text}]},{type:'web_search_call',id:'unexpected'}]})}}},
  {vendor:'anthropic',model:'claude-fable-5-2',client:{messages:{create:async()=>({stop_reason:'end_turn',content:[{type:'text',text},{type:'tool_use',id:'unexpected',name:'run',input:{}}]})}}},
  {vendor:'agy_google',model:'gemini-4-carbon',client:{models:{generateContent:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text},{inlineData:{mimeType:'image/png',data:'fixture'}}]}}]})}}},
 ];
 for(const fixture of fixtures){
  const result=await sendModelTurn({...options,...fixture,responseMode:'text_only',countTokens:async()=>20});
  assert.equal(result.complete,false,fixture.vendor);assert.equal(result.usable_for_resume,false,fixture.vendor);
 }
});

test('ordinary tool-capable callers retain their existing response behavior',async()=>{
 const result=await sendModelTurn({...options,countTokens:async()=>20,client:{responses:{create:async()=>({id:'r',status:'completed',output:[{type:'function_call',name:'read_file',call_id:'call',arguments:'{}'}]})}}});
 assert.equal(result.usable_for_resume,true);assert.deepEqual(result.tools,['read_file']);
});

test('presentation options are validated before provider invocation',async()=>{
 let calls=0;const client={responses:{create:async()=>{calls++;}}};
 await assert.rejects(sendModelTurn({...options,client,responseMode:'unknown'}),/response mode/);
 await assert.rejects(sendModelTurn({...options,client,beforeGenerate:true}),/preflight/);assert.equal(calls,0);
});
