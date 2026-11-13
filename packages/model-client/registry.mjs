import models from './models.json' with {type:'json'};
export {models};
export const modelId=(vendor,name)=>{
  const id=models[vendor]?.[name];
  if(!id) throw new Error(`Unknown model alias ${vendor}/${name}`);
  return id;
};
export const CAPABILITIES=Object.freeze({
  [modelId('anthropic','fable')]:{vendor:'anthropic',surface:'messages',window:1000000,output:128000,efforts:['low','medium','high','xhigh','max'],compaction:true},
  [modelId('google','carbon')]:{vendor:'agy_google',surface:'genai',window:1048576,output:262144,efforts:['low','medium','high'],combined:true},
  [modelId('google','argon')]:{vendor:'agy_google',surface:'genai',window:1048576,output:262144,efforts:['low','medium','high'],combined:true},
  [modelId('openai','astra')]:{vendor:'openai',surface:'responses',window:1050000,output:128000,efforts:['low','medium','high','xhigh','max','ultra'],inputCeiling:250000},
  [modelId('xai','grok-4.3')]:{vendor:'xai',surface:'responses',window:1000000,output:null,efforts:['low','high']},
  [modelId('xai','grok-4.7')]:{vendor:'xai',surface:'responses',window:500000,output:null,efforts:['low','high']},
});
export const isFrontier=model=>Object.hasOwn(CAPABILITIES,model);
