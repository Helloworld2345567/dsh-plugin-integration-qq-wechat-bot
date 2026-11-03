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
  const picker=React.createElement('select',{'aria-label':'唱歌音色'}),tree=singingCard(React.createElement,ui,config,(patch:any)=>{updated=patch;},picker);walk(tree);
  assert.ok(nodes.includes(picker));
  assert.equal(tree.children[1],picker);
  assert.deepEqual(nodes.filter(node=>node.type==='label').map(node=>node.children[0]),['说话人编号','音高调整（半音）','转换输出']);
  assert.doesNotMatch(JSON.stringify(nodes),/验收|health|acceptance|测试|权重|locator/);
  assert.ok(!nodes.some(node=>node.type==='label'&&/权重路径|服务地址|locator|凭据/i.test(String(node.children[0]))));
  nodes.find(node=>node.props?.role==='switch').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updated.media.singing.enabled,true);assert.ok(updated.tools.includes('bot_sing'));assert.ok(updated.skills.includes('singing-conversion'));
});
