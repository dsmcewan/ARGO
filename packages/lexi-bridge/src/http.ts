import {ArgoError,canonical,fail} from '@argo/contracts';
import type {Principal} from '@argo/contracts';
import type {LexiTransport} from './index.ts';

// HTTP transport for the ARGO knowledge-query contract. It speaks a contract ARGO defines; the
// audited forensic LEXI application does not serve it. Point it only at a service that implements
// POST <endpoint> with body {"schema_version":"1.0.0","query":KnowledgeQuery} and answers with a
// KnowledgeView. createLexiBridge still validates scope, binding and disclosure on every response.
//
// The principal never travels in the body. The injected credential provider returns a bearer token
// that the gateway minted for that authenticated principal, and the service authorizes the token.
// A body field naming an actor would be a claim, not an authentication.
export interface LexiHttpOptions{
 endpoint:string;
 credentials:(principal:Principal,options:{signal:AbortSignal})=>Promise<string>;
 fetch?:typeof globalThis.fetch;
 maxResponseBytes?:number;
 allowLoopbackHttp?:boolean;
}
const LOOPBACK=new Set(['127.0.0.1','[::1]','localhost']);
const DEFAULT_MAX_RESPONSE_BYTES=1<<20;
function checkEndpoint(raw:string,allowLoopbackHttp:boolean):URL{
 let url:URL;try{url=new URL(raw);}catch{return fail('INVALID_CONTRACT','LEXI endpoint is not a URL');}
 if(url.username||url.password||url.hash)fail('INVALID_CONTRACT','LEXI endpoint must not embed credentials or a fragment');
 if(url.protocol==='https:')return url;
 if(url.protocol==='http:'&&allowLoopbackHttp&&LOOPBACK.has(url.hostname))return url;
 return fail('INVALID_CONTRACT','LEXI endpoint must use HTTPS (plain HTTP only for an explicitly allowed loopback host)');
}
function statusError(status:number):never{
 if(status===401||status===403)fail('UNAUTHORIZED','LEXI refused the principal');
 if(status===409)fail('CONFLICT','LEXI projection is behind the requested cursor');
 if(status===400||status===422)fail('INVALID_CONTRACT','LEXI rejected the query');
 // Response bodies of failed calls are discarded: they are untrusted and could carry hidden material.
 return fail('UNAVAILABLE',`LEXI transport returned HTTP ${status}`);
}
async function readBounded(response:Response,limit:number):Promise<string>{
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))fail('INVALID_CONTRACT','LEXI response exceeds size limit');
 if(!response.body)return '';
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>limit){await reader.cancel().catch(()=>{});fail('INVALID_CONTRACT','LEXI response exceeds size limit');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return fail('INVALID_CONTRACT','LEXI response is not UTF-8');}
}
export function createLexiHttpTransport(options:LexiHttpOptions):LexiTransport{
 const endpoint=checkEndpoint(options.endpoint,options.allowLoopbackHttp===true).href;
 const limit=options.maxResponseBytes??DEFAULT_MAX_RESPONSE_BYTES;
 if(!Number.isSafeInteger(limit)||limit<1||limit>16*DEFAULT_MAX_RESPONSE_BYTES)fail('INVALID_CONTRACT','Invalid LEXI response limit');
 if(typeof options.credentials!=='function')fail('INVALID_CONTRACT','LEXI credential provider is required');
 const request=options.fetch??globalThis.fetch,credentials=options.credentials;
 return async(query,principal,{signal})=>{
  const token=await credentials(principal,{signal});
  if(typeof token!=='string'||!/^[\x21-\x7e]{1,8192}$/.test(token))fail('UNAUTHORIZED','LEXI credential provider returned no usable token');
  let response:Response;
  try{
   response=await request(endpoint,{method:'POST',redirect:'error',cache:'no-store',credentials:'omit',signal,
    headers:{'content-type':'application/json','accept':'application/json','authorization':`Bearer ${token}`},
    body:canonical({schema_version:'1.0.0',query})});
  }catch(error){if(error instanceof ArgoError)throw error;return fail('UNAVAILABLE','LEXI transport unavailable');}
  if(response.status!==200){await response.body?.cancel().catch(()=>{});statusError(response.status);}
  const type=response.headers.get('content-type')??'';
  if(!/^application\/json(\s*;|$)/i.test(type)){await response.body?.cancel().catch(()=>{});fail('INVALID_CONTRACT','LEXI response is not JSON');}
  const text=await readBounded(response,limit);
  try{return JSON.parse(text) as unknown;}catch{return fail('INVALID_CONTRACT','LEXI response is not valid JSON');}
 };
}
