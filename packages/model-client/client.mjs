import {prepareRequest,checkBudget,compactConversation} from './request.mjs';
import {boundedCall} from './router.mjs';
import {exchange} from './wire.mjs';
import {CAPABILITIES} from './registry.mjs';

export async function sendModelTurn({client,onEvent,countTokens,compactAfterBytes=512000,deadline=Date.now()+900000,...args}){
  if(!client)throw new Error('SDK client required');
  return boundedCall(async signal=>{
    let history=args.history??[];
    let compacted=false;
    if(CAPABILITIES[args.model]?.compaction&&history.length&&Buffer.byteLength(JSON.stringify(history))>=compactAfterBytes){
      history=await compactConversation({client,model:args.model,history,system:args.extra?.system,tools:args.extra?.tools,signal});
      compacted=true;
    }
    const prepared=prepareRequest({...args,history,signal});
    if(prepared.options.headers['anthropic-beta'])prepared.options.headers['anthropic-beta']=
      [...(client.argoBetaHeaders??[]),prepared.options.headers['anthropic-beta']].join(',');
    const counter=countTokens??sdkCounter(client,prepared,signal);
    await checkBudget(prepared,counter);
    return {...await exchange(prepared,client,onEvent),compacted};
  },{signal:args.signal,deadline});
}

function sdkCounter(client,{cap},signal){
  if(cap.vendor==='openai'&&client.responses?.inputTokens?.count){
    return async request=>{
      // These are the input-count endpoint's fields; output caps/store/cache hints are not inputs.
      const keys=['model','input','instructions','tools','tool_choice','parallel_tool_calls','reasoning','text','previous_response_id','conversation','truncation'];
      const body=Object.fromEntries(keys.filter(k=>request[k]!==undefined).map(k=>[k,request[k]]));
      return (await client.responses.inputTokens.count(body,{signal})).input_tokens;
    };
  }
  if(cap.vendor==='agy_google'&&client.models?.countTokens){
    return async request=>{
      const {model,contents,config}=request;
      // The Developer API SDK's CountTokensConfig rejects system/tools/generationConfig.
      // Its REST countTokens endpoint accepts generateContentRequest instead. Inject the full
      // count request through the SDK's documented extraBody hook; omit the alternative contents.
      const {systemInstruction,tools,toolConfig,safetySettings,abortSignal,httpOptions,automaticContinuation,...generationConfig}=config;
      const full=systemInstruction!==undefined||tools!==undefined||toolConfig!==undefined||safetySettings!==undefined||config.responseSchema||config.responseJsonSchema;
      const body={model:`models/${model}`,contents,
        ...(systemInstruction!==undefined?{systemInstruction:typeof systemInstruction==='string'?{parts:[{text:systemInstruction}],role:'user'}:systemInstruction}:{}),
        ...(tools!==undefined?{tools}:{}),...(toolConfig!==undefined?{toolConfig}:{}),
        ...(safetySettings!==undefined?{safetySettings}:{}),generationConfig};
      return (await client.models.countTokens({model,...(full?{}:{contents}),config:{abortSignal:signal,
        ...(full?{httpOptions:{extraBody:{generateContentRequest:body}}}:{})}})).totalTokens;
    };
  }
  return undefined;
}
