import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {listWorkflowFiles} from '../src/harness/pick-file.js';
import {Admin} from '../src/harness/admin.js';

async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const directory=await mkdtemp(path.resolve('.codex/workflow-browser-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'子目录'));
  for(const name of ['中文 工作流.json','UPPER.JSON','notes.txt'])await writeFile(path.join(directory,name),'{}');
  return await realpath(directory);
}

test('workflow browsing returns directories and JSON files without opening a desktop dialog',async t=>{
  const directory=await fixture(t),listing=await listWorkflowFiles(path.join(directory,'中文 工作流.json'));
  assert.equal(listing.directory,directory);assert.equal(listing.parent,path.dirname(directory));
  assert.equal(listing.entries[0].directory,true);
  assert.deepEqual(listing.entries.map(entry=>entry.name).sort(),['子目录','中文 工作流.json','UPPER.JSON'].sort());
  assert.ok(listing.entries.every(entry=>entry.path===path.join(directory,entry.name)));
  const child=await listWorkflowFiles(listing.entries[0].path);
  assert.equal(child.parent,directory);assert.deepEqual(child.entries,[]);
});

test('a removed workflow still opens its containing directory and invalid locations report an error',async t=>{
  const directory=await fixture(t);
  assert.equal((await listWorkflowFiles(path.join(directory,'removed.json'))).directory,directory);
  await assert.rejects(listWorkflowFiles('relative/path'),/路径无效/);
  await assert.rejects(listWorkflowFiles(path.join(directory,'missing-directory')),/无法读取工作流目录/);
});

test('aborted workflow browsing returns no late listing',async t=>{
  const directory=await fixture(t),controller=new AbortController();controller.abort(Error('cancelled'));
  await assert.rejects(listWorkflowFiles(directory,controller.signal),/cancelled/);
});

test('the authenticated file picker command returns the listing and propagates cancellation',async t=>{
  const directory=await fixture(t),admin=new Admin({} as any,{} as any,'fixture');
  const request={version:1,kind:'command',name:'service.settings.pick-file',input:{current:directory}};
  assert.deepEqual(await admin.command(request),await listWorkflowFiles(directory));
  const controller=new AbortController();controller.abort(Error('request closed'));
  await assert.rejects(admin.command(request,controller.signal),/request closed/);
});
