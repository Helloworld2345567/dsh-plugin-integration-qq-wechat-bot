import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {lifecycleSourceDigest} from './source-digest.mjs';
export async function verifyLifecycleBuild(root){
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),record=JSON.parse(await readFile(path.join(root,'dist','lifecycle-build.json'),'utf8')),source=await lifecycleSourceDigest(root);
  if(record.schemaVersion!==1||record.sourceEntry!=='src/index.ts'||record.sourceDigest!==source.digest||record.packageVersion!==manifest.version||JSON.stringify(record.contract)!==JSON.stringify(manifest.dshLifecycle))throw Error('LIFECYCLE_DIST_STALE');
  if(JSON.stringify(record.sourceFiles)!==JSON.stringify(source.files))throw Error('LIFECYCLE_SOURCE_INVENTORY_STALE');
  for(const file of ['index.js','compatibility.js','compatibility.d.mts']){const digest=createHash('sha256').update(await readFile(path.join(root,'dist',file))).digest('hex');if(record.outputs?.[file]!==digest)throw Error(`LIFECYCLE_DIST_HASH_MISMATCH: ${file}`);}
  return{status:'PASS',sourceEntry:record.sourceEntry,sourceDigest:record.sourceDigest,packageVersion:record.packageVersion};
}
const invoked=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked){const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');console.log(JSON.stringify(await verifyLifecycleBuild(root)));}
