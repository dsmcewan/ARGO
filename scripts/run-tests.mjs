// Only native child-test events count: output text and a zero exit are not proof.
// The trusted parent discovers test declarations without importing candidate modules.
import {run} from 'node:test';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const files=process.argv.slice(2).map(file=>resolve(file)),expected=new Map();
const location=(file,line,column)=>`${resolve(file)}:${line}:${column}`;
for(const file of files){
 const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 const names=new Set();
 for(const statement of source.statements){
  if(!ts.isImportDeclaration(statement)||statement.moduleSpecifier.text!=='node:test')continue;
  const clause=statement.importClause;
  if(clause?.name)names.add(clause.name.text);
  if(clause?.namedBindings&&ts.isNamedImports(clause.namedBindings)){
   for(const binding of clause.namedBindings.elements)if(['test','it'].includes((binding.propertyName??binding.name).text))names.add(binding.name.text);
  }
 }
 let discovered=0;
 function visit(node){
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&names.has(node.expression.text)){
   const {line,character}=source.getLineAndCharacterOfPosition(node.getStart(source));
   const name=node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])?node.arguments[0].text:null;
   expected.set(location(file,line+1,character+1),name);discovered++;
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
 if(!discovered)throw new Error(`No trusted test assertions discovered in ${file}`);
}
if(!expected.size)throw new Error('No trusted test assertions discovered');
const passed=new Set(),completed=new Set();let failures=0;
for await(const event of run({files,concurrency:1})){
 if(event.type==='test:summary'&&event.data.file&&event.data.entryFile){
  const {success,counts}=event.data;
  if(success&&counts.tests>0&&['failed','cancelled','skipped','todo'].every(key=>counts[key]===0))completed.add(resolve(event.data.entryFile));
  else{failures++;console.error('Incomplete or skipped test file',event.data.entryFile);}
 }
 if(event.type==='test:pass'&&event.data.file&&!event.data.skip&&!event.data.todo){
  const key=location(event.data.file,event.data.line,event.data.column);
  if(expected.has(key)&&(expected.get(key)===null||expected.get(key)===event.data.name))passed.add(key);
 }
 if(event.type==='test:fail'){failures++;console.error(event.data.name,event.data.details?.error);}
}
const missing=[...expected].filter(([key])=>!passed.has(key)).map(([key,name])=>`${key} ${name??'(dynamic name)'}`);
const incomplete=files.filter(file=>!completed.has(file));
if(failures||missing.length||incomplete.length)throw new Error(`Test gate refused: ${failures} failures; missing assertions: ${missing.join('; ')}; missing normal file completion: ${incomplete.join('; ')}`);
console.log(`Verified ${expected.size} named tests at trusted source locations; no failing tests.`);
