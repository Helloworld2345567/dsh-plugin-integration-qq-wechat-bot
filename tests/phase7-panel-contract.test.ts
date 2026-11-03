import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {musicCard} from '../src/client/music.js';
import {singingCard} from '../src/client/singing.js';
import {createUI} from '../src/client/ui.js';
import {v4ConfigSchema} from '../src/core/types.js';

const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};
const nodes=(tree:any)=>{const result:any[]=[];const walk=(node:any)=>{if(!node||typeof node!=='object')return;result.push(node);node.children?.forEach(walk);};walk(tree);return result;};
const config=v4ConfigSchema.parse({schemaVersion:4,id:'panel',name:'Panel',revision:4,personaPrompt:'A',tools:['bot_music','bot_sing'],skills:['music-download','singing-conversion'],media:{music:{enabled:true,profileRef:{serviceId:'music',profileId:'blocked'},includeLyrics:true},singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'missing'}}}});
const profiles=[
  {serviceId:'music',profileId:'blocked',revision:2,contentHash:'a'.repeat(64),state:'blocked',capabilities:['music.search','music.acquire'],displayName:'Managed Music',modelLabel:'Catalog A',updatedAt:1},
  {serviceId:'rvc',profileId:'missing',revision:3,contentHash:'b'.repeat(64),state:'missing',capabilities:['rvc.convert'],displayName:'Managed Voice',modelLabel:'Catalog B',updatedAt:1},
];

test('v4 service cards render selectors and explicit blocked/missing states without private inputs',()=>{const ui=createUI(React,false,()=>{}),common=[()=>{},async()=>{},async()=>null,async()=>{},async()=>{}] as const;
  const music=nodes(musicCard(React.createElement,ui,config,false,{revision:4},profiles,{}, {},common[0],common[1],common[2],common[3],common[4]));
  const singing=nodes(singingCard(React.createElement,ui,config,false,{revision:4},profiles,{}, {},common[0],common[1],common[2],common[3],common[4]));
  for(const [rows,state,label] of [[music,'blocked','音乐 Profile'],[singing,'missing','说话人编号']] as const){assert.ok(rows.some(node=>node.type==='label'&&node.children[0]===label));assert.ok(rows.some(node=>String(node.children?.[0]??'').includes(state)));assert.ok(!rows.some(node=>node.type==='label'&&/endpoint|地址|端口|path|路径|weight|权重|credential|凭据|locator/i.test(String(node.children[0]))));}
  assert.ok(music.some(node=>node.props?.role==='switch'&&node.props['aria-label']==='下载时附带歌词'));
});

test('panel implementation has no persona-level service endpoint path weight credential or locator controls',async()=>{const files=['src/client/index.ts','src/client/music.ts','src/client/singing.ts'];const source=(await Promise.all(files.map(file=>readFile(path.resolve(file),'utf8')))).join('\n');for(const forbidden of ["ui.field('推理服务地址'","ui.field('RVC 服务地址'","ui.field('GPT 权重路径'","ui.field('SoVITS 权重路径'","ui.field('参考音频路径'","ui.field('RVC 角色权重路径'","ui.field('RVC 索引路径'","ui.field('分离模型权重路径'","ui.field('密钥变量'"])assert.doesNotMatch(source,new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.doesNotMatch(source,/v3 只读兼容配置|下次保存只写 v4|migrationRequired/);});
