import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??process.cwd());
const {createModelCharacterAgent}=await import(pathToFileURL(resolve(root,'packages/interventions/src/character-model.ts')).href);
const {characterActorView}=await import(pathToFileURL(resolve(root,'TESTS/character-fixtures.ts')).href);

const response=(text='A considered answer.')=>({id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text})}]}]});
const options=(view:any,extra:any={})=>({scope:view.query.scope,actorId:'witness',sessionId:'review',candidates:[{vendor:'openai',model:'gpt-6-astra',pool:'offline'}],refreshContext:async()=>structuredClone(view),...extra});

{
 const view=characterActorView(); let generations=0;
 const agent=createModelCharacterAgent(options(view,{countTokensFor:()=>async()=>{view.ontology_blocked=true;return 10;},clientFor:()=>({responses:{create:async()=>{generations++;return response();}}})}));
 const result=await agent.respond(view.query,view.experiences[0].record_id,'stale_count');
 assert.equal(result,null);assert.equal(generations,1);
 console.log(JSON.stringify({probe:'cutoff changes during token counting',result,generations}));
}

{
 const view=characterActorView();let generations=0,release:any;
 const count=new Promise<number>(resolve=>{release=resolve;});
 const agent=createModelCharacterAgent(options(view,{timeoutMs:25,countTokensFor:()=>()=>count,clientFor:()=>({responses:{create:async()=>{generations++;return response();}}})}));
 let code;try{await agent.respond(view.query,view.experiences[0].record_id,'late_count');}catch(error:any){code=error.code;}
 assert.equal(generations,0);release(10);await delay(20);assert.equal(generations,1);
 console.log(JSON.stringify({probe:'token counting resolves after adapter deadline',code,generationsAfterDeadline:generations}));
}

{
 const view=characterActorView();const sent:any[]=[];
 const agent=createModelCharacterAgent(options(view,{candidates:[{vendor:'agy_google',model:'gemini-4-carbon',pool:'offline'}],maxOutputTokens:32,countTokensFor:()=>async()=>10,clientFor:()=>({models:{generateContent:async(request:any)=>{sent.push(request);return sent.length===1?{candidates:[{finishReason:'CONTINUATION',continuationToken:'checkpoint',content:{parts:[{text:'{"text":"A continued'}]}}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:' answer."}'}]}}]};}}})}));
 const result=await agent.respond(view.query,view.experiences[0].record_id,'continuation');
 assert.equal(sent.length,2);assert.equal(result?.body.type,'speak');
 console.log(JSON.stringify({probe:'Google explicit budget continues into another generation request',generations:sent.length,caps:sent.map(r=>r.config.maxOutputTokens),result}));
}

for(const kind of ['refusal','web_search_call']){
 const view=characterActorView();const reply=response();
 if(kind==='refusal')reply.output[0].content.unshift({type:'refusal',refusal:'Cannot answer.'} as any);
 else reply.output.unshift({type:'web_search_call',status:'completed',action:{type:'search',query:'unrequested external fact'}} as any);
 const agent=createModelCharacterAgent(options(view,{candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],clientFor:()=>({responses:{create:async()=>reply}})}));
 const result=await agent.respond(view.query,view.experiences[0].record_id,kind);
 assert.equal(result?.body.type,'speak');
 console.log(JSON.stringify({probe:`completed response containing ${kind} is accepted`,result}));
}
