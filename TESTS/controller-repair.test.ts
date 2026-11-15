import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';

const execute=promisify(execFile),root=resolve(import.meta.dirname,'..');
const env={...process.env};delete env.NODE_TEST_CONTEXT;
async function temporary(run:(directory:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'argo-controller-repair-'));
 try{await run(directory);}finally{await rm(directory,{recursive:true,force:true});}
}
async function python(directory:string){
 return execute('/usr/bin/python3',['-I','-B','scripts/run-python-tests.py','--trusted-import-root',directory],{cwd:root,env,timeout:15000});
}
test('Python exit guard checks trusted import/body completion and rejects forged stdout',async()=>{
 await temporary(async directory=>{
  const source=join(directory,'candidate.py'),oracle=join(directory,'test_candidate.py');
  await writeFile(oracle,"import unittest\nimport candidate\nclass Oracle(unittest.TestCase):\n def test_runs(self):\n  candidate.check()\n");
  for(const code of ["import os; os._exit(0)\n","import os\ndef check(): os._exit(0)\n","import os\nprint('{\"complete\":true,\"passed\":[\"test_candidate.Oracle.test_runs\"]}',flush=True)\nos._exit(0)\n"]){
   await writeFile(source,code);await assert.rejects(python(directory),/completion|missing|receipt/i);
  }
  await writeFile(source,'def check(): pass\n');assert.match((await python(directory)).stdout,/Verified 1 Python tests/);
 });
});
test('Python gate refuses failed, skipped and undiscovered tests',async()=>{
 await temporary(async directory=>{
  const oracle=join(directory,'test_candidate.py');
  for(const body of ["self.fail('broken')","self.skipTest('not executed')"]){
   await writeFile(oracle,`import unittest\nclass Oracle(unittest.TestCase):\n def test_runs(self):\n  ${body}\n`);
   await assert.rejects(python(directory),/failed|missing|skipped|completion/i);
  }
  await writeFile(oracle,'import unittest\n');await assert.rejects(python(directory),/No trusted.*test/i);
 });
});
test('JavaScript completion cannot borrow a same-named pass from another file',async()=>{
 await temporary(async directory=>{
  const early=join(directory,'early.test.mjs'),good=join(directory,'good.test.mjs');
  await writeFile(early,"import {test} from 'node:test'; process.exit(0); test('same name',()=>{});\n");
  await writeFile(good,"import {test} from 'node:test'; for(let i=0;i<2;i++)test('same name',()=>{});\n");
  await assert.rejects(execute(process.execPath,['scripts/run-tests.mjs',early,good],{cwd:root,env,timeout:15000}),/missing assertions/);
 });
});

test('JavaScript requires normal file completion after loop-generated tests',async()=>{
 await temporary(async directory=>{
  const fixture=join(directory,'loop.test.mjs');
  await writeFile(fixture,"import {test} from 'node:test'; for(let i=0;i<2;i++)test('loop '+i,async()=>{if(i===1){await new Promise(r=>setTimeout(r,50));process.exit(0);}});\n");
  const run=()=>execute(process.execPath,['scripts/run-tests.mjs',fixture],{cwd:root,env,timeout:15000});
  await assert.rejects(run(),/completion|missing assertions/);
  await writeFile(fixture,"import {test} from 'node:test'; for(let i=0;i<2;i++)test('loop '+i,()=>{});\n");
  assert.match((await run()).stdout,/Verified 1 named test/);
  await writeFile(fixture,"import {test} from 'node:test'; for(let i=0;i<2;i++)test('loop '+i,{skip:i===1},()=>{});\n");
  await assert.rejects(run(),/completion|skipped/);
 });
});

// A small repository with the real controller and required gate. The trusted fixture's
// npm executable only copies the already installed compiler; it never fetches or executes
// candidate lifecycle scripts. No recursive invocation of this regression suite is needed.
async function controllerFixture(directory:string){
 const repo=join(directory,'target'),bin=join(directory,'bin');await mkdir(repo);await mkdir(bin);
 const put=async(path:string,contents:string)=>{await mkdir(dirname(join(repo,path)),{recursive:true});await writeFile(join(repo,path),contents);};
 for(const path of ['controller','scripts'])await cp(join(root,path),join(repo,path),{recursive:true});
 await put('.npmrc','ignore-scripts=true\n');await put('.gitignore','node_modules/\n__pycache__/\nlocal.txt\n');
 await put('package.json','{"name":"controller-fixture","private":true,"type":"module"}\n');
 await put('package-lock.json','{}\n');await put('pantheon/package.json','{"type":"module"}\n');await put('pantheon/package-lock.json','{}\n');
 await put('packages/model-client/package.json','{"type":"module"}\n');await put('scenarios/fixture/package.json','{"type":"module"}\n');
 await put('tsconfig.json','{"files":["empty.ts"]}\n');await put('empty.ts','export {};\n');
 await put('SYSTEMS/CONTRACT_FREEZE.json','{}\n');
 await put('.github/workflows/deterministic-gate.yml','name: fixture\n');
 await put('scripts/generate-contract-types.py','assert True\n');
 await put('scripts/check-contracts.mjs',"console.log('Frozen schemas: 36 definitions');\n");
 await put('scripts/check-boundaries.mjs','');
 const js="import {test} from 'node:test'; import assert from 'node:assert/strict'; test('fixture oracle',()=>assert.ok(true));\n";
 await put('TESTS/fixture.test.ts',js);await put('packages/model-client/tests/fixture.test.mjs',js);
 for(const file of ['spawn-bounds','acceptance-sandbox','google-long-decode','compaction-history','frontier-board','scoped-history','frontier-adapter'])await put(`pantheon/tests/${file}.test.mjs`,js);
 await put('tools/board.py','class Board: pass\n');await put('tools/dispatch.py','class Dispatcher: pass\n');await put('tools/board_support.py','# trusted support\n');
 await put('tools/test_board.py','import unittest\nfrom board import Board\nclass BoardOracle(unittest.TestCase):\n def test_available(self): self.assertTrue(callable(Board))\n');
 await put('tools/test_dispatch.py','import unittest\nfrom dispatch import Dispatcher\nclass DispatchOracle(unittest.TestCase):\n def test_available(self): self.assertTrue(callable(Dispatcher))\n');
 await put('RESEARCH/validate.mjs',"import {readFile} from 'node:fs/promises'; const data=JSON.parse(await readFile(new URL('./findings/report.json',import.meta.url))); if(!data.valid)throw Error('Invalid research'); console.log('PASS five starter reports, provenance, references, coverage paths and unchanged v1 freeze');\n");
 await put('RESEARCH/findings/report.json','{"valid":true}\n');await put('RESEARCH/test_validate.mjs',js);
 await put('RESEARCH/gate_ticket.py','def validate(): return True\n');await put('RESEARCH/manifest.json','{}\n');await put('RESEARCH/schemas/report.schema.json','{}\n');
 await put('RESEARCH/test_gate_ticket.py',"import unittest,importlib.util\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('research_gate',Path(__file__).with_name('gate_ticket.py'))\ngate=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(gate)\nclass ResearchOracle(unittest.TestCase):\n def test_valid(self): self.assertTrue(gate.validate())\n");
 const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 await writeFile(join(bin,'npm'),`#!/bin/sh\nset -eu\nmkdir -p node_modules\ncp -a ${quote(join(root,'node_modules/typescript'))} node_modules/typescript\n`);await chmod(join(bin,'npm'),0o755);
 const fixtureEnv={...env,PATH:bin+':'+env.PATH,GIT_CONFIG_NOSYSTEM:'1'};
 const git=async(...args:string[])=>(await execute('git',args,{cwd:repo,env:fixtureEnv})).stdout.trim();
 await git('init','-q');await git('config','user.name','Controller fixture');await git('config','user.email','fixture@argo.invalid');
 await git('add','--all');await git('commit','-qm','trusted fixture');const trusted=await git('rev-parse','HEAD');
 const controller=async(candidate:string)=>execute(process.execPath,[join(root,'controller/merge.mjs'),'--repo',repo,'--candidate',candidate,'--trusted',trusted],{cwd:root,env:{...fixtureEnv,ARGO_CONTROLLER_TRUSTED_SHA:trusted},timeout:60000,maxBuffer:4*1024*1024});
 const candidate=async(path:string,contents:string)=>{await git('reset','--hard',trusted);await put(path,contents);await git('add','--all');await git('add','-f','--',path);await git('commit','-qm','candidate');const sha=await git('rev-parse','HEAD');await git('reset','--hard',trusted);return sha;};
 return {repo,git,trusted,controller,candidate};
}
test('real controller refuses broken board and research candidates and preserves target',async()=>{
 await temporary(async directory=>{
  const f=await controllerFixture(directory);
  for(const [path,code] of [['tools/board.py',"raise RuntimeError('broken board candidate')\n"],['tools/board.py','import os; os._exit(0)\n'],['tools/dispatch.py',"raise RuntimeError('broken dispatcher')\n"],['RESEARCH/findings/report.json','{"valid":false}\n']] as const){
   const sha=await f.candidate(path,code);
   await assert.rejects(f.controller(sha),/protected policy differs|failed|completion|missing|Invalid research/i);
   assert.equal(await f.git('rev-parse','HEAD'),f.trusted);assert.equal(await f.git('status','--porcelain'),'');
  }
  const good=await f.candidate('empty.ts','export const repaired = true;\n');
  assert.match((await f.controller(good)).stdout,/Merged tested candidate/);assert.equal(await f.git('rev-parse','HEAD'),good);
 });
});
test('real controller refuses changed Python oracles, gate support and research policy',async()=>{
 await temporary(async directory=>{
  const f=await controllerFixture(directory);
  for(const path of ['tools/test_board.py','tools/board_support.py','RESEARCH/validate.mjs','RESEARCH/schemas/report.schema.json','.github/workflows/deterministic-gate.yml']){
   const sha=await f.candidate(path,(await readFile(join(f.repo,path),'utf8'))+'\n# policy changed\n');
   await assert.rejects(f.controller(sha),/protected policy differs/);assert.equal(await f.git('rev-parse','HEAD'),f.trusted);
  }
 });
});

test('real controller preserves ignored local data and target ref on integration collision',async()=>{
 await temporary(async directory=>{
  const f=await controllerFixture(directory),sha=await f.candidate('local.txt','candidate bytes\n');
  await writeFile(join(f.repo,'local.txt'),'irreplaceable local bytes\n');
  assert.equal(await f.git('status','--porcelain'),'');
  await assert.rejects(f.controller(sha),/overwritten|untracked/i);
  assert.equal(await f.git('rev-parse','HEAD'),f.trusted);
  assert.equal(await readFile(join(f.repo,'local.txt'),'utf8'),'irreplaceable local bytes\n');
 });
});

test('controller refuses Python receipt-forging control-plane code before importing it',async()=>{
 await temporary(async directory=>{
  const f=await controllerFixture(directory);
  const code="import os,sys,json\nreceipt={'complete':True,'passed':['test_board.BoardOracle.test_available','test_dispatch.DispatchOracle.test_available'],'run':2,'successful':True,'skipped':0,'expected_failures':0}\nos.write(int(sys.argv[sys.argv.index('--child')+2]),json.dumps(receipt).encode())\nos._exit(0)\n";
  const sha=await f.candidate('tools/board.py',code);
  await assert.rejects(f.controller(sha),/protected policy differs: tools/);
  assert.equal(await f.git('rev-parse','HEAD'),f.trusted);
 });
});

test('controller rejects added Python, bytecode and native research import surfaces',async()=>{
 await temporary(async directory=>{
  const f=await controllerFixture(directory);
  for(const path of ['tools/injected.py','RESEARCH/json.py','RESEARCH/json/__init__.py','RESEARCH/json.so','RESEARCH/__pycache__/test_gate_ticket.cpython-311.pyc']){
   const sha=await f.candidate(path,'untrusted import surface\n');
   await assert.rejects(f.controller(sha),/protected policy differs/);
   assert.equal(await f.git('rev-parse','HEAD'),f.trusted);
  }
  const good=await f.candidate('RESEARCH/findings/report.json','{"valid":true,"revised":true}\n');
  assert.match((await f.controller(good)).stdout,/Merged tested candidate/);
 });
});
