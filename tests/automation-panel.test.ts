import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AutomationPanel} from '../src/client/automation.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mount(overrides:Record<string,any>={}){
  const slots:any[]=[];let cursor=0;let effects:Array<()=>void>=[];
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),
    useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(v:any)=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef(initial:any){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
    useEffect(effect:()=>any,deps:any[]){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j])){effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:effect()};});}}};
  const props:any={React,active:true,busy:false,configs:[{id:'default',name:'默认'},{id:'other',name:'其他'}],bots:[{id:'bot',name:'助手',configId:'default'}],confirm:async()=>true,onError:()=>{},...overrides};
  const render=()=>{cursor=0;effects=[];const tree=AutomationPanel(props);for(const effect of effects)effect();const nodes:any[]=[];const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}nodes.push(node);node.children?.forEach(walk);};walk(tree);return nodes;};
  return {props,render};
}
const snapshot=(configId='default')=>({scopes:[{scopeKey:'scope',configId,botId:'bot',senderId:'user'}],proactive:[],scheduled:[]});

test('automation refreshes on re-entry and after persona binding changes',async()=>{
  let reads=0;let current=snapshot();const m=mount({query:async()=>{reads++;return current;},mutate:async()=>{}});
  m.render();await settle();assert.ok(m.render().some(n=>n.props?.role==='switch'));
  m.props.active=false;m.render();current=snapshot('other');m.props.bots=[{id:'bot',configId:'other'}];m.render();assert.equal(reads,1);
  m.props.active=true;m.render();await settle();const nodes=m.render();assert.equal(reads,2);
  assert.ok(nodes.some(n=>n.children?.includes('此人格暂无私聊会话，收到私聊后可设置自动化。')));
  assert.ok(!nodes.some(n=>n.props?.role==='switch'));
  current=snapshot();m.props.bots=[{id:'bot',configId:'default'}];m.render();await settle();assert.ok(m.render().some(n=>n.props?.role==='switch'));assert.equal(reads,3);
});

test('successful creation followed by refresh failure cannot resubmit the same form',async()=>{
  let failRead=false,creates=0;const errors:string[]=[];const messages:string[]=[];
  const m=mount({query:async()=>{if(failRead)throw Error('网络不可用');return snapshot();},mutate:async(action:string,input:any,message:string)=>{assert.equal(action,'automation.schedule');assert.equal(input.scopeKey,'scope');assert.equal(JSON.parse(input.args).prompt,'只创建一次');creates++;messages.push(message);failRead=true;},onError:(e:string)=>errors.push(e)});
  m.render();await settle();let nodes=m.render();nodes.find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();nodes=m.render();
  nodes.find(n=>n.type==='textarea').props.onChange({target:{value:'只创建一次'}});nodes=m.render();
  nodes.find(n=>n.type==='button'&&n.children.includes('创建')).props.onClick();await settle();nodes=m.render();
  assert.equal(creates,1);assert.deepEqual(messages,['已创建']);assert.ok(errors.some(e=>e.includes('操作已完成')));
  assert.ok(!nodes.some(n=>n.type==='button'&&n.children.includes('创建')));
  failRead=false;nodes.find(n=>n.type==='button'&&n.children.includes('刷新')).props.onClick();await settle();nodes=m.render();
  assert.equal(creates,1);assert.ok(!nodes.some(n=>n.type==='textarea'));
});

test('failed creation keeps the editable task draft for retry',async()=>{
  const errors:string[]=[];const m=mount({query:async()=>snapshot(),mutate:async()=>{throw Error('写入失败');},onError:(e:string)=>errors.push(e)});
  m.render();await settle();m.render().find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();
  m.render().find(n=>n.type==='textarea').props.onChange({target:{value:'保留这个任务'}});
  m.render().find(n=>n.type==='button'&&n.children.includes('创建')).props.onClick();await settle();
  assert.equal(m.render().find(n=>n.type==='textarea').props.value,'保留这个任务');assert.deepEqual(errors,['写入失败']);
});
