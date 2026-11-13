import {test} from 'node:test';import assert from 'node:assert/strict';
import {exchange} from '../wire.mjs';
test('Google unary and continuation hops preserve signed part boundaries exactly',async()=>{
 const first=[{text:'unsigned-prefix '},{text:'signed-text',thoughtSignature:'opaque-signature'}],last=[{text:'next-hop '},{text:'signed-next',thoughtSignature:'next-signature'}];let calls=0;
 const client={models:{generateContent:async()=>++calls===1?{candidates:[{content:{parts:first},finishReason:'CONTINUATION',continuationToken:'checkpoint'}]}:{candidates:[{content:{parts:last},finishReason:'STOP'}]}}};
 const result=await exchange({vendor:'google',cap:{surface:'generateContent'},request:{config:{},contents:[]},history:[],prompt:''},client);
 assert.equal(calls,2);assert.deepEqual(result.history.at(-1).parts,[...first,...last]);
});
test('Google streaming preserves signed parts and continuation hop boundaries',async()=>{
 const first=[{text:'first '}],last=[{text:'next-hop '},{text:'signed-next',thoughtSignature:'next-signature'}];let calls=0;
 const client={models:{generateContentStream:async function*(){const initial=++calls===1;yield {candidates:[{content:{parts:initial?first:last},finishReason:initial?'CONTINUATION':'STOP',...(initial?{continuationToken:'checkpoint'}:{})}]};}}};
 const result=await exchange({vendor:'google',cap:{surface:'generateContent'},request:{config:{},contents:[]},history:[],prompt:''},client,()=>{});
 assert.deepEqual(result.history.at(-1).parts,[...first,...last]);
});
