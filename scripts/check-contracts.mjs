import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {assertContract,schemaDefinition} from '../packages/contracts/src/index.ts';
const freeze=JSON.parse(await readFile(new URL('../SYSTEMS/CONTRACT_FREEZE.json',import.meta.url),'utf8'));
for(const [file,digest] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex'),digest,`Frozen contract changed: ${file}`);
assert.equal(Object.keys(schemaDefinition.$defs).length,36);
const example=JSON.parse(await readFile(new URL('../SYSTEMS/examples/observe-claim.json',import.meta.url),'utf8'));assertContract('IntentProposal',example);
for(const mutation of [x=>{x.world_time=1.1;},x=>{x.action.type='invented';},x=>{x.extra=true;},x=>{x.scope.rights_lane='public';},x=>{delete x.expected_head;}]){
 const invalid=structuredClone(example);mutation(invalid);assert.throws(()=>assertContract('IntentProposal',invalid));
}
console.log('Frozen schemas: 36 definitions; valid fixture accepted; five invalid mutations refused.');
