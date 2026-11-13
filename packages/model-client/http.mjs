// Preserve transport status/Retry-After before SDKs normalize errors and discard headers.
export function providerFetch(fetchImpl=globalThis.fetch){
 if(typeof fetchImpl!=='function')throw new Error('Fetch implementation required');
 return async(...args)=>{
  const response=await fetchImpl(...args);
  if(!response.ok){
   let body;try{body=await response.clone().json();}catch{body=null;}
   throw Object.assign(new Error(`Provider HTTP ${response.status}`),{status:response.status,
     headers:{'retry-after':response.headers.get('retry-after')},error:body});
  }
  return response;
 };
}
