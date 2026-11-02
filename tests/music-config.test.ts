import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {botSchema,configSchema,musicSkillSchema,type CallerScope} from '../src/core/types.js';
import {allowedNow,freezeTurn,mediaConfigNow,permissionsRevoked,permitted} from '../src/core/policy.js';
import {Admin} from '../src/harness/admin.js';
import {adminCommandRequestSchema} from '../src/harness/admin-contract.js';
import {Store} from '../src/core/store.js';
import {musicCard} from '../src/client/music.js';
import {createUI} from '../src/client/ui.js';

const persona=()=>configSchema.parse({id:'music',name:'Music',personaPrompt:'A',skills:['music-download'],tools:['bot_music'],media:{music:{enabled:true}}});
const ready={configured:true,ready:true,protocol:'musicdl_json_v1',sources:[{id:'MiguMusicClient',available:true}]};

test('music stays disabled for existing personas and drops machine connection fields',()=>{
  assert.equal(configSchema.parse({id:'old',name:'Old',personaPrompt:'A'}).media.music,undefined);
  assert.deepEqual(musicSkillSchema.parse({}),{enabled:false,includeLyrics:false});
  assert.deepEqual(musicSkillSchema.parse({enabled:true,home:'private-machine-path',sources:['QQ'],token:'secret'}),{enabled:true,includeLyrics:false});
  assert.equal(musicSkillSchema.parse({includeLyrics:true}).includeLyrics,true);
  assert.throws(()=>musicSkillSchema.parse({includeLyrics:'yes'}));
});

test('music permission is independent of media, web and singing, with frozen additions and immediate revocation',()=>{
  const config=persona(),bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',enabled:true});
  const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'group',channelId:'group',senderId:'member'};
  const snapshot=freezeTurn(config,bot,scope,[]);
  assert.equal(permitted('bot_music',config,bot,scope),true);
  for(const revoked of [{...config,skills:[]},{...config,tools:[]},{...config,media:{music:{enabled:false,includeLyrics:false}}},{...config,media:{}}]){
    assert.equal(allowedNow('bot_music',snapshot,revoked,bot,scope),false);assert.equal(permissionsRevoked(snapshot,revoked,bot,scope),true);
  }
  assert.equal(allowedNow('bot_music',freezeTurn({...config,media:{}},bot,scope,[]),config,bot,scope),false);
  const disabled={...config,media:{music:{enabled:false,includeLyrics:true}}};
  assert.equal(mediaConfigNow(snapshot,disabled).media.music?.enabled,false);
  assert.equal(mediaConfigNow(snapshot,{...config,media:{music:{enabled:true,includeLyrics:true}}}).media.music?.includeLyrics,false);
});

test('music status is read-only and environment checks do not claim real downloads',async t=>{
  const home=await mkdtemp(path.resolve('.codex/music-config-')),store=new Store(home);let calls=0;
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const admin=new Admin({} as any,{store,media:{musicHealth:async()=>{calls++;return{...ready,home:'private-machine-path',sources:[{id:'MiguMusicClient',available:true,path:'private-provider-path'}]};}}} as any,'token');
  const config=persona();store.put('config',config.id,config);store.put('config-version',`${config.id}:${config.revision}`,config);let status:any=(await admin.invoke('skill.music.status',{}) as any).music;
  assert.equal(status.environment,null);assert.equal(calls,0);assert.equal(status.downloadValidation.status,'NOT_RUN');
  await admin.command({version:1,kind:'command',name:'skill.music.probe',input:{configId:config.id,revision:config.revision}});
  status=(await admin.invoke('skill.music.status',{}) as any).music;
  assert.equal(calls,1);assert.equal(status.environment.ready,true);assert.equal(status.protocolValidation.status,'PASS');assert.equal(status.downloadValidation.status,'NOT_RUN');
  assert.doesNotMatch(JSON.stringify(status),/private-machine|private-provider|"home"|"path"/);
  await admin.command({version:1,kind:'command',name:'capability.record',input:{configId:config.id,revision:config.revision,role:'music',status:'PASS',evidence:'完整歌曲已下载并解码'}});
  assert.equal(((await admin.invoke('skill.music.status',{}) as any).music).downloadValidation.status,'PASS');
  store.saveConfig({...config,name:'Changed'},config.revision);status=(await admin.invoke('skill.music.status',{}) as any).music;
  assert.equal(status.protocolValidation.status,'NOT_RUN');assert.equal(status.downloadValidation.status,'NOT_RUN');assert.equal(status.environment.ready,true);assert.equal(calls,1);
  await assert.rejects(admin.invoke('skill.music.probe',{configId:config.id,revision:config.revision}),/配置已变化/);assert.equal(calls,1);
});

test('music environment failures are redacted and an edited persona cannot accept an old probe',async t=>{
  const home=await mkdtemp(path.resolve('.codex/music-config-')),store=new Store(home);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  let probe:()=>Promise<unknown>=async()=>{throw Error('private-machine-path with a credential');};
  const admin=new Admin({} as any,{store,media:{musicHealth:()=>probe()}} as any,'token');const config=persona();store.put('config',config.id,config);store.put('config-version',`${config.id}:${config.revision}`,config);
  await admin.invoke('skill.music.probe',{configId:config.id,revision:config.revision});
  let status:any=(await admin.invoke('skill.music.status',{}) as any).music;
  assert.equal(status.protocolValidation.status,'FAIL');assert.equal(status.environment.error,'MUSIC_ENVIRONMENT_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(status),/private-machine|credential/);
  probe=async()=>{store.saveConfig({...config,name:'Changed during check'},config.revision);return ready;};
  await assert.rejects(admin.invoke('skill.music.probe',{configId:config.id,revision:config.revision}),/配置已变化/);
  status=(await admin.invoke('skill.music.status',{}) as any).music;assert.equal(status.protocolValidation.status,'NOT_RUN');assert.equal(status.environment.ready,false);
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'skill.music.probe',input:{configId:config.id,revision:1,home:'override'}}));
});

test('music card enables dedicated permissions and retains persona media settings',async()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})},ui=createUI(React,false,()=>{});
  const config=configSchema.parse({id:'music',name:'Music',personaPrompt:'A',tools:[],skills:[],media:{voice:{enabled:false}}});let updated:any;
  const nodes:any[]=[];const walk=(item:any)=>{if(!item||typeof item!=='object')return;nodes.push(item);item.children?.forEach(walk);};
  walk(musicCard(React.createElement,ui,config,true,{revision:1,environment:null},patch=>{updated=patch;},async()=>{},async()=>null));
  assert.equal(nodes.find(node=>node.type==='button'&&node.children[0]==='检查音乐环境').props.disabled,true);
  assert.equal(nodes.some(node=>node.type==='input'),false);
  nodes.find(node=>node.props?.['aria-label']==='音乐搜索与下载').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updated.media.music.enabled,true);assert.equal(updated.media.music.includeLyrics,false);assert.deepEqual(updated.media.voice,config.media.voice);
  assert.deepEqual(updated.tools,['bot_music']);assert.deepEqual(updated.skills,['music-download']);
});
