import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const root=process.env.ARGO_SW_ROOT??'/workspace/ARGO/.board/shared-world-foundation/worktrees/SW-200-1-d8fbe5da6f';
const mod=async(p:string)=>import(pathToFileURL(`${root}/${p}`).href);
const {genesis,command,principal,query}=await mod('TESTS/shared-world-rules-helpers.ts');
const {initialWorldState,resolveWorld,worldStateHash}=await mod('packages/ledger/src/world/rules.ts');
const {ownWorldGenesis,withWorldHead}=await mod('packages/ledger/src/world/rules/ownership.ts');
const {viewWorldActor}=await mod('packages/ledger/src/world/view.ts');
const {hash}=await mod('packages/contracts/src/index.ts');
const {assertWorldContract}=await mod('packages/contracts/src/shared-world.ts');
const g=ownWorldGenesis(genesis()),p=principal(g),note={type:'speak',text:'Generated authoritative pure transition',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null};let s=initialWorldState(g);const start=performance.now();
for(let n=1;n<=1000;n++){
 const r=resolveWorld(g,s,command(s,note,'hero',`perf_${n}`),p);s=withWorldHead(r.state,hash({test_only:true,previous:s.cursor.head,digest:worldStateHash(r.state)}));
 if(![128,512,1000].includes(n))continue;
 assertWorldContract('State',s,g);const samples=[];
 for(let i=0;i<9;i++){const a=performance.now();worldStateHash(s);const b=performance.now();viewWorldActor(g,s,query(s),p);const c=performance.now();const fork=resolveWorld(g,s,command(s,note,'hero',`probe_${n}_${i}`),p);const d=performance.now();worldStateHash(fork.state);const e=performance.now();samples.push({cached_hash_ms:b-a,view_ms:c-b,resolve_ms:d-c,new_hash_ms:e-d});}
 const median=(key:string)=>samples.map(x=>x[key]).sort((a,b)=>a-b)[4];console.log(JSON.stringify({prefix:n,bytes:Buffer.byteLength(JSON.stringify(s)),elapsed_build_ms:performance.now()-start,median:Object.fromEntries(Object.keys(samples[0]).map(k=>[k,median(k)])),max_combined_ms:Math.max(...samples.map(x=>Object.values(x).reduce((a,b)=>a+b,0))),limitations:'real pure transitions and synthetic head finalization; no signed journal, storage, worker, event-loop, RPC or provider performance claim'}));
}
