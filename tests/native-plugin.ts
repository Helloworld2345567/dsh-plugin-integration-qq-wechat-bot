// Test-only bundle: real Harness loop and persistence, deterministic local model, no provider calls.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import z from '@deepseek-ai/schemastery';
import {credentialRef} from '@deepseek-ai/dsh-credentials';
import {Context} from '@deepseek-ai/cordis';
import {LlmAdapter,ToolCallId,MessageId,type GenerateOptions,type StreamChunk} from '@deepseek-ai/dsh-llm';
import type {} from '../src/index.js';
import type {NativeHarness} from '../src/harness/bridge.js';
import {scopeKey} from '../src/core/store.js';
import {botSchema,type InboundMessage} from '../src/core/types.js';
export const inject=['botIntegration','llm','settings','credentials','sessionQuery','agents','agentPresets','tools','skills','systemPrompt','attachments','permissionPresets','sessions','sessionPersistence'];
export const name='bot-native-fixture';
export const Config=z.object({baseURL:z.string().default('https://fixture.invalid/v1').volatile(),apiKeyEnv:z.string().default('BOT_TEST_ANALYSIS_KEY').volatile(),api:z.string().default('openai-completions').volatile()});
export async function apply(ctx:Context){
  const runtime=ctx.botIntegration;const store=runtime.store;const bridge=runtime.harness as NativeHarness;
  const requests:GenerateOptions[]=[];let phase=0;let compactions=0;let mediaCall:{name:string;args:Record<string,unknown>}|undefined;
  class Fixture extends LlmAdapter{
    providerInfo(provider:string){return{id:provider,name:'Local deterministic fixture'};}
    async listModels(provider:string){return ['first','second'].map(id=>({provider,id,name:id,inputModalities:['text','image'] as const}));}
    async resolveModel(provider:string,id:string){return{provider,id,name:id,inputModalities:['text','image'] as const,context:{contextWindow:24000}};}
    async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
      if(options.purpose){if(options.purpose==='compaction'){compactions++;yield*text('会话摘要：用户说我喜欢绿茶。之前的合成测试材料已压缩；保持当前人格并继续任务。');}else yield*text('fixture title');return;}
      requests.push(options);
      if(mediaCall){const call=mediaCall;mediaCall=undefined;yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId('media-'+requests.length),name:call.name,arguments:JSON.stringify(call.args)}};yield{type:'finish',reason:{kind:'tool-calls'}};return;}
      if(phase++===0){
        // Change the binding during a multi-step turn. The second step must keep its original model/persona.
        runtime.saveBot({...store.bot('fixture'),configId:'sakura'});
        const args={key:'drink',value:'绿茶',sourceId:'first',quote:'我喜欢绿茶'};
        yield{type:'block-start',index:0,blockType:'tool-call'};
        yield{type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId('remember-1'),name:'bot_remember',arguments:JSON.stringify(args)}};
        yield{type:'finish',reason:{kind:'tool-calls'}};return;
      }
      yield*text('FINAL_ONLY');
    }
  }
  function*text(value:string):Generator<StreamChunk>{yield{type:'block-start',index:0,blockType:'reasoning'};yield{type:'block-end',index:0,block:{type:'reasoning',text:'PRIVATE_REASONING'}};yield{type:'block-start',index:1,blockType:'text'};yield{type:'block-end',index:1,block:{type:'text',text:value}};yield{type:'finish',reason:{kind:'stop'}};}
  ctx.llm.registerAdapter(['bot-fixture'],new Fixture());
  ctx.llm.registerConfigurableProviders([{provider:'bot-fixture',displayName:'Fixture',settingsNs:'bot-native-fixture',settingsPath:[]}]);
  // Start after composition; errors are durable evidence for the parent test runner.
  const resultPath=process.env.NATIVE_TEST_RESULT!;
  const test=async()=>{
    const initial=store.config('default');await runtime.saveConfig({...initial,model:{provider:'bot-fixture',model:'first'},personaPrompt:'PERSONA_A'},initial.revision);
    const sakura=store.config('sakura');await runtime.saveConfig({...sakura,model:{provider:'bot-fixture',model:'second'},personaPrompt:'PERSONA_B'},sakura.revision);
    store.saveBot(botSchema.parse({id:'fixture',name:'Fixture',channel:'qq',accountId:'fixture',enabled:true}));
    const scope={botId:'fixture',accountId:'fixture',platform:'qq' as const,kind:'private' as const,channelId:'alice',senderId:'alice'};
    const binding=store.binding(scope);const msg=(id:string,text:string):InboundMessage=>({id,text,scope,attachments:[],reply:{},timestamp:Date.now()});
    store.accept(msg('first','我喜欢绿茶'));
    const first=await bridge.run(binding,[msg('first','我喜欢绿茶')],AbortSignal.timeout(30000));
    assert.deepEqual(first.outputs,[{type:'text',text:'FINAL_ONLY'}]);assert.equal(first.snapshot.config.id,'default');assert.equal(requests.length,2);assert.ok(requests.every(r=>r.model==='first'));
    assert.equal(store.memories(scopeKey(scope))[0]?.value,'绿茶');
    assert.ok(requests[1].messages.some(m=>m.role==='tool'));
    const second=await bridge.run(binding,[msg('second','接着聊')],AbortSignal.timeout(30000));
    assert.equal(second.snapshot.config.id,'sakura');assert.equal(requests.at(-1)!.model,'second');assert.equal(bridge.live.get(binding.sessionId)!.handle.agent.id,binding.sessionId);
    const serialized=JSON.stringify(requests.at(-1)!.messages);assert.ok(serialized.includes('我喜欢绿茶'));assert.ok(serialized.includes('PERSONA_B'));
    const agent=bridge.live.get(binding.sessionId)!.handle.agent;
    const tools=ctx.tools.schemas(agent).map(t=>t.name);assert.ok(tools.includes('bot_media'));assert.ok(!tools.includes('pwsh'));assert.ok(!tools.includes('spawn_agent'));
    assert.equal(ctx.permissionPresets.current(agent.session),'read-only');assert.ok(tools.includes('skill'));
    const hidden=await ctx.tools.execute({name:'skill',arguments:{name:'private-global-skill'},callId:ToolCallId('hidden-skill'),agent,signal:AbortSignal.timeout(5000)});assert.equal(hidden.isError,true);
    const denied=await agent.ctx.tools.execute({name:'pwsh',arguments:{command:'Write-Output should-not-run'},callId:ToolCallId('denied'),agent,signal:AbortSignal.timeout(5000)});assert.equal(denied.isError,true);
    runtime.saveBot({...store.bot('fixture'),trustedUsers:['alice']});
    await bridge.run(binding,[msg('trusted','可信私聊测试')],AbortSignal.timeout(30000));
    assert.equal(ctx.permissionPresets.current(agent.session),'danger-full-access');assert.ok(ctx.tools.schemas(agent).some(t=>t.name==='pwsh'));
    const executed=await ctx.tools.execute({name:'pwsh',arguments:{command:"Write-Output 'trusted-fixture'"},callId:ToolCallId('trusted-command'),agent,signal:AbortSignal.timeout(15000)});assert.equal(executed.isError,false,JSON.stringify(executed));
    const child=await ctx.agents.create({sessionId:('child-'+binding.sessionId) as any,parentAgent:agent,agentOptions:{provider:'bot-fixture',model:'second'}});
    runtime.saveBot({...store.bot('fixture'),configId:'default'});await bridge.run(binding,[msg('switch-back','父轮切回默认')],AbortSignal.timeout(30000));
    child.agent.followup({id:MessageId('child-input'),role:'user',content:[{type:'text',text:'子任务沿用创建时的配置'}],source:{kind:'user'}});await child.agent.whenIdle();
    const childRequest=requests.find(r=>r.sessionId===child.agent.id)!;assert.equal(childRequest?.model,'second');assert.ok(JSON.stringify(childRequest.messages).includes('PERSONA_B'));
    let childCancelled=false;const cancelChild=child.agent.cancel.bind(child.agent);child.agent.cancel=(cause)=>{childCancelled=true;return cancelChild(cause);};
    runtime.saveBot({...store.bot('fixture'),trustedUsers:[]});
    assert.equal(childCancelled,true,'revocation cancels children even after the parent inbox turn has finished');
    const revoked=await ctx.tools.execute({name:'pwsh',arguments:{command:'Write-Output must-not-run'},callId:ToolCallId('revoked-child'),agent:child.agent,signal:AbortSignal.timeout(5000)});assert.equal(revoked.isError,true);await child.dispose();
    await bridge.dispose(binding.sessionId);
    await bridge.run(binding,[msg('third','重启恢复历史')],AbortSignal.timeout(30000));assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('我喜欢绿茶'));
    await ctx.credentials.set(credentialRef('BOT_TEST_ANALYSIS_KEY'),'fixture-analysis-key');
    const inherited=await runtime.media.analysisProvider!.resolve(store.config('default'),'asr');assert.equal(inherited.endpoint.baseUrl,'https://fixture.invalid/v1');assert.equal(inherited.endpoint.model,'first');assert.equal(inherited.apiKey,'fixture-analysis-key');
    const skill=await ctx.tools.execute({name:'skill',arguments:{name:'media-analysis'},callId:ToolCallId('analysis-skill'),agent:bridge.live.get(binding.sessionId)!.handle.agent,signal:AbortSignal.timeout(5000)});assert.equal(skill.isError,false);assert.ok(JSON.stringify(skill.content).includes('media_analysis'));
    for(let i=0;i<12;i++)await bridge.run(binding,[msg(`long-${i}`,`合成历史第${i}轮：`+'The fixture contains repeated context material for deterministic compression. '.repeat(140))],AbortSignal.timeout(30000));
    assert.ok(compactions>0,'long context should trigger native automatic compaction');assert.ok(bridge.live.get(binding.sessionId)!.handle.agent.session.snapshotEvents().some(e=>String(e.type)==='compaction/end'));
    const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z4AdMOEQH6QSAM1BAQ/oQeJvAAAAAElFTkSuQmCC','base64');
    // Real image admission verifies actual decodable pixels, not an attachment path placeholder.
    const asset=await runtime.assets.save(binding.key,{kind:'image',name:'reference.png',mime:'image/png'},pixels);
    mediaCall={name:'bot_media',args:{operation:'image_understand',inputs:[asset.id]}};
    await bridge.run(binding,[msg('pixels','读取刚才的图片')],AbortSignal.timeout(30000));
    assert.ok(requests.at(-1)!.messages.some(m=>m.role==='tool'&&m.content.some(b=>b.type==='image')),'native model must receive image tool pixels: '+JSON.stringify(requests.at(-1)!.messages.slice(-3)));
    const docFile=path.join(store.home,'native-scan.pdf');execFileSync(process.env.BOT_PYTHON!,['-c',"from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=200,height=200); w.write(sys.argv[1])",docFile],{windowsHide:true});
    const scan=await runtime.assets.save(binding.key,{kind:'file',name:'scan.pdf',mime:'application/pdf'},await (await import('node:fs/promises')).readFile(docFile));
    mediaCall={name:'bot_media',args:{operation:'document_read',inputs:[scan.id]}};
    const docResult=await bridge.run(binding,[msg('ocr','读取扫描页')],AbortSignal.timeout(30000));assert.deepEqual(docResult.outputs,[{type:'text',text:'FINAL_ONLY'}]);
    assert.ok(requests.at(-1)!.messages.some(m=>m.role==='tool'&&m.content.some(b=>b.type==='image')),'scanned page pixels must reach the current chat model');
    const mediaRun=runtime.media.run.bind(runtime.media);let imageCalls=0;
    runtime.media.run=async(scope,operation,config,inputs)=>{assert.equal(config.media.image,undefined);assert.equal(operation,'image_edit');assert.deepEqual(inputs,[asset.id]);imageCalls++;return{assetIds:[asset.id]};};
    try{
      mediaCall={name:'image_generation',args:{operation:'edit',prompt:'Use the real reference on the moon',inputs:[asset.id]}};
      const generated=await bridge.run(binding,[msg('image-skill','按参考图生成图片')],AbortSignal.timeout(30000));
      assert.equal(imageCalls,1);assert.deepEqual(generated.outputs,[{type:'text',text:'FINAL_ONLY'},{type:'asset',assetId:asset.id}]);
      const parent=bridge.live.get(binding.sessionId)!.handle.agent;
      const duplicate=await ctx.tools.execute({name:'bot_media',arguments:{operation:'image_generate',prompt:'duplicate'},callId:ToolCallId('duplicate-image'),agent:parent,signal:AbortSignal.timeout(5000)});assert.equal(duplicate.isError,true);assert.equal(imageCalls,1);
      const c=store.config('default');await runtime.saveConfig({...c,media:{image:{enabled:false}}},c.revision);
      const disabled=await ctx.tools.execute({name:'image_generation',arguments:{prompt:'disabled'},callId:ToolCallId('disabled-image'),agent:parent,signal:AbortSignal.timeout(5000)});assert.equal(disabled.isError,true);assert.equal(imageCalls,1);
    }finally{runtime.media.run=mediaRun;}
    const audio=await runtime.assets.save(binding.key,{kind:'audio',name:'voice.wav',mime:'audio/wav'},Buffer.from('fixture'));
    let analysisCalls=0;runtime.media.run=async(scope,operation,config,inputs)=>{assert.equal(operation,'transcribe');assert.deepEqual(inputs,[audio.id]);assert.equal(config.model?.model,'first');analysisCalls++;return{text:'SCRIPT_TRANSCRIPT',coverage:'AUDIO_MODEL_ANALYSIS',assetIds:[]};};
    try{
      mediaCall={name:'media_analysis',args:{kind:'audio',question:'转写'}};await bridge.run(binding,[msg('analysis','分析最近语音')],AbortSignal.timeout(30000));assert.equal(analysisCalls,1);assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('SCRIPT_TRANSCRIPT'));
      const c=store.config('default');await runtime.saveConfig({...c,skills:['image-generation']},c.revision);
      for(const call of [{name:'media_analysis',arguments:{kind:'audio',inputs:[audio.id]}},{name:'bot_media',arguments:{operation:'transcribe',inputs:[audio.id]}},{name:'skill',arguments:{name:'media-analysis'}}]){const denied=await ctx.tools.execute({...call,callId:ToolCallId('revoked-'+call.name),agent:bridge.live.get(binding.sessionId)!.handle.agent,signal:AbortSignal.timeout(5000)});assert.equal(denied.isError,true);}assert.equal(analysisCalls,1);
    }finally{runtime.media.run=mediaRun;}
    const webChecks:string[]=[];
    if(process.env.BOT_TEST_WEB_TOOLS_SOURCE){
      const c=store.config('default');await runtime.saveConfig({...c,tools:[...c.tools,'web_search','web_fetch']},c.revision);
      mediaCall={name:'web_fetch',args:{url:'https://example.com/'}};
      await bridge.run(binding,[msg('web-page','读取公开测试页面')],AbortSignal.timeout(45000));
      const parent=bridge.live.get(binding.sessionId)!.handle.agent;const schemas=ctx.tools.schemas(parent).map(t=>t.name);assert.ok(schemas.includes('web_fetch'));assert.ok(schemas.includes('web_search'));assert.ok(!schemas.includes('pwsh'));assert.equal(ctx.permissionPresets.current(parent.session),'read-only');
      const page=requests.at(-1)!.messages.filter(m=>m.role==='tool'&&m.toolCallId?.startsWith('media-')).at(-1)!;assert.ok(page.role==='tool');assert.equal(page.isError,false,JSON.stringify(page));assert.ok(JSON.stringify(page.content).includes('Example Domain'));
      const search=await ctx.tools.execute({name:'web_search',arguments:{queries:['DeepSeek Harness official']},callId:ToolCallId('missing-search-key'),agent:parent,signal:AbortSignal.timeout(10000)});assert.equal(search.isError,true,'without search credentials this must not claim search success');
      const current=store.config('default');await runtime.saveConfig({...current,tools:current.tools.filter(t=>!['web_search','web_fetch'].includes(t))},current.revision);
      const revoked=await ctx.tools.execute({name:'web_fetch',arguments:{url:'https://example.com/'},callId:ToolCallId('revoked-web'),agent:parent,signal:AbortSignal.timeout(5000)});assert.equal(revoked.isError,true);
      webChecks.push('installed dsh-web-tools exposes native web tools to ordinary bot session','actual public page fetch returns Example Domain without host access','missing search key remains explicit error','web permission revocation denies later calls');
    }
    await writeFile(resultPath,JSON.stringify({status:'PASS',requests:requests.length,compactions,checks:['real native turn and business tool','final text excludes reasoning','snapshot holds across tool steps','next-turn persona/model switch preserves session/history','ordinary host tools hidden and denied','trusted PowerShell execution without per-call approval','frozen child persona/model after parent switches','revoked permission denied in child agent','private skill read denied','durable session resume','native provider settings and credentials inherited without copying secrets','published media-analysis skill readable by ordinary user','native automatic long-context compaction','image bytes loaded into native chat model without vision service','scanned PDF rendered and passed to native chat model','image skill inherits environment with no WebUI media setup','reference edit auto-registers one image for delivery','compatibility call cannot bypass image attempt limit','image skill disable immediately denies calls','audio analysis selects same-session recent attachment and returns script result','analysis revocation denies dedicated and compatibility tools and skill reads',...webChecks]}));
  };
  setImmediate(()=>void test().catch(async error=>{await writeFile(resultPath,JSON.stringify({status:'FAIL',error:error.stack??String(error),failures:store.list('failure'),events:[...bridge.live.values()].flatMap(l=>l.handle.agent.session.snapshotEvents()).filter(e=>e.type==='turn/end').slice(-2)}));}));
}
