// Injected SDKs own HTTP serialization. This module owns completion and opaque history.
const textOf=parts=>parts.filter(p=>p.type==='text'||(!p.type&&!p.thought)).map(p=>p.text??'').join('');
const responseText=res=>res.output_text??(res.output??[]).filter(x=>x.type==='message')
  .flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text??'').join('');
const successfulStop=reason=>['end_turn','tool_use','stop_sequence'].includes(reason);

export async function exchange(prepared,client,onEvent){
  const {cap,request,options,vendor,continuity,history,prompt}=prepared;
  const emit=(type,rest={})=>onEvent?.({seat:vendor,type,at:Date.now(),...rest});
  let response,complete=false,text='',output=[],tools=[],responseId=null,usage=null;
  if(cap.surface==='responses'){
    if(onEvent){
      const stream=await client.responses.create({...request,stream:true},options);
      let terminal=false;
      for await(const event of stream){
        if(event.type==='response.output_text.delta')emit('delta',{text:event.delta??''});
        else if(/reasoning|thinking/.test(event.type??''))emit('thinking',{bytes:Buffer.byteLength(event.delta??event.text??'')});
        else if(event.type==='response.output_item.added'&&event.item?.name)emit('tool',{name:event.item.name});
        else if(event.type==='response.completed'){response=event.response;terminal=true;}
        else if(event.type==='error'||event.type==='response.failed'||event.type==='response.incomplete'){
          response=event.response;terminal=false;break;
        }
      }
      complete=terminal&&response?.status==='completed';
    }else{
      response=await client.responses.create(request,options);
      complete=response?.status==='completed';
    }
    output=response?.output??[];
    complete=complete&&Array.isArray(output)&&output.length>0;
    text=responseText(response??{});
    responseId=response?.id??null;
    usage=response?.usage??null;
    tools=output.filter(x=>['function_call','custom_tool_call'].includes(x.type)).map(x=>x.name);
  }else if(cap.surface==='messages'){
    // A signed compaction block requires beta parsing and the same header on every turn.
    const messages=options.headers?.['anthropic-beta']?(client.beta?.messages??client.messages):client.messages;
    if(onEvent){
      const stream=await messages.create({...request,stream:true},options);
      const blocks=[];
      const jsonParts=new Map();
      let stop=null,sawStop=false;
      for await(const event of stream){
        if(event.type==='content_block_start')blocks[event.index]=structuredClone(event.content_block);
        else if(event.type==='content_block_delta'){
          const delta=event.delta,block=blocks[event.index];
          if(!block)throw new Error('Stream delta without its content block');
          if(delta.type==='text_delta'){block.text=(block.text??'')+delta.text;emit('delta',{text:delta.text});}
          else if(delta.type==='thinking_delta'){block.thinking=(block.thinking??'')+delta.thinking;emit('thinking',{bytes:Buffer.byteLength(delta.thinking)});}
          else if(delta.type==='signature_delta')block.signature=(block.signature??'')+delta.signature;
          else if(delta.type==='input_json_delta')jsonParts.set(event.index,(jsonParts.get(event.index)??'')+delta.partial_json);
        }else if(event.type==='message_delta'){stop=event.delta?.stop_reason??stop;usage=event.usage??usage;}
        else if(event.type==='message_stop')sawStop=true;
        else if(event.type==='error')throw Object.assign(new Error('Provider stream error'),{status:event.error?.status});
      }
      for(const [index,value] of jsonParts)blocks[index].input=JSON.parse(value);
      output=blocks;
      complete=sawStop&&successfulStop(stop);
    }else{
      response=await messages.create(request,options);
      output=response?.content??[];usage=response?.usage??null;
      complete=successfulStop(response?.stop_reason);
    }
    complete=complete&&Array.isArray(output)&&output.length>0;
    text=textOf(output);
    tools=output.filter(x=>x.type==='tool_use').map(x=>x.name);
  }else{
    if(onEvent){
      const stream=await client.models.generateContentStream(request);
      let reason=null,continuation=false;
      for await(const chunk of stream){
        const candidate=chunk.candidates?.[0];
        reason=candidate?.finishReason??reason;
        continuation=Boolean(chunk.continuationToken??chunk.continuation_token);
        usage=chunk.usageMetadata??usage;
        for(const part of candidate?.content?.parts??[]){
          const p=structuredClone(part),last=output.at(-1);
          // Text fragments form one signed part; function-call parts retain exact boundaries.
          if(typeof p.text==='string'&&last&&typeof last.text==='string'&&!last.thoughtSignature&&
            last.thought===p.thought&&!last.functionCall&&!p.functionCall){
            last.text+=p.text;
            for(const [key,value] of Object.entries(p))if(key!=='text')last[key]=value;
          }else output.push(p);
          if(p.thought)emit('thinking',{bytes:Buffer.byteLength(p.text??'')});
          else if(p.text)emit('delta',{text:p.text});
          else if(p.functionCall?.name)emit('tool',{name:p.functionCall.name});
        }
      }
      complete=reason==='STOP'&&!continuation;
    }else{
      response=await client.models.generateContent(request);
      const candidate=response?.candidates?.[0];
      output=candidate?.content?.parts??[];usage=response?.usageMetadata??null;
      complete=candidate?.finishReason==='STOP'&&!response?.continuationToken&&!response?.continuation_token;
    }
    complete=complete&&output.length>0;
    text=textOf(output);
    tools=output.filter(p=>p.functionCall).map(p=>p.functionCall.name);
  }
  const replay=cap.surface!=='responses'||continuity==='replay';
  const nextHistory=cap.surface==='responses'?[...history,{role:'user',content:prompt},...structuredClone(output)]
    :cap.surface==='messages'?[...request.messages,{role:'assistant',content:structuredClone(output)}]
    :[...request.contents,{role:'model',parts:structuredClone(output)}];
  const usable=complete&&(replay||typeof responseId==='string'&&responseId.length>0);
  emit(usable?'done':'error',usable?{}:{text:'Provider output incomplete; refusing truncated result'});
  return {vendor,response_id:responseId,text,tools:[...new Set(tools)].sort(),usage,complete,
    resumed:replay?history.length>0:Boolean(request.previous_response_id),streamed:Boolean(onEvent),
    usable_for_resume:usable,why_unusable:usable?null:'Provider output incomplete or missing authoritative terminal state',
    ...(replay?{history:nextHistory}:{})};
}
