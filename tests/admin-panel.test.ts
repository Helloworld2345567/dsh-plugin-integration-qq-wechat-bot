import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUI,dateInput,scheduledTime} from '../src/client/ui.js';
import {chinese,english,message,type LocaleKey} from '../src/client/locale.js';
import {botSettingsFromConfig,botSettingsSchema,configSchema} from '../src/core/types.js';

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

test('an enabled bot in a stopped service shows an off switch that starts the bot',async()=>{
  const bot={id:'bot',name:'Bot',channel:'qq',configId:'default',enabled:true,status:'stopped',credentialConfigured:true,trustedUsers:[]};
  const summary={bots:[bot],configs:[{id:'default',name:'默认'}],counts:{pendingDeliveries:0},health:{activeTasks:0,serviceRunning:false}};
  let app:any,cursor=0;const states:any[]=['bots',summary,'','','',false,[bot]];const commands:any[]=[],strictCommands:any[]=[];
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(value:any)=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:()=>({current:null}),useEffect:()=>{}};
  const previous=(globalThis as any).window,previousFetch=globalThis.fetch;
  const locale={register:()=>()=>{},bind:()=>chinese};
  (globalThis as any).window={__BOT_INTEGRATION__:{endpoint:'http://fixture.invalid',token:'fixture'},__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({locale,effect:(callback:any)=>callback(),slots:{inject:(_slot:any,register:any)=>register(),register:(_meta:any,component:any)=>{app=component;}}})}};
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));if(body.action)commands.push(body);if(body.name)strictCommands.push(body);
    return Response.json({result:body.action?{ok:true}:{data:body.name==='bots.list'?[bot]:summary}});
  };
  const flatten=(node:any):any[]=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(flatten)]:[];
  const render=()=>{cursor=0;return flatten(app());};
  try{
    await import(new URL('../src/client/index.ts?stopped-service',import.meta.url).href);
    const serviceControl=render().find(node=>node.type==='button'&&node.props?.['aria-label']==='开启机器人服务');
    assert.ok(serviceControl);serviceControl.props.onClick();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(strictCommands[0],{version:1,kind:'command',name:'bot.service.start',input:{}});strictCommands.length=0;commands.length=0;
    const control=render().find(node=>node.props?.role==='switch'&&node.props['aria-label']==='运行');
    assert.equal(control.props['aria-checked'],false);control.props.onClick();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(commands,[{action:'bot.start',input:{id:'bot'}}]);assert.equal(bot.enabled,true);
    states[1]={...summary,health:{...summary.health,serviceRunning:true}};
    assert.equal(render().find(node=>node.props?.role==='switch'&&node.props['aria-label']==='运行').props['aria-checked'],false);
    for(const status of ['connecting','connected','error']){
      bot.status=status;
      assert.equal(render().find(node=>node.props?.role==='switch'&&node.props['aria-label']==='运行').props['aria-checked'],true);
    }
  }finally{(globalThis as any).window=previous;globalThis.fetch=previousFetch;}
});


const flattenPanel=(node:any):any[]=>Array.isArray(node)?node.flatMap(flattenPanel):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(flattenPanel)]:[];
const settlePanel=()=>new Promise(resolve=>setImmediate(resolve));

function panelHarness(states:any[],respond:(body:any)=>any,options:{locale?:'zh'|'en';settingsForm?:any}={}){
  let app:any,cursor=0,active=options.locale??'zh';
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],(value:any)=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:()=>({current:null}),useEffect:()=>{},useSyncExternalStore:(_subscribe:any,snapshot:any)=>snapshot()};
  const previousWindow=(globalThis as any).window,previousFetch=globalThis.fetch;
  const locale={getSnapshot:()=>({revision:1,active}),subscribe:()=>()=>{},register:()=>()=>{},bind:()=>(key:LocaleKey,params?:Record<string,unknown>)=>(active==='en'?english:chinese)(key,params)};
  (globalThis as any).window={__BOT_INTEGRATION__:{endpoint:'http://fixture.invalid',token:'fixture'},__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({locale,configForms:options.settingsForm?{get:()=>options.settingsForm}:undefined,effect:(callback:any)=>callback(),slots:{inject:(_slot:any,register:any)=>register(),register:(_meta:any,component:any)=>{app=component;}}})}};
  globalThis.fetch=async(_url,init)=>Response.json({result:await respond(JSON.parse(String(init?.body)))});
  return{
    start:async(name:string)=>{await import(new URL('../src/client/index.ts?'+name,import.meta.url).href);},
    render:()=>{cursor=0;return flattenPanel(app());},
    setLocale:(value:'zh'|'en')=>{active=value;},
    restore:()=>{(globalThis as any).window=previousWindow;globalThis.fetch=previousFetch;},
  };
}

test('language switching redraws notices and dialogs without rewriting persona drafts',async()=>{
  const states:any[]=['catalog',{bots:[],configs:[],counts:{pendingDeliveries:0},health:{activeTasks:0}},'','',message('saved'),false,[]];
  const harness=panelHarness(states,()=>{throw Error('Rendering must not fetch');},{locale:'en'});
  try{
    await harness.start('locale-draft');let tree=harness.render();
    assert.ok(tree.some(n=>n.props?.className==='notice'&&n.children.includes('Saved')));
    tree.find(n=>n.type==='button'&&n.props?.['aria-label']==='New persona').props.onClick();await settlePanel();
    assert.equal(states[7].personaPrompt,english('defaultPersonaPrompt'));
    harness.render().find(n=>n.type==='textarea').props.onChange({target:{value:'User-authored prompt'}});
    tree=harness.render();tree.find(n=>n.type==='button'&&n.children.includes('Bots')).props.onClick();await settlePanel();
    assert.equal(harness.render().find(n=>n.props?.role==='dialog').props['aria-label'],english('unsavedChanges'));
    harness.setLocale('zh');tree=harness.render();
    assert.equal(tree.find(n=>n.props?.role==='dialog').props['aria-label'],chinese('unsavedChanges'));
    assert.equal(states[7].personaPrompt,'User-authored prompt');assert.equal(states[8],true);
    flattenPanel(tree.find(n=>n.props?.role==='dialog')).find(n=>n.type==='button'&&n.children.includes('取消')&&!n.props.disabled).props.onClick();await settlePanel();
    assert.equal(states[0],'catalog');assert.equal(states[7].personaPrompt,'User-authored prompt');
  }finally{harness.restore();}
});

test('global bot message language uses the Host form, stays independent of UI and reports refused saves',async()=>{
  let snapshot={status:'ready',writable:true,value:{messageLocale:'zh'},revision:1};let accepted=false;const writes:any[]=[];
  const form={subscribe:()=>()=>{},getSnapshot:()=>snapshot,set:async(field:string,value:string)=>{writes.push({field,value});if(accepted)snapshot={...snapshot,value:{messageLocale:value},revision:snapshot.revision+1};return accepted;}};
  const states:any[]=['services',{bots:[],configs:[],counts:{pendingDeliveries:0},health:{activeTasks:0,serviceRunning:false}}];
  const harness=panelHarness(states,()=>{throw Error('Host settings must not use Admin API');},{locale:'en',settingsForm:form});
  const select=()=>harness.render().find(n=>n.type==='label'&&n.children[0]===english('messageLocale')).children[1];
  try{
    await harness.start('global-message-locale');assert.equal(select().props.value,'zh');assert.equal(select().props.disabled,false);
    select().props.onChange({target:{value:'en'}});await settlePanel();
    assert.deepEqual(writes,[{field:'messageLocale',value:'en'}]);assert.equal(select().props.value,'zh');
    assert.ok(harness.render().some(n=>n.props?.role==='alert'&&n.children[0]===english('messageLocaleSaveFailed')));
    accepted=true;select().props.onChange({target:{value:'en'}});await settlePanel();assert.equal(select().props.value,'en');
    assert.ok(harness.render().some(n=>n.props?.className==='notice'&&n.children[0]==='Saved'));
    harness.setLocale('zh');let tree=harness.render();assert.ok(tree.some(n=>n.props?.className==='notice'&&n.children[0]==='已保存'));
    assert.equal(tree.find(n=>n.type==='label'&&n.children[0]===chinese('messageLocale')).children[1].props.value,'en');
    snapshot={...snapshot,writable:false};tree=harness.render();assert.equal(tree.find(n=>n.type==='label'&&n.children[0]===chinese('messageLocale')).children[1].props.disabled,true);
  }finally{harness.restore();}
});

test('bot page renders creation before data arrives and with no bots, then edits the loaded bot settings',async()=>{
  const states:any[]=['bots',null,'','','',false,null];
  const harness=panelHarness(states,()=>{throw Error('No API request expected while rendering');});
  const createButton=(tree:any[])=>tree.find(n=>n.type==='button'&&n.props?.['aria-label']==='新建机器人');
  try{
    await harness.start('empty-bots');let tree=harness.render();
    assert.ok(createButton(tree));assert.equal(createButton(tree).props.disabled,false);
    createButton(tree).props.onClick();await settlePanel();
    tree=harness.render();assert.ok(tree.some(n=>n.props?.className==='card create-form'));
    createButton(tree).props.onClick();await settlePanel();
    states[1]={bots:[],configs:[],counts:{pendingDeliveries:0},health:{activeTasks:0}};states[6]=[];
    tree=harness.render();assert.ok(createButton(tree));assert.ok(!tree.some(n=>n.props?.className==='bot-detail'));
    const persona=configSchema.parse({id:'default',name:'默认',personaPrompt:'hello',media:{image:{enabled:false}}});
    const bot={id:'loaded',name:'已加载机器人',channel:'qq',configId:persona.id,enabled:false,status:'stopped',trustedUsers:[],settings:botSettingsFromConfig(persona)};
    states[1]={...states[1],bots:[bot],configs:[persona]};states[6]=[bot];
    tree=harness.render();assert.ok(tree.some(n=>n.props?.className==='bot-detail'&&n.props['aria-label']===bot.name));
    tree.find(n=>n.props?.id==='bot-detail-loaded-run').props.onClick();await settlePanel();
    tree=harness.render();
    assert.ok(tree.some(n=>n.type==='label'&&n.children[0]==='提供商'));
    assert.ok(tree.some(n=>n.type==='span'&&n.children[0]==='处理延时回复'));
    tree.find(n=>n.props?.id==='bot-detail-loaded-media').props.onClick();await settlePanel();
    tree=harness.render();const image=tree.find(n=>n.props?.role==='switch'&&n.props['aria-label']==='图片');
    assert.equal(image.props['aria-checked'],false);image.props.onClick();await settlePanel();
    assert.equal(states[29].id,bot.id);assert.equal(states[29].settings.media.image.enabled,true);assert.equal(bot.settings.media.image?.enabled,false);
  }finally{harness.restore();}
});

test('persona editing keeps only identity, prompt and files while preserving the full saved configuration',async()=>{
  const initial=configSchema.parse({schemaVersion:4,id:'default',name:'默认',personaPrompt:'hello',model:{provider:'deepseek',model:'deepseek-chat'},media:{image:{enabled:false}}});
  let saved=initial;
  const summary=()=>({bots:[],configs:[saved,{id:'other',name:'其他人格'}],counts:{bots:0,configs:2,pendingDeliveries:0},health:{activeTasks:0}});
  const states:any[]=['catalog',summary(),'加载错误','操作错误','',false,[],initial,false,false,'basic'];
  const calls:any[]=[];
  const harness=panelHarness(states,body=>{
    calls.push(body);
    if(body.action==='config.save'){saved=configSchema.parse({...body.input.config,revision:2});return saved;}
    if(body.name==='catalog.config')return{data:saved};
    if(body.action==='skill.image.status'||body.action==='skill.media.status')return{};
    return{data:summary()};
  });
  try{
    await harness.start('persona-focus');let tree=harness.render();
    assert.ok(tree.some(n=>n.type==='button'&&n.props?.['aria-label']==='其他人格'));
    assert.ok(tree.some(n=>n.props?.role==='alert'&&n.children[0]==='加载错误\n操作错误'));
    assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('自动化')));
    assert.ok(!tree.some(n=>n.type==='button'&&['模型','行为','媒体'].some(label=>n.children.includes(label))));
    assert.ok(!tree.some(n=>n.props?.role==='switch'));
    tree.find(n=>n.type==='label'&&n.children[0]==='名称').children[1].props.onChange({target:{value:'改名人格'}});
    tree=harness.render();tree.find(n=>n.type==='label'&&n.children[0]==='人设').children[1].props.onChange({target:{value:'新的独立人设'}});
    tree=harness.render();tree.find(n=>n.type==='button'&&n.children.includes('文件')).props.onClick();await settlePanel();
    tree=harness.render();assert.ok(tree.some(n=>n.type==='h3'&&n.children.includes('配置文件')));
    assert.equal(states[7].name,'改名人格');assert.equal(states[7].personaPrompt,'新的独立人设');assert.equal(states[8],true);
    tree.find(n=>n.type==='button'&&n.props.className==='primary'&&n.children.includes('保存')).props.onClick();await settlePanel();await settlePanel();
    assert.equal(calls.filter(body=>body.action==='config.save').length,1);
    assert.equal(saved.name,'改名人格');assert.equal(saved.personaPrompt,'新的独立人设');
    assert.deepEqual(saved.model,initial.model);assert.deepEqual(saved.media,initial.media);assert.equal(states[8],false);
    states[3]='保留本地错误';states[0]='overview';tree=harness.render();assert.ok(tree.some(n=>n.props?.role==='alert'&&n.children[0].includes('保留本地错误')));
    states[0]='catalog';states[7]=null;tree=harness.render();
    assert.ok(tree.some(n=>n.type==='button'&&n.props?.['aria-label']==='其他人格'));
    assert.ok(tree.some(n=>n.type==='button'&&n.props?.['aria-label']==='新建人格'));
    states[1]={...summary(),configs:[]};tree=harness.render();
    assert.ok(tree.some(n=>n.type==='button'&&n.props?.['aria-label']==='新建人格'&&!n.props.disabled));
  }finally{harness.restore();}
});

test('bot tabs expose independent media drafts, authorization and workspace without changing persona settings',async()=>{
  const persona=configSchema.parse({schemaVersion:4,id:'default',name:'默认',personaPrompt:'hello',media:{image:{enabled:false},voice:{enabled:false,protocol:'edge_tts'}}});
  let bot:any={id:'bot',name:'机器人一',channel:'qq',configId:'default',enabled:false,status:'stopped',archived:false,credentialConfigured:false,trustedUsers:[],settings:botSettingsFromConfig(persona)};
  const otherPersona={...persona,id:'other',name:'其他人格'};
  const summary=()=>({bots:[bot],configs:[persona,otherPersona],counts:{bots:1,configs:2,pendingDeliveries:0},health:{activeTasks:0,serviceRunning:true}});
  const states:any[]=['bots',summary(),'','','',false,[bot]];
  const calls:any[]=[];
  const harness=panelHarness(states,body=>{
    calls.push(body);
    if(body.action==='bot.save'){bot={...bot,...body.input,settings:botSettingsSchema.parse(body.input.settings)};return bot;}
    if(body.action==='skill.image.status'){assert.deepEqual(body.input,{scope:'bots'});return{bot:{keyConfigured:false,keyEnv:'CUSTOM_IMAGE_KEY'}};}
    if(body.action==='skill.media.status')return{bot:{}};
    if(body.name==='catalog.models')return{data:[]};
    if(body.name==='catalog.profiles')return{items:[],nextCursor:null};
    return{data:body.name==='bots.list'?[bot]:summary()};
  });
  const clickSection=async(id:string)=>{const button=harness.render().find(n=>n.props?.id==='bot-detail-bot-'+id);assert.ok(button);button.props.onClick();await settlePanel();const tree=harness.render();assert.equal(tree.find(n=>n.props?.id==='bot-detail-bot-'+id).props['aria-current'],'page');return tree;};
  try{
    await harness.start('bot-tabs');let tree=harness.render();
    assert.ok(tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='运行'));
    assert.ok(!tree.some(n=>n.props?.id==='bot-detail-bot-model'||n.props?.id==='bot-detail-bot-behavior'));
    tree=await clickSection('persona');
    assert.ok(tree.some(n=>n.type==='label'&&n.children[0]==='人格'));
    assert.ok(tree.some(n=>n.type==='option'&&n.children.includes('其他人格')));
    assert.ok(!tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='运行'));
    tree=await clickSection('auth');
    assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('授权')));
    tree.find(n=>n.type==='button'&&n.children.includes('凭据')).props.onClick();await settlePanel();
    tree=harness.render();assert.ok(tree.some(n=>n.type==='input'&&n.props.type==='password'));
    tree=await clickSection('workspace');
    assert.ok(tree.some(n=>n.type==='label'&&n.children[0]==='工作目录'));
    assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('添加')));
    assert.ok(!tree.some(n=>n.type==='input'&&n.props.type==='password'));
    tree=await clickSection('run');assert.ok(tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='运行'));
    assert.ok(tree.some(n=>n.type==='label'&&n.children[0]==='提供商'));
    assert.ok(tree.some(n=>n.type==='span'&&n.children[0]==='处理延时回复'));
    tree=await clickSection('media');
    assert.ok(tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='图片'&&!n.props['aria-checked']));
    assert.ok(tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='语音 TTS'&&!n.props['aria-checked']));
    assert.ok(!tree.some(n=>n.type==='input'&&n.props.type==='checkbox'));
    tree.find(n=>n.props?.role==='switch'&&n.props['aria-label']==='图片').props.onClick();await settlePanel();
    assert.equal(states[29].id,'bot');assert.equal(states[29].settings.media.image.enabled,true);
    assert.equal(persona.media.image?.enabled,false);assert.equal(bot.settings.media.image.enabled,false);
    const imageSection=()=>flattenPanel(harness.render().find(n=>n.props?.key==='image'));
    const protocol=imageSection().find(n=>n.type==='label'&&n.children[0]==='生图协议');
    assert.ok(protocol);protocol.children[1].props.onChange({target:{value:'comfyui'}});await settlePanel();
    const expectedImage={enabled:true,protocol:'comfyui'};
    assert.deepEqual(states[29].settings.media.image,expectedImage);
    assert.ok(!imageSection().some(n=>n.type==='label'&&['模型','服务地址','密钥环境变量名'].includes(n.children[0])));
    assert.ok(imageSection().some(n=>n.type==='p'&&n.children[0]==='未保存'));
    tree=harness.render();tree.find(n=>n.type==='button'&&n.props.className==='primary'&&n.children.includes('保存')).props.onClick();await settlePanel();await settlePanel();
    assert.equal(calls.filter(body=>body.action==='bot.save').length,1);assert.ok(!calls.some(body=>body.action==='config.save'));
    assert.deepEqual(bot.settings.media.image,expectedImage);assert.equal(states[29],null);
    assert.equal(states[13].bot.keyConfigured,false);assert.ok(imageSection().some(n=>n.type==='p'&&n.children[0]==='待配置'));
    assert.equal(states[29],null);assert.deepEqual(bot.settings.media.image,expectedImage);
  }finally{harness.restore();}
});

test('bot deletion still confirms, cancels and clears only matching authorization forms',async()=>{
  const persona=configSchema.parse({id:'default',name:'默认',personaPrompt:'hello'});
  const duplicateBots=['1','2'].map(id=>({id,name:'sakura',channel:'qq',configId:'default',enabled:false,archived:false,credentialConfigured:false,trustedUsers:[],settings:botSettingsFromConfig(persona)}));
  let remaining=duplicateBots;const deleted:string[]=[];
  const summary=()=>({bots:remaining,configs:[persona],counts:{pendingDeliveries:0},health:{activeTasks:0}});
  const states:any[]=['bots',summary(),'','','',false,remaining];states[18]={id:'1'};states[19]={botId:'1'};states[28]='auth';
  const harness=panelHarness(states,body=>{
    if(body.action==='bot.delete'){deleted.push(body.input.id);remaining=remaining.filter(bot=>bot.id!==body.input.id);return{ok:true};}
    if(body.action==='skill.image.status'||body.action==='skill.media.status')return{};
    return{data:body.name==='bots.list'?remaining:summary()};
  });
  try{
    await harness.start('bot-delete');let tree=harness.render();
    assert.equal(tree.filter(n=>n.type==='button'&&n.children.includes('删除')).length,2);
    tree.find(n=>n.props?.['aria-label']==='删除机器人 sakura（1）').props.onClick();await settlePanel();
    tree=harness.render();assert.match(tree.find(n=>n.props?.role==='dialog').props['aria-label'],/ID：1/);assert.match(tree.find(n=>n.props?.role==='dialog').props['aria-label'],/永久删除.*聊天记录/);
    flattenPanel(tree.find(n=>n.props?.role==='dialog')).find(n=>n.type==='button'&&n.children.includes('取消')).props.onClick();await settlePanel();assert.deepEqual(deleted,[]);
    tree=harness.render();tree.find(n=>n.props?.['aria-label']==='删除机器人 sakura（1）').props.onClick();await settlePanel();
    tree=harness.render();tree.find(n=>n.props?.role==='dialog').props.onSubmit({preventDefault:()=>{}});await settlePanel();await settlePanel();
    tree=harness.render();assert.deepEqual(deleted,['1']);assert.equal(states[18],null);assert.equal(states[19],null);
    assert.ok(!tree.some(n=>n.props?.['aria-label']==='删除机器人 sakura（1）'));assert.ok(tree.some(n=>n.props?.['aria-label']==='删除机器人 sakura（2）'));
    states[5]=true;tree=harness.render();assert.equal(tree.find(n=>n.props?.['aria-label']==='删除机器人 sakura（2）').props.disabled,true);
  }finally{harness.restore();}
});

test('overview session deletion confirms the exact session, cancels and refreshes the list',async()=>{
  let remaining=['session-1','session-2'].map(id=>({id,channelId:'same-channel',personaId:'default',createdAt:Date.UTC(2026,10,11),effectiveModel:{provider:'fixture',model:'chat'}}));
  const commands:any[]=[];let finishDelete:()=>void;
  const summary=()=>({bots:[],configs:[],counts:{pendingDeliveries:0},health:{activeTasks:0},sessionRevision:String(remaining.length)});
  const states:any[]=['overview',{...summary(),sessions:remaining},'','','',false];
  const harness=panelHarness(states,async body=>{
    if(body.kind==='command'){
      commands.push(body);await new Promise<void>(resolve=>{finishDelete=resolve;});
      remaining=remaining.filter(session=>session.id!==body.input.id);return{ok:true,current:false};
    }
    if(body.name==='overview.sessions')return{items:remaining,nextCursor:null};
    return{data:summary()};
  });
  try{
    await harness.start('session-delete');let tree=harness.render();
    const button=(nodes:any[],id:string)=>nodes.find(n=>n.props?.['aria-label']===`删除会话 ${id}`);
    assert.ok(tree.some(n=>n.type==='h3'&&n.children.includes('聊天会话')));
    button(tree,'session-1').props.onClick();await settlePanel();tree=harness.render();
    const dialog=tree.find(n=>n.props?.role==='dialog');assert.match(dialog.props['aria-label'],/session-1/);assert.match(dialog.props['aria-label'],/渠道附件和长期记忆会保留/);
    assert.equal(button(tree,'session-2').props.disabled,true);
    flattenPanel(dialog).find(n=>n.type==='button'&&n.children.includes('取消')).props.onClick();await settlePanel();assert.deepEqual(commands,[]);
    button(harness.render(),'session-1').props.onClick();await settlePanel();
    harness.render().find(n=>n.props?.role==='dialog').props.onSubmit({preventDefault:()=>{}});await settlePanel();
    assert.equal(button(harness.render(),'session-2').props.disabled,true);
    finishDelete!();await settlePanel();await settlePanel();tree=harness.render();
    assert.deepEqual(commands,[{version:1,kind:'command',name:'session.delete',input:{id:'session-1'}}]);
    assert.equal(button(tree,'session-1'),undefined);assert.ok(button(tree,'session-2'));assert.equal(button(tree,'session-2').props.disabled,false);
    assert.ok(tree.some(n=>n.props?.className==='notice'&&n.children.includes('会话已删除')));
  }finally{harness.restore();}
});

test('failed session deletion keeps the session visible and reports the failure',async()=>{
  const states:any[]=['overview',{bots:[],configs:[],sessions:[{id:'owned-elsewhere'}],counts:{pendingDeliveries:0},health:{activeTasks:0}},'','','',false];
  const harness=panelHarness(states,body=>{assert.equal(body.name,'session.delete');throw Error('Session is in use');},{locale:'en'});
  try{
    await harness.start('session-delete-failure');
    harness.render().find(n=>n.props?.['aria-label']==='Delete session owned-elsewhere').props.onClick();await settlePanel();
    harness.render().find(n=>n.props?.role==='dialog').props.onSubmit({preventDefault:()=>{}});await settlePanel();await settlePanel();
    const tree=harness.render();assert.ok(tree.some(n=>n.props?.['aria-label']==='Delete session owned-elsewhere'&&!n.props.disabled));
    assert.equal(states[3],'Session is in use');assert.equal(states[4],'');
  }finally{harness.restore();}
});
