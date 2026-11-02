import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {botSchema,configSchema,singingSkillSchema,type CallerScope} from '../src/core/types.js';
import {allowedNow,freezeTurn,permissionsRevoked,permitted} from '../src/core/policy.js';
import {Admin} from '../src/harness/admin.js';
import {Store} from '../src/core/store.js';
import {singingCard} from '../src/client/singing.js';
import {createUI} from '../src/client/ui.js';

const singing={enabled:true,serviceUrl:'http://rvc.invalid:9881/',modelVersion:'v2',singingModelId:'Voice',singingWeightsPath:'models/voice.pth'};
const persona=()=>configSchema.parse({id:'singer',name:'Singer',personaPrompt:'A',skills:['singing-conversion'],tools:['bot_sing'],media:{singing}});
test('STS is opt-in and allows disabled drafts without borrowing voice model settings',()=>{
  assert.equal(configSchema.parse({id:'old',name:'Old',personaPrompt:'A'}).media.singing,undefined);
  const disabled=singingSkillSchema.parse({serviceUrl:'http://RVC.invalid:80///'});
  assert.equal(disabled.enabled,false);assert.equal(disabled.serviceUrl,'http://rvc.invalid');assert.equal(disabled.indexRate,0);assert.equal(disabled.defaultOutput,'mp3');
  assert.throws(()=>singingSkillSchema.parse({enabled:true}),/开启 STS/);
  assert.equal(singingSkillSchema.parse({...singing,singingIndexPath:'models/voice.index'}).indexRate,0.75);
  assert.throws(()=>singingSkillSchema.parse({...singing,indexRate:0.75}),/检索比例/);
  assert.throws(()=>singingSkillSchema.parse({...singing,serviceUrl:'http://user:secret@rvc.invalid/'}),/无凭据/);
  assert.throws(()=>singingSkillSchema.parse({...singing,pitchShift:25}));
  assert.throws(()=>singingSkillSchema.parse({...singing,speakerId:-1}));
  assert.throws(()=>singingSkillSchema.parse({...singing,separation:{status:'configured'}}));
  const separation=singingSkillSchema.parse({...singing,separation:{enabled:true,modelId:'vocals',modelPath:'models/vocals.ckpt',instrumentalMix:true,volume:0.8}}).separation;
  assert.equal(separation.status,'configured');assert.equal(separation.instrumentalMix,true);assert.equal(separation.volume,0.8);
  const legacy=singingSkillSchema.parse({...singing,separation:{status:'unconfigured'}}).separation;
  assert.equal(legacy.enabled,false);assert.equal(legacy.status,'unconfigured');assert.equal(legacy.instrumentalMix,false);
  const editorPayload=singingSkillSchema.parse({...singing,separation:{enabled:true,status:'unconfigured',modelId:'vocals',modelPath:'models/vocals.ckpt',instrumentalMix:true,volume:0.8}}).separation;
  assert.equal(editorPayload.enabled,true);assert.equal(editorPayload.status,'configured');
  assert.throws(()=>singingSkillSchema.parse({...singing,separation:{enabled:true,modelId:'vocals'}}),/分离模型权重路径/);
  assert.throws(()=>singingSkillSchema.parse({...singing,separation:{enabled:true,modelPath:'models\/vocals.ckpt'}}),/分离模型/);
  assert.throws(()=>singingSkillSchema.parse({...singing,separation:{volume:2.1}}));
});

test('bot_sing requires current and frozen skill, tool and STS permissions',()=>{
  const config=persona();const bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',enabled:true});
  const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
  const snapshot=freezeTurn(config,bot,scope,[]);assert.equal(permitted('bot_sing',config,bot,scope),true);
  for(const revoked of [{...config,skills:[]},{...config,tools:[]},{...config,media:{singing:{...config.media.singing!,enabled:false}}},{...config,media:{}}]){
    assert.equal(allowedNow('bot_sing',snapshot,revoked,bot,scope),false);assert.equal(permissionsRevoked(snapshot,revoked,bot,scope),true);
  }
  assert.equal(allowedNow('bot_sing',freezeTurn({...config,tools:[]},bot,scope,[]),config,bot,scope),false);
});

test('STS administration keeps protocol and real-model acceptance separate and revision-bound',async t=>{
  const home=await mkdtemp(path.resolve('.codex/singing-config-'));const store=new Store(home);const admin=new Admin({} as any,{store} as any,'token',async()=>{});
  const previousFetch=globalThis.fetch;t.after(async()=>{globalThis.fetch=previousFetch;store.close();await rm(home,{recursive:true,force:true});});
  const config=persona();store.put('config',config.id,config);store.put('config-version',`${config.id}:${config.revision}`,config);let status:any=(await admin.invoke('skill.singing.status',{}) as any).singer;
  assert.equal(status.configured,true);assert.equal(status.protocolValidation.status,'NOT_RUN');assert.equal(status.conversionValidation.status,'NOT_RUN');
  assert.equal(status.separation.protocol,'rvc_separate_cli');assert.equal(status.separation.modelComplete,false);assert.equal(status.separation.status,'unconfigured');
  assert.doesNotMatch(JSON.stringify(status),/rvc\.invalid|voice\.pth|serviceUrl|WeightsPath/);
  globalThis.fetch=async input=>{assert.equal(input,'http://rvc.invalid:9881/health');return Response.json({protocol:'rvc_http_v1',status:'ready'});};
  await admin.invoke('skill.singing.probe',{configId:config.id,revision:config.revision});
  status=(await admin.invoke('skill.singing.status',{}) as any).singer;assert.equal(status.protocolValidation.status,'PASS');assert.equal(status.conversionValidation.status,'NOT_RUN');
  await admin.invoke('capability.record',{configId:config.id,revision:config.revision,role:'singing',status:'PASS',evidence:'Complete local output decoded and target voice auditioned'});
  status=(await admin.invoke('skill.singing.status',{}) as any).singer;assert.equal(status.conversionValidation.status,'PASS');
  const next=store.saveConfig({...config,name:'Changed'},config.revision);status=(await admin.invoke('skill.singing.status',{}) as any).singer;
  assert.equal(status.protocolValidation.status,'NOT_RUN');assert.equal(status.conversionValidation.status,'NOT_RUN');
  await assert.rejects(admin.invoke('capability.record',{configId:config.id,revision:config.revision,role:'singing',status:'PASS',evidence:'Old evidence'}),/配置已变化/);
  globalThis.fetch=async()=>{throw Error('private service path');};await assert.rejects(admin.invoke('skill.singing.probe',{configId:config.id,revision:next.revision}),/已登记 Profile/);
  status=(await admin.invoke('skill.singing.status',{}) as any).singer;assert.equal(status.state,'missing');assert.equal(status.protocolValidation.status,'NOT_RUN');assert.doesNotMatch(JSON.stringify(status),/private service|rvc\.invalid|voice\.pth/);
});

test('STS card supports disabled drafts and enabling supplies dedicated permissions',async()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};const ui=createUI(React,false,()=>{});const config=configSchema.parse({id:'singer',name:'Singer',personaPrompt:'A',tools:[],skills:[]});let updated:any;
  const nodes:any[]=[];const walk=(item:any)=>{if(!item||typeof item!=='object')return;nodes.push(item);item.children?.forEach(walk);};
  walk(singingCard(React.createElement,ui,config,false,{revision:1,configured:false},[],{}, {},(patch:any)=>{updated=patch;},async()=>{},async()=>null,async()=>{},async()=>{}));
  assert.ok(nodes.some(node=>node.type==='label'&&node.children[0]==='音色 Profile'));
  assert.ok(nodes.some(node=>node.type==='small'&&String(node.children[0]).includes('本机路径')));
  assert.ok(!nodes.some(node=>node.type==='label'&&/权重路径|服务地址|locator|凭据/i.test(String(node.children[0]))));
  nodes.find(node=>node.props?.role==='switch').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updated.media.singing.enabled,true);assert.ok(updated.tools.includes('bot_sing'));assert.ok(updated.skills.includes('singing-conversion'));
});
