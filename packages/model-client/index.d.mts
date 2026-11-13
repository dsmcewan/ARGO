export type Vendor='anthropic'|'agy_google'|'openai'|'xai';
export type OpaqueItem=Record<string,unknown>;
export interface TurnOptions {client:unknown;vendor:Vendor;model:string;prompt:string;history?:OpaqueItem[];extra?:OpaqueItem;scope?:OpaqueItem;sessionId?:string;effort?:string;architecture?:boolean;contractHeader?:string;signal?:AbortSignal;deadline?:number;continuity?:'replay'|'server';previousResponseId?:string;compactAfterBytes?:number;countTokens?:(request:OpaqueItem)=>Promise<number>;onEvent?:(event:OpaqueItem)=>void}
export interface TurnResult {vendor:Vendor;response_id:string|null;text:string;tools:string[];complete:boolean;usable_for_resume:boolean;why_unusable:string|null;history?:OpaqueItem[];compacted:boolean;resumed:boolean;streamed:boolean;usage:unknown}
export function sendModelTurn(options:TurnOptions):Promise<TurnResult>;
export interface Candidate {vendor:Vendor;model:string;pool:string;poolConfig?:unknown}
export interface Cooldown {get(pool:string):Promise<{until:number;reason:string}|null>;success(pool:string):Promise<void>;refuse(pool:string,value:{until:number;reason:string}):Promise<void>}
export function routeCall<T,S extends Candidate=Candidate>(options:{candidates:S[];invoke:(seat:S,options:{signal:AbortSignal;attempt:number})=>Promise<T>;signal?:AbortSignal;deadline?:number;cooldown?:Cooldown;maxAttempts?:number}):Promise<{value:T;seat:S;attempts:OpaqueItem[]}>;
export function boundedCall<T>(fn:(signal:AbortSignal)=>Promise<T>,options?:{signal?:AbortSignal;deadline?:number}):Promise<T>;
export function openCooldownStore(directory:string):Cooldown;
export function modelId(vendor:string,name:string):string;
export function isFrontier(model:string):boolean;
export function cacheKey(options:{scope:OpaqueItem;sessionId:string;vendor:string;model:string}):string;
export const models:Record<string,Record<string,string>>;
export const CAPABILITIES:Readonly<Record<string,{vendor:Vendor;surface:string;window:number;output:number|null;efforts:string[];compaction?:boolean;inputCeiling?:number;combined?:boolean}>>;
export function providerFetch(fetchImpl?:typeof fetch):typeof fetch;
