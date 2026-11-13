import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,symlink,readFile,rm,chmod} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {assertCandidatePolicy} from '../controller/policy.ts';
import * as policy from '../controller/policy.ts';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
test('a symlink ancestor cannot redirect trusted policy operations onto host files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'argo-policy-'));try{const candidate=join(root,'candidate'),trusted=join(root,'trusted'),outside=join(root,'outside');await mkdir(candidate);await mkdir(join(trusted,'scripts'),{recursive:true});await mkdir(outside);await writeFile(join(trusted,'scripts/gate.mjs'),'trusted');await writeFile(join(outside,'gate.mjs'),'host sentinel');await symlink(outside,join(candidate,'scripts'));
 await assert.rejects(assertCandidatePolicy(candidate,trusted,['scripts/gate.mjs']),/symlink|symbolic/i);assert.equal(await readFile(join(outside,'gate.mjs'),'utf8'),'host sentinel');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('policy changes are refused instead of testing an overlaid tree and merging untested original bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'argo-policy-diff-'));try{const candidate=join(root,'candidate'),trusted=join(root,'trusted');for(const dir of [candidate,trusted]){await mkdir(join(dir,'scripts'),{recursive:true});await writeFile(join(dir,'scripts/gate.mjs'),'trusted');}
 await assertCandidatePolicy(candidate,trusted,['scripts']);await writeFile(join(candidate,'scripts/gate.mjs'),'process.exit(0)');await assert.rejects(assertCandidatePolicy(candidate,trusted,['scripts']),/policy|differs/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('zero exit without executing registered oracle tests cannot pass the parent gate',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const root=await mkdtemp(join(tmpdir(),'argo-test-proof-'));try{
  const fixture=join(root,'early-exit.mjs');await writeFile(fixture,"import {test} from 'node:test'; process.exit(0); test('oracle must execute',()=>{});\n");
  await assert.rejects(run(process.execPath,['scripts/run-tests.mjs',fixture],{cwd:process.cwd(),env,timeout:10000}),/missing assertions/);
  await writeFile(fixture,"import {test} from 'node:test'; test('oracle must execute',()=>{});\n");
  assert.match((await run(process.execPath,['scripts/run-tests.mjs',fixture],{cwd:process.cwd(),env,timeout:10000})).stdout,/Verified 1 named test/);
 }finally{await rm(root,{recursive:true,force:true});}
});

async function withArchivedTree(attributes:string,check:(root:string,listing:Buffer)=>Promise<void>,submodule=false):Promise<void>{
 const root=await mkdtemp(join(tmpdir(),'argo-archive-policy-')),repo=join(root,'repo'),extracted=join(root,'extracted');
 const run=promisify(execFile),env={PATH:process.env.PATH,HOME:root,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1'};
 const git=async(args:string[])=>(await run('git',args,{cwd:repo,env,encoding:'buffer',timeout:10000})).stdout;
 try{
  await mkdir(repo);await mkdir(extracted);await mkdir(join(repo,'nested'));
  await writeFile(join(repo,'.gitattributes'),attributes);
  await writeFile(join(repo,'source.txt'),'committed value: $Format:%H$\n');
  await writeFile(join(repo,'nested','odd\tname\n.txt'),Buffer.from([0,255,10]));
  await writeFile(join(repo,'runner.sh'),'#!/bin/sh\nexit 0\n');await chmod(join(repo,'runner.sh'),0o755);
  await symlink('source.txt',join(repo,'source-link'));
  await git(['init','-q']);await git(['add','--all']);
  const commit=()=>git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','archive fixture']);await commit();
  if(submodule){const head=(await git(['rev-parse','HEAD'])).toString().trim();await git(['update-index','--add','--cacheinfo',`160000,${head},submodule`]);await commit();}
  const listing=await git(['ls-tree','-rz','--full-tree','HEAD']);
  const archive=join(root,'candidate.tar');await writeFile(archive,await git(['archive','--format=tar','HEAD']));
  await run('tar',['-xf',archive,'-C',extracted],{env,timeout:10000});
  await check(extracted,listing);
 }finally{await rm(root,{recursive:true,force:true});}
}
function exactTreeVerifier():(root:string,listing:Buffer)=>Promise<void>{
 const verify=Reflect.get(policy,'assertExactGitTree');assert.equal(typeof verify,'function','controller must verify the raw Git tree identity');return verify;
}
test('ordinary archives preserve exact Git paths, binary blobs, executable files and symlinks',async()=>{
 await withArchivedTree('',async(root,listing)=>{await exactTreeVerifier()(root,listing);});
});
test('export-subst cannot substitute source bytes before the controller tests them',async()=>{
 await withArchivedTree('source.txt export-subst\n',async(root,listing)=>{
  assert.equal((await readFile(join(root,'source.txt'),'utf8')).includes('$Format:%H$'),false);
  await assert.rejects(exactTreeVerifier()(root,listing),/blob|bytes|identity/i);
 });
});
test('export-ignore cannot omit a committed file from the candidate tested by the controller',async()=>{
 await withArchivedTree('source.txt export-ignore\n',async(root,listing)=>{
  await assert.rejects(readFile(join(root,'source.txt')),error=>error instanceof Error&&'code'in error&&error.code==='ENOENT');
  await assert.rejects(exactTreeVerifier()(root,listing),/missing|path|identity/i);
 });
});
test('staging rejects extra files, changed executable bits and substituted symlink targets',async()=>{
 await withArchivedTree('',async(root,listing)=>{
  const verify=exactTreeVerifier();
  await writeFile(join(root,'extra.txt'),'uncommitted');await assert.rejects(verify(root,listing),/extra|unexpected|path/i);await rm(join(root,'extra.txt'));
  await chmod(join(root,'runner.sh'),0o644);await assert.rejects(verify(root,listing),/mode|executable/i);await chmod(join(root,'runner.sh'),0o755);
  await rm(join(root,'source-link'));await symlink('runner.sh',join(root,'source-link'));await assert.rejects(verify(root,listing),/blob|bytes|identity/i);
 });
});
test('unmaterialized submodules cannot pass exact candidate validation',async()=>{
 await withArchivedTree('',async(root,listing)=>{await assert.rejects(exactTreeVerifier()(root,listing),/submodule|unsupported.*mode|unsupported.*type/i);},true);
});
