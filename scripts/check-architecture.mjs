import {builtinModules} from 'node:module';
import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const NODE_BUILTINS=new Set([...builtinModules,...builtinModules.map(name=>`node:${name}`)]);
const REQUIRED_DIRECTORIES=['src/client','src/core','src/channels','src/harness','packages/bot-lifecycle/src','packages/bot-lifecycle/src/contract','python','skills','scripts','tests'];
const HOST_OWNED_MODULE=/^src\/core\/(?:store|runtime|delivery-worker|channel-registry|channel-ports|session-actions|repositories)\.ts$/;
const CHANNEL_HOST_OWNED_MODULE=/^src\/core\/(?:store|runtime|delivery-worker|session-actions|repositories|sqlite-[^/]+|[^/]+-store)\.ts$/;
const ADAPTER_HOST_OWNED_MODULE=/^src\/core\/(?:[^/]*(?:store|session|delivery|sqlite|repositories|runtime)[^/]*)\.ts$/;
const LIFECYCLE_SOURCE='packages/bot-lifecycle/src/';
const LIFECYCLE_CONTRACT='packages/bot-lifecycle/src/contract/';

export function normalizeRepoPath(value){
  const normalized=String(value).replaceAll('\\','/').replace(/^\.\//,'');
  return path.posix.normalize(normalized).replace(/^\.\//,'');
}

function absoluteSpecifier(value){return /^file:/i.test(value)||path.isAbsolute(value)||path.win32.isAbsolute(value);}
function safeSpecifier(value){
  if(absoluteSpecifier(value))return'<absolute-import>';
  return normalizeRepoPath(value);
}

function runtimeImport(statement){
  const clause=statement.importClause;
  if(!clause)return true;
  if(clause.isTypeOnly)return false;
  if(clause.name)return true;
  const bindings=clause.namedBindings;
  return !bindings||!ts.isNamedImports(bindings)||bindings.elements.some(element=>!element.isTypeOnly);
}

export function parseModuleImports(file,source){
  const kind=file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS;
  const node=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,kind),imports=[],skippedDynamicImports=[];
  for(const statement of node.statements){
    if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier))imports.push({specifier:statement.moduleSpecifier.text,runtime:runtimeImport(statement),dynamic:false});
    else if(ts.isImportEqualsDeclaration(statement)&&ts.isExternalModuleReference(statement.moduleReference)&&statement.moduleReference.expression&&ts.isStringLiteral(statement.moduleReference.expression))imports.push({specifier:statement.moduleReference.expression.text,runtime:!statement.isTypeOnly,dynamic:false});
    else if(ts.isExportDeclaration(statement)&&statement.moduleSpecifier&&ts.isStringLiteral(statement.moduleSpecifier)){
      const runtime=!statement.isTypeOnly&&(!statement.exportClause||!ts.isNamedExports(statement.exportClause)||statement.exportClause.elements.some(element=>!element.isTypeOnly));
      imports.push({specifier:statement.moduleSpecifier.text,runtime,dynamic:false});
    }
  }
  function visit(item){
    if(ts.isCallExpression(item)&&(item.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(item.expression)&&item.expression.text==='require')){
      const argument=item.arguments[0];
      if(argument&&ts.isStringLiteralLike(argument))imports.push({specifier:argument.text,runtime:true,dynamic:true});
      else skippedDynamicImports.push({file:normalizeRepoPath(file),line:node.getLineAndCharacterOfPosition(item.getStart(node)).line+1});
    }
    item.forEachChild(visit);
  }
  visit(node);
  return{imports,skippedDynamicImports};
}

function candidateTargets(from,specifier){
  if(!specifier.startsWith('.'))return[];
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(from),normalizeRepoPath(specifier)));
  const extension=path.posix.extname(base),values=[base];
  if(extension==='.js'||extension==='.mjs'||extension==='.cjs')values.push(base.slice(0,-extension.length)+'.ts');
  if(!extension)values.push(`${base}.ts`,`${base}.mjs`,`${base}.js`,`${base}/index.ts`,`${base}/index.mjs`,`${base}/index.js`);
  return[...new Set(values.map(normalizeRepoPath))];
}

function resolveTarget(from,specifier,fileSet){return candidateTargets(from,specifier).find(candidate=>fileSet.has(candidate));}
function productionTypeScript(file){return (file.startsWith('src/')||file.startsWith('packages/'))&&/\.m?ts$/.test(file)&&!/\.(?:test|spec)\.ts$/.test(file);}
const RUNTIME_SCRIPTS=new Set(['scripts/start.mjs','scripts/stop.mjs','scripts/runtime.mjs','scripts/install.mjs','scripts/installation.mjs','scripts/supervisor.mjs','scripts/workspace-storage.mjs','scripts/bootstrap-github.mjs','scripts/github-bootstrap.mjs']);
function productionModule(file){return productionTypeScript(file)||file.startsWith('packages/')&&/\.(?:mjs|cjs|js)$/.test(file)&&!file.includes('/dist/')||RUNTIME_SCRIPTS.has(file);}
function packageRoot(file){const parts=file.split('/');return parts.length>=2&&parts[0]==='packages'?parts.slice(0,2).join('/'):undefined;}
function violation(rule,file,detail,target){return{rule,file:normalizeRepoPath(file),...(target?{target:normalizeRepoPath(target)}:{}),detail};}

function stronglyConnected(graph){
  const index=new Map(),low=new Map(),stack=[],inside=new Set(),groups=[];let next=0;
  function visit(node){
    index.set(node,next);low.set(node,next++);stack.push(node);inside.add(node);
    for(const target of graph.get(node)??[]){if(!index.has(target)){visit(target);low.set(node,Math.min(low.get(node),low.get(target)));}else if(inside.has(target))low.set(node,Math.min(low.get(node),index.get(target)));}
    if(low.get(node)===index.get(node)){const group=[];let value;do{value=stack.pop();inside.delete(value);group.push(value);}while(value!==node);if(group.length>1||(graph.get(node)??new Set()).has(node))groups.push(group.sort());}
  }
  for(const node of [...graph.keys()].sort())if(!index.has(node))visit(node);
  return groups.sort((a,b)=>a[0].localeCompare(b[0]));
}

export function analyzeModules(entries){
  const files=new Map(entries.map(entry=>[normalizeRepoPath(entry.path),entry.source])),fileSet=new Set(files.keys()),violations=[],skippedDynamicImports=[],edges=[];
  const graph=new Map([...files.keys()].filter(productionTypeScript).map(file=>[file,new Set()]));
  for(const [file,source] of files){
    if(!/\.(?:ts|mjs|cjs|js)$/.test(file))continue;
    const adapterNamed=/^src\/core\/(?!service-adapter-utils\.ts$)[^/]+-adapter\.ts$/.test(file),adapterImplemented=/\b(?:extends\s+IsolatedServiceAdapter|implements\s+ServiceAdapter)\b/.test(source),serviceAdapter=adapterNamed||adapterImplemented;
    if(adapterImplemented&&!adapterNamed)violations.push(violation('service-adapter-location',file,'Service Adapter modules must use the *-adapter.ts boundary name'));
    const parsed=parseModuleImports(file,source);skippedDynamicImports.push(...parsed.skippedDynamicImports);
    for(const dependency of parsed.imports){
      const target=resolveTarget(file,dependency.specifier,fileSet);edges.push({from:file,to:target,specifier:safeSpecifier(dependency.specifier),runtime:dependency.runtime,dynamic:dependency.dynamic});
      if(dependency.runtime&&target&&graph.has(file)&&graph.has(target))graph.get(file).add(target);
      if(productionModule(file)&&absoluteSpecifier(dependency.specifier))violations.push(violation('absolute-import',file,'imports forbidden <absolute-import>'));
      if(productionModule(file)&&/(?:^|\/)(?:tests?|fixtures?|\.codex|\.runtime)(?:\/|$)/i.test(normalizeRepoPath(dependency.specifier)))violations.push(violation('production-isolation',file,`imports forbidden ${safeSpecifier(dependency.specifier)}`,target));
      if(file.startsWith('src/client/')){
        if(NODE_BUILTINS.has(dependency.specifier)||dependency.specifier.startsWith('node:'))violations.push(violation('client-node',file,`imports Node builtin ${safeSpecifier(dependency.specifier)}`));
        if(target&&/^src\/(?:channels|harness|lifecycle)\//.test(target))violations.push(violation('client-server',file,'imports a server layer',target));
        if(target?.startsWith('src/core/')&&(dependency.runtime||target!=='src/core/client-contracts.ts'))violations.push(violation('client-server',file,dependency.runtime?'runtime-imports core implementation':'type-imports a non-public core implementation',target));
      }
      if(file.startsWith('src/core/')&&target&&(/^src\/(?:client|channels|harness)\//.test(target)||target.startsWith(LIFECYCLE_SOURCE)&&!target.startsWith(LIFECYCLE_CONTRACT)))violations.push(violation('core-direction',file,'imports an outer layer or coordinator implementation',target));
      if(file.startsWith('src/channels/')&&(dependency.specifier==='node:sqlite'||target&&(/^src\/harness\//.test(target)||CHANNEL_HOST_OWNED_MODULE.test(target))))violations.push(violation('channel-isolation',file,'imports SQLite, Harness or a host-owned Store, Session or delivery implementation',target));
      if(file.startsWith(LIFECYCLE_SOURCE)&&target?.startsWith('src/'))violations.push(violation('lifecycle-isolation',file,'imports root-package source; lifecycle must build inside its own package boundary',target));
      if(file.startsWith(LIFECYCLE_SOURCE)&&/(?:qq|wechat|weixin|persona|delivery|channel|credentials|store|runtime-bridge)/i.test(dependency.specifier)&&target&&!target.startsWith(LIFECYCLE_CONTRACT))violations.push(violation('lifecycle-business-isolation',file,'imports messaging, persona, delivery, credential, Store or channel behavior',target));
      if(serviceAdapter){
        if(target&&ADAPTER_HOST_OWNED_MODULE.test(target))violations.push(violation('service-adapter-isolation',file,'imports host-owned Store, Session, channel, delivery, SQLite or runtime implementation',target));
        if(dependency.specifier==='node:sqlite'||/@deepseek-ai\/dsh-(?:session|storage|attachment)/.test(dependency.specifier))violations.push(violation('service-adapter-isolation',file,`imports host service ${safeSpecifier(dependency.specifier)}`));
      }
      const owner=packageRoot(file);
      if(owner&&dependency.specifier.startsWith('.')){const requested=normalizeRepoPath(path.posix.join(path.posix.dirname(file),dependency.specifier));if(!requested.startsWith(`${owner}/`))violations.push(violation('package-isolation',file,'relative import escapes the package source boundary',target??requested));}
      if(owner&&dependency.specifier.startsWith('.')&&target&&!target.startsWith(`${owner}/`))violations.push(violation('package-isolation',file,'resolved import escapes the package source boundary',target));
    }
  }
  for(const skipped of skippedDynamicImports)if(productionModule(skipped.file))violations.push(violation('dynamic-import-target',skipped.file,`cannot determine import or require target at line ${skipped.line}`));
  const cycles=stronglyConnected(graph);
  for(const cycle of cycles)violations.push(violation('typescript-cycle',cycle[0],`runtime cycle: ${cycle.join(' -> ')}`));
  return{files:[...files.keys()].sort(),edges,cycles,violations:violations.sort((a,b)=>a.file.localeCompare(b.file)||a.rule.localeCompare(b.rule)||a.detail.localeCompare(b.detail)),skippedDynamicImports:skippedDynamicImports.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line)};
}

async function walk(root,directory,accept,result=[]){
  let entries;try{entries=await readdir(path.join(root,directory),{withFileTypes:true});}catch(error){if(error?.code==='ENOENT')return result;throw error;}
  for(const entry of entries){const relative=normalizeRepoPath(path.posix.join(directory,entry.name));if(entry.isDirectory()){if(!['node_modules','.git','.codex','.runtime','dist'].includes(entry.name))await walk(root,relative,accept,result);}else if(entry.isFile()&&accept(relative))result.push(relative);}
  return result;
}

const PYTHON_IMPORT_EFFECTS=[
  /\b(?:ThreadingHTTPServer|HTTPServer|subprocess\.(?:run|Popen|call|check_call|check_output)|asyncio\.run|sqlite3\.connect|socket\.create_connection|requests\.(?:get|post|put|patch|delete|request)|urllib\.request\.urlopen|threading\.Timer|os\.(?:system|mkdir|makedirs)|shutil\.(?:copy|copy2|copytree|move))\s*\(/,
  /\bopen\s*\([^\n]*,[^\n]*['"][wax+]/,
  /\.(?:serve_forever|write_text|write_bytes|mkdir|touch)\s*\(/,
];
function pythonImports(file,source){
  const imports=[];for(const [index,line] of source.split(/\r?\n/).entries()){
    const from=/^\s*from\s+(\.*(?:[A-Za-z_][A-Za-z0-9_.]*)?)\s+import\s+/.exec(line);if(from?.[1]){imports.push({file,module:from[1],line:index+1});continue;}
    const direct=/^\s*import\s+(.+)$/.exec(line);if(direct)for(const part of direct[1].split(',')){const name=/^\s*([A-Za-z_][A-Za-z0-9_.]*)/.exec(part)?.[1];if(name)imports.push({file,module:name,line:index+1});}
  }return imports;
}

function pythonImportSideEffects(file,source){
  const findings=[],blocks=[];let pendingInactiveIndent;
  for(const [index,line] of source.split(/\r?\n/).entries()){
    if(!line.trim()||/^\s*#/.test(line))continue;const indent=line.match(/^\s*/)[0].replaceAll('\t','    ').length,statement=line.trim();
    if(pendingInactiveIndent!==undefined){if(/:\s*(?:#.*)?$/.test(statement)){blocks.push({indent:pendingInactiveIndent,inactive:true});pendingInactiveIndent=undefined;}continue;}
    while(blocks.length&&indent<=blocks.at(-1).indent)blocks.pop();
    const inactive=blocks.some(block=>block.inactive),definition=/^(?:async\s+def|def|class)\s+/.test(statement);
    if(definition){if(/:\s*(?:#.*)?$/.test(statement))blocks.push({indent,inactive:true});else pendingInactiveIndent=indent;continue;}
    if(!inactive&&PYTHON_IMPORT_EFFECTS.some(pattern=>pattern.test(line)))findings.push({file,line:index+1});
    if(/^if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(statement))blocks.push({indent,inactive:true});
    else if(/^(?:if|elif|else|try|except|finally|with|for|while|match|case)\b.*:\s*(?:#.*)?$/.test(statement))blocks.push({indent,inactive});
  }return findings;
}

export function analyzePythonModules(entries){
  const imports=entries.flatMap(({path:file,source})=>pythonImports(normalizeRepoPath(file),source));
  const importSideEffects=entries.flatMap(({path:file,source})=>pythonImportSideEffects(normalizeRepoPath(file),source));
  return{imports,importSideEffects};
}

async function exists(file){return stat(file).then(value=>value.isFile()||value.isDirectory(),()=>false);}

export async function checkRepository(root=process.cwd(),options={}){
  const relativeFiles=[
    ...await walk(root,'src',file=>/\.m?ts$/.test(file)),
    ...await walk(root,'packages',file=>/\.(?:mts|ts|mjs|cjs|js)$/.test(file)),
    ...await walk(root,'scripts',file=>file.endsWith('.mjs')),
  ];
  const entries=await Promise.all(relativeFiles.map(async file=>({path:file,source:await readFile(path.join(root,file),'utf8')}))),analysis=analyzeModules(entries),violations=[...analysis.violations];
  const pythonFiles=[...await walk(root,'python',file=>file.endsWith('.py')),...await walk(root,'skills',file=>file.endsWith('.py'))];
  const pythonSources=await Promise.all(pythonFiles.map(async file=>({path:file,source:await readFile(path.join(root,file),'utf8')}))),pythonAnalysis=analyzePythonModules(pythonSources);
  const explicitPythonImports=pythonAnalysis.imports,pythonSideEffects=pythonAnalysis.importSideEffects;
  for(const finding of pythonSideEffects)violations.push(violation('python-import-side-effect',finding.file,`starts a process, network server or database at import line ${finding.line}`));
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),lifecycleManifest=JSON.parse(await readFile(path.join(root,'packages/bot-lifecycle/package.json'),'utf8')),build=await readFile(path.join(root,'scripts/build.mjs'),'utf8'),architecture=await readFile(path.join(root,'docs/architecture-boundaries.md'),'utf8');
  const requiredExports={'.':'./dist/index.js','./client':'./dist/client.js'};
  for(const [name,target] of Object.entries(requiredExports))if(manifest.exports?.[name]!==target)violations.push(violation('package-entry','package.json',`export ${name} must remain ${target}`));
  if(lifecycleManifest.source!=='./src/index.ts'||lifecycleManifest.main!=='./dist/index.js'||lifecycleManifest.exports?.['.']!=='./dist/index.js')violations.push(violation('package-entry','packages/bot-lifecycle/package.json','source, main and export . must map src/index.ts to dist/index.js'));
  if(lifecycleManifest.exports?.['./compatibility']?.import!=='./dist/compatibility.js'||lifecycleManifest.exports?.['./compatibility']?.types!=='./dist/compatibility.d.mts')violations.push(violation('package-entry','packages/bot-lifecycle/package.json','serialized compatibility contract export is missing'));
  for(const file of ['dist/index.js','dist/compatibility.js','dist/compatibility.d.mts','dist/lifecycle-build.json'])if(!lifecycleManifest.files?.includes(file))violations.push(violation('package-entry','packages/bot-lifecycle/package.json',`published lifecycle file is missing: ${file}`));
  for(const [source,target] of [['src/index.ts','dist/index.js'],['src/client/index.ts','dist/client.js'],['packages/bot-lifecycle/src/index.ts','packages/bot-lifecycle/dist/index.js']]){
    if(!await exists(path.join(root,source)))violations.push(violation('package-entry',source,'source entry is missing'));
    if(!build.includes(source)&&source.startsWith('packages/')){const packageBuild=await readFile(path.join(root,'packages/bot-lifecycle/scripts/build.mjs'),'utf8');if(!packageBuild.includes("'src','index.ts'")&&!packageBuild.includes('src/index.ts'))violations.push(violation('package-entry','packages/bot-lifecycle/scripts/build.mjs',`build mapping missing: ${source} -> ${target}`));}
    else if(!source.startsWith('packages/')&&(!build.includes(source)||!build.includes(target)))violations.push(violation('package-entry','scripts/build.mjs',`build mapping missing: ${source} -> ${target}`));
  }
  if(!build.includes("../packages/bot-lifecycle/scripts/build.mjs"))violations.push(violation('package-entry','scripts/build.mjs','root build must invoke the lifecycle package-owned build'));
  if(await exists(path.join(root,'src/lifecycle')))violations.push(violation('architecture-layout','src/lifecycle','legacy lifecycle source directory must not exist'));
  for(const legacy of ['src/core/evolution-contract.ts','src/core/source-integrity.ts'])if(await exists(path.join(root,legacy)))violations.push(violation('architecture-layout',legacy,'lifecycle contract must have a single source under packages/bot-lifecycle/src/contract'));
  for(const [file,declaration,role] of [['package.json',manifest.dshLifecycle,'main'],['packages/bot-lifecycle/package.json',lifecycleManifest.dshLifecycle,'coordinator']])if(declaration?.schemaVersion!==1||declaration?.role!==role)violations.push(violation('lifecycle-contract',file,`${role} versioned lifecycle declaration is missing`));
  for(const directory of REQUIRED_DIRECTORIES){
    if(!await exists(path.join(root,directory)))violations.push(violation('architecture-layout',directory,'declared directory is missing'));
    if(!architecture.includes(`\`${directory}${directory.includes('.')?'':'/'}\``)&&!architecture.includes(`\`${directory}\``))violations.push(violation('architecture-layout','docs/architecture-boundaries.md',`directory declaration missing: ${directory}`));
  }
  if(!architecture.includes('`src/index.ts`'))violations.push(violation('architecture-layout','docs/architecture-boundaries.md','composition root declaration missing: src/index.ts'));
  return{status:violations.length?'FAIL':'PASS',modules:analysis.files.length,typescriptModules:analysis.files.filter(file=>/\.m?ts$/.test(file)&&(file.startsWith('src/')||file.startsWith('packages/'))).length,runtimeEdges:analysis.edges.filter(edge=>edge.runtime).length,pythonModules:pythonFiles.length,pythonImports:explicitPythonImports.length,pythonImportSideEffects:pythonSideEffects,cycles:analysis.cycles,skippedDynamicImports:analysis.skippedDynamicImports,...options.inventory?{dependencyInventory:{modules:analysis.files,imports:analysis.edges,pythonImports:explicitPythonImports}}:{},violations:violations.sort((a,b)=>a.file.localeCompare(b.file)||a.rule.localeCompare(b.rule)||a.detail.localeCompare(b.detail))};
}

export function formatArchitectureResult(result){return JSON.stringify(result,null,2);}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked){
  try{
    const result=await checkRepository(process.cwd(),{inventory:process.argv.includes('--inventory')});
    console.log(formatArchitectureResult(result));
    if(result.status!=='PASS')process.exitCode=1;
  }catch(error){
    console.log(formatArchitectureResult({status:'FAIL',violations:[{rule:'architecture-check',file:'<repository>',detail:error&&typeof error==='object'&&'code'in error?String(error.code):'ARCHITECTURE_CHECK_FAILED'}]}));
    process.exitCode=1;
  }
}
