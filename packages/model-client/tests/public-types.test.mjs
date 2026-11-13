import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as runtime from '../index.mjs';

test('strict consumers can use every public root export and request/router subpaths',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'argo-model-types-'));
  try{
    const modules=join(directory,'node_modules/@argo');await mkdir(modules,{recursive:true});
    await symlink(fileURLToPath(new URL('..',import.meta.url)),join(modules,'model-client'),'dir');
    const file=join(directory,'consumer.mts');
    await writeFile(file,`
      import * as model from '@argo/model-client';
      import {prepareRequest, checkBudget, compactConversation, cacheKey, COMPACTION_BETA} from '@argo/model-client/request';
      import {routeCall, boundedCall, classifyFailure} from '@argo/model-client/router';
      ${Object.keys(runtime).map(name=>`void model.${name};`).join('\n')}
      const prepared = prepareRequest({vendor:'openai',model:'gpt-6-astra',prompt:'fixture'});
      const count: Promise<number|null> = checkBudget(prepared,async request => { const body: unknown = request; return 10; });
      const history: Promise<Record<string,unknown>[]> = compactConversation({client:{},model:'claude-fable-5-2',history:[]});
      const key: string = cacheKey({scope:{tenant:'fixture'},sessionId:'s',vendor:'openai',model:'gpt-6-astra'});
      const beta: string = COMPACTION_BETA;
      const failure: {retryable:boolean;retryMs:number|null;quota:boolean} = classifyFailure({status:429});
      const bounded: Promise<number> = boundedCall(async signal => { signal.throwIfAborted(); return 1; });
      const routed = await routeCall({candidates:[{vendor:'xai',model:'grok-4.7',pool:'p',label:'kept'}],invoke:async (seat,{signal,attempt}) => seat.label.length + attempt});
      const value: number = routed.value;
      const retained: string = routed.seat.label;
      // @ts-expect-error Unknown provider is rejected by the public request contract.
      prepareRequest({vendor:'unknown',model:'x',prompt:'fixture'});
      // @ts-expect-error Token counters must return numbers.
      checkBudget(prepared,async () => '10');
      // @ts-expect-error Router result retains the invoke result type.
      const wrong: string = routed.value;
    `);
    const program=ts.createProgram([file],{strict:true,noEmit:true,exactOptionalPropertyTypes:true,
      module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2024});
    const diagnostics=ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{
      getCanonicalFileName:file=>file,getCurrentDirectory:()=>directory,getNewLine:()=> '\n',
    }));
    const checker=program.getTypeChecker();
    const module=checker.getSymbolAtLocation(program.getSourceFile(file).statements[0].moduleSpecifier);
    const declared=checker.getExportsOfModule(module).filter(symbol=>symbol.flags&ts.SymbolFlags.Value).map(symbol=>symbol.name);
    assert.deepEqual(declared.sort(),Object.keys(runtime).sort(),'public declarations and runtime values must match in both directions');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('existing Node require consumers can still load the public request and router subpaths',()=>{
  const require=createRequire(import.meta.url);
  assert.equal(require('@argo/model-client/request').prepareRequest,runtime.prepareRequest);
  assert.equal(require('@argo/model-client/router').routeCall,runtime.routeCall);
});
