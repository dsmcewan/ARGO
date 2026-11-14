/** Explicit trusted-local operator harness. No remote authentication/live SDK. */
import {generateKeyPairSync,createPrivateKey,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,realpath,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ArgoError,assertWorldContract,assertWorldData,assertWorldGenesis,canonical,fail,freezeDto,hash} from '@argo/contracts';
import type {WorldCommand,WorldCursor,WorldGenesis,WorldLedger,WorldPrincipal,WorldReceipt} from '@argo/contracts';
import {openWorldLedger,replayWorld} from '@argo/ledger';
import {createWorldModelAgent} from '@argo/interventions';
import {createWorldSession} from '../../../packages/session/src/index.ts';
import type {WorldSession} from '../../../packages/session/src/index.ts';
import {buildSharedWorldCampaign} from './seed.ts';
import type {SharedWorldCampaignOptions} from './seed.ts';
import type {CampaignPack} from '../campaign/types.ts';
import pack from '../campaign/world.json' with {type:'json'};

export type WorldLocalConfig=Omit<SharedWorldCampaignOptions,'seed'|'authority_public_key'>;
type Flags={mode:'init'|'resume'|'demo';dir:string;config?:string;actor?:string;referee?:boolean};
type Emit=(row:unknown)=>void;
const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const limit=1024*1024;
function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function closed(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
 assertWorldData(value);if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid('Expected exactly the documented fields');
}
function argumentsFor(args:string[]):Flags{
 const mode=args[0];if(!['init','resume','demo'].includes(mode??''))invalid('Use init, resume or demo with an explicit --dir');
 const values:Record<string,string|true>=Object.create(null);
 for(let i=1;i<args.length;i++){
  const flag=args[i]!;if(!['--dir','--config','--actor','--referee'].includes(flag)||Object.hasOwn(values,flag))invalid('Unknown or repeated CLI option');
  if(flag==='--referee'){values[flag]=true;continue;}
  const value=args[++i];if(!value||value.startsWith('--')||value.includes('\0'))invalid('CLI option requires a value');values[flag]=value;
 }
 const dir=values['--dir'];if(typeof dir!=='string')invalid('An explicit --dir is required');
 if(mode==='init'&&(typeof values['--config']!=='string'||values['--actor']||values['--referee']))invalid('init requires --config and no actor/referee flag');
 if(mode==='resume'&&(Boolean(values['--actor'])===Boolean(values['--referee'])||values['--config']))invalid('resume requires exactly --actor ID or --referee');
 if(mode==='demo'&&Object.keys(values).length!==1)invalid('demo accepts only --dir');
 return {mode:mode as Flags['mode'],dir,...(typeof values['--config']==='string'?{config:values['--config']}:{}),...(typeof values['--actor']==='string'?{actor:values['--actor']}:{}),...(values['--referee']?{referee:true}:{})};
}
function within(root:string,path:string):boolean{const rel=relative(root,path);return rel===''||!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);}
async function excludedRoots():Promise<string[]>{
 const root=await realpath(sourceRoot),roots=[root];
 // A linked worktree must also keep private worlds outside its main checkout.
 const marker=await lstat(join(root,'.git')).catch(()=>null);
 if(marker?.isFile()){
  const text=await readFile(join(root,'.git'),'utf8'),match=/^gitdir: (.+)\s*$/m.exec(text);
  if(match){const gitdir=resolve(root,match[1]!),common=(await readFile(join(gitdir,'commondir'),'utf8')).trim();const gitRoot=await realpath(resolve(gitdir,common));if(gitRoot.endsWith(sep+'.git'))roots.push(dirname(gitRoot));}
 }
 return roots;
}
async function resolvedDestination(input:string):Promise<string>{
 if(!input||input.includes('\0'))invalid('Invalid private directory');
 const absolute=resolve(input),tail:string[]=[];let parent=absolute;
 for(;;){
  try{parent=await realpath(parent);break;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const next=dirname(parent);if(next===parent)throw error;tail.unshift(parent.slice(next.length+(next.endsWith(sep)?0:1)));parent=next;}
 }
 const target=resolve(parent,...tail);
 for(const root of await excludedRoots())if(within(root,target))invalid('Private worlds must live outside the source checkout');
 return target;
}
async function newDirectory(input:string):Promise<string>{
 // Reject existing symlinks too, including ones whose targets do not exist.
 if(await lstat(resolve(input)).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))invalid('Refusing to overwrite an existing world directory');
 const dir=await resolvedDestination(input);await mkdir(dir,{mode:0o700});return dir;
}
async function checkPrivate(path:string,directory=false):Promise<void>{
 const info=await lstat(path);if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile())||(info.mode&0o777)!==(directory?0o700:0o600)||process.getuid&&info.uid!==process.getuid())invalid('Private world permissions or file type are unsafe');
}
async function privateRead(path:string,maxBytes=16*1024*1024):Promise<string>{
 await checkPrivate(path);const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await file.stat();if(!info.isFile()||(info.mode&0o777)!==0o600||info.size>maxBytes||process.getuid&&info.uid!==process.getuid())invalid('Private file failed its bounds or permissions check');return await file.readFile('utf8');}finally{await file.close();}
}
async function privateWrite(path:string,data:unknown):Promise<void>{await writeFile(path,typeof data==='string'?data:canonical(data)+'\n',{flag:'wx',mode:0o600});}
function localPrincipal(genesis:WorldGenesis,actor?:string):WorldPrincipal{
 if(actor===undefined)return {scope:genesis.mortal.scope,role:'referee',actor_id:null,principal_id:genesis.mortal.referee_id};
 const found=genesis.mortal.actors.find(row=>row.id===actor);if(!found)invalid('Unknown local actor capability');
 return {scope:genesis.mortal.scope,role:found.kind,actor_id:found.id,principal_id:found.controller_id};
}
async function initialize(input:string,config:WorldLocalConfig,deterministicSeed?:string){
 closed(config,['scope','authority_key_id','referee_id','npc_controller_id','variant','hp_mode','environment','starting_kit','initial_knowledge_ids','travelers']);
 const keys=generateKeyPairSync('ed25519'),seed=buildSharedWorldCampaign(pack as CampaignPack,{...config,seed:deterministicSeed??randomBytes(32).toString('hex'),authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString()});
 const dir=await newDirectory(input);
 // Partial initialization stays private and is never silently overwritten.
 await privateWrite(join(dir,'genesis.json'),seed.genesis);await privateWrite(join(dir,'manifest.json'),seed.manifest);
 await privateWrite(join(dir,'signing-key.pem'),keys.privateKey.export({type:'pkcs8',format:'pem'}).toString());
 const ledger=await openWorldLedger({path:join(dir,'world.sqlite'),genesis:seed.genesis,privateKey:keys.privateKey});
 try{await checkPrivate(join(dir,'world.sqlite'));await privateWrite(join(dir,'ready.json'),{version:'shared-world-local/0.1.0',genesis_hash:hash(seed.genesis)});}catch(error){await ledger.close();throw error;}
 return {dir,genesis:seed.genesis,ledger};
}
async function resume(input:string,expectedHead?:WorldCursor){
 await checkPrivate(resolve(input),true);const dir=await resolvedDestination(input);await checkPrivate(dir,true);
 const genesis:unknown=JSON.parse(await privateRead(join(dir,'genesis.json')));assertWorldGenesis(genesis);
 const ready:unknown=JSON.parse(await privateRead(join(dir,'ready.json')));closed(ready,['version','genesis_hash']);
 if(ready.version!=='shared-world-local/0.1.0'||ready.genesis_hash!==hash(genesis))invalid('Initialization marker differs from genesis');
 const privateKey=createPrivateKey(await privateRead(join(dir,'signing-key.pem'),32768));
 for(const suffix of ['','-wal','-shm']){const path=join(dir,'world.sqlite'+suffix);if(await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))await checkPrivate(path);else if(suffix==='')invalid('Initialized journal is missing');}
 const ledger=await openWorldLedger({path:join(dir,'world.sqlite'),genesis,privateKey,...(expectedHead?{expectedHead}:{})});return {dir,genesis,ledger};
}

/** The text is released from a current actor view, never from a proposal.
 * Stale/rejected submissions throw before reaching the display step. */
export async function submitForDisplay(session:WorldSession,input:WorldCommand):Promise<{receipt:WorldReceipt;spoken:null|{type:'spoken';speaker_id:string;record_id:string;text:string}}>{
 assertWorldContract('Command',input);const command=freezeDto(structuredClone(input));
 const receipt=await session.submit(command);let spoken:null|{type:'spoken';speaker_id:string;record_id:string;text:string}=null;
 if(command.actor_id!==null&&command.action.type==='speak'){
  try{const view=await session.view(await session.query());if(!view.mythic_closed){const record=view.memories.find(row=>row.sequence===receipt.cursor.sequence&&row.actor_id===command.actor_id&&row.payload.type==='speak');
   if(record?.payload.type==='speak'&&record.payload.text===command.action.text&&canonical(record.payload.audience)===canonical(command.action.audience)&&record.payload.in_reply_to===command.action.in_reply_to)spoken={type:'spoken',speaker_id:command.actor_id,record_id:record.record_id,text:record.payload.text};
  }}catch(error){if(!(error instanceof ArgoError))throw error;/* Accepted but visibility moved; disclose receipt only. */}
 }
 return {receipt,spoken};
}

async function* lines(input:AsyncIterable<Uint8Array|string>):AsyncGenerator<string>{
 let pending=Buffer.alloc(0);
 for await(const chunk of input){const bytes=typeof chunk==='string'?Buffer.from(chunk):Buffer.from(chunk);let offset=0;
  for(let next=bytes.indexOf(10,offset);next!==-1;next=bytes.indexOf(10,offset)){
   if(pending.length+next-offset>limit)invalid('JSON line exceeds one MiB');
   const line=Buffer.concat([pending,bytes.subarray(offset,next)]).toString('utf8');pending=Buffer.alloc(0);offset=next+1;yield line;
  }
  if(pending.length+bytes.length-offset>limit)invalid('JSON line exceeds one MiB');pending=Buffer.concat([pending,bytes.subarray(offset)]);
 }
 if(pending.length)yield pending.toString('utf8');
}
function errorRow(error:unknown){return {type:'error',code:error instanceof ArgoError?error.code:'UNAVAILABLE',message:error instanceof ArgoError?error.message.slice(0,240):'Local operation failed; no state replacement was attempted.'};}
async function operate(session:WorldSession,input:unknown,emit:Emit):Promise<void>{
 assertWorldData(input);if(input===null||typeof input!=='object'||Array.isArray(input))invalid('Expected a JSON operation');const row=input as Record<string,unknown>;
 if(row.op==='query'){closed(row,['op']);emit({type:'query',query:await session.query()});}
 else if(row.op==='view'){closed(row,['op','query']);assertWorldContract('Query',row.query);emit({type:'view',view:await session.view(row.query)});}
 else if(row.op==='prepare'){closed(row,['op','request_id','action']);if(typeof row.request_id!=='string')invalid('request_id must be a string');assertWorldContract('Action',row.action);emit({type:'prepared',command:await session.prepare(row.action,row.request_id)});}
 else if(row.op==='submit'){closed(row,['op','command']);assertWorldContract('Command',row.command);const result=await submitForDisplay(session,row.command);emit({type:'committed',receipt:result.receipt});if(result.spoken)emit(result.spoken);}
 else invalid('Unknown JSON operation');
}
function demoConfig():WorldLocalConfig{return {scope:{tenant_id:'demo',workspace_id:'demo',workspace_tenant_id:'demo:homebrew:demo',campaign_id:'tempting_fates',world_id:'offline_demo',branch_id:'main',rights_lane:'homebrew'},authority_key_id:'demo_key',referee_id:'referee',npc_controller_id:'npc_host',variant:'legend',hp_mode:'floor4',environment:'night',starting_kit:'borrowed_lamp',initial_knowledge_ids:['melia_lamp_loan_offer'],travelers:[{id:'hero',name:'The visitor',controller_id:'auth_hero',weapon:'spear',nature:{description:'Practical, wary and curious.',priorities:['return borrowed things']},presentation:{occupation:'Traveler',wants:'Find a safe route.',will_not:'Accept a hidden debt.'},max_speech_characters:1024}]};}
function ensure(value:unknown,message:string):asserts value{if(!value)fail('CORRUPT_LEDGER',message);}
async function demo(input:string,emit:Emit):Promise<void>{
 const {dir,genesis,ledger}=await initialize(input,demoConfig(),'ab'.repeat(32));let active:WorldLedger=ledger;
 try{
  emit({type:'demo_started',offline:true,provider:'injected_response_fixture'});
  const hero=createWorldSession({genesis,ledger,principal:localPrincipal(genesis,'hero')}),melia=createWorldSession({genesis,ledger,principal:localPrincipal(genesis,'melia')});
  const original=await ledger.snapshot();const lamp=(await hero.view(await hero.query())).physical.items.find(item=>item.tool==='lamp');ensure(!lamp,'Borrowed kit unexpectedly has a lamp');
  const withoutLamp=await hero.prepare({type:'mortal',action:{type:'travel',route_id:'r_harbor_market'}},'no_lamp');
  let refused=false;try{await hero.submit(withoutLamp);}catch(error){if(!(error instanceof ArgoError))throw error;refused=true;}
  ensure(refused&&canonical(await ledger.snapshot())===canonical(original),'Unlit travel must refuse without changes');
  const question=await hero.prepare({type:'speak',text:'May I borrow your lamp? What would I owe, and when should I return it?',audience:{kind:'whisper',addressed_actor_ids:['melia']},in_reply_to:null},'ask_melia');
  const questionReceipt=await hero.submit(question),context=await melia.view(await melia.query()),inbound=context.memories.find(row=>row.sequence===questionReceipt.cursor.sequence)!;
  let captured:unknown;
  const agent=createWorldModelAgent({scope:genesis.mortal.scope,actorId:'melia',sessionId:'explicit_offline_demo',candidates:[{vendor:'xai',model:'grok-4.7',pool:'injected_offline'}],refreshContext:async query=>melia.view(query),clientFor:()=>({responses:{create:async(request:unknown)=>{
   captured=request;return {id:'offline_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text:'No fee or deposit. Bring it back on your next harbor return; supply your own oil. We agree actual damage up to five obols. No service or oath.'})}]}]};
  }}})});
  const proposal=await agent.respond(context.query,inbound.record_id,'melia_reply',{communicationGoal:'Explain your own loan terms without pressure.'});ensure(proposal&&captured,'Offline model fixture must produce a proposal');
  const capturedText=canonical(captured);for(const term of ['melia_lamp_loan_offer','actual_damage_by_explicit_agreement','May I borrow'])ensure(capturedText.includes(term),'Model request omitted required context');
  await privateWrite(join(dir,'model-request.json'),captured);
  const delivered=await submitForDisplay(melia,proposal);ensure(delivered.spoken,'Accepted reply must be visible');emit({type:'committed',receipt:delivered.receipt});emit(delivered.spoken);
  const talked=await ledger.snapshot();ensure(talked.loans.length===0&&talked.offers.length===0&&canonical(talked.physical)===canonical(original.physical),'Words alone must not transfer custody, resources or create a loan');
  await melia.submit(await melia.prepare({type:'offer_loan',offer_id:'demo_lamp_loan',policy_id:'melia_lamp_loan_offer',item_id:'traveler_lamp',borrower_actor_id:'hero',return_location_id:'l_harbor',repair_cap_obols:5,expires_at:3600},'offer_lamp'));
  const offerView=await hero.view(await hero.query()),offered=offerView.memories.find(row=>row.payload.type==='loan_offered');ensure(offered?.payload.type==='loan_offered','Borrower must acquire explicit offer terms');
  const acceptance=await hero.prepare({type:'accept_loan',offer_id:offered.payload.terms.offer_id,offer_hash:offered.payload.offer_hash},'accept_lamp');
  const accepted=await hero.submit(acceptance),afterAccept=await ledger.snapshot();ensure(afterAccept.loans.length===1&&afterAccept.physical.items.find(item=>item.id==='traveler_lamp')?.owner_id==='hero','Acceptance must atomically bind custody and loan');
  const oil=afterAccept.physical.actors.find(a=>a.id==='hero')!.resources.oil,start=afterAccept.cursor.world_time;
  for(const [request,route] of [['outbound','r_harbor_market'],['homebound','r_harbor_market']])await hero.submit(await hero.prepare({type:'mortal',action:{type:'travel',route_id:route!}},request!));
  await hero.submit(await hero.prepare({type:'return_loan',loan_id:'demo_lamp_loan'},'return_lamp'));
  ensure(canonical(await hero.submit(acceptance))===canonical(accepted),'Exact retry receipt changed');
  const final=await ledger.snapshot();ensure(final.loans[0]?.status==='returned'&&final.physical.items.find(item=>item.id==='traveler_lamp')?.owner_id==='melia','Lamp return must fulfill loan');
  const events=await ledger.events();ensure(canonical(replayWorld(genesis,events))===canonical(final),'Signed replay differs');await ledger.close();
  const reopened=await resume(dir,final.cursor);active=reopened.ledger;ensure(canonical(await active.snapshot())===canonical(final),'Restart differs');
  emit({type:'demo_complete',offline:true,no_loan_from_conversation:true,loan_returned:true,replayed:true,events:events.length,cursor:final.cursor,oil_spent:oil-final.physical.actors.find(a=>a.id==='hero')!.resources.oil,elapsed_seconds:final.cursor.world_time-start});
 }finally{await active.close();}
}

export async function main(args=process.argv.slice(2),input:AsyncIterable<Uint8Array|string>=process.stdin,emit:Emit=row=>{process.stdout.write(JSON.stringify(row)+'\n');}):Promise<number>{
 process.umask(0o077);const flags=argumentsFor(args);
 if(flags.mode==='demo'){await demo(flags.dir,emit);return 0;}
 if(flags.mode==='init'){
  const file=await open(flags.config!,'r');let text:string;try{if((await file.stat()).size>limit)invalid('Configuration exceeds one MiB');text=await file.readFile('utf8');}finally{await file.close();}
  const config:unknown=JSON.parse(text);assertWorldData(config);const fresh=await initialize(flags.dir,config as WorldLocalConfig);
  try{emit({type:'initialized',genesis_hash:hash(fresh.genesis),cursor:(await fresh.ledger.snapshot()).cursor});}finally{await fresh.ledger.close();}return 0;
 }
 const saved=await resume(flags.dir);let failed=false;
 try{
  const session=createWorldSession({genesis:saved.genesis,ledger:saved.ledger,principal:localPrincipal(saved.genesis,flags.actor)});
  for await(const line of lines(input)){if(!line.trim())continue;try{await operate(session,JSON.parse(line),emit);}catch(error){failed=true;emit(errorRow(error));}}
 }finally{await saved.ledger.close();}
 return failed?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=await main();}catch(error){process.stdout.write(JSON.stringify(errorRow(error))+'\n');process.exitCode=1;}
}
