import {lstat,readdir,readFile} from 'node:fs/promises';import {resolve,join,sep} from 'node:path';import {createHash} from 'node:crypto';
async function manifest(root:string,path:string):Promise<string>{
 const parts=path.split('/');if(parts.some(part=>!part||part==='.'||part==='..'))throw Error('Invalid policy path');
 let current=resolve(root);
 for(const part of parts){current=join(current,part);const st=await lstat(current);if(st.isSymbolicLink())throw Error('Candidate policy path has a symbolic link ancestor');}
 const records:string[]=[];
 async function walk(absolute:string,relative:string):Promise<void>{
  const st=await lstat(absolute);if(st.isSymbolicLink())throw Error('Symbolic links cannot replace protected policy');
  if(st.isDirectory()){for(const name of (await readdir(absolute)).sort())await walk(join(absolute,name),relative+'/'+name);}
  else if(st.isFile())records.push(relative+'\0'+(st.mode&0o111)+'\0'+createHash('sha256').update(await readFile(absolute)).digest('hex'));
  else throw Error('Unsupported policy file type');
 }
 await walk(current,path);return records.join('\n');
}
export async function assertCandidatePolicy(candidate:string,trusted:string,paths:readonly string[]):Promise<void>{
 for(const path of paths)if(await manifest(candidate,path)!==await manifest(trusted,path))throw Error(`Candidate protected policy differs: ${path}`);
}

// git archive honors export-ignore/export-subst. Compare its output with immutable raw tree
// identities before any dependency install or candidate execution can change the staging tree.
export async function assertExactGitTree(root:string,listing:Buffer):Promise<void>{
 const entries=new Map<string,{mode:string;oid:string}>(),directories=new Set<string>();
 const records=new TextDecoder('utf-8',{fatal:true}).decode(listing).split('\0');
 if(records.pop()!=='')throw Error('Invalid NUL-terminated Git tree listing');
 for(const record of records){
  const tab=record.indexOf('\t'),header=record.slice(0,tab),path=record.slice(tab+1);
  const match=/^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(header);
  if(tab<0||!match)throw Error('Unsupported Git tree mode or type');
  const [,mode,type,oid]=match;
  if(mode==='160000'||type!=='blob')throw Error('Submodules are unsupported in controller staging');
  const parts=path.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||part==='.git')||entries.has(path))throw Error('Invalid or duplicate Git tree path');
  entries.set(path,{mode:mode!,oid:oid!});
  for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));
 }
 const base=resolve(root),visited=new Set<string>();
 if(!(await lstat(base)).isDirectory())throw Error('Staging root must be a directory');
 async function walk(directory:string,prefix=''):Promise<void>{
  for(const name of await readdir(directory)){
   const path=prefix?prefix+'/'+name:name,absolute=join(directory,name),st=await lstat(absolute);
   if(st.isDirectory()){
    if(!directories.has(path))throw Error(`Unexpected extracted Git tree directory: ${path}`);
    await walk(absolute,path);continue;
   }
   const expected=entries.get(path);
   if(!expected||visited.has(path))throw Error(`Unexpected extracted Git tree path: ${path}`);
   const mode=st.isSymbolicLink()?'120000':st.isFile()?(st.mode&0o100?'100755':'100644'):null;
   if(mode!==expected.mode)throw Error(`Extracted Git tree mode differs: ${path}`);
   const bytes=st.isSymbolicLink()?await readlink(absolute,{encoding:'buffer'}):await readFile(absolute);
   const oid=createHash(expected.oid.length===40?'sha1':'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
   if(oid!==expected.oid)throw Error(`Extracted Git tree blob bytes differ: ${path}`);
   visited.add(path);
  }
 }
 await walk(base);
 for(const path of entries.keys())if(!visited.has(path))throw Error(`Missing extracted Git tree path: ${path}`);
}

import {readlink} from 'node:fs/promises';import {isAbsolute,dirname} from 'node:path';
export async function assertSafeStaging(root:string):Promise<void>{
 const base=resolve(root);
 async function walk(directory:string):Promise<void>{
  for(const name of await readdir(directory)){
   const path=join(directory,name),st=await lstat(path);
   if(st.isSymbolicLink()){
    const link=await readlink(path),target=resolve(dirname(path),link);
    if(isAbsolute(link)||!target.startsWith(base+sep))throw Error('Staging symlink escapes candidate');
    const to=await lstat(target);if(!to.isFile()||to.isSymbolicLink())throw Error('Staging permits only internal regular-file symlinks');
   }else if(st.isDirectory())await walk(path);else if(!st.isFile())throw Error('Unsupported staging entry');
  }
 }
 await walk(base);
}
