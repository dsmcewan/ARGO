import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {sendModelTurn} from '../index.mjs';

// Exercise the pinned transport serializer; only the HTTP response is replaced.
const {GoogleGenAI}=createRequire(new URL('../../../pantheon/package.json',import.meta.url))('@google/genai');
const rootConfig={
  toolConfig:{functionCallingConfig:{mode:'AUTO'}},
  safetySettings:[{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_LOW_AND_ABOVE'}],
};

async function envelopes(config){
  const sent=[];
  const fetch=async(url,init)=>{
    const count=String(url).endsWith(':countTokens');
    assert.ok(count||String(url).endsWith(':generateContent'));
    sent.push({count,body:JSON.parse(init.body)});
    return Response.json(count?{totalTokens:10}:{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'complete'}]}}]});
  };
  const client=new GoogleGenAI({apiKey:'offline-fixture',httpOptions:{apiVersion:'v1beta1',fetch,retryOptions:{attempts:1}}});
  const result=await sendModelTurn({client,vendor:'agy_google',model:'gemini-4-carbon',prompt:'fixture question',extra:{config}});
  assert.equal(result.complete,true);
  assert.deepEqual(sent.map(row=>row.count),[true,false]);
  const counted=sent[0].body.generateContentRequest;
  assert.ok(counted,'root request options require a full generateContentRequest count');
  assert.equal(counted.model,'models/gemini-4-carbon');
  assert.equal(Object.hasOwn(sent[0].body,'contents'),false);
  const {model,...countBody}=counted;
  assert.deepEqual(countBody,sent[1].body,'count and generation must describe the same provider request');
  assert.deepEqual(countBody.toolConfig,rootConfig.toolConfig);
  assert.deepEqual(countBody.safetySettings,rootConfig.safetySettings);
  assert.equal(Object.hasOwn(countBody.generationConfig,'toolConfig'),false);
  assert.equal(Object.hasOwn(countBody.generationConfig,'safetySettings'),false);
}

test('Google full count keeps tool and safety options at the serialized request root',async()=>{
  await envelopes({...rootConfig,systemInstruction:'stable contract',
    tools:[{functionDeclarations:[{name:'lookup',parameters:{type:'OBJECT',properties:{q:{type:'STRING'}}}}]}],
    responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{answer:{type:'STRING'}}},
    stopSequences:['END'],candidateCount:1,maxOutputTokens:131072});
});

test('Google root options trigger a full count without system instructions or tools',async()=>{
  await envelopes(rootConfig);
});
