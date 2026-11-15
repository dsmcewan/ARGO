import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import * as contracts from '../packages/contracts/src/index.ts';
import {characterScope,characterPrincipal,characterCursor,characterProfile,characterCommand,characterExperience,characterImpression,characterProjection,characterActorView,characterNarratorQuery,characterNarratorView,CHARACTER_VERSION} from './character-fixtures.ts';
const api=contracts as unknown as {assertCharacterContract?:(name:string,value:unknown)=>void;characterRequestHash?:(command:unknown,principal:unknown)=>string;characterProposalId?:(scope:unknown,id:string)=>string};
function check(name:string,value:unknown){assert.equal(typeof api.assertCharacterContract,'function','Character contract validator must be exported');api.assertCharacterContract!(name,value);}
function refuse(name:string,value:unknown){assert.throws(()=>check(name,value),(error:unknown)=>error instanceof contracts.ArgoError);}

test('character commands accept five bounded variants without authorizing caller-chosen speech identity',()=>{
 const common=characterCommand();
 for(const body of [{type:'configure',profile:characterProfile()},{type:'speak',text:'Hello.',addressed_actor_ids:[]},{type:'witness_action',record_id:'b'.repeat(64)},{type:'form_impression',subject_actor_id:'traveler',evidence_ids:['b'.repeat(64)],interpretation:'They kept their word.',previous_impression_id:null},{type:'set_activity',activity:{description:'Working',busy_until:20}}])check('CharacterCommand',{...common,body});
 for(const extra of [{actor_id:'clotho'},{source_id:'clotho'},{witnesses:{actor_ids:['outsider'],party_id:null}},{role:'system'}])refuse('CharacterCommand',{...common,body:{...common.body,...extra}});
 refuse('CharacterCommand',{...common,body:{...common.body,type:'reach_narrator'}});
});
test('character cursors reject inconsistent heads and noncanonical temporal integers',()=>{
 check('CharacterCursor',characterCursor(0));check('CharacterCursor',characterCursor(3));
 for(const cursor of [{sequence:0,head:'a'.repeat(64),world_time:10},{sequence:1,head:null,world_time:10},{sequence:1,head:'z'.repeat(64),world_time:10},{sequence:1,head:'a'.repeat(64),world_time:-1},{sequence:1.5,head:'a'.repeat(64),world_time:10},{sequence:1,head:'a'.repeat(64),world_time:-0}])refuse('CharacterCursor',cursor);
});
test('character scope identity and version are checked on nested public queries and envelopes',()=>{
 const command=characterCommand();
 refuse('CharacterCommand',{...command,scope:{...command.scope,workspace_tenant_id:'wrong'}});
 refuse('CharacterCommand',{...command,version:'1.0.0'});
 const view=characterNarratorView();view.query.scope.workspace_tenant_id='wrong';refuse('CharacterNarratorView',view);
 const envelope={version:CHARACTER_VERSION,scope:characterScope(),request_id:'request_1',request_hash:'d'.repeat(64),requester:{principal_id:'auth_traveler',actor_id:'traveler',role:'player'},body:{type:'speak',actor_id:'traveler',text:'Hello.',addressed_actor_ids:[],witnesses:{request_hash:'d'.repeat(64),actor_ids:['traveler'],party_id:null}}};
 check('CharacterEnvelope',envelope);refuse('CharacterEnvelope',{...envelope,scope:{...envelope.scope,world_id:''}});
 refuse('CharacterEnvelope',{...envelope,body:{...envelope.body,actor_id:'clotho'}});
 refuse('CharacterEnvelope',{...envelope,body:{...envelope.body,witnesses:{...envelope.body.witnesses,request_hash:'e'.repeat(64)}}});
});
test('character DTO preflight rejects active objects without invoking user getters or proxy traps',()=>{
 let touched=0;const accessor={...characterCommand()};Object.defineProperty(accessor,'request_id',{enumerable:true,get(){touched++;return 'request_1';}});refuse('CharacterCommand',accessor);
 refuse('CharacterCommand',new Proxy(characterCommand(),{getPrototypeOf(){touched++;return Object.prototype;}}));
 assert.equal(touched,0);
 const command=characterCommand();Object.defineProperty(command,Symbol('hidden'),{value:true});refuse('CharacterCommand',command);
 const circular:any=characterCommand();circular.body=circular;refuse('CharacterCommand',circular);
});
test('character text and array bounds reject empty identity, unbounded speech and duplicate evidence',()=>{
 const command=characterCommand();
 for(const body of [{...command.body,text:''},{...command.body,text:'x'.repeat(8193)},{...command.body,addressed_actor_ids:['witness','witness']},{type:'form_impression',subject_actor_id:'traveler',evidence_ids:[],interpretation:'x',previous_impression_id:null},{type:'form_impression',subject_actor_id:'traveler',evidence_ids:['b'.repeat(64),'b'.repeat(64)],interpretation:'x',previous_impression_id:null}])refuse('CharacterCommand',{...command,body});
 refuse('CharacterCommand',{...command,request_id:''});
 check('CharacterCommand',{...command,body:{...command.body,text:'x'.repeat(8192)}});
 refuse('CharacterProfile',{...characterProfile(),speech_policy:{max_characters:0,minimum_interval:0}});
 refuse('CharacterProfile',{...characterProfile(),revision:0});
 refuse('CharacterWitnessGrant',{request_hash:'d'.repeat(64),actor_ids:Array.from({length:65},(_,i)=>'actor_'+i),party_id:null});
});
test('character experience variants distinguish authenticated speech from committed action summaries',()=>{
 check('CharacterExperience',characterExperience());
 check('CharacterExperience',{...characterExperience(),kind:'action',action_type:'move_item',addressed_actor_ids:[]});
 refuse('CharacterExperience',{...characterExperience(),action_type:'move_item'});
 refuse('CharacterExperience',{...characterExperience(),kind:'action'});
 refuse('CharacterExperience',{...characterExperience(),kind:'action',action_type:'draw'});
 refuse('CharacterExperience',{...characterExperience(),principal_actor_id:'someone_else'});
 refuse('CharacterExperience',{...characterExperience(),witnesses:['outsider']});
});
test('character projection bounds every stored experience and acquisition to its authoritative cursor',()=>{
 check('CharacterProjection',characterProjection());
 const future=characterProjection();future.records[0]!.experience.sequence=4;refuse('CharacterProjection',future);
 const before=characterProjection();before.records[0]!.acquisitions[0]!.sequence=1;refuse('CharacterProjection',before);
 const unknown=characterProjection();unknown.records[0]!.acquisitions[0]!.actor_id='missing';refuse('CharacterProjection',unknown);
 const duplicate=characterProjection();duplicate.profiles.push(characterProfile());refuse('CharacterProjection',duplicate);
 const flags=characterProjection();flags.engagement_closed=true;refuse('CharacterProjection',flags);
});
test('character actor views bind impression ownership and profile to the queried actor',()=>{
 check('CharacterView',characterActorView());
 const wrong=characterActorView();wrong.impressions[0]!.data.owner_actor_id='traveler';refuse('CharacterView',wrong);
 const profile=characterActorView();profile.profile.actor_id='traveler';refuse('CharacterView',profile);
 const future=characterActorView();future.last_spoke_at=11;refuse('CharacterView',future);
 const many=characterActorView();many.experiences=Array.from({length:17},(_,i)=>({...characterExperience(),record_id:i.toString(16).padStart(64,'0')}));refuse('CharacterView',many);
});
test('character narrator queries reject private viewer substitution, invalid page bounds and party mismatch',()=>{
 check('CharacterNarratorQuery',characterNarratorQuery());
 for(const patch of [{actor_id:'outsider'},{party_id:'party'},{audience:'party',party_id:null},{limit:0},{limit:129},{after_sequence:4}])refuse('CharacterNarratorQuery',{...characterNarratorQuery(),...patch});
 check('CharacterNarratorQuery',{...characterNarratorQuery(),actor_id:'witness',audience:'party',party_id:'party'});
});
test('character narrator pages bind coverage and visible cursors without admitting observer metadata',()=>{
 check('CharacterNarratorView',characterNarratorView());
 const wrong=characterNarratorView();wrong.records[0]!.actor_id='other';refuse('CharacterNarratorView',wrong);
 const after=characterNarratorView();after.query.after_sequence=2;refuse('CharacterNarratorView',after);
 const cutoff=characterNarratorView();cutoff.ontology_blocked=true;refuse('CharacterNarratorView',cutoff);
 const coverage=characterNarratorView();coverage.coverage.through_sequence=2;refuse('CharacterNarratorView',coverage);
 const cursor=characterNarratorView();cursor.next_after_sequence=1;refuse('CharacterNarratorView',cursor);
 refuse('CharacterNarratorView',{...characterNarratorView(),impressions:[characterImpression()]});
});
test('character receipts bind event hash and cursor while preserving the exact command kind',()=>{
 const receipt={version:CHARACTER_VERSION,scope:characterScope(),request_id:'request_1',request_hash:'d'.repeat(64),event_id:'event_3',event_hash:'a'.repeat(64),cursor:characterCursor(),kind:'speak'};
 check('CharacterReceipt',receipt);
 refuse('CharacterReceipt',{...receipt,event_hash:'b'.repeat(64)});
 refuse('CharacterReceipt',{...receipt,event_id:'event_2'});
 refuse('CharacterReceipt',{...receipt,kind:'reach_narrator'});
});
test('character identity helpers bind scope, content and authenticated identity without receipt-list noise',()=>{
 assert.equal(typeof api.characterRequestHash,'function');assert.equal(typeof api.characterProposalId,'function');
 const command=characterCommand(),principal=characterPrincipal();
 const first=api.characterRequestHash!(command,principal);
 const expected=createHash('sha256').update(contracts.canonical({command,principal:{principal_id:'auth_traveler',actor_id:'traveler',role:'player',scope:characterScope()}})).digest('hex');
 assert.equal(first,expected);
 assert.equal(api.characterRequestHash!(command,{...principal,confirmed_receipts:['unused']}),first);
 assert.notEqual(api.characterRequestHash!({...command,body:{...command.body,text:'Different'}},principal),first);
 assert.notEqual(api.characterRequestHash!(command,{...principal,principal_id:'different'}),first);
 assert.throws(()=>api.characterRequestHash!(command,{...principal,scope:{...principal.scope,branch_id:'elsewhere'}}),contracts.ArgoError);
 const proposal=api.characterProposalId!(characterScope(),'request_speech');
 assert.match(proposal,/^argo_character_[a-f0-9]{64}$/);
 assert.notEqual(api.characterProposalId!({...characterScope(),branch_id:'elsewhere'},'request_speech'),proposal);
 assert.throws(()=>api.characterProposalId!(characterScope(),''),contracts.ArgoError);
});


test('character projection retains complete history beyond public page bounds',()=>{
 const projection=characterProjection();projection.cursor=characterCursor(4101);projection.impressions=[];
 projection.records=Array.from({length:4100},(_,index)=>({experience:{...characterExperience(index+2),record_id:(index+1).toString(16).padStart(64,'0')},acquisitions:[{actor_id:'traveler',sequence:index+2,world_time:10,party_id:null}]}));
 check('CharacterProjection',projection);
});
test('character profile schema is meta-valid, immutable and bound to the explicit local freeze',async()=>{
 const schema=contracts.characterSchema;
 const ajv=new Ajv2020({allErrors:true,strict:true});assert.equal(ajv.validateSchema(schema),true);
 assert.throws(()=>{(schema.$defs.CharacterSpeak.properties.text as {maxLength:number}).maxLength=100000;},TypeError);
 const freeze=JSON.parse(await readFile(new URL('../SYSTEMS/characters-v1/FREEZE.json',import.meta.url),'utf8')) as {profile_version:string;files:Record<string,string>};
 assert.equal(freeze.profile_version,CHARACTER_VERSION);
 assert.deepEqual(Object.keys(freeze.files).sort(),['SYSTEMS/characters-v1/API.md','SYSTEMS/characters-v1/CONTRACT.md','SYSTEMS/characters-v1/characters.schema.json']);
 for(const [path,digest] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),digest,path);
});

test('character principal validation rejects active authentication DTOs before detaching them',()=>{
 const candidate=contracts as unknown as {assertCharacterPrincipal?:(value:unknown)=>void};
 assert.equal(typeof candidate.assertCharacterPrincipal,'function');const validate=candidate.assertCharacterPrincipal!;
 validate(characterPrincipal());
 assert.throws(()=>validate({...characterPrincipal(),scope:{...characterScope(),workspace_tenant_id:'wrong'}}),contracts.ArgoError);
 let touched=0;const active={...characterPrincipal()};Object.defineProperty(active,'principal_id',{enumerable:true,get(){touched++;return 'auth_other';}});
 assert.throws(()=>validate(active),contracts.ArgoError);
 assert.throws(()=>validate(new Proxy(characterPrincipal(),{getPrototypeOf(){touched++;return Object.prototype;}})),contracts.ArgoError);
 assert.equal(touched,0);
});
