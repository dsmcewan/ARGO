import {ArgoError,fail} from './index.ts';
export interface ServiceOptions {signal?:AbortSignal}
export async function serviceCall<T>(invoke:(signal:AbortSignal)=>Promise<T>,timeoutMs:number,options:ServiceOptions={}):Promise<T>{
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)fail('INVALID_CONTRACT','Invalid service deadline');
 if(options.signal?.aborted)fail('CANCELLED','Service call cancelled');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let rejectStop:(error:ArgoError)=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
 const stop=(code:'CANCELLED'|'UNAVAILABLE',message:string)=>{controller.abort();rejectStop(new ArgoError(code,message));};
 const abort=()=>stop('CANCELLED','Service call cancelled');options.signal?.addEventListener('abort',abort,{once:true});
 timer=setTimeout(()=>stop('UNAVAILABLE','Service deadline exceeded; a submitted mutation may have committed'),timeoutMs);
 try{return await Promise.race([Promise.resolve().then(()=>invoke(controller.signal)),stopped]);}
 catch(error){if(error instanceof ArgoError)throw error;return fail('UNAVAILABLE','Service transport unavailable');}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
export function freezeDto<T>(value:T):T{
 if(value&&typeof value==='object'){for(const child of Object.values(value))freezeDto(child);Object.freeze(value);}return value;
}
