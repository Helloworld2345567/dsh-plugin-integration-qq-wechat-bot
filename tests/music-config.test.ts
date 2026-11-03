import {test} from 'node:test';
import assert from 'node:assert/strict';
import {botSchema,configSchema,musicSkillSchema,type CallerScope} from '../src/core/types.js';
import {allowedNow,freezeTurn,mediaConfigNow,permissionsRevoked,permitted} from '../src/core/policy.js';
import {musicCard} from '../src/client/music.js';
import {createUI} from '../src/client/ui.js';

const persona=()=>configSchema.parse({id:'music',name:'Music',personaPrompt:'A',skills:['music-download'],tools:['bot_music'],media:{music:{enabled:true}}});

test('music stays disabled by default and rejects machine connection fields',()=>{
  assert.equal(configSchema.parse({id:'old',name:'Old',personaPrompt:'A'}).media.music,undefined);
  assert.deepEqual(musicSkillSchema.parse({}),{enabled:false,includeLyrics:false});
  assert.throws(()=>musicSkillSchema.parse({enabled:true,home:'private-machine-path',sources:['QQ'],token:'secret'}));
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

test('music card enables dedicated permissions and retains persona media settings',async()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})},ui=createUI(React,false,()=>{});
  const config=configSchema.parse({id:'music',name:'Music',personaPrompt:'A',tools:[],skills:[],media:{voice:{enabled:false}}});let updated:any;
  const nodes:any[]=[];const walk=(item:any)=>{if(!item||typeof item!=='object')return;nodes.push(item);item.children?.forEach(walk);};
  walk(musicCard(React.createElement,ui,config,[],(patch:any)=>{updated=patch;}));
  assert.doesNotMatch(JSON.stringify(nodes),/验收|health|acceptance|测试|权重|locator/);
  assert.ok(nodes.some(node=>node.type==='label'&&node.children[0]==='音乐来源'));
  assert.equal(nodes.some(node=>node.type==='input'),false);
  nodes.find(node=>node.props?.['aria-label']==='音乐搜索与下载').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updated.media.music.enabled,true);assert.equal(updated.media.music.includeLyrics,false);assert.deepEqual(updated.media.voice,config.media.voice);
  assert.deepEqual(updated.tools,['bot_music']);assert.deepEqual(updated.skills,['music-download']);
});
