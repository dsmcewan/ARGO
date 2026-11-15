import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.argv[2]??'/tmp/argo-independent-review-final-97dc6c0';
const {openLedger}=await import(root+'/packages/ledger/src/index.ts');
const {genesis,keys,principal,proposal}=await import(root+'/TESTS/fixtures.ts');
const directory=await fs.mkdtemp(join(tmpdir(),'argo-close-probe-'));const originalOpen=fs.open;
try{
 const ledger=await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey});
 const command=proposal(await ledger.snapshot(),{type:'advance_time',to_time:11},'system');
 let closedAfterSync=false;
 fs.open=async(...args)=>{const file=await originalOpen(...args);if(args[0]===join(directory,'events.jsonl')&&args[1]==='a'){const close=file.close.bind(file),sync=file.sync.bind(file);let synced=false;file.sync=async()=>{await sync();synced=true;};file.close=async()=>{await close();closedAfterSync=synced;throw Object.assign(new Error('injected post-fsync close EIO'),{code:'EIO'});};}return file;};syncBuiltinESMExports();
 let submitError;try{await ledger.submit(command,principal('system','system'));}catch(error){submitError=error.message;}
 fs.open=originalOpen;syncBuiltinESMExports();
 const durableBytes=await fs.readFile(join(directory,'events.jsonl'));await fs.writeFile(join(directory,'events.jsonl'),'');
 let observed;try{observed={accepted:true,sequence:(await ledger.snapshot()).sequence};}catch(error){observed={accepted:false,code:error.code};}
 console.log(JSON.stringify({probe:'fsynced_append_close_failure_rollback',closedAfterSync,submitError,durableBytes:durableBytes.length,...observed}));
}finally{fs.open=originalOpen;syncBuiltinESMExports();await fs.rm(directory,{recursive:true,force:true});}
