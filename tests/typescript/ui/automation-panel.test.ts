import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AutomationPanel} from '../../../src/client/automation.js';
import {renderText,type DisplayText} from '../../../src/client/locale.js';

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
  const m=mount({query:async()=>{if(failRead)throw Error('网络不可用');return snapshot();},mutate:async(action:string,input:any,message:DisplayText)=>{assert.equal(action,'automation.schedule');assert.equal(input.scopeKey,'scope');assert.equal(JSON.parse(input.args).prompt,'只创建一次');creates++;messages.push(renderText(message));failRead=true;},onError:(e:DisplayText)=>errors.push(renderText(e))});
  m.render();await settle();let nodes=m.render();nodes.find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();nodes=m.render();
  nodes.find(n=>n.type==='textarea').props.onChange({target:{value:'只创建一次'}});nodes=m.render();
  nodes.find(n=>n.type==='form'&&n.props.className==='detail-body').props.onSubmit({preventDefault:()=>{}});await settle();nodes=m.render();
  assert.equal(creates,1);assert.deepEqual(messages,['已创建']);assert.ok(errors.some(e=>e.includes('操作已完成')));
  assert.ok(!nodes.some(n=>n.type==='button'&&n.children.includes('创建')));
  failRead=false;nodes.find(n=>n.type==='button'&&n.children.includes('刷新')).props.onClick();await settle();nodes=m.render();
  assert.equal(creates,1);assert.ok(!nodes.some(n=>n.type==='textarea'));
});

test('failed creation keeps the editable task draft for retry',async()=>{
  const errors:string[]=[];const m=mount({query:async()=>snapshot(),mutate:async()=>{throw Error('写入失败');},onError:(e:string)=>errors.push(e)});
  m.render();await settle();m.render().find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();
  m.render().find(n=>n.type==='textarea').props.onChange({target:{value:'保留这个任务'}});
  m.render().find(n=>n.type==='form'&&n.props.className==='detail-body').props.onSubmit({preventDefault:()=>{}});await settle();
  assert.equal(m.render().find(n=>n.type==='textarea').props.value,'保留这个任务');assert.deepEqual(errors,['写入失败']);
});

test('automation refresh failure keeps the list and draft, and restoring the baseline clears dirty',async()=>{
  let failRead=false;let draftState:any;
  const m=mount({query:async()=>{if(failRead)throw Error('refresh failed');return snapshot();},mutate:async()=>{},onDraftState:(state:any)=>{draftState=state;}});
  m.render();await settle();let nodes=m.render();
  const daily=(items:any[])=>items.find(n=>n.type==='input'&&n.props.id==='automation-daily-limit');
  daily(nodes).props.onChange({target:{value:'5'}});nodes=m.render();assert.equal(draftState.dirty,true);
  failRead=true;nodes.find(n=>n.type==='button'&&n.children.includes('刷新')).props.onClick();await settle();nodes=m.render();
  assert.equal(daily(nodes).props.value,5);assert.ok(nodes.some(n=>n.props?.role==='switch'));assert.equal(draftState.dirty,true);
  daily(nodes).props.onChange({target:{value:'3'}});m.render();assert.equal(draftState.dirty,false);
});

test('automation protects a new schedule when switching session or cancelling',async()=>{
  let resolutions=0;let discard=false;let draftState:any;
  const m=mount({query:async()=>({...snapshot(),scopes:[...snapshot().scopes,{scopeKey:'second',configId:'default',botId:'bot',senderId:'second'}]}),mutate:async()=>{},onDraftState:(state:any)=>{draftState=state;},resolveDraft:async(_save:any,onDiscard:any)=>{resolutions++;if(discard)onDiscard();return discard;}});
  m.render();await settle();m.render().find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();
  m.render().find(n=>n.type==='textarea').props.onChange({target:{value:'待保存的任务'}});let nodes=m.render();assert.equal(draftState.dirty,true);
  const scopeSelect=(items:any[])=>items.find(n=>n.type==='label'&&n.children[0]==='目标会话').children[1];
  scopeSelect(nodes).props.onChange({target:{value:'second'}});await settle();nodes=m.render();
  assert.equal(scopeSelect(nodes).props.value,'scope');assert.equal(nodes.find(n=>n.type==='textarea').props.value,'待保存的任务');
  nodes.find(n=>n.type==='button'&&n.children.includes('取消')).props.onClick();await settle();assert.ok(m.render().some(n=>n.type==='textarea'));
  discard=true;scopeSelect(m.render()).props.onChange({target:{value:'second'}});await settle();nodes=m.render();
  assert.equal(scopeSelect(nodes).props.value,'second');assert.ok(!nodes.some(n=>n.type==='textarea'));assert.equal(draftState.dirty,false);assert.equal(resolutions,3);
});

test('saved proactive settings update their baseline even when the following refresh fails',async()=>{
  let saved=false,writes=0,draftState:any;
  const m=mount({query:async()=>{if(saved)throw Error('refresh failed');return snapshot();},mutate:async()=>{saved=true;writes++;},onDraftState:(state:any)=>{draftState=state;}});
  m.render();await settle();m.render().find(n=>n.props?.id==='automation-daily-limit').props.onChange({target:{value:'5'}});m.render();
  await draftState.save();let nodes=m.render();assert.equal(writes,1);assert.equal(draftState.dirty,false);
  assert.equal(nodes.find(n=>n.props?.id==='automation-daily-limit').props.value,5);
  await draftState.save();assert.equal(writes,1);
});

test('a pending task submission freezes its form and blocks discarding its draft',async()=>{
  let finish:()=>void;let draftState:any;
  const m=mount({query:async()=>snapshot(),mutate:()=>new Promise<void>(resolve=>{finish=resolve;}),onDraftState:(state:any)=>{draftState=state;}});
  m.render();await settle();m.render().find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();
  m.render().find(n=>n.type==='textarea').props.onChange({target:{value:'只提交一次'}});let nodes=m.render();
  nodes.find(n=>n.type==='form'&&n.props.className==='detail-body').props.onSubmit({preventDefault:()=>{}});await settle();nodes=m.render();
  assert.equal(nodes.find(n=>n.type==='button'&&n.children.includes('创建')).props.disabled,true);
  assert.throws(()=>draftState.discard(),/操作进行中/);assert.equal(nodes.find(n=>n.type==='textarea').props.value,'只提交一次');
  finish!();await settle();nodes=m.render();assert.ok(!nodes.some(n=>n.type==='textarea'));assert.equal(draftState.dirty,false);
});

