// Child of probes.mjs; uses the same real SQLite world/outbox across processes.
import assert from 'node:assert/strict';
import {readFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPrivateKey} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const [root,expectedSha,configPath]=process.argv.slice(2),exec=promisify(execFile);
assert.equal(process.env.NODE_TEST_CONTEXT,undefined);
assert.equal((await exec('git',['-C',root,'rev-parse','HEAD'])).stdout.trim(),expectedSha);
const load=p=>import(pathToFileURL(join(resolve(root),p)).href);
const api=await load('packages/session/src/index.ts'),{openWorldLedger}=await load('packages/ledger/src/index.ts');
const config=JSON.parse(await readFile(configPath,'utf8'));
const ledger=await openWorldLedger({path:config.world_path,genesis:config.options.genesis,privateKey:createPrivateKey(config.private_key)});
const store=await api.openWorldConversationStore(config.options);
const model={clientFor:(_candidate,turn)=>({responses:{create:async()=>{
 await appendFile(config.calls,JSON.stringify({pid:process.pid,turn})+'\n',{mode:0o600});
 return {id:'offline_process_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"text":"One process replies."}'}]}]};
}}})};
const host=api.createWorldConversation({store,ledger,model});
const start=new Promise(resolve=>process.once('message',resolve));process.send({type:'ready'});await start;
try{const result=await host.turn({turn_id:'cross_process',text:'A single reply across processes.'});process.send({type:'done',phase:result.phase,outcome:result.outcome});}finally{await host.close();await store.close();await ledger.close();process.disconnect();}
