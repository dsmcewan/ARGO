import Ajv from 'ajv/dist/2020.js';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const schema=JSON.parse(await readFile(new URL('./schemas/report.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({allErrors:true,strict:true}).compile(schema);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertReport(report){
 if(!validate(report))throw Error(JSON.stringify(validate.errors));
 for(const source of report.sources){const date=new Date(source.accessed_on+'T00:00:00Z');if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==source.accessed_on)throw Error('Invalid source retrieval date');}
 const ids=new Set();
 for(const [group,tag] of [['sources','S'],['claims','C'],['proposals','P'],['benchmarks','B']])for(const item of report[group]){
  if(!new RegExp(`^${report.lane}-${tag}[1-9][0-9]*$`).test(item.id)||ids.has(item.id))throw Error('Invalid or duplicate lane identifier: '+item.id);
  ids.add(item.id);
 }
 const sources=new Map(report.sources.map(s=>[s.id,s]));
 for(const entry of [...report.claims,...report.proposals])for(const id of entry.source_ids)if(!sources.has(id))throw Error('Unknown source reference: '+id);
 for(const claim of report.claims)if(claim.basis==='documented'&&(!claim.source_ids.length||claim.source_ids.every(id=>sources.get(id).retrieval==='unavailable')))throw Error('Documented claim lacks retrieved evidence');
 if(report.requested_model!==(report.lane==='R5'?'grok-4.7':'grok-4.3'))throw Error('Wrong lane routing');
 if(report.producer.kind==='codex_starter'&&(report.status!=='starter'||report.producer.executed_model!==null||report.producer.paid_run))throw Error('Starter provenance cannot claim vendor execution or completion');
 if(report.producer.kind==='vendor_run'&&!report.producer.executed_model)throw Error('Vendor run requires actual model provenance');
 for(const test of report.benchmarks){
  if(test.status==='existing_source_assertion'&&!test.coverage_path)throw Error('Existing coverage needs a real path');
  if(test.status==='proposed'&&test.coverage_path!==null)throw Error('Proposed benchmark cannot claim existing coverage');
  if(test.coverage_path&&(test.coverage_path.startsWith('/')||test.coverage_path.split('/').some(x=>!x||x==='.'||x==='..')))throw Error('Unsafe coverage path');
 }
 return report;
}
export function assertStarterReport(report){
 assertReport(report);
 if(report.status!=='starter'||report.producer.kind!=='codex_starter'||report.producer.executed_model!==null||report.producer.paid_run!==false)throw Error('Offline delivery cannot include a vendor run or completed research stage');
 return report;
}
export function renderReport(r){
 const lines=[`# ${r.title}`,'',`Status: **${r.status}**. Baseline: \`${r.base_commit}\`. Prepared as ${r.producer.kind}; requested seat \`${r.requested_model}\`; actual vendor execution: ${r.producer.executed_model??'none'}.`,'',r.summary,'','## Sources',''];
 for(const s of r.sources)lines.push(`- **${s.id}** [${s.title}](${s.url}) — ${s.edition}; ${s.retrieval}; accessed ${s.accessed_on}. Locator: ${s.locator}.`);
 lines.push('','## Findings','');for(const c of r.claims)lines.push(`- **${c.id} (${c.basis})** ${c.statement} Sources: ${c.source_ids.join(', ')||'none'}.`);
 lines.push('','## Proposed mechanics and fields','');for(const p of r.proposals){lines.push(`### ${p.id}: ${p.title}`,'',`Compatibility: **${p.compatibility}**. Targets: ${p.targets.join(', ')}. Sources: ${p.source_ids.join(', ')}.`,'','| Field | Type | Visibility | Meaning |','|---|---|---|---|');for(const f of p.fields)lines.push(`| \`${f.name}\` | ${f.type} | ${f.visibility} | ${f.meaning} |`);lines.push('');for(const rule of p.rules)lines.push('- '+rule);lines.push('');}
 lines.push('## Deterministic benchmark specifications','');for(const b of r.benchmarks){lines.push(`### ${b.id}: ${b.title}`,'',`Status: **${b.status}**${b.coverage_path?`; inspected source: [${b.coverage_path}](../../${b.coverage_path})`:''}.`,'',`**Given:** ${b.given}`,`**When:** ${b.when}`,`**Then:** ${b.then.join(' ')}`,`**Oracle:** ${b.oracle}`,'');}
 lines.push('## Limits and open questions','');for(const q of r.open_questions)lines.push('- '+q);return lines.join('\n')+'\n';
}
export async function validatePackage({write=false}={}){
 const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
 if(manifest.paid_runs_authorized!==false||manifest.vendor_pipeline_executed!==false)throw Error('This delivery is offline starter research only');
 if(manifest.reports.length!==5||new Set(manifest.reports.map(x=>x.lane)).size!==5)throw Error('Exactly five distinct lanes required');
 for(const entry of manifest.reports){
  for(const path of [entry.json,entry.markdown])if(!/^findings\/[a-z0-9_]+\.(json|md)$/.test(path))throw Error('Unsafe report manifest path');
  const report=assertStarterReport(JSON.parse(await readFile(new URL(entry.json,import.meta.url),'utf8')));
  if(report.lane!==entry.lane||report.base_commit!==manifest.baseline_commit)throw Error('Baseline/lane mismatch');
  for(const b of report.benchmarks)if(b.coverage_path){const p=resolve(root,b.coverage_path);if(relative(root,p).startsWith('..')||!(await stat(p)).isFile())throw Error('Missing coverage file: '+b.coverage_path);}
  const markdown=renderReport(report),path=new URL(entry.markdown,import.meta.url);
  if(write)await writeFile(path,markdown);else if(await readFile(path,'utf8')!==markdown)throw Error('Stale rendered report: '+entry.markdown);
 }
 const freeze=JSON.parse(await readFile(resolve(root,'SYSTEMS/CONTRACT_FREEZE.json'),'utf8'));
 for(const [path,expected] of Object.entries(freeze.files))if(hash(await readFile(resolve(root,path)))!==expected)throw Error('Frozen v1 file changed: '+path);
 console.log('PASS five starter reports, provenance, references, coverage paths and unchanged v1 freeze');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await validatePackage({write:process.argv.includes('--write')});
