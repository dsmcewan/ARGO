// Runs in the separately trusted controller before installation or candidate imports.
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';

async function researchSurface(root){
 const paths=[];
 async function walk(relative){
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
   const path=relative+'/'+entry.name;
   // Only documents and report data are mutable. In particular, additional Python,
   // bytecode, native extensions, packages and hidden import files are policy changes.
   if(entry.isFile()&&(path.endsWith('.md')||/^RESEARCH\/findings\/[a-z0-9_]+\.json$/.test(path)))continue;
   paths.push(path);
   if(entry.isDirectory())await walk(path);
  }
 }
 await walk('RESEARCH');return paths.sort();
}

export async function protectedPaths(trusted,candidate=trusted){
 const paths=['.npmrc','controller','scripts','TESTS','pantheon/tests','packages/model-client/tests',
  'SYSTEMS/CONTRACT_FREEZE.json','tsconfig.json','package.json','package-lock.json',
  'pantheon/package.json','pantheon/package-lock.json','.github/workflows/deterministic-gate.yml',
  'tools'];
 const surface=await researchSurface(trusted),otherSurface=await researchSurface(candidate);
 if(JSON.stringify(surface)!==JSON.stringify(otherSurface))throw Error('Candidate protected policy differs: RESEARCH import surface');
 // Pin files individually so mutable JSON/Markdown beneath the same directories can
 // change. The closed inventory above also prevents injected import directories.
 for(const path of surface){
  const parent=path.slice(0,path.lastIndexOf('/')),name=path.slice(path.lastIndexOf('/')+1);
  const entry=(await readdir(join(trusted,parent),{withFileTypes:true})).find(item=>item.name===name);
  if(!entry.isDirectory())paths.push(path);
 }
 // Workspace manifests control dependency resolution, exports and executable lookup.
 for(const directory of ['packages','scenarios']){
  const entries=await readdir(join(trusted,directory),{withFileTypes:true});
  const other=await readdir(join(candidate,directory),{withFileTypes:true});
  const names=items=>items.filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  if(JSON.stringify(names(entries))!==JSON.stringify(names(other)))throw Error(`Candidate protected policy differs: ${directory} workspace inventory`);
  for(const entry of entries)if(entry.isDirectory())paths.push(`${directory}/${entry.name}/package.json`);
 }
 return paths;
}
