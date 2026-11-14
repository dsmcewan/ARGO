import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root='/workspace/ARGO/.board/shared-world-gate-budget/worktrees/SW-520-1-4136752cec';
const {protectedPaths}=await import(pathToFileURL(join(root,'controller/acceptance-policy.mjs')).href);
const {assertCandidatePolicy}=await import(pathToFileURL(join(root,'controller/policy.ts')).href);
const pins=await protectedPaths(root,root);assert.ok(pins.includes('scripts'));assert.ok(pins.includes('TESTS'));assert.ok(pins.includes('controller'));
const out=import.meta.dirname,temp=await mkdtemp('/tmp/argo-budget-policy-');let refusal;
try{
 for(const name of ['base','candidate']){await mkdir(join(temp,name,'scripts'),{recursive:true});await writeFile(join(temp,name,'scripts/gate.mjs'),await readFile(join(out,`${name}-gate.mjs`)),{mode:0o644});}
 await assertCandidatePolicy(join(temp,'base'),join(temp,'base'),['scripts']);
 await assert.rejects(assertCandidatePolicy(join(temp,'candidate'),join(temp,'base'),['scripts']),e=>{refusal=e.message;return e.message==='Candidate protected policy differs: scripts';});
}finally{await rm(temp,{recursive:true,force:true});}
console.log(JSON.stringify({protected_scripts:true,unchanged_policy_control:'passes',exact_changed_gate_policy_comparison:refusal,trust_pin_modified:false}));
