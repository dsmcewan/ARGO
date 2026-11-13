import {test} from 'node:test';import assert from 'node:assert/strict';
import {GoogleGenAI} from '@google/genai';import {sendModelTurn} from '../../packages/model-client/client.mjs';

test('pinned Google SDK follows long-decode checkpoints and assembles the complete response',async()=>{
 const calls=[];let hops=0;
 const fetch=async (url,init)=>{
  calls.push({url:String(url),body:JSON.parse(init.body)});
  if(String(url).includes('countTokens'))return Response.json({totalTokens:100});
  hops++;
  return Response.json({candidates:[{index:0,finishReason:hops===1?'CONTINUATION':'STOP',
   ...(hops===1?{continuationToken:'opaque-checkpoint'}:{}),content:{role:'model',parts:[{text:hops===1?'first':' second'}]}}]});
 };
 const client=new GoogleGenAI({apiKey:'offline-fixture',httpOptions:{apiVersion:'v1beta1',fetch,retryOptions:{attempts:1}}});
 const result=await sendModelTurn({client,vendor:'agy_google',model:'gemini-4-carbon',prompt:'generate code',extra:{config:{maxOutputTokens:131072}},deadline:Date.now()+1000});
 assert.equal(result.complete,true);assert.equal(result.text,'first second');assert.equal(hops,2);
 assert.ok(calls.every(c=>c.url.includes('/v1beta1/')));
 assert.equal(calls.at(-1).body.continuationToken,'opaque-checkpoint');
 assert.equal(calls[1].body.generationConfig.maxOutputTokens,131072);
});
test('a dropped long decode cannot certify partial text as complete',async()=>{
 const client={models:{countTokens:async()=>({totalTokens:10}),generateContent:async()=>({candidates:[{finishReason:'CONTINUATION',continuationToken:'checkpoint',content:{parts:[{text:'partial'}]}}]})}};
 const result=await sendModelTurn({client,vendor:'agy_google',model:'gemini-4-carbon',prompt:'code'});
 assert.equal(result.usable_for_resume,false);
});
