/** Offline analysis entrypoint; writes reports only, never world storage. */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {canonical,hash} from '../../../packages/contracts/src/index.ts';
import {PROTOCOL,combatArms} from './fixtures.ts';
import {runStudy,runCombatTrial,runResourceTrial,RESOURCE_CASES} from './runner.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
function argumentsOf(argv:string[]){
 const args:Record<string,string>={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if(!key||!['--phase','--trials','--output','--training','--decision'].includes(key)||value===undefined||Object.hasOwn(args,key))throw Error('Usage: cli.ts --phase pilot|train|holdout --output FILE [--trials N] [--training FILE --decision FILE]');args[key]=value;}
 const phase=args['--phase'];if(!['pilot','train','holdout'].includes(phase??'')||!args['--output'])throw Error('Explicit phase and output path required');
 const trials=Number(args['--trials']??(phase==='pilot'?'10':'500'));
 if(!Number.isSafeInteger(trials)||trials>(phase==='pilot'?10:10000)||trials<(phase==='pilot'?10:500))throw Error('Pilot requires10; studies require500..10000 trials per cell');
 if(phase==='holdout'&&(!args['--training']||!args['--decision']))throw Error('Heldout requires a frozen training report and decision');
 if(phase!=='holdout'&&args['--training'])throw Error('Training input is only allowed for heldout');
 return {phase:phase as 'pilot'|'train'|'holdout',trials,output:resolve(args['--output']),training:args['--training'],decision:args['--decision']};
}
async function sources(){
 const paths:string[]=[];
 async function collect(dir:string){for(const e of await readdir(join(root,dir),{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await collect(p);else if(e.isFile()&&/\.(ts|json)$/.test(e.name))paths.push(p);}}
 await collect('packages/contracts/src');await collect('SYSTEMS');await collect('scenarios/tempted-fates/balance');
 paths.push('packages/ledger/src/mortal/rules.ts','package.json','package-lock.json','packages/contracts/package.json','packages/ledger/package.json','scenarios/tempted-fates/package.json');paths.sort();
 const files:Record<string,string>={};for(const p of paths){const bytes=await readFile(join(root,p));
  const committed=execFileSync('git',['show',`HEAD:${p}`],{cwd:root,maxBuffer:32*1024*1024});if(!bytes.equals(committed))throw Error(`Study source differs from committed HEAD: ${p}`);files[p]=sha(bytes);}
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 return {commit,node:process.version,files,fingerprint:hash({files,node:process.version})};
}
function decisionFor(report:Record<string,any>,reportHash:string){
 return {protocol:PROTOCOL,training_report_sha256:reportHash,source_fingerprint:report.source.fingerprint,trials:report.result.trials_per_cell,recommendation:report.result.recommendation,selection_rule:report.result.selection_rule};
}
async function main(){
 const args=argumentsOf(process.argv.slice(2)),source=await sources();
 const protocolBytes=await readFile(join(root,'scenarios/tempted-fates/balance/protocol.json'));
 let frozen:ReturnType<typeof decisionFor>|null=null;
 if(args.phase==='holdout'){
  const raw=await readFile(resolve(args.training!)),training=JSON.parse(raw.toString()),decision=JSON.parse(await readFile(resolve(args.decision!),'utf8'));
  if(training.phase!=='train'||training.protocol!==PROTOCOL||training.source?.fingerprint!==source.fingerprint||training.result?.trials_per_cell!==args.trials||training.result?.study_eligible!==true)throw Error('Heldout source, count or training identity differs');
  frozen=decisionFor(training,sha(raw));if(canonical(decision)!==canonical(frozen))throw Error('Training decision does not match the exact report');
 }
 await mkdir(dirname(args.output),{recursive:true});
 // Exclusive intent remains after failure. Never overwrite or quietly rerun a study.
 const started={protocol:PROTOCOL,phase:args.phase,trials:args.trials,source,started_at_utc:new Date().toISOString(),frozen_decision:frozen};
 await writeFile(args.output+'.started.json',JSON.stringify(started,null,2)+'\n',{flag:'wx'});
 const start=performance.now();let result:unknown;
 if(args.phase==='pilot'){
  let trials=0;for(let i=0;i<10;i++){for(const arm of combatArms()){runCombatTrial('pilot',i,arm);trials++;}for(const scenario of RESOURCE_CASES){runResourceTrial('pilot',i,scenario);trials++;}}
  result={seeds:10,combat_trials:210,resource_trials:80,replayed_trials:trials,note:'Timing pilot only. Outcomes deliberately not summarized or used for seed/arm selection.'};
 }else{
  let last=performance.now();result=runStudy({phase:args.phase,trials:args.trials,onProgress:(done,total)=>{if(performance.now()-last>15000){process.stderr.write(`Completed ${done}/${total} trials (including independent command replay).\n`);last=performance.now();}}});
 }
 const report={protocol:PROTOCOL,phase:args.phase,preregistered_first_study:args.trials===500,protocol_sha256:sha(protocolBytes),source,frozen_decision:frozen,result,elapsed_ms:performance.now()-start,finished_at_utc:new Date().toISOString(),analysis_only:true};
 const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(args.output,bytes,{flag:'wx'});
 if(args.phase==='train')await writeFile(resolve(args.decision??args.output+'.decision.json'),JSON.stringify(decisionFor(report,sha(bytes)),null,2)+'\n',{flag:'wx'});
 process.stdout.write(JSON.stringify({report:relative(process.cwd(),args.output),sha256:sha(bytes),elapsed_ms:report.elapsed_ms})+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exitCode=1;});
