import {test} from 'node:test';
import assert from 'node:assert/strict';

test('catalog retains unloaded personas and keeps save outside collapsed details',async()=>{
  const config={id:'default',name:'默认',revision:1,tools:[],skills:[],hostTools:[],media:{}};
  let app:any;let cursor=0;
  const states:any[]=['catalog',{bots:[],configs:[config],sessions:[],deliveries:[],versions:[]},{configs:[config,{id:'sakura',name:'小樱'}],counts:{bots:0,configs:2,pendingDeliveries:0},health:{activeTasks:0}},'加载错误','操作错误'];
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;return[i<states.length?states[i]:initial,()=>{}];},useRef:()=>({current:null}),useEffect:()=>{}};
  const previous=(globalThis as any).window;
  (globalThis as any).window={__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({slots:{inject:(_slot:any,register:any)=>register(),register:(_meta:any,component:any)=>{app=component;}}})}};
  try{
    await import('../src/client/index.js');const tree=app();
    const nodes:Array<{node:any;parents:any[]}>=[];
    const walk=(node:any,parents:any[]=[])=>{if(!node||typeof node!=='object')return;nodes.push({node,parents});for(const child of node.children??[])walk(child,[...parents,node]);};walk(tree);
    assert.ok(nodes.some(({node})=>node.type==='button'&&node.children.includes('小樱')));
    assert.ok(!nodes.some(({node})=>node.children?.includes('进化')));
    const save=nodes.find(({node})=>node.type==='button'&&node.children.includes('保存'));assert.ok(save);
    assert.ok(!save.parents.some(node=>node.type==='details'));
    assert.ok(!nodes.some(({node})=>node.props?.role==='alert'));
    states[0]='overview';cursor=0;const overview=app();
    const alert=overview.children.find((node:any)=>node?.props?.role==='alert');assert.ok(alert);
    assert.equal(alert.children[0],'加载错误\n操作错误');
    assert.equal(overview.children.at(-2),alert);
  }finally{(globalThis as any).window=previous;}
});
