import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MusicServiceLibrary} from '../src/core/music-service-library.js';
import {ProfileStore} from '../src/core/profile-store.js';

function settingsStore(){
  let value: unknown;
  return {read:()=>value,write:(next:unknown)=>{value=next;}};
}

test('music settings discover a managed profile and preserve Kuwo/NetEase priority',async t=>{
  const root=await mkdtemp(path.resolve('.codex/music-library-')),store=settingsStore(),profiles=new ProfileStore();
  t.after(()=>rm(root,{recursive:true,force:true}));
  const pythonRelative=path.join('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await mkdir(path.dirname(path.join(root,pythonRelative)),{recursive:true});
  await mkdir(path.join(root,'scripts'),{recursive:true});
  await writeFile(path.join(root,pythonRelative),'python');
  await writeFile(path.join(root,'scripts','music_api.py'),'');
  const library=new MusicServiceLibrary(store,profiles,{musicHome:root,musicSources:['KuwoMusicClient','NeteaseMusicClient']});
  await library.initialize();
  const profile=profiles.require({serviceId:'music',profileId:'default'});
  assert.equal(profile.state,'ready');
  assert.deepEqual(profile.managedConfig,{home:root,sources:['KuwoMusicClient','NeteaseMusicClient']});
  assert.equal(profile.capabilities.includes('music.search'),true);
  assert.deepEqual(library.view().musicSources,['KuwoMusicClient','NeteaseMusicClient']);
});

test('missing Music home leaves a visible missing profile without throwing',async t=>{
  const root=path.join(path.resolve('.codex'),'music-library-missing-'+Date.now()),profiles=new ProfileStore();
  t.after(()=>rm(root,{recursive:true,force:true}));
  const library=new MusicServiceLibrary(settingsStore(),profiles,{musicHome:root});
  await library.initialize();
  assert.equal(library.status().state,'missing');
  assert.equal(profiles.require({serviceId:'music',profileId:'default'}).state,'missing');
});

