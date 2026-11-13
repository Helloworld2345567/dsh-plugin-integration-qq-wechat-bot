import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPanelServiceHealth,modelLibraryLabel,serviceHealthLabel} from '../src/client/service-health.js';
import {chinese} from '../src/client/locale.js';

const profile=(serviceId:string,profileId:string,state='ready')=>({serviceId,profileId,state,capabilities:[serviceId==='rvc'?'rvc.convert':`${serviceId}.speak`]});

test('service health probes one usable profile per speech service and does not probe the RVC directory',async()=>{
  const calls:any[]=[];
  const health=await loadPanelServiceHealth(async(name,input)=>{calls.push({name,input});return{state:input.serviceId==='gpt-sovits'?'ready':'unavailable',checkedAt:123};},[
    profile('gpt-sovits','blocked','blocked'),profile('gpt-sovits','partial','partial'),profile('gpt-sovits','ready'),profile('gpt-sovits','second-ready'),profile('breeze-tts','breeze'),profile('rvc','rvc'),
  ]);
  assert.deepEqual(calls,[{name:'service.health',input:{serviceId:'gpt-sovits',profileId:'ready'}},{name:'service.health',input:{serviceId:'breeze-tts',profileId:'breeze'}}]);
  assert.equal(health['gpt-sovits'].state,'ready');assert.equal(health['breeze-tts'].state,'unavailable');assert.equal(health.rvc,undefined);
});

test('unconfigured, unknown and failed probes are not presented as a failed connection',async()=>{
  assert.equal(serviceHealthLabel(undefined,chinese),'未知');
  const missing=await loadPanelServiceHealth(async()=>{throw Error('Unexpected probe');},[]);
  assert.equal(serviceHealthLabel(missing['gpt-sovits'],chinese),'待配置');assert.equal(serviceHealthLabel(missing['breeze-tts'],chinese),'待配置');
  const unknown=await loadPanelServiceHealth(async()=>{throw Error('查询失败');},[profile('gpt-sovits','ready'),profile('breeze-tts','blocked','blocked')]);
  assert.equal(unknown['gpt-sovits'].safeDiagnostic,'查询失败');assert.equal(serviceHealthLabel(unknown['gpt-sovits'],chinese),'未知');assert.equal(serviceHealthLabel(unknown['breeze-tts'],chinese),'未知');
  assert.equal(serviceHealthLabel({state:'unavailable'},chinese),'连接失败');
  assert.equal(modelLibraryLabel({state:'ready',checkedAt:123},chinese),'已配置');assert.equal(modelLibraryLabel({state:'ready',checkedAt:0},chinese),'未知');assert.equal(modelLibraryLabel({state:'blocked',checkedAt:123},chinese),'异常');
});

test('overview and services load real health, and service actions refresh profiles, reports and health',async()=>{
  const flatten=(node:any):any[]=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(flatten)]:[];
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  for(const page of ['overview','services']){
    const previousWindow=(globalThis as any).window,previousFetch=globalThis.fetch;
    const summary={bots:[],configs:[],counts:{pendingDeliveries:0},health:{activeTasks:0,serviceRunning:false}};
    let settings:any={revision:'sha256:'+'1'.repeat(64),modelsRoot:'E:\\models',gptSovitsUrl:'http://127.0.0.1:9880',breezeTtsUrl:'http://127.0.0.1:8080',gptSovitsProjectRoot:'E:\\gpt',breezeTtsProjectRoot:'E:\\breeze',breezeTtsVoicesRoot:'E:\\breeze\\voices',imageProtocol:'comfyui',comfyUiBaseUrl:'http://127.0.0.1:8188',comfyUiWorkflowPath:'E:\\COMFYUI\\workflows\\fixture.json',reports:{rvc:{state:'ready',checkedAt:123,profileCount:1,diagnostics:[]}}};
    const calls:any[]=[],effects:Array<()=>unknown>=[],cleanups:Array<()=>void>=[],states:any[]=[page,summary],refs:any[]=[];
    let app:any,cursor=0,refCursor=0,mounted=false,healthState='ready';
    const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useRef:(initial:any)=>{const i=refCursor++;return refs[i]??=({current:initial});},useEffect:(effect:()=>unknown)=>{if(!mounted)effects.push(effect);}};
    const locale={register:()=>()=>{},bind:()=>chinese};
    (globalThis as any).window={__BOT_INTEGRATION__:{endpoint:'http://fixture.invalid',token:'fixture'},__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({locale,effect:(fn:any)=>fn(),slots:{inject:(_slot:any,fn:any)=>fn(),register:(_meta:any,component:any)=>{app=component;}}})}};
    globalThis.fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));calls.push(body);
      if(body.name==='catalog.profiles')return Response.json({result:{items:[profile('gpt-sovits','gpt'),profile('breeze-tts','breeze'),profile('rvc','rvc')],nextCursor:null}});
      if(body.name==='service.settings')return Response.json({result:{data:settings}});
      if(body.name==='service.health')return Response.json({result:{data:{state:healthState,checkedAt:123}}});
      if(body.name==='service.settings.save'){const {expectedRevision,...next}=body.input;settings={...settings,...next};return Response.json({result:{data:settings}});}
      if(body.name==='service.start')return Response.json({result:{data:{state:'already-running'}}});
      return Response.json({result:{data:summary}});
    };
    const render=()=>{cursor=0;refCursor=0;return flatten(app());};
    try{
      await import(new URL('../src/client/index.ts?service-health-'+page,import.meta.url).href);
      let tree=render();assert.ok(!tree.some(n=>n.props?.className==='badge'&&n.children.includes('连接失败')));
      mounted=true;for(const effect of effects){const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup as ()=>void);}
      await settle();await settle();tree=render();
      assert.equal(calls.filter(call=>call.name==='service.health').length,2);assert.ok(tree.some(n=>n.children.includes('连接正常')));assert.ok(tree.some(n=>n.children.includes('已配置')));
      if(page==='services'){
        assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('启动 ComfyUI')));assert.ok(!tree.some(n=>n.type==='p'&&n.children.includes('选择 ComfyUI 后将提交 API 格式工作流')));
        assert.ok(tree.some(n=>n.props?.role==='status'&&n.children.includes('已停止')));
        for(const action of ['refresh','save','start']){
          const previousHealthCalls=calls.filter(call=>call.name==='service.health').length,previousProfileCalls=calls.filter(call=>call.name==='catalog.profiles').length;
          healthState=action==='start'?'ready':'unavailable';tree=render();
          if(action==='save'){tree.find(n=>n.type==='label'&&n.children[0]==='GPT-SoVITS 服务地址').children[1].props.onChange({target:{value:'http://127.0.0.1:9881'}});tree=render();}
          const label=action==='refresh'?'刷新':action==='save'?'保存':'启动 GPT-SoVITS';
          const button=tree.find(n=>n.type==='button'&&n.children.includes(label));assert.equal(button.props.disabled,false);button.props.onClick();await settle();await settle();
          tree=render();assert.equal(calls.filter(call=>call.name==='service.health').length,previousHealthCalls+2);assert.equal(calls.filter(call=>call.name==='catalog.profiles').length,previousProfileCalls+1);
          assert.ok(tree.some(n=>n.children.includes(action==='start'?'连接正常':'连接失败')));
        }
      }
    }finally{for(const cleanup of cleanups)cleanup();(globalThis as any).window=previousWindow;globalThis.fetch=previousFetch;}
  }
});
