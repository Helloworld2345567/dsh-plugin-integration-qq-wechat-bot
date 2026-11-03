import {test} from 'node:test';
import assert from 'node:assert/strict';
import {botSchema,configSchema,type CallerScope} from '../src/core/types.js';
import {allowedNow,freezeTurn,permissionsRevoked,permitted} from '../src/core/policy.js';
import {singingCard} from '../src/client/singing.js';
import {createUI} from '../src/client/ui.js';

const singing={enabled:true,profileRef:{serviceId:'rvc',profileId:'default'}};
const persona=()=>configSchema.parse({id:'singer',name:'Singer',personaPrompt:'A',skills:['singing-conversion'],tools:['bot_sing'],media:{singing}});
test('bot_sing requires current and frozen skill, tool and STS permissions',()=>{
  const config=persona();const bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',enabled:true});
  const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
  const snapshot=freezeTurn(config,bot,scope,[]);assert.equal(permitted('bot_sing',config,bot,scope),true);
  for(const revoked of [{...config,skills:[]},{...config,tools:[]},{...config,media:{singing:{...config.media.singing!,enabled:false}}},{...config,media:{}}]){
    assert.equal(allowedNow('bot_sing',snapshot,revoked,bot,scope),false);assert.equal(permissionsRevoked(snapshot,revoked,bot,scope),true);
  }
  assert.equal(allowedNow('bot_sing',freezeTurn({...config,tools:[]},bot,scope,[]),config,bot,scope),false);
});

test('STS card supports disabled drafts and enabling supplies dedicated permissions',async()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};const ui=createUI(React,false,()=>{});const config=configSchema.parse({id:'singer',name:'Singer',personaPrompt:'A',tools:[],skills:[]});let updated:any;
  const nodes:any[]=[];const walk=(item:any)=>{if(!item||typeof item!=='object')return;nodes.push(item);item.children?.forEach(walk);};
  walk(singingCard(React.createElement,ui,config,false,{revision:1,configured:false},[],{}, {},(patch:any)=>{updated=patch;},async()=>{},async()=>null,async()=>{},async()=>{}));
  assert.ok(nodes.some(node=>node.type==='small'&&String(node.children[0]).includes('唱歌音色列表')));
  assert.ok(nodes.some(node=>node.type==='small'&&String(node.children[0]).includes('本机路径')));
  assert.ok(!nodes.some(node=>node.type==='label'&&/权重路径|服务地址|locator|凭据/i.test(String(node.children[0]))));
  nodes.find(node=>node.props?.role==='switch').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updated.media.singing.enabled,true);assert.ok(updated.tools.includes('bot_sing'));assert.ok(updated.skills.includes('singing-conversion'));
});
