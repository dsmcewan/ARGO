import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createServer} from 'node:http';import type {IncomingMessage,ServerResponse} from 'node:http';import type {AddressInfo} from 'node:net';
import {createLexiBridge,createLexiHttpTransport,projectKnowledge} from '../packages/lexi-bridge/src/index.ts';
import {openLedger} from '../packages/ledger/src/index.ts';import {genesis,keys,principal,proposal,scope} from './fixtures.ts';
import type {KnowledgeQuery,Principal} from '../packages/contracts/src/index.ts';
const query=(sequence:number,time=10):KnowledgeQuery=>({schema_version:'1.0.0',scope:structuredClone(scope),actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:time,as_of_sequence:sequence});
type Handler=(request:IncomingMessage,body:string,response:ServerResponse)=>void;
async function serve(handler:Handler,fn:(endpoint:string)=>Promise<void>){
 const server=createServer((request,response)=>{let body='';request.setEncoding('utf8');request.on('data',d=>body+=d);request.on('end',()=>handler(request,body,response));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/knowledge/query`);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const json=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
// The gateway mints a token per authenticated principal; the test service maps it back. The body never names a principal.
const tokens=new Map([['token-donor','donor']]);
const credentials=async(p:Principal)=>`token-${p.actor_id}`;
test('LEXI HTTP transport sends the query with a principal token and the bridge validates the answer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-lexi-http-'));
 try{
  const l=await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey});
  await l.submit(proposal(await l.snapshot(),{type:'observe_claim',observation:{claim_id:'solo',channel:'belief',source_id:'donor',content:'solo',observers:['donor'],party_id:null,occurred_at:0}}),principal());
  await l.submit(proposal(await l.snapshot(),{type:'observe_claim',observation:{claim_id:'hidden',channel:'belief',source_id:'traveler',content:'hidden',observers:['traveler'],party_id:null,occurred_at:0}},'traveler'),principal('traveler'));
  const seen:unknown[]=[];
  await serve(async(request,body,response)=>{
   const actor=tokens.get((request.headers.authorization??'').replace(/^Bearer /,''));
   if(request.method!=='POST'||!actor)return json(response,401,{});
   const parsed=JSON.parse(body);seen.push(parsed);
   json(response,200,projectKnowledge(await l.snapshot(),parsed.query,principal(actor)));
  },async endpoint=>{
   const client=createLexiBridge({scope,transport:createLexiHttpTransport({endpoint,credentials,allowLoopbackHttp:true})});
   const view=await client.query(query(2),principal());
   assert.deepEqual(view.claims.map(c=>c.observation.claim_id),['solo'],'only the donor\'s observation crosses the wire');
   assert.ok(Object.isFrozen(view));
   assert.deepEqual(Object.keys(seen[0] as object).sort(),['query','schema_version'],'no principal claim in the body');
   await assert.rejects(client.query(query(2),principal('outsider')),/actor/i,'the bridge refuses before any call');
   assert.equal(seen.length,1);
   const anonymous=createLexiBridge({scope,transport:createLexiHttpTransport({endpoint,credentials:async()=>'token-unknown',allowLoopbackHttp:true})});
   await assert.rejects(anonymous.query(query(2),principal()),/refused the principal/);
  });
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('LEXI HTTP transport refuses insecure endpoints and unusable credentials before sending',async()=>{
 for(const endpoint of ['http://lexi.example/q','http://127.0.0.1/q','https://user:pw@lexi.example/q','https://lexi.example/q#x','ftp://lexi.example/q','not a url'])
  assert.throws(()=>createLexiHttpTransport({endpoint,credentials}),/endpoint/i,endpoint);
 assert.doesNotThrow(()=>createLexiHttpTransport({endpoint:'https://lexi.example/q',credentials}));
 assert.throws(()=>createLexiHttpTransport({endpoint:'https://lexi.example/q',credentials,maxResponseBytes:0}),/limit/);
 let calls=0;const fetch=(async()=>{calls++;throw new Error('must not send');}) as typeof globalThis.fetch;
 for(const token of ['','line\nbreak','sp ace']){
  const transport=createLexiHttpTransport({endpoint:'https://lexi.example/q',credentials:async()=>token,fetch});
  await assert.rejects(transport(query(0),principal(),{signal:new AbortController().signal}),/token/);
 }
 assert.equal(calls,0);
});
test('LEXI HTTP transport maps status, refuses redirects, non-JSON and oversized answers, and honours deadlines',async()=>{
 let mode='';
 await serve((_request,_body,response)=>{
  if(mode==='redirect'){response.writeHead(302,{location:'https://elsewhere.example/'});return response.end();}
  if(mode==='text'){response.writeHead(200,{'content-type':'text/plain'});return response.end('{}');}
  if(mode==='huge'){response.writeHead(200,{'content-type':'application/json'});return response.end(JSON.stringify({pad:'x'.repeat(4096)}));}
  if(mode==='chunked'){response.writeHead(200,{'content-type':'application/json'});for(let i=0;i<8;i++)response.write('x'.repeat(1024));return response.end();}
  if(mode==='hang')return;
  if(mode==='bad-json'){response.writeHead(200,{'content-type':'application/json'});return response.end('{"a":');}
  json(response,Number(mode),{schema_version:'1.0.0',code:'CORRUPT_LEDGER',retryable:false,message:'secret detail'});
 },async endpoint=>{
  const transport=createLexiHttpTransport({endpoint,credentials,allowLoopbackHttp:true,maxResponseBytes:2048});
  const client=createLexiBridge({scope,transport,timeoutMs:200});
  const expect=async(next:string,pattern:RegExp,code:string)=>{mode=next;await assert.rejects(client.query(query(0),principal()),(error:any)=>{assert.match(error.message,pattern,next);assert.equal(error.code,code,next);assert.doesNotMatch(error.message,/secret/);return true;});};
  await expect('401',/refused/,'UNAUTHORIZED');await expect('403',/refused/,'UNAUTHORIZED');
  await expect('409',/behind/,'CONFLICT');await expect('400',/rejected/,'INVALID_CONTRACT');
  await expect('503',/HTTP 503/,'UNAVAILABLE');await expect('500',/HTTP 500/,'UNAVAILABLE');
  await expect('redirect',/unavailable/i,'UNAVAILABLE');await expect('text',/not JSON/,'INVALID_CONTRACT');
  await expect('huge',/size limit/,'INVALID_CONTRACT');await expect('chunked',/size limit/,'INVALID_CONTRACT');
  await expect('bad-json',/valid JSON/,'INVALID_CONTRACT');await expect('hang',/deadline/,'UNAVAILABLE');
  mode='200';await assert.rejects(client.query(query(0),principal()),/KnowledgeView contract/,'a 200 error body is still not a knowledge view');
 });
});
