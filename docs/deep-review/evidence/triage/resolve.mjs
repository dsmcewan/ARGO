import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const root='/workspace/ARGO';
const map={contracts:'packages/contracts/src/index.ts',ledger:'packages/ledger/src/index.ts','lexi-bridge':'packages/lexi-bridge/src/index.ts','telos-bridge':'packages/telos-bridge/src/index.ts','argo-dm':'packages/argo-dm/src/index.ts',interventions:'packages/interventions/src/index.ts','model-client':'packages/model-client/index.mjs','tempted-fates':'scenarios/tempted-fates/index.ts'};
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier.startsWith('@argo/')&&map[specifier.slice(6)])return {url:pathToFileURL(`${root}/${map[specifier.slice(6)]}`).href,shortCircuit:true};
 if(specifier.startsWith('ajv/'))return {url:pathToFileURL(`/tmp/argo-review2-ledger-deps/node_modules/${specifier}`).href,shortCircuit:true};
 return nextResolve(specifier,context);
}});
