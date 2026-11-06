import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configSchema} from '../src/core/types.js';
import {chinese} from '../src/client/locale.js';

test('default and new personas can refresh and change both voices in one valid draft before saving',async()=>{
  const initial=configSchema.parse({schemaVersion:4,id:'default',name:'默认',personaPrompt:'Original',media:{voice:{enabled:false,protocol:'edge_tts'}}});
  const summary={bots:[],configs:[initial],counts:{pendingDeliveries:0},health:{activeTasks:0}};
  const profiles=['gpt-sovits','rvc'].flatMap(serviceId=>['first','second'].map(profileId=>({serviceId,profileId,state:'ready',displayName:profileId,capabilities:[serviceId==='rvc'?'rvc.convert':'gpt-sovits.speak']})));
  let app:any,cursor=0;const states:any[]=['catalog',summary,'','','',false,[],initial,false,false,'media'];const calls:any[]=[];
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useRef:()=>({current:null}),useEffect:()=>{}};
  const previous=(globalThis as any).window,previousFetch=globalThis.fetch;
  const locale={register:()=>()=>{},bind:()=>chinese};
  (globalThis as any).window={__BOT_INTEGRATION__:{endpoint:'http://fixture.invalid',token:'fixture'},__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({locale,effect:(fn:any)=>fn(),slots:{inject:(_slot:any,fn:any)=>fn(),register:(_meta:any,component:any)=>{app=component;}}})}};
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));calls.push(body);
    if(body.action==='config.save'){const config=configSchema.parse(body.input.config);return Response.json({result:{...config,revision:config.revision+1}});}
    if(body.name==='catalog.profiles')return Response.json({result:{items:profiles,nextCursor:null}});
    return Response.json({result:body.name==='overview.summary'?{data:summary}:body.action==='skill.image.status'?{}:{data:{}}});
  };
  const flatten=(node:any):any[]=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(flatten)]:[];
  const render=()=>{cursor=0;return flatten(app());};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const section=(key:string)=>flatten(render().find(n=>n.props?.key===key));
  const select=async(key:string,label:string,value:string)=>{const control=section(key).find(n=>n.type==='label'&&n.children[0]===label).children[1];assert.equal(control.props.disabled,false);control.props.onChange({target:{value}});await settle();};
  try{
    await import(new URL('../src/client/index.ts?voice-draft',import.meta.url).href);render();
    section('voice').find(n=>n.props?.role==='switch').props.onClick();await settle();
    assert.ok(states[7].tools.includes('bot_voice'));assert.ok(states[7].skills.includes('voice-generation'));
    await select('voice','引擎','gpt-sovits');
    section('voice').find(n=>n.type==='button'&&n.children.includes('刷新')).props.onClick();await settle();await settle();
    assert.equal(calls.find(c=>c.name==='service.refresh').input.serviceId,'gpt-sovits');assert.equal(states[8],true);
    await select('voice','说话','gpt-sovits/first');await select('voice','说话','gpt-sovits/second');
    section('singing').find(n=>n.props?.role==='switch').props.onClick();await settle();
    await select('singing','唱歌','rvc/first');await select('singing','唱歌','rvc/second');
    assert.equal(calls.some(c=>c.action==='config.save'),false,'selection is a local draft');
    assert.equal(states[7].media.voice.profileRef.profileId,'second');assert.equal(states[7].media.singing.profileRef.profileId,'second');
    for(const role of ['asr','video']){const controls=section(role);assert.ok(!controls.some(n=>n.type==='label'&&['提供商','模型'].includes(n.children[0])));}
    render().find(n=>n.type==='button'&&n.props.className==='primary'&&n.children.includes('保存')).props.onClick();await settle();await settle();
    assert.equal(calls.filter(c=>c.action==='config.save').length,1);assert.equal(states[8],false);
    assert.equal(configSchema.parse(states[7]).media.voice?.profileRef?.profileId,'second');
    render().find(n=>n.type==='button'&&n.children.includes('新建')).props.onClick();await settle();
    states[10]='media';states[7].media.voice.engine='gpt-sovits';states[7].media.voice.protocol=undefined;await settle();await select('voice','说话','gpt-sovits/first');await select('singing','唱歌','rvc/first');
    assert.equal(states[7].id,'');assert.equal(states[7].media.voice.profileRef.profileId,'first');assert.equal(states[7].media.singing.profileRef.profileId,'first');
  }finally{(globalThis as any).window=previous;globalThis.fetch=previousFetch;}
});
