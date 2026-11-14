import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.argv[2]??'/workspace/ARGO/.worktrees/deep-review-repair';
const {openLedger}=await import(root+'/packages/ledger/src/index.ts');
const {createCharacterAuthority}=await import(root+'/packages/ledger/src/characters.ts');
const {genesis,keys,principal,proposal}=await import(root+'/TESTS/fixtures.ts');
const system=principal('system','system');
async function fixture(fn){const directory=await mkdtemp(join(tmpdir(),'argo-independent-'));try{const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});await fn({directory,seed,ledger,path:join(directory,'events.jsonl')});}finally{await rm(directory,{recursive:true,force:true});}}
async function advance(ledger,time){return ledger.submit(proposal(await ledger.snapshot(),{type:'advance_time',to_time:time},'system'),system);}
await fixture(async f=>{
 const before=await readFile(f.path),outcome=await advance(f.ledger,11);
 await writeFile(f.path,before);
 let observed;try{observed={accepted:true,sequence:(await f.ledger.snapshot()).sequence};}catch(error){observed={accepted:false,code:error.code,message:error.message};}
 console.log(JSON.stringify({probe:'acknowledged_append_rollback',acknowledged_sequence:outcome.sequence,...observed}));
});
await fixture(async f=>{
 await advance(f.ledger,11);await f.ledger.snapshot();const prefix=await readFile(f.path);
 const other=await openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey});await advance(other,12);
 const full=await readFile(f.path);await writeFile(f.path,Buffer.concat([prefix,Buffer.from([0xef,0xbb,0xbf]),full.subarray(prefix.length)]));
 let warm,cold;
 try{warm={accepted:true,sequence:(await f.ledger.snapshot()).sequence};}catch(error){warm={accepted:false,code:error.code,message:error.message};}
 try{await openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey});cold={accepted:true};}catch(error){cold={accepted:false,code:error.code,message:error.message};}
 console.log(JSON.stringify({probe:'bom_at_warm_suffix_boundary',warm,cold}));
});
await fixture(async f=>{
 let release,started;const begun=new Promise(resolve=>started=resolve),delayed=new Promise(resolve=>release=resolve);let calls=0;
 const authority=await createCharacterAuthority({ledger:{...f.ledger,events:async()=>{calls++;if(calls===1){started();return delayed;}return [];}},systemPrincipal:system});
 const first=authority.readProjection();await begun;const controller=new AbortController();controller.abort();
 let cancelledSettled=false;
 const second=authority.readProjection({signal:controller.signal}).then(()=>{cancelledSettled=true;return 'accepted';},error=>{cancelledSettled=true;return error.code;});
 await new Promise(resolve=>setTimeout(resolve,30));const settledBeforeFirstRelease=cancelledSettled;
 release([]);await first;const final=await second;
 console.log(JSON.stringify({probe:'pre_aborted_character_read_queued_behind_load',settledBeforeFirstRelease,final}));
});
