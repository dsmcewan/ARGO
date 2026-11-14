import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareRequest,checkBudget,sendModelTurn} from '../index.mjs';

const seats=[
  ['anthropic','claude-fable-5-2'],
  ['agy_google','gemini-4-carbon'],
  ['agy_google','gemini-4-argon'],
  ['openai','gpt-6-astra'],
  ['xai','grok-4.7'],
];
const options=(vendor,model,more={})=>({vendor,model,prompt:'Reply to the acquired message.',effort:'low',...more});
const outputLimit=request=>request.max_tokens??request.max_output_tokens??request.config?.maxOutputTokens;

test('explicit Google budgets retain short caller limits instead of increasing generation allowance',()=>{
  for(const model of ['gemini-4-carbon','gemini-4-argon']){
    const extra={config:{maxOutputTokens:2048}};
    const prepared=prepareRequest(options('agy_google',model,{outputBudgetPolicy:'explicit',extra}));
    assert.equal(prepared.request.config.maxOutputTokens,2048);
    assert.equal(prepared.request.config.thinkingConfig.thinkingLevel,'LOW');
    assert.deepEqual(extra,{config:{maxOutputTokens:2048}},'Caller configuration remains unchanged');
  }
});

test('explicit output policy requires a positive safe integer cap on every provider surface',()=>{
  for(const [vendor,model] of seats){
    assert.throws(()=>prepareRequest(options(vendor,model,{outputBudgetPolicy:'explicit'})),/explicit.*output|output.*explicit/i);
    for(const invalid of [undefined,null,0,-1,1.5,NaN,Infinity,'2048',false]){
      assert.throws(()=>prepareRequest(options(vendor,model,{outputBudgetPolicy:'explicit',extra:{max_output_tokens:invalid}})),/token|explicit.*output|output.*explicit/i);
    }
  }
  assert.throws(()=>prepareRequest(options('agy_google','gemini-4-carbon',{outputBudgetPolicy:'explicit',extra:{config:{maxOutputTokens:0}}})),/token/i);
});

test('explicit caps normalize supported aliases without leaking local policy to provider requests',()=>{
  for(const [vendor,model] of seats){
    for(const [extra,want] of [[{max_output_tokens:800},800],[{max_tokens:700},700]]){
      const prepared=prepareRequest(options(vendor,model,{outputBudgetPolicy:'explicit',extra}));
      assert.equal(outputLimit(prepared.request),want);
      assert.equal(Object.hasOwn(prepared.request,'outputBudgetPolicy'),false);
      assert.equal(Object.hasOwn(prepared.request.config??{},'outputBudgetPolicy'),false);
    }
  }
  const prepared=prepareRequest(options('agy_google','gemini-4-carbon',{
    outputBudgetPolicy:'explicit',extra:{max_output_tokens:800,config:{maxOutputTokens:1200}},
  }));
  assert.equal(prepared.request.config.maxOutputTokens,1200,'Existing provider-native alias precedence is retained');
});

test('omitted and long-decode policies retain the existing default and legacy-cap behavior',()=>{
  for(const [vendor,model] of seats){
    for(const policy of [{},{outputBudgetPolicy:'long_decode'}]){
      assert.equal(outputLimit(prepareRequest(options(vendor,model,policy)).request),65536);
      const prepared=prepareRequest(options(vendor,model,{...policy,extra:{max_output_tokens:800}}));
      assert.equal(outputLimit(prepared.request),vendor==='agy_google'?65536:800);
    }
  }
});

test('unknown output policies and caps beyond the model limit fail before generation',()=>{
  for(const [vendor,model] of seats){
    for(const policy of ['short','EXPLICIT','',null,false,1,{},[]]){
      assert.throws(()=>prepareRequest(options(vendor,model,{outputBudgetPolicy:policy,extra:{max_output_tokens:2048}})),/output.*policy|policy.*output/i);
    }
  }
  for(const [vendor,model,cap] of [
    ['anthropic','claude-fable-5-2',128001],
    ['openai','gpt-6-astra',128001],
    ['agy_google','gemini-4-carbon',262145],
  ])assert.throws(()=>prepareRequest(options(vendor,model,{outputBudgetPolicy:'explicit',extra:{max_output_tokens:cap}})),/limit|bound/i);
});

test('combined-context accounting reserves the explicit output cap and rejects overflow',async()=>{
  const prepared=prepareRequest(options('agy_google','gemini-4-carbon',{outputBudgetPolicy:'explicit',extra:{max_output_tokens:2048}}));
  assert.equal(await checkBudget(prepared,async()=>1046528),1046528);
  await assert.rejects(checkBudget(prepared,async()=>1046529),/window/i);
});

test('single-turn generation sends explicit small caps through all provider transports',async()=>{
  const reply='{"text":"A short reply."}';
  for(const [vendor,model] of seats){
    let sent;
    const client=vendor==='anthropic'?{messages:{create:async request=>{
      sent=request;return {id:'fixture',type:'message',role:'assistant',model,stop_reason:'end_turn',content:[{type:'text',text:reply}],usage:{input_tokens:12,output_tokens:8}};
    }}}:vendor==='agy_google'?{models:{generateContent:async request=>{
      sent=request;return {candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:reply}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:8,totalTokenCount:20}};
    }}}:{responses:{create:async request=>{
      sent=request;return {id:'fixture',status:'completed',model,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:reply}]}],usage:{input_tokens:12,output_tokens:8,total_tokens:20}};
    }}};
    const result=await sendModelTurn({...options(vendor,model),client,outputBudgetPolicy:'explicit',extra:{max_output_tokens:1536},countTokens:async()=>12});
    assert.equal(outputLimit(sent),1536,`${vendor} transport retains the chosen cap`);
    assert.equal(Object.hasOwn(sent,'outputBudgetPolicy'),false);
    assert.equal(result.text,reply);
    assert.equal(result.usable_for_resume,true);
    assert.deepEqual(result.tools,[]);
  }
});
