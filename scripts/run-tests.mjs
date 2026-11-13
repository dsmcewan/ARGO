// Parent-owned verification: exit 0 before test registration is not a passing test suite.
import {run} from 'node:test';import ts from 'typescript';import {readFile} from 'node:fs/promises';
const files=process.argv.slice(2),expected=new Map();
for(const file of files){
 const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='test'&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])){const name=node.arguments[0].text;expected.set(name,(expected.get(name)??0)+1);}ts.forEachChild(node,visit);}visit(source);
}
if(!expected.size)throw new Error('No trusted test assertions discovered');
const passed=new Map();let failures=0;
for await(const event of run({files,concurrency:1})){
 if(event.type==='test:pass')passed.set(event.data.name,(passed.get(event.data.name)??0)+1);
 if(event.type==='test:fail'){failures++;console.error(event.data.name,event.data.details?.error);}
}
const missing=[...expected].filter(([name,count])=>(passed.get(name)??0)<count).map(([name])=>name);
if(failures||missing.length)throw new Error(`Test gate refused: ${failures} failures; missing assertions: ${missing.join('; ')}`);
console.log(`Verified ${[...expected.values()].reduce((a,b)=>a+b,0)} named tests; no failing tests.`);
