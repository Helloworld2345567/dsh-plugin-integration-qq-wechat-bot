import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {loadSkillOperations, resolveSkillOperation, skillToolManifests, validateSkillSource} from '../src/core/skill-operations.js';
import {mediaOperationRegistry} from '../src/core/media-operation-registry.js';

test('shipped skill declarations route tools and preserve provider and delivery contracts', () => {
  const manifest = skillToolManifests.find(item => item.skill === 'media-analysis')!;
  for (const [args, id] of [
    [{kind:'audio'}, 'transcribe'], [{kind:'video'}, 'video_analyze'],
    [{kind:'image'}, 'image_download'], [{kind:'video',action:'download'}, 'video_download'],
  ] as const) {
    assert.equal(resolveSkillOperation(manifest,args),id);
    assert.equal(mediaOperationRegistry.get(id).handler,'skill');
    assert.equal(mediaOperationRegistry.get(id).tool,manifest.tool.name);
  }
  assert.equal(mediaOperationRegistry.get('transcribe').role,'asr');
  assert.equal(mediaOperationRegistry.get('video_analyze').role,'video');
  assert.equal(mediaOperationRegistry.get('image_download').deliver,true);
  assert.throws(()=>resolveSkillOperation(manifest,{kind:'audio',action:'download'}),/ARGUMENTS_INVALID/);
});

test('voice generation keeps speak and rejects the removed chant route', () => {
  const manifest = skillToolManifests.find(item => item.skill === 'voice-generation')!;
  assert.ok(manifest);
  assert.equal(manifest.permissionTool, 'bot_voice');
  assert.equal(resolveSkillOperation(manifest, {}), 'voice_speak');
  assert.throws(()=>resolveSkillOperation(manifest, {mode:'chant'}),/ARGUMENTS_INVALID/);
  assert.equal(mediaOperationRegistry.has('voice_chant'),false);
  const operation = mediaOperationRegistry.get('voice_speak');
  assert.equal(operation.role, 'tts');
  assert.equal(operation.deliver, true);
  assert.equal(operation.permissionTool, 'bot_voice');
});

test('music catalog and delivery stay behind the dedicated tool',()=>{
  const manifest=skillToolManifests.find(item=>item.skill==='music-download')!;
  assert.equal(manifest.permissionTool,'bot_music');
  assert.equal(resolveSkillOperation(manifest,{action:'search'}),'music_search');
  assert.equal(resolveSkillOperation(manifest,{action:'download'}),'music_acquire');
  assert.deepEqual(manifest.tool.parameters.action.enum,['search','download']);
  for(const id of ['music_search','music_acquire','music_delivery']){
    const operation=mediaOperationRegistry.get(id);
    assert.equal(operation.deliver,false);
    assert.equal(operation.permissionTool,'bot_music');
  }
  const singing=skillToolManifests.find(item=>item.skill==='singing-conversion')!;
  assert.equal(resolveSkillOperation(singing,{action:'sing',song:'泡沫'}),'singing_convert');
});

test('a new packaged skill declares its own operation without host routing edits', async () => {
  const root=await mkdtemp(path.resolve('.codex/skill-contract-'));
  try {
    await mkdir(path.join(root,'fixture/scripts'),{recursive:true});
    await writeFile(path.join(root,'fixture/scripts/worker.py'),'def execute(job): return {"text": "fixture"}\n');
    const manifest={skill:'fixture',worker:'scripts/worker.py',tools:[{tool:{name:'fixture_media',description:'fixture',parameters:{mode:{type:'string'}}},defaults:{mode:'extract'},routes:[{match:{mode:'extract'},operation:'fixture_extract'}]}],operations:[{id:'fixture_extract',quotaUnits:1,inputKinds:[],deliver:true,urlRequiredError:'FIXTURE_URL_REQUIRED'}]};
    await writeFile(path.join(root,'fixture/operations.json'),JSON.stringify(manifest));
    const [loaded]=loadSkillOperations(root);
    assert.equal(resolveSkillOperation(loaded.tools[0],{}),'fixture_extract');
    assert.throws(()=>validateSkillSource(loaded.operations[0],[],{}),/FIXTURE_URL_REQUIRED/);
    await writeFile(path.join(root,'fixture/operations.json'),JSON.stringify({...manifest,worker:'../../worker.py'}));
    assert.throws(()=>loadSkillOperations(root),/MANIFEST_INVALID/);
  } finally {await rm(root,{recursive:true,force:true});}
});
