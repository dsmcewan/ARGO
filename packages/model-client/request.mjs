import {createHash} from 'node:crypto';
import {CAPABILITIES} from './registry.mjs';

export const COMPACTION_BETA='compact-2026-09-04';
const RESERVED=new Set(['model','input','messages','contents','previous_response_id','stream']);
const count=(n,label)=>{
  if(!Number.isSafeInteger(n)||n<=0) throw new Error(`${label}: token budget must be a positive safe integer`);
  return n;
};
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;

export function cacheKey({scope,sessionId,vendor,model}){
  if(!scope||!sessionId)throw new Error('Cache identity requires explicit scope and session');
  return createHash('sha256').update(JSON.stringify(sorted({scope,sessionId,vendor,model}))).digest('hex');
}

export function prepareRequest({vendor,model,prompt,history=[],previousResponseId,continuity='replay',extra={},scope,sessionId,
  effort,architecture=false,contractHeader='',signal}){
  const cap=CAPABILITIES[model];
  if(!cap||cap.vendor!==vendor)throw new Error('Model capability or vendor mismatch');
  if(typeof prompt!=='string'||!prompt)throw new Error('Prompt is required');
  if(!Array.isArray(history))throw new Error('History must be an array');
  for(const key of Object.keys(extra))if(RESERVED.has(key))throw new Error(`Reserved request field: ${key}`);
  const e=structuredClone(extra);
  for(const key of ['temperature','top_p','top_k'])delete e[key];
  const allowed=cap.surface==='messages'
    ? ['max_tokens','max_output_tokens','thinking','tool_choice','output_config','system','tools','metadata','stop_sequences','service_tier','cache_control']
    :cap.surface==='genai'?['config','max_tokens','max_output_tokens']
    :['max_tokens','max_output_tokens','reasoning','tools','tool_choice','parallel_tool_calls','instructions','text','store','include','metadata','service_tier','truncation','prompt_cache_key'];
  for(const key of Object.keys(e))if(!allowed.includes(key))throw new Error(`Unsupported ${cap.surface} parameter: ${key}`);
  const options={...(signal?{signal}:{}),headers:{}};
  const pinned=contractHeader?`${contractHeader}\n\n${prompt}`:prompt;
  let request;
  if(cap.surface==='messages'){
    delete e.thinking;
    if(['any','tool'].includes(e.tool_choice?.type))delete e.tool_choice;
    const depth=effort??e.output_config?.effort??(architecture?'xhigh':'high');
    if(!cap.efforts.includes(depth))throw new Error('Unsupported effort for model');
    const max=count(e.max_tokens??e.max_output_tokens??65536,'max_tokens');
    delete e.max_output_tokens;
    if(max>cap.output)throw new Error('Output token budget exceeds model limit');
    request={...e,model,max_tokens:max,output_config:{...e.output_config,effort:depth},messages:[...structuredClone(history),{role:'user',content:pinned}]};
    if(history.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='compaction')))
      options.headers['anthropic-beta']=COMPACTION_BETA;
  }else if(cap.surface==='genai'){
    const config=e.config??{};
    delete e.config;
    config.maxOutputTokens??=e.max_output_tokens??e.max_tokens;
    delete e.max_output_tokens;delete e.max_tokens;
    delete config.cachedContent;
    for(const key of ['temperature','topP','topK'])delete config[key];
    const thinking={...config.thinkingConfig};
    delete thinking.thinkingBudget;
    const wanted=effort??thinking.thinkingLevel?.toLowerCase()??'high';
    const depth=wanted==='minimal'?'low':wanted;
    if(!cap.efforts.includes(depth))throw new Error('Unsupported effort for model');
    thinking.thinkingLevel=depth.toUpperCase();
    config.thinkingConfig=thinking;
    config.maxOutputTokens=Math.max(65536,count(config.maxOutputTokens??65536,'maxOutputTokens'));
    if(config.maxOutputTokens>cap.output)throw new Error('Output token budget exceeds configured long-decode bound');
    if(signal)config.abortSignal=signal;
    request={...e,model,config,contents:[...structuredClone(history),{role:'user',parts:[{text:pinned}]}]};
  }else{
    const max=count(e.max_output_tokens??e.max_tokens??65536,'max_output_tokens');
    if(cap.output&&max>cap.output)throw new Error('Output token budget exceeds model limit');
    delete e.max_tokens;
    const reasoning={...e.reasoning};
    if(vendor==='openai')delete reasoning.context;
    const depth=effort??reasoning.effort;
    if(depth&&!cap.efforts.includes(depth))throw new Error('Unsupported effort for model');
    if(depth)reasoning.effort=depth;
    const input=continuity==='replay'?[...structuredClone(history),{role:'user',content:pinned}]:pinned;
    request={...e,model,input,max_output_tokens:max,...(Object.keys(reasoning).length?{reasoning}:{}),
      ...(continuity==='replay'?{store:false,include:[...new Set([...(e.include??[]),'reasoning.encrypted_content'])]}:
        previousResponseId?{previous_response_id:previousResponseId}:{})};
    if(scope&&sessionId)request.prompt_cache_key=cacheKey({scope,sessionId,vendor,model});
  }
  return {vendor,model,cap,request,options,continuity,history:structuredClone(history),prompt:pinned};
}

export async function checkBudget(prepared,countTokens){
  const {cap,request}=prepared;
  if(!cap.inputCeiling&&!cap.combined)return null;
  if(typeof countTokens!=='function')throw new Error('A trustworthy provider token count is required before generation');
  const input=await countTokens(request);
  if(!Number.isSafeInteger(input)||input<0)throw new Error('Invalid provider token count');
  if(cap.inputCeiling&&input>=cap.inputCeiling)throw new Error(`Input token policy requires fewer than ${cap.inputCeiling} tokens`);
  const output=request.config?.maxOutputTokens??request.max_output_tokens??request.max_tokens;
  if(input+output>cap.window)throw new Error('Combined input and output exceeds model context window');
  return input;
}

export async function compactConversation({client,model,history,system,tools,signal}){
  if(!CAPABILITIES[model]?.compaction)throw new Error('Model does not support configured compaction');
  if(!history?.length)throw new Error('Compaction needs a conversation');
  const pending=new Set();
  for(const m of history)for(const block of Array.isArray(m.content)?m.content:[]){
    if(block.type==='tool_use')pending.add(block.id);
    if(block.type==='tool_result')pending.delete(block.tool_use_id);
  }
  if(pending.size)throw new Error('Cannot compact an unresolved tool turn');
  const messages=client.beta?.messages??client.messages;
  const request={model,messages:structuredClone(history),max_tokens:16384,compaction:{type:'summarize'},
    ...(system!==undefined?{system}:{}),...(tools!==undefined?{tools}:{})};
  const response=await messages.create(request,{signal,headers:{'anthropic-beta':[...(client.argoBetaHeaders??[]),COMPACTION_BETA].join(',')}});
  const blocks=response?.content;
  if(response?.stop_reason!=='compaction'||!Array.isArray(blocks)||blocks.length!==1||blocks[0]?.type!=='compaction'||
    typeof blocks[0].signature!=='string'||!blocks[0].signature)throw new Error('Compaction did not return one complete signed block');
  return [{role:'assistant',content:structuredClone(blocks)}];
}
