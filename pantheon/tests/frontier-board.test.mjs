import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {join} from 'node:path';
import {withPipeline} from './fixtures/pipeline.mjs';import {runOpenItem} from '../src/board/run-item.mjs';
import {openBoard,checkout} from '../src/board/index.mjs';
const spec=repo=>({key:'fallover',repo_root:repo,title:'test',goal:'test',question:'q',copy:[],acceptance_cmd:'true',slot:'code',path:'code.mjs'});
test('a 400 after a 429 retry is terminal on the actual board path',async()=>{
 await withPipeline(async({repo,opts})=>{
  let attempts=0;const other=[];const base=opts.makeClientFor;
  const result=await runOpenItem(spec(repo),{...opts,seatOverrides:{implementer:opts.seatOverrides.implementer,reviewer:opts.seatOverrides.reviewer},makeClientFor:vendor=>{
   if(vendor==='anthropic')return {messages:{create:async()=>{attempts++;throw Object.assign(new Error(attempts===1?'busy':'invalid parameter'),{status:attempts===1?429:400,headers:{'retry-after':'0'}});}}};
   other.push(vendor);return base(vendor);
  }});
  assert.equal(attempts,2);assert.equal(result.shipped,false);assert.match(result.error.message,/invalid parameter/);
  assert.deepEqual(other,['xai']);
 });
});
test('planner fallback publishes under the actual Google identity through the API transport',async()=>{
 await withPipeline(async({repo,opts})=>{
  const base=opts.makeClientFor;
  const result=await runOpenItem(spec(repo),{...opts,seatOverrides:{implementer:opts.seatOverrides.implementer,reviewer:opts.seatOverrides.reviewer},makeClientFor:vendor=>{
   if(vendor==='anthropic')return {messages:{create:async()=>{throw Object.assign(new Error('quota'),{status:429});}}};
   if(vendor==='agy_google')return {models:{countTokens:async()=>({totalTokens:100}),generateContentStream:async function*(){yield {candidates:[{finishReason:'STOP',content:{parts:[{text:'TITLE: fallback implementation'}]}}]};}}};
   return base(vendor);
  }});
  assert.equal(result.shipped,true,JSON.stringify(result.error));
  const run=JSON.parse(readFileSync(join(result.board,'run.json'),'utf8'));assert.equal(run.planner_vendor,'agy_google');
  const b=openBoard(result.board);const plan=checkout(b.store,b.refs.resolve('refs/seat/agy_google-plan/wip'));
  assert.equal(plan.slots.plan.author.vendor,'agy_google');
 });
});
