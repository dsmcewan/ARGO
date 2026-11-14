import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,rm,readFile,writeFile,mkdir,appendFile,utimes,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLedger,replay} from '../packages/ledger/src/index.ts';
import {canonical} from '../packages/contracts/src/index.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';

async function setup(t:any){
 const directory=await mkdtemp(join(tmpdir(),'argo-ledger-cache-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 const advance=async(l=ledger)=>{const s=await l.snapshot();return l.submit(proposal(s,{type:'advance_time',to_time:s.world_time+1},'system'),principal('system','system'));};
 return {directory,seed,ledger,advance,path:join(directory,'events.jsonl')};
}

test('unchanged reads and retries do not reverify already accepted signatures',async t=>{
 const f=await setup(t);
 const p=proposal(await f.ledger.snapshot(),{type:'advance_time',to_time:11},'system');
 const receipt=await f.ledger.submit(p,principal('system','system'));
 await f.ledger.snapshot(); // Admit a durable append into the per-handle prefix.
 const spy=t.mock.method(crypto,'verify');syncBuiltinESMExports();
 t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 assert.equal((await f.ledger.snapshot()).sequence,1);
 assert.equal((await f.ledger.events()).length,1);
 assert.deepEqual(await f.ledger.submit(p,principal('system','system')),receipt);
 assert.equal(spy.mock.callCount(),0,'Unchanged history must not repeat signature work');
});

test('another writer is verified once and matches cold replay without exposing cached objects',async t=>{
 const f=await setup(t);await f.advance();await f.ledger.snapshot();
 const other=await openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey});
 await f.advance(other);
 const spy=t.mock.method(crypto,'verify');syncBuiltinESMExports();
 t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 const state=await f.ledger.snapshot();assert.equal(state.sequence,2);assert.equal(state.world_time,12);
 assert.equal(spy.mock.callCount(),1,'Only the other writer\'s suffix is new');
 state.actors.donor!.alive=false;state.proposals={};
 const history=await f.ledger.events();history[0]!.proposal.actor_id='outsider';
 const intact=await f.ledger.events();assert.equal(intact[0]!.proposal.actor_id,'system');
 assert.equal((await f.ledger.snapshot()).actors.donor!.alive,true);
 assert.equal(canonical(await f.ledger.snapshot()),canonical(replay(f.seed,intact)));
});

test('same-size edits with restored mtime cannot hide behind a warm prefix',async t=>{
 const f=await setup(t);await f.advance();await f.ledger.snapshot();
 const before=await readFile(f.path),metadata=await stat(f.path);
 const edited=Buffer.from(before.toString().replace('"to_time":11','"to_time":12'));
 assert.equal(edited.length,before.length);assert.notDeepEqual(edited,before);
 await writeFile(f.path,edited);await utimes(f.path,metadata.atime,metadata.mtime);
 await assert.rejects(f.ledger.snapshot(),/prefix|corrupt/i);
 await writeFile(f.path,before);assert.equal((await f.ledger.snapshot()).world_time,11);
});

test('an observed prefix cannot roll back within the same open handle',async t=>{
 const f=await setup(t);await f.advance();await f.ledger.snapshot();
 const before=await readFile(f.path);await writeFile(f.path,'');
 await assert.rejects(f.ledger.events(),/prefix|corrupt/i);
 await writeFile(f.path,before);assert.equal((await f.ledger.snapshot()).sequence,1);
});

test('a successful append is protected before any subsequent read warms the cache',async t=>{
 const f=await setup(t);
 const p=proposal(await f.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'traveler'});
 const receipt=await f.ledger.submit(p,principal());assert.equal(receipt.sequence,1);
 const good=await readFile(f.path);await writeFile(f.path,'');
 await assert.rejects(f.ledger.submit(p,principal()),/prefix|corrupt/i);
 await writeFile(f.path,good);assert.deepEqual(await f.ledger.submit(p,principal()),receipt);
});

test('a durable append stays protected when its derived snapshot write fails',async t=>{
 const f=await setup(t);await mkdir(join(f.directory,'snapshot.json'));
 const p=proposal(await f.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'traveler'});
 await assert.rejects(f.ledger.submit(p,principal()),/directory|EISDIR/i);
 const good=await readFile(f.path);await writeFile(f.path,'');
 await assert.rejects(f.ledger.snapshot(),/prefix|corrupt/i);
 await writeFile(f.path,good);assert.equal((await f.ledger.snapshot()).sequence,1);
});

test('a durable append stays protected if closing the synchronized event file fails',async t=>{
 const f=await setup(t),realOpen=fs.open;
 const p=proposal(await f.ledger.snapshot(),{type:'advance_time',to_time:11},'system');
 let synchronized=false;
 const spy=t.mock.method(fs,'open',async(...args:Parameters<typeof fs.open>)=>{
  const file=await realOpen(...args);
  if(args[0]===f.path&&args[1]==='a'){
   const close=file.close.bind(file),sync=file.sync.bind(file);
   file.sync=async()=>{await sync();synchronized=true;};
   file.close=async()=>{await close();throw Object.assign(new Error('Injected close EIO'),{code:'EIO'});};
  }
  return file;
 });
 syncBuiltinESMExports();t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(f.ledger.submit(p,principal('system','system')),/Injected close EIO/);
 spy.mock.restore();syncBuiltinESMExports();assert.equal(synchronized,true);
 const good=await readFile(f.path);assert.ok(good.length>0);await writeFile(f.path,'');
 await assert.rejects(f.ledger.snapshot(),/prefix|corrupt/i);
 await writeFile(f.path,good);assert.equal((await f.ledger.snapshot()).sequence,1);
});

test('a failed multi-event suffix cannot partially publish the verification cache',async t=>{
 const f=await setup(t);await f.advance();await f.ledger.snapshot();
 const other=await openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey});
 await f.advance(other);await f.advance(other);
 const good=await readFile(f.path,'utf8');
 await writeFile(f.path,good.replace('"to_time":13','"to_time":14'));
 await assert.rejects(f.ledger.snapshot(),/corrupt|hash/i);
 await writeFile(f.path,good);
 assert.equal((await f.ledger.snapshot()).sequence,3);
 assert.equal((await f.ledger.snapshot()).world_time,13);
 assert.equal(canonical(await f.ledger.snapshot()),canonical(replay(f.seed,await f.ledger.events())));
});

test('genesis and journal existence remain checked even when history is cached',async t=>{
 const f=await setup(t);await f.advance();await f.ledger.snapshot();
 const path=join(f.directory,'genesis.json'),good=await readFile(path);
 await writeFile(path,good.toString().replace('"world_time":10','"world_time":11'));
 await assert.rejects(f.ledger.snapshot(),/genesis/i);await writeFile(path,good);
 await rm(f.path);await assert.rejects(f.ledger.events(),/missing|corrupt/i);
});

test('snapshot files remain disposable and a post-append snapshot failure is retryable',async t=>{
 const f=await setup(t);await writeFile(join(f.directory,'snapshot.json'),'UNTRUSTED CACHE');
 assert.equal((await f.ledger.snapshot()).sequence,0);
 await rm(join(f.directory,'snapshot.json'));await mkdir(join(f.directory,'snapshot.json'));
 const p=proposal(await f.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'traveler'});
 await assert.rejects(f.ledger.submit(p,principal()),/directory|EISDIR/i);
 assert.equal((await f.ledger.snapshot()).sequence,1);
 await rm(join(f.directory,'snapshot.json'),{recursive:true});
 assert.equal((await f.ledger.submit(p,principal())).sequence,1);
 assert.equal((await f.ledger.events()).length,1);
});

test('blank or partial suffix records fail instead of becoming a trusted prefix',async t=>{
 const f=await setup(t);await f.advance();await f.ledger.snapshot();
 const good=await readFile(f.path);
 for(const tail of ['\n','{"partial":',Buffer.from([0xff,0x0a])]){
  await writeFile(f.path,good);await appendFile(f.path,tail);
  await assert.rejects(f.ledger.snapshot(),/blank|partial|UTF-8|corrupt/i);
 }
 await writeFile(f.path,good);assert.equal((await f.ledger.snapshot()).sequence,1);
});

test('a BOM at an append boundary is rejected identically by warm and cold readers',async t=>{
 const f=await setup(t);await f.advance();const prefix=await readFile(f.path);
 const other=await openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey});
 await f.advance(other);const good=await readFile(f.path);
 await writeFile(f.path,Buffer.concat([prefix,Buffer.from([0xef,0xbb,0xbf]),good.subarray(prefix.length)]));
 await assert.rejects(f.ledger.snapshot(),/corrupt|canonical/i);
 await assert.rejects(openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey}),/corrupt|canonical/i);
 await writeFile(f.path,good);assert.equal((await f.ledger.snapshot()).sequence,2);
});
