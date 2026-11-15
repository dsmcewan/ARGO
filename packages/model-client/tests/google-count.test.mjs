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

async function envelopes(config,stream=false){
  const original=structuredClone(config);
  const sent=[];
  const fetch=async(url,init)=>{
    const path=new URL(url).pathname;
    const count=path.endsWith(':countTokens');
    assert.ok(count||path.endsWith(stream?':streamGenerateContent':':generateContent'));
    sent.push({count,body:JSON.parse(init.body)});
    const response=count?{totalTokens:10}:{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'complete'}]}}]};
    return !count&&stream?new Response(`data: ${JSON.stringify(response)}\n\n`,{headers:{'content-type':'text/event-stream'}}):Response.json(response);
  };
  const client=new GoogleGenAI({apiKey:'offline-fixture',httpOptions:{apiVersion:'v1beta1',fetch,retryOptions:{attempts:1}}});
  const result=await sendModelTurn({client,vendor:'agy_google',model:'gemini-4-carbon',prompt:'fixture question',extra:{config},...(stream?{onEvent:()=>{}}:{})});
  assert.equal(result.complete,true);
  assert.deepEqual(config,original,'neither count normalization nor SDK generation may mutate caller config');
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
  return countBody;
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

test('Google count normalizes system instruction Part arrays like the pinned SDK',async()=>{
  for(const systemInstruction of [[{text:'stable contract'}],{text:'stable contract'},['stable contract']]){
    const body=await envelopes({...rootConfig,systemInstruction});
    assert.deepEqual(body.systemInstruction,{parts:[{text:'stable contract'}],role:'user'});
  }
});

test('Google count normalizes lowercase and nullable response schemas like the pinned SDK',async()=>{
  const body=await envelopes({...rootConfig,responseSchema:{type:'object',properties:{
    answer:{type:'string'},values:{type:'array',items:{type:['integer','null']}},
    optional:{anyOf:[{type:'null'},{type:'boolean'}]},
    union:{anyOf:[{type:'string'},{type:'integer'},{type:'null'}]},
  },additionalProperties:false}});
  assert.deepEqual(body.generationConfig.responseSchema,{type:'OBJECT',properties:{
    answer:{type:'STRING'},values:{type:'ARRAY',items:{type:'INTEGER',nullable:true}},
    optional:{type:'BOOLEAN',nullable:true},union:{anyOf:[{type:'STRING'},{type:'INTEGER'}],nullable:true},
  }});
});

test('Google count normalizes function declaration schemas and JSON schema aliases like the pinned SDK',async()=>{
  const jsonSchema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{answer:{type:'string'}},additionalProperties:false};
  const body=await envelopes({...rootConfig,responseJsonSchema:jsonSchema,tools:[{functionDeclarations:[
    {name:'lookup',parameters:{type:'object',properties:{query:{type:'string'}}},response:{type:['string','integer']}},
    {name:'structured',parameters:jsonSchema,response:jsonSchema},
  ]}]});
  assert.equal(Object.hasOwn(body.generationConfig,'responseSchema'),false);
  assert.deepEqual(body.generationConfig.responseJsonSchema,jsonSchema);
  assert.deepEqual(body.tools[0].functionDeclarations,[
    {name:'lookup',parameters:{type:'OBJECT',properties:{query:{type:'STRING'}}},response:{anyOf:[{type:'STRING'},{type:'INTEGER'}]}},
    {name:'structured',parametersJsonSchema:jsonSchema,responseJsonSchema:jsonSchema},
  ]);
});

test('Google count follows the response JSON Schema alias when no tools snapshot the config',async()=>{
  const jsonSchema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{answer:{type:'string'}}};
  const body=await envelopes({...rootConfig,responseSchema:jsonSchema});
  assert.equal(Object.hasOwn(body.generationConfig,'responseSchema'),false);
  assert.deepEqual(body.generationConfig.responseJsonSchema,jsonSchema);
});

test('ambiguous Google response schema aliases with tools fail before either HTTP request',async()=>{
  let calls=0;
  const client=new GoogleGenAI({apiKey:'offline-fixture',httpOptions:{apiVersion:'v1beta1',retryOptions:{attempts:1},
    fetch:async url=>{calls++;return Response.json(String(url).endsWith(':countTokens')?{totalTokens:10}:
      {candidates:[{finishReason:'STOP',content:{parts:[{text:'complete'}]}}]});}}});
  await assert.rejects(sendModelTurn({client,vendor:'agy_google',model:'gemini-4-carbon',prompt:'fixture',
    extra:{config:{tools:[],responseSchema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}}}}),/responseJsonSchema/);
  assert.equal(calls,0);
});

test('Google schema normalization fails before count or generation HTTP for conflicting schema forms',async()=>{
  let calls=0;
  const client=new GoogleGenAI({apiKey:'offline-fixture',httpOptions:{apiVersion:'v1beta1',retryOptions:{attempts:1},
    fetch:async()=>{calls++;return Response.json({totalTokens:10});}}});
  await assert.rejects(sendModelTurn({client,vendor:'agy_google',model:'gemini-4-carbon',prompt:'fixture',
    extra:{config:{responseSchema:{type:'object',anyOf:[{type:'string'}]}}}}),/type.*anyOf/i);
  assert.equal(calls,0);
});

test('Google normalized count also matches the streaming serializer',async()=>{
  await envelopes({...rootConfig,systemInstruction:[{text:'stable contract'}],
    responseSchema:{type:'object',properties:{answer:{type:'string'}}},
    tools:[{functionDeclarations:[{name:'lookup',parameters:{type:'object',properties:{query:{type:'string'}}}}]}]},true);
});
