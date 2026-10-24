import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUI,dateInput,scheduledTime} from '../src/client/ui.js';

test('switches expose their state and handle failed actions',async()=>{
  const errors:string[]=[];let calls=0;
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};
  const toggle=createUI(React,false,e=>errors.push(e)).toggle('图片',true,()=>{calls++;throw Error('保存失败');});
  const control=toggle.children[1];
  assert.equal(control.props.role,'switch');assert.equal(control.props['aria-checked'],true);assert.equal(control.props['aria-label'],'图片');
  control.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);assert.deepEqual(errors,['保存失败']);
  assert.equal(createUI(React,true,()=>{}).toggle('图片',false,()=>{}).children[1].props.disabled,true);
});

test('schedule input uses the selected timezone, including daylight saving',()=>{
  assert.equal(new Date(scheduledTime('2026-10-24T18:30','Asia/Shanghai')).toISOString(),'2026-10-24T10:30:00.000Z');
  assert.equal(new Date(scheduledTime('2026-10-24T18:30','Asia/Tokyo')).toISOString(),'2026-10-24T09:30:00.000Z');
  assert.equal(new Date(scheduledTime('2026-07-01T18:30','America/New_York')).toISOString(),'2026-07-01T22:30:00.000Z');
  assert.equal(dateInput(Date.parse('2026-10-24T10:30:00Z'),'Asia/Shanghai'),'2026-10-24T18:30');
  assert.throws(()=>scheduledTime('2026-03-08T02:30','America/New_York'),/不存在/);
  assert.throws(()=>scheduledTime('2026-02-30T12:00','Asia/Shanghai'),/不存在/);
});

test('controlled selects capture the new value before React restores the DOM',async()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};let selected='old';
  const field=createUI(React,false,()=>{}).select('人格','old',[{id:'old'},{id:'next'}],value=>{selected=value;});
  const target={value:'next'};field.children[1].props.onChange({target});target.value='old';
  await new Promise(resolve=>setImmediate(resolve));assert.equal(selected,'next');
});

test('panel retains summary options, drafts and local errors across its sections',async()=>{
  const config={id:'default',name:'默认',revision:1,personaPrompt:'hello',tools:[],skills:[],hostTools:[],media:{image:{enabled:false}},allowHostTools:false};
  const summary={bots:[],configs:[config,{id:'other',name:'其他人格'}],counts:{bots:0,configs:2,pendingDeliveries:0},health:{activeTasks:0}};
  let app:any,cursor=0;const states:any[]=['catalog',summary,'加载错误','操作错误','',false,[],config,false,false,'basic'];
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(value:any)=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:()=>({current:null}),useEffect:()=>{}};
  const previous=(globalThis as any).window;
  (globalThis as any).window={__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({slots:{inject:(_slot:any,register:any)=>register(),register:(_meta:any,component:any)=>{app=component;}}})}};
  const nodes=(tree:any)=>{const result:any[]=[];const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}result.push(node);node.children?.forEach(walk);};walk(tree);return result;};
  const render=()=>{cursor=0;return nodes(app());};
  try{
    await import('../src/client/index.js');let tree=render();
    assert.ok(tree.some(n=>n.type==='option'&&n.children.includes('其他人格')));
    assert.ok(tree.some(n=>n.props?.role==='alert'&&n.children[0]==='加载错误\n操作错误'));
    assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('自动化')));
    const nameLabel=tree.find(n=>n.type==='label'&&n.children[0]==='名称');nameLabel.children[1].props.onChange({target:{value:'未保存的人格'}});
    tree=render();tree.find(n=>n.type==='button'&&n.children.includes('媒体')).props.onClick();await new Promise(resolve=>setImmediate(resolve));
    tree=render();assert.ok(tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='图片'&&!n.props['aria-checked']));
    assert.ok(!tree.some(n=>n.type==='input'&&n.props.type==='checkbox'));
    tree.find(n=>n.props?.role==='switch'&&n.props['aria-label']==='图片').props.onClick();await new Promise(resolve=>setImmediate(resolve));
    tree=render();assert.equal(states[7].name,'未保存的人格');assert.equal(states[7].media.image.enabled,true);assert.equal(states[8],true);
    assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('保存')&&!n.props.disabled));
    states[0]='overview';tree=render();assert.ok(tree.some(n=>n.props?.role==='alert'));
    states[0]='catalog';states[7]=null;tree=render();assert.ok(tree.some(n=>n.type==='option'&&n.children.includes('其他人格')));
    assert.ok(!tree.some(n=>n.props?.role==='switch'));
  }finally{(globalThis as any).window=previous;}
});
