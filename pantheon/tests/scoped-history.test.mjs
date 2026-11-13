import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {sdkTurn} from '../src/sdk/seat-sdk.mjs';
test('explicit tenant/session boundaries isolate stored replay and server handles',async()=>{
 const home=mkdtempSync(join(tmpdir(),'argo-scoped-history-')),calls=[];
 const client={messages:{create:async req=>{calls.push(req);return {stop_reason:'end_turn',content:[{type:'text',text:'ok'}]};}}};
 try{const base={vendor:'anthropic',model:'claude-fable-5-2',cwd:'/shared',purpose:'narrator',home,client};
 await sdkTurn({...base,scope:{tenant:'private'},sessionId:'a',prompt:'PRIVATE_SECRET'});
 await sdkTurn({...base,scope:{tenant:'public'},sessionId:'b',prompt:'Public question'});
 assert.equal(JSON.stringify(calls[1]).includes('PRIVATE_SECRET'),false);
 }finally{rmSync(home,{recursive:true,force:true});}
});
