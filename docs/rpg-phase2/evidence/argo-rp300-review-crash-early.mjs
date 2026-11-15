// Independent offline crash/reopen probe. Supply the combined candidate checkout.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createPrivateKey} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=resolve(process.argv[2]??'.');
const load=relative=>import(pathToFileURL(join(root,relative)).href);
const {openMortalLedger}=await load('packages/ledger/src/mortal/storage.ts');
if(process.argv[3]==='child'){
 let ledger;
 process.on('message',async message=>{
  try{
   if(message.type==='open'){
    ledger=await openMortalLedger({path:message.path,genesis:message.genesis,privateKey:createPrivateKey(message.pem)});
    process.send({type:'ready'});
   }else if(message.type==='submit'){
    process.send({type:'started'});
    const receipt=await ledger.submit(message.command,message.principal);
    process.send({type:'submitted',receipt});
   }
  }catch(error){process.send({type:'failed',message:error.message,code:error.code});}
 });
}else{
 const {mortalGenesis,mortalCommand,mortalPrincipal,keys}=await load('TESTS/mortal-fixtures.ts');
 const {replayMortal,verifyMortalReceipt}=await load('packages/ledger/src/mortal/journal.ts');
 const {hash}=await load('packages/contracts/src/index.ts');
 const directory=await mkdtemp(join(tmpdir(),'argo-rp300-crash-review-'));
 const trials=[];
 function messageOf(child,type){
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(new Error('Child operation timed out')),15000);
   const onMessage=message=>{if(message.type===type)finish(null,message);else if(message.type==='failed')finish(new Error(JSON.stringify(message)));};
   const onExit=(code,signal)=>finish(new Error(`Child exited before ${type}: ${code}/${signal}`));
   function finish(error,value){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);error?reject(error):resolve(value);}
   child.on('message',onMessage);child.once('exit',onExit);
  });
 }
 try{
  for(const [index,delay] of [0,0,1,1,5,10,20,50].entries()){
   const path=join(directory,`world-${index}.sqlite`),genesis=mortalGenesis();
   let ledger=await openMortalLedger({path,genesis,privateKey:keys.privateKey});
   const initial=await ledger.snapshot(),principal=mortalPrincipal(genesis),command=mortalCommand(initial,{type:'wait',turns:1},'hero','crash_request');
   await ledger.close();
   const child=fork(fileURLToPath(import.meta.url),[root,'child'],{stdio:['ignore','pipe','pipe','ipc']});
   let diagnostics='';child.stdout.on('data',bytes=>{diagnostics=(diagnostics+bytes).slice(-4096);});child.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes).slice(-4096);});
   let submitted=false;child.on('message',message=>{if(message.type==='submitted')submitted=true;});
   const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
   try{
    const ready=messageOf(child,'ready');
    child.send({type:'open',path,genesis,pem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
    await ready;
    const started=messageOf(child,'started');child.send({type:'submit',command,principal});await started;
    await new Promise(resolve=>setTimeout(resolve,delay));child.kill('SIGKILL');await exit;
    ledger=await openMortalLedger({path,genesis,privateKey:keys.privateKey});
    try{
     const beforeRetry=await ledger.snapshot();assert.ok(beforeRetry.sequence===0||beforeRetry.sequence===1);
     const receipt=await ledger.submit(command,principal),state=await ledger.snapshot(),events=await ledger.events();
     assert.equal(state.sequence,1);assert.equal(state.world_time,600);assert.equal(events.length,1);
     assert.deepEqual(replayMortal(genesis,events),state);
     assert.deepEqual(await ledger.submit(command,principal),receipt);
     verifyMortalReceipt(receipt,{scope:genesis.scope,genesis_hash:hash(genesis),authority_key_id:genesis.authority_key_id,authority_public_key:genesis.authority_public_key});
     trials.push({delay_ms:delay,receipt_observed_before_kill:submitted,sequence_after_crash:beforeRetry.sequence,sequence_after_retry:state.sequence});
    }finally{await ledger.close();}
   }catch(error){error.message+=`\nChild diagnostics: ${diagnostics}`;throw error;}
   finally{child.kill('SIGKILL');await exit;}
  }
  console.log(JSON.stringify({status:'PASS',trials,limits:'SIGKILL process crash, not host power loss; no private-key bytes retained'},null,2));
 }finally{await rm(directory,{recursive:true,force:true});}
}
