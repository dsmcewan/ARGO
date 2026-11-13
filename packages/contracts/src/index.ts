import {createHash} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import schema from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import type {ContractMap,Scope,Error as ContractError} from './generated.ts';
export type * from './generated.ts';

export class ArgoError extends Error {
 readonly code:ContractError['code'];
 constructor(code:ContractError['code'],message:string){super(message);this.name='ArgoError';this.code=code;}
 toJSON():ContractError{return {schema_version:'1.0.0',code:this.code,retryable:['CONFLICT','UNAVAILABLE'].includes(this.code),message:this.message.slice(0,1024)};}
}
export function fail(code:ContractError['code'],message:string):never{throw new ArgoError(code,message);}
export function canonical(value:unknown):string{
 const active=new Set<object>();
 const visit=(v:unknown):string=>{
  if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))fail('INVALID_CONTRACT','Canonical numbers must be safe integers');return String(v);}
  if(typeof v!=='object')fail('INVALID_CONTRACT','Unsupported canonical value');
  if(active.has(v))fail('INVALID_CONTRACT','Canonical cycle');active.add(v);
  try{
   if(Reflect.ownKeys(v).some(k=>typeof k==='symbol'))fail('INVALID_CONTRACT','Canonical symbols are forbidden');
   if(Array.isArray(v)){
    const descriptors=Object.getOwnPropertyDescriptors(v);
    if(Object.keys(descriptors).length!==v.length+1)fail('INVALID_CONTRACT','Sparse or decorated arrays are forbidden');
    return '['+Array.from({length:v.length},(_,i)=>{
     const d=descriptors[String(i)];
     if(!d||!d.enumerable||!('value' in d))fail('INVALID_CONTRACT','Unsafe canonical array entry');
     return visit(d.value);
    }).join(',')+']';
   }
   if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)fail('INVALID_CONTRACT','Only plain canonical objects are allowed');
   const descriptors=Object.getOwnPropertyDescriptors(v);
   return '{'+Object.keys(descriptors).sort().map(k=>{
    const d=descriptors[k]!;
    if(['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!('value' in d))fail('INVALID_CONTRACT','Unsafe canonical property');
    return JSON.stringify(k)+':'+visit(d.value);
   }).join(',')+'}';
  }finally{active.delete(v);}
 };
 return visit(value);
}
export const hash=(value:unknown):string=>createHash('sha256').update(canonical(value),'utf8').digest('hex');
const ajv=new Ajv2020({allErrors:true,strict:true});ajv.addSchema(schema);
const validators=Object.fromEntries(Object.keys(schema.$defs).map(name=>[name,ajv.compile({$ref:`${schema.$id}#/$defs/${name}`})]));
export function assertContract<K extends keyof ContractMap>(name:K,value:unknown):asserts value is ContractMap[K]{
 canonical(value);
 const validate=validators[name];if(!validate||!validate(value))fail('INVALID_CONTRACT',`Invalid ${name} contract`);
}
export function assertScope(scope:Scope):void{
 assertContract('Scope',scope);
 if(scope.workspace_tenant_id!==`${scope.tenant_id}:${scope.rights_lane}:${scope.workspace_id}`)fail('SCOPE_DENIED','Invalid rights workspace scope');
}
export function sameScope(a:Scope,b:Scope):boolean{assertScope(a);assertScope(b);return canonical(a)===canonical(b);}
export function requireScope(a:Scope,b:Scope):void{if(!sameScope(a,b))fail('SCOPE_DENIED','Scope does not match authorized workspace');}
export function safeAdd(a:number,b:number):number{const value=a+b;if(!Number.isSafeInteger(value)||value<0)fail('INVALID_ACTION','Integer overflow or underflow');return value;}
export const schemaDefinition=schema;
export {serviceCall,freezeDto} from './transport.ts';
export type {ServiceOptions} from './transport.ts';
export function own<T>(record:Record<string,T>,key:string):T|undefined{return Object.hasOwn(record,key)?record[key]:undefined;}
export function assertKnowledgeDisclosure(value:unknown):asserts value is ContractMap['KnowledgeView']{
 assertContract('KnowledgeView',value);assertScope(value.scope);
 if(value.audience==='actor'&&value.party_id!==null||value.audience==='party'&&value.party_id===null)fail('INVALID_CONTRACT','Invalid knowledge audience');
 for(const claim of value.claims)if(claim.acquired_at>value.as_of_world_time||claim.sequence>value.as_of_sequence||!claim.observation.observers.includes(value.actor_id)||(value.audience==='party'&&claim.observation.party_id!==value.party_id))fail('INVALID_CONTRACT','Knowledge disclosure exceeds actor, party or time boundary');
}

// Additive, opt-in local projection profile; gameplay v1 remains unchanged.
export {projectionSchema,assertProjectionContract,validateActorQuery,validateCanonicalQuery,buildActorView,selectCanonicalRelations,adaptV1KnowledgeQuery,encodeIdEntries} from './projection-v2.ts';
export type {ProjectionReadContext} from './projection-v2.ts';
export type * from './projection-generated.ts';

// Additive private character-memory profile; no frozen gameplay reinterpretation.
export {CHARACTER_PROFILE,CHARACTER_CLAIM_PREFIX,characterSchema,assertCharacterContract,assertCharacterPrincipal,characterRequestHash,characterProposalId} from './characters.ts';
export type * from './character-types.ts';
