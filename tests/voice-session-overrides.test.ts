import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,configSchema,type CallerScope} from '../src/core/types.js';
import {permitted} from '../src/core/policy.js';

const scope=(kind:'private'|'group'='private'):CallerScope=>({botId:'one',platform:'qq',accountId:'one',kind,channelId:kind==='private'?'alice':'room',senderId:'alice'});

test('session TTS and STS overrides merge without changing the persona and survive reopen',async t=>{
  const home=await mkdtemp(path.resolve('.codex/voice-session-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const store=new SqlitePersistence(home);
  try{
    store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice']}));
    const original=store.personas.config('default');
    const configured=configSchema.parse({...original,media:{...original.media,
      voice:{enabled:true,engine:'edge_tts',protocol:'edge_tts',voice:'zh-CN-XiaoxiaoNeural',replyMode:'on_demand',format:'mp3'},
      singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'base'},speakerId:2,pitchShift:4,indexRate:.25,defaultOutput:'wav'},
    }});
    store.personas.saveConfig(configured,original.revision);
    const binding=store.sessions.binding(scope());
    store.sessions.updateSession({...binding,
      ttsOverride:{kind:'profile',profileRef:{serviceId:'gpt-sovits',profileId:'speaker'}},
      stsOverride:{profileRef:{serviceId:'rvc',profileId:'target'}},
    });
    const effective=store.personas.effectiveConfig(store.sessions.binding(scope()));
    assert.equal(effective.media.voice?.engine,'gpt-sovits');
    assert.deepEqual(effective.media.voice?.profileRef,{serviceId:'gpt-sovits',profileId:'speaker'});
    assert.equal(effective.media.voice?.format,'wav');
    assert.equal(effective.media.voice?.voice,undefined);
    assert.deepEqual(effective.media.singing?.profileRef,{serviceId:'rvc',profileId:'target'});
    assert.equal(effective.media.singing?.pitchShift,4);
    assert.equal(store.personas.config('default').media.voice?.voice,'zh-CN-XiaoxiaoNeural');
    assert.equal(store.personas.config('default').media.singing?.profileRef?.profileId,'base');
  }finally{store.close();}
  const reopened=new SqlitePersistence(home);
  try{
    const binding=reopened.sessions.binding(scope());
    assert.equal(binding.ttsOverride?.kind,'profile');
    assert.equal(binding.stsOverride?.profileRef.profileId,'target');
    assert.equal(reopened.personas.effectiveConfig(binding).media.voice?.profileRef?.profileId,'speaker');
  }finally{reopened.close();}
});

test('voice control permission is restricted to trusted private callers',()=>{
  const bot=botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice']});
  const config=configSchema.parse({id:'default',name:'Default',personaPrompt:'test'});
  assert.equal(permitted('bot_voice_control',config,bot,scope('private')),true);
  assert.equal(permitted('bot_voice_control',config,bot,scope('group')),false);
});
