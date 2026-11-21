// Explicit offline fixtures for composing the real native consumers. No test registration.
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { modelId } from '../../packages/model-client/index.mjs';
import { brokerCommand, requestHash } from './transport.mjs';
export const TESTING_METADATA = Object.freeze({ transport: 'offline-fixture', production_qualified: false });

const taskTemplate = JSON.parse(readFileSync(new URL('../contracts/fixtures/task.valid.json', import.meta.url)));
export const ALL = { requests: 100, input_tokens: 1000000, output_tokens: 1000000, spend_microusd: 10000 };
const source = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const selections = {
  anthropic: [modelId('anthropic','fable')],
  openai: [modelId('openai','astra'),modelId('openai','sol-6.1'),modelId('openai','luna')],
  xai: [modelId('xai','grok-4.3'),modelId('xai','grok-4.7')],
  agy_google: [modelId('google','carbon'),modelId('google','argon')],
};
const promptOf = request => typeof request.input === 'string' ? request.input
  : request.input?.at(-1)?.content ?? request.messages?.at(-1)?.content ?? request.contents?.at(-1)?.parts?.map(p=>p.text??'').join('') ?? '';

export function fixtureRoutes(calls, behavior = {}) {
  return Object.entries(selections).map(([vendor, ids]) => ({ vendor, pool: vendor, principalId: `${vendor}-operator`, credentialRef: `${vendor}-reference`, models: ids, sourceSha256: source,
    estimate: ({method}) => ({requests:1,input_tokens:10000,output_tokens:method.endsWith('.count')?0:1000,spend_microusd:10}),
    measure: () => ({requests:1,input_tokens:10,output_tokens:10,spend_microusd:1}),
    invoke: async ({method, request, operation, signal}) => {
      calls.push({vendor, method, model:request.model, prompt:promptOf(request), operation});
      await behavior.before?.({vendor,method,request,signal});
      if (method.endsWith('.count')) return vendor==='agy_google'?{totalTokens:100}:{input_tokens:100};
      const prompt = promptOf(request);
      const text = /VERDICT/i.test(prompt) ? 'Verified synthetic fixture.\nVERDICT: approve'
        : /TITLE:/i.test(prompt) ? 'TITLE: build requested artifact'
        : /RAN: nothing/i.test(prompt) ? 'Synthetic scout.\nRAN: nothing'
        : `export const value = ${/second/.test(prompt)?2:1};\n`;
      const usage={input_tokens:10,output_tokens:10};
      return {async *[Symbol.asyncIterator]() {
        if(vendor==='anthropic') {
          yield {type:'message_start',message:{usage}};
          yield {type:'content_block_start',index:0,content_block:{type:'text',text:''}};
          yield {type:'content_block_delta',index:0,delta:{type:'text_delta',text}};
          yield {type:'message_delta',delta:{stop_reason:'end_turn'},usage};
          yield {type:'message_stop'};
        } else if(vendor==='agy_google') {
          yield {candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}};
        } else {
          yield {type:'response.output_text.delta',delta:text};
          yield {type:'response.completed',response:{id:`fixture-${requestHash(request).slice(0,20)}`,status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage}};
        }
      }};
    },
  })).map(route => ({...route,measure:({method})=>({requests:1,input_tokens:10,output_tokens:method.endsWith('.count')?0:10,spend_microusd:1})}));
}
export function setup(t, limits = ALL) {
  const dir = mkdtempSync(path.join(tmpdir(),'argo-pantheon-admitted-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const config = {schema_version:1,global:{lifetime:limits,windows:[]},pools:Object.fromEntries(Object.entries(selections).map(([vendor,ids])=>[vendor,{credential_ref:`${vendor}-reference`,models:ids,lifetime:ALL,windows:[]}]))};
  const configPath=path.join(dir,'config.json');writeFileSync(configPath,JSON.stringify(config));
  const broker={database:path.join(dir,'broker.sqlite'),config:configPath};
  broker.databaseId=brokerCommand(broker,'initialize').database_id;
  function execution(name='first') {
    const repo=path.join(dir,name);mkdirSync(repo,{recursive:true});
    const spec={key:name,repo_root:repo,title:`${name} artifact`,goal:`Build ${name} artifact`,question:'What should be checked?',copy:[],acceptance_cmd:'node --check artifact.mjs',slot:'code',path:'artifact.mjs'};
    const task=structuredClone(taskTemplate);task.identity.ticket_id=name;task.identity.idempotency_key=`operation-${name}`;
    task.author={principal_id:'openai-operator',vendor:'openai'};
    task.publication={required:false,remote_repo:null,remote_ref:null,expected_prior_oid:null,policy_sha:null};
    return {spec,task,expectedExecutionSpecSha:requestHash(spec),boardDir:path.join(dir,`${name}-board`),broker,owner:`worker-${name}`,timeoutMs:2000};
  }
  return {dir,broker,execution,snapshot:()=>brokerCommand(broker,'snapshot')};
}
