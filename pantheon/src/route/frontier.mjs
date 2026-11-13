import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {modelId,models,isFrontier} from '../../../packages/model-client/index.mjs';

const seats={
  planner:[['anthropic','fable'],['google','carbon'],['openai','astra']],
  implementer:[['openai','astra'],['anthropic','fable'],['google','carbon']],
  scout:[['xai','grok-4.3']],reviewer:[['xai','grok-4.7'],['google','carbon']],
  synthesis:[['google','carbon']],fast_loop:[['google','argon']],
};

export function readPools({rows,env=process.env}={}){
  rows??=env.PANTHEON_POOLS_FILE?JSON.parse(readFileSync(env.PANTHEON_POOLS_FILE,'utf8')):[];
  if(!Array.isArray(rows))throw new Error('Pool configuration must be an array');
  const ids=new Set(),credentials=new Set();
  return rows.map(row=>{
    if(!/^[A-Za-z0-9_-]+$/.test(row.id??'')||ids.has(row.id)||!['anthropic','openai','xai','agy_google'].includes(row.vendor)||
      !['oauth','key'].includes(row.auth)||!/^[A-Z][A-Z0-9_]*$/.test(row.credential_env??''))throw new Error('Invalid or duplicate pool configuration');
    if(row.auth==='oauth'&&row.vendor!=='anthropic')throw new Error('This API transport supports configured OAuth only for Anthropic');
    const credential=env[row.credential_env];
    if(!credential)throw new Error(`Missing credential environment binding for pool ${row.id}`);
    const fingerprint=createHash('sha256').update(credential).digest('hex');
    if(credentials.has(fingerprint))throw new Error('Two pool IDs use the same credential');
    ids.add(row.id);credentials.add(fingerprint);
    return {id:row.id,vendor:row.vendor,auth:row.auth,credential_env:row.credential_env};
  });
}

export function frontierCandidates(role,{pools=[],avoid=[],pin}={}){
  let choices=(seats[role]??[]).map(([vendor,name])=>({vendor:vendor==='google'?'agy_google':vendor,model:modelId(vendor,name)}));
  if(pin){
    const found=Object.entries(models).find(([,names])=>Object.values(names).includes(pin));
    if(!found)throw new Error('Pinned model is not in the model registry');
    const vendor=found[0]==='google'?'agy_google':found[0];
    choices=[{vendor,model:pin},...choices.filter(c=>c.model!==pin)];
  }
  return choices.filter(c=>!avoid.includes(c.vendor)).flatMap(c=>{
    const configured=pools.filter(p=>p.vendor===c.vendor);
    return (configured.length?configured:[{id:c.vendor,vendor:c.vendor}]).map(pool=>({...c,pool:pool.id,
      poolConfig:pool.credential_env?pool:null,transport:isFrontier(c.model)||c.vendor!=='agy_google'?'api':'cli',
      basis:'OPERATOR',band:'hard',why:'ARGO November model policy'}));
  }).map((c,rank)=>({...c,rank}));
}
