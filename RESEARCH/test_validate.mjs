import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {assertReport,assertStarterReport,renderReport} from './validate.mjs';
const fixture=JSON.parse(await readFile(new URL('./findings/01_referee_loops.json',import.meta.url),'utf8'));
test('unretrieved or nonexistent evidence cannot certify a documented claim',()=>{
 const missing=structuredClone(fixture);missing.claims[0].source_ids=['R1-S999'];assert.throws(()=>assertReport(missing),/source reference/);
 const unavailable=structuredClone(fixture);unavailable.sources.forEach(s=>s.retrieval='unavailable');assert.throws(()=>assertReport(unavailable),/retrieved evidence/);
});
test('starter metadata cannot claim a paid vendor run or completed research stage',()=>{
 for(const change of [{status:'complete'},{producer:{kind:'codex_starter',executed_model:'grok-4.3',paid_run:true}}])assert.throws(()=>assertReport({...structuredClone(fixture),...change}),/Starter provenance/);
});
test('future tests cannot masquerade as implemented assertions or escape the repository',()=>{
 const future=structuredClone(fixture);future.benchmarks[0].coverage_path='TESTS/ledger.test.ts';assert.throws(()=>assertReport(future),/Proposed benchmark/);
 future.benchmarks[0].status='existing_source_assertion';future.benchmarks[0].coverage_path='../secret';assert.throws(()=>assertReport(future),/Unsafe coverage/);
});
test('strict reports reject extra state and render reproducibly',()=>{
 assert.throws(()=>assertReport({...fixture,world_state:{}}));assertReport(fixture);assert.equal(renderReport(fixture),renderReport(structuredClone(fixture)));
});
test('offline package refuses otherwise valid vendor provenance',()=>{
 const vendor=structuredClone(fixture);vendor.status='complete';vendor.producer={kind:'vendor_run',executed_model:'grok-4.3',paid_run:true};
 assertReport(vendor);assert.throws(()=>assertStarterReport(vendor),/Offline delivery/);assertStarterReport(fixture);
});
test('later research can use its real date, but invalid calendar dates are refused',()=>{
 const later=structuredClone(fixture);later.sources[0].accessed_on='2026-11-14';assertReport(later);
 later.sources[0].accessed_on='2026-02-30';assert.throws(()=>assertReport(later),/retrieval date/);
});
