import {test} from 'node:test';
import assert from 'node:assert/strict';
import {botSettingsFromConfig,botSettingsSchema,configSchema} from '../src/core/types.js';
import {chinese} from '../src/client/locale.js';

test('bot voice drafts refresh, save independently and confirm before switching robots or pages',async()=>{
  const persona=configSchema.parse({schemaVersion:4,id:'default',name:'默认',personaPrompt:'Original',media:{voice:{enabled:false,protocol:'edge_tts'}}});
  let bots:any[]=['first','second'].map((id,index)=>({id,name:index?'机器人二':'机器人一',channel:'qq',configId:persona.id,enabled:false,status:'stopped',trustedUsers:[],settings:botSettingsFromConfig(persona)}));
  const summary=()=>({bots,configs:[persona],counts:{pendingDeliveries:0},health:{activeTasks:0,serviceRunning:true}});
  const profiles=['gpt-sovits','rvc'].flatMap(serviceId=>['first','second'].map(profileId=>({serviceId,profileId,state:'ready',displayName:profileId,capabilities:[serviceId==='rvc'?'rvc.convert':'gpt-sovits.speak']})));
  let app:any,cursor=0;const states:any[]=['bots',summary(),'','','',false,bots,persona,false,false,'basic'];states[28]='media';const calls:any[]=[];
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useRef:()=>({current:null}),useEffect:()=>{}};
  const previous=(globalThis as any).window,previousFetch=globalThis.fetch;
  const locale={register:()=>()=>{},bind:()=>chinese};
  (globalThis as any).window={__BOT_INTEGRATION__:{endpoint:'http://fixture.invalid',token:'fixture'},__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({locale,effect:(fn:any)=>fn(),slots:{inject:(_slot:any,fn:any)=>fn(),register:(_meta:any,component:any)=>{app=component;}}})}};
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));calls.push(body);
    if(body.action==='bot.save'){
      const next={...bots.find(bot=>bot.id===body.input.id),...body.input,settings:botSettingsSchema.parse(body.input.settings)};
      bots=bots.map(bot=>bot.id===next.id?next:bot);return Response.json({result:next});
    }
    if(body.name==='catalog.profiles')return Response.json({result:{items:profiles,nextCursor:null}});
    if(body.name==='catalog.config')return Response.json({result:{data:persona}});
    if(body.action==='skill.image.status'||body.action==='skill.media.status'){assert.deepEqual(body.input,{scope:'bots'});return Response.json({result:{}});}
    return Response.json({result:{data:body.name==='bots.list'?bots:summary()}});
  };
  const flatten=(node:any):any[]=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(flatten)]:[];
  const render=()=>{cursor=0;return flatten(app());};
  const currentDraft=():any=>states[29];
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const section=(key:string)=>flatten(render().find(n=>n.props?.key===key));
  const select=async(key:string,label:string,value:string)=>{const control=section(key).find(n=>n.type==='label'&&n.children[0]===label).children[1];assert.equal(control.props.disabled,false);control.props.onChange({target:{value}});await settle();};
  const clickBot=async(name:string)=>{render().find(n=>n.type==='button'&&n.props?.['aria-label']===name).props.onClick();await settle();};
  const showMedia=async(id:string)=>{render().find(n=>n.props?.id==='bot-detail-'+id+'-media').props.onClick();await settle();};
  const dialog=()=>render().find(n=>n.props?.role==='dialog');
  const cancel=async()=>{flatten(dialog()).find(n=>n.type==='button'&&n.children.includes('取消')).props.onClick();await settle();};
  const confirm=async()=>{dialog().props.onSubmit({preventDefault:()=>{}});await settle();await settle();};
  const openPersonas=async()=>{render().find(n=>n.type==='button'&&n.props?.className?.includes('sidebar-item')&&n.children.includes('人格')).props.onClick();await settle();};
  try{
    await import(new URL('../src/client/index.ts?bot-voice-draft',import.meta.url).href);render();
    section('voice').find(n=>n.props?.role==='switch').props.onClick();await settle();
    assert.ok(states[29].settings.tools.includes('bot_voice'));assert.ok(states[29].settings.skills.includes('voice-generation'));
    await select('voice','引擎','gpt-sovits');
    section('voice').find(n=>n.type==='button'&&n.children.includes('刷新')).props.onClick();await settle();await settle();
    assert.equal(calls.find(c=>c.name==='service.refresh').input.serviceId,'gpt-sovits');assert.equal(states[29].id,'first');
    await select('voice','说话','gpt-sovits/first');await select('voice','说话','gpt-sovits/second');
    const voiceControls=section('voice');
    assert.ok(voiceControls.some(n=>n.type==='option'&&n.children.includes('文字 + 语音')));
    assert.ok(!voiceControls.some(n=>n.type==='label'&&/提供商|权重|凭据|locator/i.test(String(n.children[0]))));
    section('singing').find(n=>n.props?.role==='switch').props.onClick();await settle();
    await select('singing','唱歌','rvc/first');await select('singing','唱歌','rvc/second');
    assert.equal(calls.some(c=>c.action==='bot.save'||c.action==='config.save'),false,'selection stays in the robot draft');
    assert.equal(states[29].settings.media.voice.profileRef.profileId,'second');assert.equal(states[29].settings.media.singing.profileRef.profileId,'second');
    assert.equal(bots[0].settings.media.voice.enabled,false);assert.equal(bots[1].settings.media.voice.enabled,false);assert.equal(persona.media.voice?.enabled,false);
    for(const role of ['asr','video']){const controls=section(role);assert.ok(!controls.some(n=>n.type==='label'&&['提供商','模型'].includes(n.children[0])));}
    render().find(n=>n.type==='button'&&n.props.className==='primary'&&n.children.includes('保存')).props.onClick();await settle();await settle();
    assert.equal(calls.filter(c=>c.action==='bot.save').length,1);assert.equal(states[29],null);
    const savedFirst=botSettingsSchema.parse(bots[0].settings);
    assert.equal(savedFirst.media.voice?.profileRef?.profileId,'second');assert.equal(savedFirst.media.singing?.profileRef?.profileId,'second');
    assert.equal(bots[1].settings.media.voice.enabled,false);assert.equal(calls.some(c=>c.action==='config.save'),false);

    await clickBot('机器人二');await showMedia('second');
    assert.equal(states[27],'second');assert.equal(section('voice').find(n=>n.props?.role==='switch').props['aria-checked'],false);
    section('voice').find(n=>n.props?.role==='switch').props.onClick();await settle();
    await select('voice','引擎','gpt-sovits');await select('voice','说话','gpt-sovits/first');
    section('singing').find(n=>n.props?.role==='switch').props.onClick();await settle();await select('singing','唱歌','rvc/first');
    assert.equal(currentDraft().id,'second');assert.equal(currentDraft().settings.media.voice.profileRef.profileId,'first');
    await clickBot('机器人一');
    assert.match(dialog().props['aria-label'],/未保存/);assert.equal(states[27],'second');
    await cancel();assert.equal(states[27],'second');assert.equal(currentDraft().settings.media.voice.profileRef.profileId,'first');
    await clickBot('机器人一');await confirm();await showMedia('first');
    assert.equal(states[27],'first');assert.equal(states[29],null);
    assert.equal(section('voice').find(n=>n.type==='label'&&n.children[0]==='说话').children[1].props.value,'gpt-sovits/second');
    assert.equal(section('singing').find(n=>n.type==='label'&&n.children[0]==='唱歌').children[1].props.value,'rvc/second');

    await select('voice','说话','gpt-sovits/first');await openPersonas();
    assert.match(dialog().props['aria-label'],/未保存/);assert.equal(states[0],'bots');
    await cancel();assert.equal(states[0],'bots');assert.equal(currentDraft().settings.media.voice.profileRef.profileId,'first');
    await openPersonas();await confirm();assert.equal(states[0],'catalog');assert.equal(states[29],null);
    assert.equal(savedFirst.media.voice?.profileRef?.profileId,'second');assert.equal(bots[0].settings.media.voice.profileRef.profileId,'second');assert.equal(bots[1].settings.media.voice.enabled,false);
    render().find(n=>n.type==='button'&&n.props?.['aria-label']==='默认').props.onClick();await settle();
    const personaTree=render();assert.ok(personaTree.some(n=>n.type==='label'&&n.children[0]==='人设'));assert.ok(!personaTree.some(n=>n.type==='button'&&n.children.includes('媒体')));
    assert.equal(persona.media.voice?.enabled,false);assert.equal(calls.filter(c=>c.action==='bot.save').length,1);
  }finally{(globalThis as any).window=previous;globalThis.fetch=previousFetch;}
});
