import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {createPrivateKey} from 'node:crypto';
import {openLedger} from '../packages/ledger/src/index.ts';
const directory=process.argv[2]!;const config=JSON.parse(await readFile(join(directory,'worker.json'),'utf8'));
config.proposal.proposal_id += '_'+process.argv[3];
const ledger=await openLedger({directory,genesis:config.genesis,privateKey:createPrivateKey(config.privateKey)});
process.send?.('ready');
process.once('message',async()=>{try{await ledger.submit(config.proposal,config.principal);process.send?.('committed');}catch(error){process.send?.(error instanceof Error?error.message:'failed');}finally{process.disconnect();}});
