// Independent static acceptance-budget review. Never imports or executes gate code.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const [rootArg,base,candidate,outArg,foundationArg,outerArg,parserRootArg]=process.argv.slice(2);
if(!outerArg)throw Error('node static-check.mjs CHECKOUT BASE_SHA CANDIDATE_SHA OUTPUT FOUNDATION_MS OUTER_MS');
const root=resolve(rootArg),out=resolve(outArg),exec=promisify(execFile),git=async(...args)=>(await exec('git',['-C',root,...args],{maxBuffer:8*1024*1024})).stdout;
const digest=x=>createHash('sha256').update(x).digest('hex'),blob=(sha,path)=>git('show',sha+':'+path);
assert.equal((await git('rev-parse','HEAD')).trim(),candidate);assert.equal(await git('status','--porcelain'),'');
const allowed=['scripts/gate.mjs','controller/merge.mjs','docs/characters-runtime/evidence/run-candidate-gate.py','docs/session-continuation/GATE_BUDGET.md'];
const changed=(await git('diff','--name-only',base,candidate)).trim().split('\n').filter(Boolean);assert.ok(changed.every(p=>allowed.includes(p)));assert.ok(changed.length);
const preserved=['scripts/run-tests.mjs','scripts/run-python-tests.py','controller/acceptance-policy.mjs','controller/policy.ts','.github/workflows/deterministic-gate.yml','package.json','package-lock.json','SYSTEMS/CONTRACT_FREEZE.json'];
const hashes={};for(const path of preserved){const old=await blob(base,path),current=await blob(candidate,path);assert.equal(current,old,path+' changed');hashes[path]=digest(current);}
const parserRequire=createRequire(join(resolve(parserRootArg||root),'package.json'));
const parserPath=parserRequire.resolve('typescript'),ts=parserRequire('typescript');
const parserSha256=digest(await readFile(parserPath));
const parse=(name,text)=>{const tree=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(tree.parseDiagnostics.length,0);return tree;};
const find=(tree,predicate)=>{const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(tree);return result;};
function normalized(node,source,budget){if(node===budget)return[node.kind,'REVIEWED_TIMEOUT_ONLY'];const children=node.getChildren(source);return children.length?[node.kind,children.map(x=>normalized(x,source,budget))]:[node.kind,node.getText(source)];}
const oldGate=await blob(base,'scripts/gate.mjs'),newGate=await blob(candidate,'scripts/gate.mjs'),og=parse('old-gate.mjs',oldGate),ng=parse('new-gate.mjs',newGate);
function foundation(tree){const groups=find(tree,n=>ts.isArrayLiteralExpression(n)&&n.elements.length>0&&ts.isStringLiteral(n.elements[0])&&n.elements[0].text==='foundation');assert.equal(groups.length,1);const opts=groups[0].elements[3];assert.ok(ts.isObjectLiteralExpression(opts));assert.equal(opts.properties.length,1);const property=opts.properties[0];assert.equal(property.name.getText(tree),'timeout');assert.ok(ts.isNumericLiteral(property.initializer));return property.initializer;}
const of=foundation(og),nf=foundation(ng);assert.equal(Number(of.text),600000);assert.equal(Number(nf.text),Number(foundationArg));assert.ok(Number(nf.text)>0&&Number.isSafeInteger(Number(nf.text)));
assert.deepEqual(normalized(ng,ng,nf),normalized(og,og,of),'Gate AST changed beyond foundation timeout');
const expected=['generated-types','schema','boundaries','types','board-and-dispatch','research-python','research-tests','research-package','foundation','model-and-process'];
const groups=find(ng,n=>ts.isArrayLiteralExpression(n)&&n.elements.length>0&&ts.isStringLiteral(n.elements[0])&&expected.includes(n.elements[0].text)).map(n=>n.elements[0].text);assert.deepEqual(groups,expected);
const oldMerge=await blob(base,'controller/merge.mjs'),newMerge=await blob(candidate,'controller/merge.mjs'),om=parse('old-merge.mjs',oldMerge),nm=parse('new-merge.mjs',newMerge);
function outer(tree){const calls=find(tree,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='run'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='/usr/bin/bwrap');assert.equal(calls.length,1);assert.equal(calls[0].arguments.length,5);const value=calls[0].arguments[4];assert.ok(ts.isNumericLiteral(value));return value;}
const oo=outer(om),no=outer(nm);assert.equal(Number(oo.text),600000);assert.equal(Number(no.text),Number(outerArg));assert.ok(Number(no.text)>0&&Number.isSafeInteger(Number(no.text)));
assert.deepEqual(normalized(nm,nm,no),normalized(om,om,oo),'Merge controller AST changed beyond outer timeout');
for(const text of ["timeout:300000,killSignal:'SIGKILL',maxBuffer:16*1024*1024,...opts",".filter(f=>f.endsWith('.test.ts')).sort().map(f=>'TESTS/'+f)","const output=await run(cmd,args,opts)","if(await candidate()!==before","Merge gate requires a clean committed candidate"])assert.ok(newGate.includes(text),text);
for(const text of ["process.env.ARGO_CONTROLLER_TRUSTED_SHA!==trusted","assertCandidatePolicy(source,policy,protectedPaths)","maxBuffer:64*1024*1024","--unshare-all","'--ro-bind',source,'/workspace'"])assert.ok(newMerge.includes(text),text);
const native=await blob(candidate,'scripts/run-tests.mjs');for(const text of ["run({files,concurrency:1})","event.type==='test:summary'","event.data.entryFile","['failed','cancelled','skipped','todo']","expected.get(key)===event.data.name","failures||missing.length||incomplete.length"])assert.ok(native.includes(text),text);
const ci=await blob(candidate,'.github/workflows/deterministic-gate.yml');assert.ok(ci.includes('timeout-minutes: 20'));
await mkdir(out,{recursive:true});await writeFile(join(out,'candidate.diff'),await git('diff',base,candidate));
assert.equal((await git('rev-parse','HEAD')).trim(),candidate);assert.equal(await git('status','--porcelain'),'');
const result={candidate,base,changed,groups,typescript_parser:{path:parserPath,version:ts.version,sha256:parserSha256},foundation_ms:Number(nf.text),outer_ms:Number(no.text),preserved_sha256:hashes,gate_ast:'Only reviewed foundation timeout differs',controller_ast:'Only reviewed whole-gate timeout differs',ci_cap_minutes:20,ci_budget_note:Number(no.text)>1200000?'Configured outer maximum exceeds CI job cap; coordinator must explicitly report incompatibility.':'CI setup plus full execution must still fit its unchanged 20-minute cap.',source_clean:true,execution:'Static parsing only; no gate/controller/test invocation, trust promotion or merge.'};await writeFile(join(out,'static-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
