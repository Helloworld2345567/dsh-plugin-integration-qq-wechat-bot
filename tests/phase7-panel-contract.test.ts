import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {musicCard} from '../src/client/music.js';
import {singingCard} from '../src/client/singing.js';
import {voiceModelPicker} from '../src/client/voice-models.js';
import type {PublicServiceProfile} from '../src/core/service-management.js';
import {createUI} from '../src/client/ui.js';
import {v4ConfigSchema} from '../src/core/types.js';

const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};
const nodes=(tree:any)=>{const result:any[]=[];const walk=(node:any)=>{if(!node||typeof node!=='object')return;result.push(node);node.children?.forEach(walk);};walk(tree);return result;};
const config=v4ConfigSchema.parse({schemaVersion:4,id:'panel',name:'Panel',revision:4,personaPrompt:'A',tools:['bot_music','bot_sing'],skills:['music-download','singing-conversion'],media:{music:{enabled:true,profileRef:{serviceId:'music',profileId:'blocked'},includeLyrics:true},singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'missing'}}}});
const profiles:PublicServiceProfile[]=[
  {serviceId:'music',profileId:'blocked',revision:2,contentHash:'a'.repeat(64),state:'blocked',capabilities:['music.search','music.acquire'],displayName:'Managed Music',modelLabel:'Catalog A',updatedAt:1},
  {serviceId:'rvc',profileId:'missing',revision:3,contentHash:'b'.repeat(64),state:'missing',capabilities:['rvc.convert'],displayName:'Managed Voice',modelLabel:'Catalog B',updatedAt:1},
];

test('media cards keep unavailable selections without exposing internal status or verification controls',()=>{const ui=createUI(React,false,()=>{});
  const music=nodes(musicCard(React.createElement,ui,config,profiles,()=>{}));
  const picker=voiceModelPicker(React.createElement,ui,{role:'singing',config,profiles,busy:false,dirty:false,existing:true,apply:async()=>{}});
  const singing=nodes(singingCard(React.createElement,ui,config,()=>{},picker));
  for(const [rows,value,label] of [[music,'music/blocked','音乐来源'],[singing,'rvc/missing','唱歌音色']] as const){assert.ok(rows.some(node=>node.type==='label'&&node.children[0]===label));assert.equal(rows.find(node=>node.type==='option'&&node.props.value===value).props.disabled,true);assert.ok(!rows.some(node=>node.type==='label'&&/endpoint|地址|端口|path|路径|weight|权重|credential|凭据|locator/i.test(String(node.children[0]))));assert.ok(!rows.some(node=>node.type==='button'&&/检查|验收|测试/.test(String(node.children[0]))));}
  assert.ok(music.some(node=>node.props?.role==='switch'&&node.props['aria-label']==='下载时附带歌词'));
});

test('panel implementation has no persona-level service endpoint path weight credential or locator controls',async()=>{const files=['src/client/index.ts','src/client/music.ts','src/client/singing.ts'];const source=(await Promise.all(files.map(file=>readFile(path.resolve(file),'utf8')))).join('\n');for(const forbidden of ["ui.field('推理服务地址'","ui.field('RVC 服务地址'","ui.field('GPT 权重路径'","ui.field('SoVITS 权重路径'","ui.field('参考音频路径'","ui.field('RVC 角色权重路径'","ui.field('RVC 索引路径'","ui.field('分离模型权重路径'","ui.field('密钥变量'"])assert.doesNotMatch(source,new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.doesNotMatch(source,/v3 只读兼容配置|下次保存只写 v4|migrationRequired/);});
