import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUI,dateInput,scheduledTime} from '../src/client/ui.js';
import {chinese} from '../src/client/locale.js';

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
  const previous=(globalThis as any).window;const previousFetch=globalThis.fetch;
  const locale={getSnapshot:()=>({revision:1}),subscribe:()=>()=>{},register:()=>()=>{},bind:()=>chinese};
  (globalThis as any).window={__ModuleLoader__:{load:({factory}:any)=>factory(()=>React).apply({locale,effect:(callback:any)=>callback(),slots:{inject:(_slot:any,register:any)=>register(),register:(_meta:any,component:any)=>{app=component;}}})}};
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
    assert.ok(tree.some(n=>n.props?.role==='switch'&&n.props['aria-label']==='语音 TTS'&&!n.props['aria-checked']));
    assert.ok(!tree.some(n=>n.type==='input'&&n.props.type==='checkbox'));
    tree.find(n=>n.props?.role==='switch'&&n.props['aria-label']==='图片').props.onClick();await new Promise(resolve=>setImmediate(resolve));
    tree=render();assert.equal(states[7].name,'未保存的人格');assert.equal(states[7].media.image.enabled,true);assert.equal(states[8],true);
    states[7]={...states[7],media:{...states[7].media,image:{enabled:true,baseUrl:'https://old.example.invalid/v1',keyEnv:'OLD_IMAGE_KEY',model:'existing-image-model'}}};
    tree=render();let imageSection=nodes(tree.find(n=>n.props?.key==='image'));
    assert.equal(imageSection.find(n=>n.type==='label'&&n.children[0]==='服务地址').children[1].props.value,'https://old.example.invalid/v1');
    imageSection.find(n=>n.type==='label'&&n.children[0]==='服务地址').children[1].props.onChange({target:{value:'  https://images.example.invalid/v1  '}});
    tree=render();imageSection=nodes(tree.find(n=>n.props?.key==='image'));
    imageSection.find(n=>n.type==='label'&&n.children[0]==='密钥环境变量名').children[1].props.onChange({target:{value:'  CUSTOM_IMAGE_KEY  '}});
    const expectedImage={enabled:true,baseUrl:'https://images.example.invalid/v1',keyEnv:'CUSTOM_IMAGE_KEY',model:'existing-image-model'};
    assert.deepEqual(states[7].media.image,expectedImage);
    assert.ok(!imageSection.some(n=>n.type==='input'&&n.props.type==='password'));
    assert.ok(imageSection.some(n=>n.type==='small'&&String(n.children[0]).includes('只填写变量名')));
    assert.ok(imageSection.some(n=>n.type==='p'&&n.children[0]==='未保存'));
    assert.ok(tree.some(n=>n.type==='button'&&n.children.includes('保存')&&!n.props.disabled));
    states[7]={...states[7],schemaVersion:4,media:{...states[7].media,voice:{enabled:true,profileRef:{serviceId:'gpt-sovits',profileId:'speaker'},replyMode:'auto',format:'wav'}}};states[8]=false;
    states[13]={default:{keyConfigured:true}};
    tree=render();const voiceSection=nodes(tree.find(n=>n.props?.key==='voice'));
    assert.ok(voiceSection.some(n=>n.type==='option'&&n.children.includes('文字 + 语音')));
    assert.ok(voiceSection.some(n=>n.type==='label'&&n.children[0]==='说话'));
    assert.ok(!tree.some(n=>n.type==='button'&&/检查|验收|登记|模型服务/.test(n.children.join(''))));
    assert.ok(!voiceSection.some(n=>n.type==='label'&&/权重|凭据|locator/i.test(String(n.children[0]))));
    assert.ok(!voiceSection.some(n=>n.type==='label'&&n.children[0]==='提供商'));
    const calls:string[]=[];(globalThis as any).window.__BOT_INTEGRATION__={endpoint:'http://admin.invalid',token:'fixture'};
    globalThis.fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));calls.push(body.action??body.name);
      if(body.action==='config.save'){assert.deepEqual(body.input.config.media.image,expectedImage);return Response.json({result:{...body.input.config,revision:2}});}
      if(body.action==='skill.image.status')return Response.json({result:{default:{keyConfigured:false,keyEnv:'CUSTOM_IMAGE_KEY'}}});
      if(body.name==='catalog.models')return Response.json({result:{data:[],revision:'sha256:'+'3'.repeat(64)}});
      if(body.name==='catalog.profiles')return Response.json({result:{items:[],nextCursor:null,revision:'sha256:'+'4'.repeat(64)}});
      return Response.json({result:{data:summary,revision:'sha256:'+'1'.repeat(64)}});
    };
    states[8]=true;tree=render();tree.find(n=>n.type==='button'&&n.children.includes('保存')).props.onClick();await new Promise(resolve=>setImmediate(resolve));
    tree=render();assert.equal(states[7].revision,2);
    assert.ok(calls.includes('skill.image.status'));assert.equal(states[13].default.keyConfigured,false);
    assert.ok(nodes(tree.find(n=>n.props?.key==='image')).some(n=>n.type==='p'&&n.children[0]==='待配置'));
    imageSection=nodes(tree.find(n=>n.props?.key==='image'));
    imageSection.find(n=>n.type==='label'&&n.children[0]==='服务地址').children[1].props.onChange({target:{value:'   '}});
    tree=render();imageSection=nodes(tree.find(n=>n.props?.key==='image'));
    imageSection.find(n=>n.type==='label'&&n.children[0]==='密钥环境变量名').children[1].props.onChange({target:{value:'  '}});
    assert.equal(states[7].media.image.baseUrl,undefined);assert.equal(states[7].media.image.keyEnv,undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(states[7])).media.image,{enabled:true,model:'existing-image-model'});
    states[3]='保留本地错误';states[0]='overview';tree=render();assert.ok(tree.some(n=>n.props?.role==='alert'));
    states[0]='catalog';states[7]=null;tree=render();assert.ok(tree.some(n=>n.type==='option'&&n.children.includes('其他人格')));
    assert.ok(!tree.some(n=>n.props?.role==='switch'));
    const duplicateBots=['1','2'].map(id=>({id,name:'sakura',channel:'qq',configId:'default',enabled:false,archived:false,credentialConfigured:false,trustedUsers:[]}));
    let remaining=duplicateBots;const deleted:string[]=[];
    states[0]='bots';states[1]={...summary,bots:duplicateBots};states[6]=duplicateBots;states[18]={id:'1'};states[19]={botId:'1'};
    globalThis.fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      if(body.action==='bot.delete'){deleted.push(body.input.id);remaining=remaining.filter(bot=>bot.id!==body.input.id);return Response.json({result:{ok:true}});}
      const data=body.name==='bots.list'?remaining:{...summary,bots:remaining};
      return Response.json({result:{data,revision:'sha256:'+'2'.repeat(64)}});
    };
    tree=render();assert.equal(tree.filter(n=>n.type==='button'&&n.children.includes('删除')).length,2);
    tree.find(n=>n.props?.['aria-label']==='删除机器人 sakura（1）').props.onClick();await new Promise(resolve=>setImmediate(resolve));
    tree=render();assert.match(tree.find(n=>n.props?.role==='dialog').props['aria-label'],/ID：1/);assert.match(tree.find(n=>n.props?.role==='dialog').props['aria-label'],/永久删除.*聊天记录/);
    tree.find(n=>n.type==='button'&&n.children.includes('取消')).props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(deleted,[]);
    tree=render();tree.find(n=>n.props?.['aria-label']==='删除机器人 sakura（1）').props.onClick();await new Promise(resolve=>setImmediate(resolve));
    tree=render();tree.find(n=>n.props?.role==='dialog').props.onSubmit({preventDefault:()=>{}});await new Promise(resolve=>setImmediate(resolve));
    tree=render();assert.deepEqual(deleted,['1']);assert.equal(states[18],null);assert.equal(states[19],null);
    assert.ok(!tree.some(n=>n.props?.['aria-label']==='删除机器人 sakura（1）'));assert.ok(tree.some(n=>n.props?.['aria-label']==='删除机器人 sakura（2）'));
    states[5]=true;tree=render();assert.equal(tree.find(n=>n.props?.['aria-label']==='删除机器人 sakura（2）').props.disabled,true);
  }finally{(globalThis as any).window=previous;globalThis.fetch=previousFetch;}
});
