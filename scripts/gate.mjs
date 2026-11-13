// Deterministic controller entry point. Report bytes, exit codes and hashes; never model verdicts.
import {readFile,readdir,lstat,readlink} from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile);
const root=resolve(import.meta.dirname,'..');
const run=async(cmd,args,opts={})=>{try{return (await execute(cmd,args,{cwd:root,encoding:'utf8',timeout:300000,killSignal:'SIGKILL',maxBuffer:16*1024*1024,...opts})).stdout;}catch(error){throw new Error(`${cmd} ${args.join(' ')} failed\n${error.stdout??''}\n${error.stderr??''}`,{cause:error});}};
async function candidate(){
 const files=(await run('git',['ls-files','--cached','--others','--exclude-standard','-z'])).split('\0').filter(Boolean).sort();
 const h=createHash('sha256');for(const file of files){const path=resolve(root,file),st=await lstat(path);h.update(file+'\0'+st.mode+'\0');h.update(st.isSymbolicLink()?await readlink(path):await readFile(path));h.update('\0');}return h.digest('hex');
}
const mergeReady=process.argv.includes('--merge-ready');
if(mergeReady&&(await run('git',['status','--porcelain'])).trim())throw new Error('Merge gate requires a clean committed candidate');
const before=await candidate();const head=(await run('git',['rev-parse','HEAD'])).trim();
const checks=[];
for(const [name,cmd,args,opts] of [
 ['generated-types','python3',['scripts/generate-contract-types.py','--check']],
 ['schema',process.execPath,['scripts/check-contracts.mjs']],
 ['boundaries',process.execPath,['scripts/check-boundaries.mjs']],
 ['types',process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
 ['board-and-dispatch', 'python3', ['-I','-S','-B','scripts/run-python-tests.py','--trusted-import-root','tools']],
 ['research-python', 'python3', ['-I','-S','-B','scripts/run-python-tests.py','RESEARCH']],
 ['research-tests',process.execPath,['scripts/run-tests.mjs','RESEARCH/test_validate.mjs']],
 ['research-package',process.execPath,['RESEARCH/validate.mjs']],
 ['foundation',process.execPath,['scripts/run-tests.mjs',...(await readdir(resolve(root,'TESTS'))).filter(f=>f.endsWith('.test.ts')).sort().map(f=>'TESTS/'+f)]],
 ['model-and-process',process.execPath,['../scripts/run-tests.mjs',...(await readdir(resolve(root,'packages/model-client/tests'))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'../packages/model-client/tests/'+f),...(await readdir(resolve(root,'pantheon/tests'))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f)],{cwd:resolve(root,'pantheon')}],
]){
 const output=await run(cmd,args,opts);if(name==='schema'&&!output.includes('Frozen schemas: 36 definitions'))throw new Error('Schema checker did not complete');if(name==='research-package'&&!output.includes('PASS five starter reports, provenance, references, coverage paths and unchanged v1 freeze'))throw new Error('Research validator did not complete');checks.push({name,output_sha256:createHash('sha256').update(output).digest('hex')});console.log(`PASS ${name}`);
}
if(await candidate()!==before||(await run('git',['rev-parse','HEAD'])).trim()!==head)throw new Error('Candidate changed during verification');
console.log(JSON.stringify({controller:'deterministic-v1',commit:head,workspace_sha256:before,merge_ready:mergeReady,checks}));
