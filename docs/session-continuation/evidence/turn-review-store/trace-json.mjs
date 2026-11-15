// External review instrumentation; never imported into production source.
import {appendFileSync} from 'node:fs';
import {isMainThread,threadId} from 'node:worker_threads';
const original=JSON.parse;
JSON.parse=function(text,...args){if(typeof text==='string'&&Buffer.byteLength(text)>131072)appendFileSync(process.env.ARGO_REVIEW_PARSE_TRACE,JSON.stringify({isMainThread,threadId,bytes:Buffer.byteLength(text)})+'\n',{mode:0o600});return original.call(this,text,...args);};
