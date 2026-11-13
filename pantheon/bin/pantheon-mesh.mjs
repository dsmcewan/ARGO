#!/usr/bin/env node
// Explicit offline edge. Config files cannot silently switch on execution.
import {readFileSync,statSync} from 'node:fs';
import {runBlackboardMesh} from '../src/board/blackboard-mesh.mjs';
const usage='Usage: node pantheon/bin/pantheon-mesh.mjs --config config.json [--offline]\nDefault: dry-run. --offline enables confined local fixture commands only; no vendor calls.\n';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){process.stdout.write(usage);}
else{
 const controller=new AbortController();
 const cancel=()=>controller.abort(new Error('Mesh supervisor cancelled'));
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try{
  let configPath=null,offline=false;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--config'&&!configPath&&args[i+1])configPath=args[++i];
   else if(args[i]==='--offline'&&!offline)offline=true;
   else throw new Error(usage.trim());
  }
  if(!configPath)throw new Error(usage.trim());
  const stat=statSync(configPath);if(!stat.isFile()||stat.size>65536)throw new Error('Config must be a regular JSON file under 64 KiB');
  const bytes=readFileSync(configPath);if(bytes.length>65536)throw new Error('Config exceeds 64 KiB');
  const config=JSON.parse(bytes.toString('utf8'));
  if(config===null||typeof config!=='object'||Array.isArray(config))throw new Error('Config must be a JSON object');
  if(config.offline===true&&!offline)throw new Error('Execution requires the explicit --offline flag; config alone cannot enable it');
  if(config.offline!==undefined&&typeof config.offline!=='boolean')throw new Error('Config offline must be boolean');
  const result=await runBlackboardMesh({...config,offline,signal:controller.signal});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(error){process.stderr.write(`Mesh refused: ${String(error?.message??error).slice(0,4096)}\n`);process.exitCode=controller.signal.aborted?130:2;}
 finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
