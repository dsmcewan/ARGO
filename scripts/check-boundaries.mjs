import ts from 'typescript';import {readFile,readdir} from 'node:fs/promises';import {resolve,dirname,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..'),packages=new Map();
for(const group of ['packages','scenarios'])for(const name of await readdir(resolve(root,group))){
 const directory=resolve(root,group,name);try{const manifest=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));packages.set(directory,manifest);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
}
async function walk(directory){const paths=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(['node_modules','tests'].includes(entry.name))continue;const path=resolve(directory,entry.name);if(entry.isDirectory())paths.push(...await walk(path));else if(/\.(ts|mjs)$/.test(entry.name)&&!entry.name.endsWith('.d.mts'))paths.push(path);}return paths;}
let count=0;
for(const [directory,manifest] of packages)for(const file of await walk(directory)){
 const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 const specifiers=[];function visit(node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))specifiers.push(node.moduleSpecifier.text);ts.forEachChild(node,visit);}visit(source);
 for(const name of specifiers){
  if(name.startsWith('node:'))continue;
  if(name.startsWith('.')){
   const target=resolve(dirname(file),name),owner=[...packages.keys()].find(p=>target.startsWith(p+'/'));
   if(owner===directory)continue;
   if(owner){const dependency=packages.get(owner).name;if(!Object.hasOwn(manifest.dependencies??{},dependency))throw Error(`${file}: undeclared workspace dependency ${dependency}`);continue;}
   if(manifest.name==='@argo/contracts'&&target.startsWith(resolve(root,'SYSTEMS')+'/'))continue;
   throw Error(`${file}: import escapes declared workspace boundary: ${name}`);
  }
  const dependency=name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0];
  if(!Object.hasOwn(manifest.dependencies??{},dependency))throw Error(`${file}: undeclared dependency ${dependency}`);
 }
 count++;
}
console.log(`Workspace import boundaries: ${count} source modules checked.`);
