import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=path.resolve('src/core');
function source(file:string){const text=readFileSync(path.join(root,file),'utf8');return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);}
test('Stats core does not cross SQLite, filesystem or raw-history seams',()=>{
  const file='stats.ts',node=source(file),errors:string[]=[];
  for(const statement of node.statements)if(ts.isImportDeclaration(statement)){const value=(statement.moduleSpecifier as ts.StringLiteral).text;if(['node:fs','node:path','./store.js'].includes(value))errors.push(`forbidden import ${value}`);}
  const walk=(item:ts.Node)=>{if(ts.isCallExpression(item)&&ts.isPropertyAccessExpression(item.expression)&&['allMessages','deliveries','get','list','put'].includes(item.expression.name.text))errors.push(`forbidden call ${item.expression.name.text}`);item.forEachChild(walk);};walk(node);assert.deepEqual(errors,[]);
});
test('only SQLite adapters use raw database or generic record operations',()=>{for(const file of ['stats.ts','runtime.ts','media.ts','features.ts','skills.ts','management.ts','evolution.ts','failure-context.ts','repositories.ts']){const text=readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(text,/node:sqlite|DatabaseSync|\.store\.(?:get|list|put)\(|\bstore\.(?:get|list|put)\(/,file);}});
