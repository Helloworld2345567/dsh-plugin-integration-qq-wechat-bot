// Test-only bundle: real Harness loop and persistence, deterministic local model, no provider calls.
import assert from 'node:assert/strict';
import {writeFile,mkdir,realpath,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import z from '@deepseek-ai/schemastery';
import {credentialRef} from '@deepseek-ai/dsh-credentials';
import {Context} from '@deepseek-ai/cordis';
import {LlmAdapter,ToolCallId,MessageId,resolveRetryPolicy,type GenerateOptions,type StreamChunk} from '@deepseek-ai/dsh-llm';
import {PiAiAdapter,type ResolvedPiAiProviderProfile} from '@deepseek-ai/dsh-llm-pi-ai';
import {fauxProvider,fauxAssistantMessage,InMemoryCredentialStore} from '@earendil-works/pi-ai';
import type {} from '../src/index.js';
import type {NativeHarness} from '../src/harness/bridge.js';
import {scopeKey} from '../src/core/store.js';
import {freezeTurn} from '../src/core/policy.js';
import {botSchema,type InboundMessage} from '../src/core/types.js';
export const inject=['botIntegration','llm','settings','credentials','sessionQuery','agents','agentPresets','tools','skills','systemPrompt','attachments','permissionPresets','sessions','sessionPersistence','workingDirectory'];
export const name='bot-native-fixture';
export const Config=z.object({baseURL:z.string().default('https://fixture.invalid/v1').volatile(),apiKeyEnv:z.string().default('BOT_TEST_ANALYSIS_KEY').volatile(),api:z.string().default('openai-completions').volatile()});
export async function apply(ctx:Context){
  const runtime=ctx.botIntegration;const store=runtime.store;const bridge=runtime.harness as NativeHarness;
  const progressRequests:GenerateOptions[]=[];let progressFails=false;
  const requests:GenerateOptions[]=[];let phase=0;let compactions=0;let finalText="FINAL_ONLY";let mediaCall:{name:string;args:Record<string,unknown>}|undefined;let beforeTool:(()=>Promise<void>)|undefined;let beforeFinal:((options:GenerateOptions)=>void|Promise<void>)|undefined;
  class Fixture extends LlmAdapter{
    providerInfo(provider:string){return{id:provider,name:'Local deterministic fixture'};}
    async listModels(provider:string){return ['first','second'].map(id=>({provider,id,name:id,inputModalities:['text','image'] as const}));}
    async resolveModel(provider:string,id:string){return{provider,id,name:id,inputModalities:['text','image'] as const,context:{contextWindow:24000}};}
    async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
      if(options.purpose){if(options.purpose==='compaction'){compactions++;yield*text('会话摘要：用户说我喜欢绿茶。之前的合成测试材料已压缩；保持当前人格并继续任务。');}else yield*text('fixture title');return;}
      if(options.system?.startsWith('你正在替当前角色发送一条任务进度提醒。')){progressRequests.push(options);if(progressFails){yield{type:'block-start',index:0,blockType:'text'};yield{type:'block-end',index:0,block:{type:'text',text:'不完整的提示'}};throw Error('fixture progress failure');}yield*text('这一步还在处理喵，暂时没有最终结果。');return;}
      requests.push(options);
      if(mediaCall){const call=mediaCall;mediaCall=undefined;const update=beforeTool;beforeTool=undefined;await update?.();yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId('media-'+requests.length),name:call.name,arguments:JSON.stringify(call.args)}};yield{type:'finish',reason:{kind:'tool-calls'}};return;}
      if(phase++===0){
        // Change the binding during a multi-step turn. The second step must keep its original model/persona.
        runtime.saveBot({...store.bot('fixture'),configId:'sakura'});
        await writeFile(path.join(store.personas.directory('sakura'),'persona.md'),'PERSONA_B_FILE');
        await runtime.applyPersonaFiles('sakura');
        const args={key:'drink',value:'绿茶',sourceId:'first',quote:'我喜欢绿茶'};
        yield{type:'block-start',index:0,blockType:'tool-call'};
        yield{type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId('remember-1'),name:'bot_remember',arguments:JSON.stringify(args)}};
        yield{type:'finish',reason:{kind:'tool-calls'}};return;
      }
      const checkFinal=beforeFinal;beforeFinal=undefined;await checkFinal?.(options);
      yield*text(finalText);finalText='FINAL_ONLY';
    }
  }
  function*text(value:string):Generator<StreamChunk>{yield{type:'block-start',index:0,blockType:'reasoning'};yield{type:'block-end',index:0,block:{type:'reasoning',text:'PRIVATE_REASONING'}};yield{type:'block-start',index:1,blockType:'text'};yield{type:'block-end',index:1,block:{type:'text',text:value}};yield{type:'usage',usage:{inputTokens:20,outputTokens:8,cacheReadTokens:3,cacheWriteTokens:2,reasoningTokens:2,totalTokens:33}};yield{type:'finish',reason:{kind:'stop'}};}
  ctx.llm.registerAdapter(['bot-fixture'],new Fixture());
  ctx.llm.registerConfigurableProviders([{provider:'bot-fixture',displayName:'Fixture',settingsNs:'bot-native-fixture',settingsPath:[]}]);
  // Start after composition; errors are durable evidence for the parent test runner.
  const resultPath=process.env.NATIVE_TEST_RESULT!;
  const test=async()=>{
    const initial=store.config('default');await runtime.saveConfig({...initial,model:{provider:'bot-fixture',model:'first'},allowHostTools:true,personaPrompt:'PERSONA_A'},initial.revision);
    const sakura=store.config('sakura');await runtime.saveConfig({...sakura,model:{provider:'bot-fixture',model:'second'},allowHostTools:true,personaPrompt:'PERSONA_B'},sakura.revision);
    store.saveBot(botSchema.parse({id:'fixture',name:'Fixture',channel:'qq',accountId:'fixture',enabled:true}));
    const scope={botId:'fixture',accountId:'fixture',platform:'qq' as const,kind:'private' as const,channelId:'alice',senderId:'alice'};
    const binding=store.binding(scope);const msg=(id:string,text:string):InboundMessage=>({id,text,scope,attachments:[],reply:{target:scope.channelId,kind:scope.kind,msgId:id},timestamp:Date.now()});
    const toolJson=(result:any)=>{assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join(''));};
    const noHostPaths=(value:unknown)=>{const json=JSON.stringify(value);assert.doesNotMatch(json,/"(?:path|resourceBase|candidateRoot|directory|workingDirectory)"/);assert.ok(!json.includes(JSON.stringify(store.home).slice(1,-1)),'catalog must not expose the host data directory');};
    store.accept(msg('first','我喜欢绿茶'));
    const stages:string[]=[];let ends=0;
    const first=await bridge.run(binding,[msg('first','我喜欢绿茶')],AbortSignal.timeout(30000),{onProgress:stage=>stages.push(stage),onEnd:()=>ends++});
    assert.ok(stages.includes('tool'));assert.ok(stages.includes('model'));assert.equal(ends,1);
    assert.deepEqual(first.outputs,[{type:'text',text:'FINAL_ONLY'}]);assert.equal(first.snapshot.config.id,'default');assert.equal(requests.length,2);assert.ok(requests.every(r=>r.model==='first'));
    assert.equal(store.memories(scopeKey(scope))[0]?.value,'绿茶');
    assert.ok(requests[1].messages.some(m=>m.role==='tool'));
    const second=await bridge.run(binding,[msg('second','接着聊')],AbortSignal.timeout(30000));
    assert.equal(second.snapshot.config.id,'sakura');assert.equal(requests.at(-1)!.model,'second');assert.equal(bridge.live.get(binding.sessionId)!.handle.agent.id,binding.sessionId);
    const serialized=JSON.stringify(requests.at(-1)!.messages);assert.ok(serialized.includes('我喜欢绿茶'));assert.ok(serialized.includes('PERSONA_B_FILE'));assert.ok(!JSON.stringify(requests[1].messages).includes('PERSONA_B_FILE'));
    const agent=bridge.live.get(binding.sessionId)!.handle.agent;
    const historySeq=agent.session.seq;
    const progressText=await bridge.formatProgress(binding,first.snapshot,{stage:'image',elapsedSeconds:60},AbortSignal.timeout(5000));
    assert.equal(progressText,'这一步还在处理喵，暂时没有最终结果。');assert.equal(agent.session.seq,historySeq);
    assert.equal(progressRequests[0].model,'first');assert.match(progressRequests[0].system! ,/PERSONA_A/);assert.equal(progressRequests[0].tools,undefined);assert.equal(progressRequests[0].maxTokens,256);assert.equal(progressRequests[0].sessionId,undefined);assert.doesNotMatch(progressText,/PRIVATE_REASONING/);
    const progressBefore=bridge.extensions.stats!.query({range:'all',kind:'progress'}).summary.calls;
    progressFails=true;await assert.rejects(bridge.formatProgress(binding,first.snapshot,{stage:'model',elapsedSeconds:120},AbortSignal.timeout(5000)),/fixture progress failure/);progressFails=false;
    const progressStats=bridge.extensions.stats!.query({range:'all',kind:'progress'});assert.equal(progressStats.summary.calls,progressBefore+1);assert.ok(progressStats.summary.unknownUsageCalls>=1);

    // A frozen foreground snapshot survives first-time session initialization.
    const frozenScope={...scope,channelId:'frozen-progress',senderId:'frozen-progress'};const frozenBinding=store.binding(frozenScope);
    const frozenSnapshot=freezeTurn(store.config('default'),store.bot('fixture'),frozenScope,['frozen-progress']);
    const frozenRun=await bridge.run(frozenBinding,[{...msg('frozen-progress','继续处理'),scope:frozenScope}],AbortSignal.timeout(30000),{snapshot:frozenSnapshot});
    assert.equal(frozenRun.snapshot.config.id,'default');assert.equal(requests.at(-1)!.model,'first');assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('PERSONA_A'));
    await bridge.dispose(frozenBinding.sessionId);

    // Observe a real tool event while its local implementation is still pending.
    let enterTool!:()=>void,releaseTool!:()=>void;const toolEntered=new Promise<void>(r=>enterTool=r),toolRelease=new Promise<void>(r=>releaseTool=r);
    const originalRun=runtime.media.run.bind(runtime.media);const toolStages:string[]=[];
    runtime.media.run=async(...args)=>{if(args[1]==='social_read'){enterTool();await toolRelease;return{text:'fixture source',assetIds:[]};}return originalRun(...args);};
    try{
      mediaCall={name:'bot_read_social',args:{url:'https://example.com/fixture'}};
      const toolRun=bridge.run(binding,[msg('long-progress-tool','查找资料')],AbortSignal.timeout(30000),{onProgress:stage=>toolStages.push(stage)});
      await Promise.race([toolEntered,toolRun.then(()=>{throw Error('fixture tool was not entered');})]);assert.equal(toolStages.at(-1),'search');
      await assert.rejects(bridge.run(binding,[msg('overlapping-background','后台请求')],AbortSignal.timeout(5000)),/SESSION_BUSY/);
      const during=await bridge.formatProgress(binding,bridge.live.get(binding.sessionId)!.snapshot,{stage:'search',elapsedSeconds:60},AbortSignal.timeout(5000));assert.ok(during);assert.equal(toolStages.at(-1),'search');
      releaseTool();await toolRun;assert.equal(toolStages.at(-1),'model');
    }finally{releaseTool();runtime.media.run=originalRun;}

    const tools=ctx.tools.schemas(agent).map(t=>t.name);assert.ok(tools.includes('bot_media'));assert.ok(tools.includes('media_transform'));assert.ok(!tools.includes('pwsh'));assert.ok(!tools.includes('spawn_agent'));
    for(const name of ['bot_stats','bot_evolve','bot_model','bot_persona']){assert.ok(!tools.includes(name),`${name} schema must be hidden from ordinary channel callers`);const denied=await ctx.tools.execute({name,arguments:name==='bot_stats'?{range:'all'}:{action:name==='bot_evolve'?'status':'list'},callId:ToolCallId('ordinary-'+name),agent,signal:AbortSignal.timeout(5000)});assert.equal(denied.isError,true,`${name} must deny ordinary channel callers`);}
    for(const name of ['bot_session','bot_skills'])assert.ok(tools.includes(name),`${name} basic schema must be available to ordinary users`);
    for(const action of ['help','status','list']){const result=toolJson(await ctx.tools.execute({name:'bot_session',arguments:{action},callId:ToolCallId('ordinary-session-'+action),agent,signal:AbortSignal.timeout(5000)}));assert.equal(result.action,action);if(action==='status')assert.equal(result.sessionId,binding.sessionId);if(action==='list')assert.ok(result.sessions.every((item:any)=>item.sessionId===binding.sessionId));}
    const ordinarySkills=toolJson(await ctx.tools.execute({name:'bot_skills',arguments:{action:'list'},callId:ToolCallId('ordinary-skills-list'),agent,signal:AbortSignal.timeout(5000)}));assert.ok(ordinarySkills.skills.length>0);assert.ok(ordinarySkills.skills.every((item:any)=>item.enabled===true));noHostPaths(ordinarySkills);
    const ordinarySkillWrite=await ctx.tools.execute({name:'bot_skills',arguments:{action:'disable',name:'image-generation'},callId:ToolCallId('ordinary-skills-disable'),agent,signal:AbortSignal.timeout(5000)});assert.equal(ordinarySkillWrite.isError,true);
    assert.equal(ctx.permissionPresets.current(agent.session),'read-only');assert.ok(tools.includes('skill'));
    const hidden=await ctx.tools.execute({name:'skill',arguments:{name:'private-global-skill'},callId:ToolCallId('hidden-skill'),agent,signal:AbortSignal.timeout(5000)});assert.equal(hidden.isError,true);
    const denied=await agent.ctx.tools.execute({name:'pwsh',arguments:{command:'Write-Output should-not-run'},callId:ToolCallId('denied'),agent,signal:AbortSignal.timeout(5000)});assert.equal(denied.isError,true);
    runtime.saveBot({...store.bot('fixture'),trustedUsers:['alice']});
    await bridge.run(binding,[msg('trusted','可信私聊测试')],AbortSignal.timeout(30000));
    assert.equal(ctx.permissionPresets.current(agent.session),'danger-full-access');assert.ok(ctx.tools.schemas(agent).some(t=>t.name==='pwsh'));
    const executed=await ctx.tools.execute({name:'pwsh',arguments:{command:"Write-Output 'trusted-fixture'"},callId:ToolCallId('trusted-command'),agent,signal:AbortSignal.timeout(15000)});assert.equal(executed.isError,false,JSON.stringify(executed));
    const originalCwd=ctx.workingDirectory.get(agent.session);const customCwd=path.join(store.home,'custom-workspace 空格 & literal');await mkdir(customCwd,{recursive:true});await writeFile(path.join(customCwd,'workspace-proof.txt'),'CUSTOM_WORKSPACE_PROOF');
    runtime.saveBot({...store.bot('fixture'),workingDirectory:customCwd});assert.equal(ctx.workingDirectory.get(agent.session),originalCwd,'saving does not mutate the current turn cwd');
    await bridge.run(binding,[msg('workspace-switch','在指定目录中继续对话')],AbortSignal.timeout(30000));assert.equal(agent.id,binding.sessionId);assert.equal(ctx.workingDirectory.get(agent.session),await realpath(customCwd));assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('我喜欢绿茶'));
    const inDirectory=await ctx.tools.execute({name:'pwsh',arguments:{command:"Get-Content -LiteralPath './workspace-proof.txt'"},callId:ToolCallId('workspace-command'),agent,signal:AbortSignal.timeout(15000)});assert.equal(inDirectory.isError,false,JSON.stringify(inDirectory));assert.ok(JSON.stringify(inDirectory).includes('CUSTOM_WORKSPACE_PROOF'),JSON.stringify(inDirectory));
    const delivered=await ctx.tools.execute({name:'bot_send_file',arguments:{path:'workspace-proof.txt'},callId:ToolCallId('workspace-file'),agent,signal:AbortSignal.timeout(5000)});assert.equal(delivered.isError,false,JSON.stringify(delivered));
    const child=await ctx.agents.create({sessionId:('child-'+binding.sessionId) as any,parentAgent:agent,agentOptions:{provider:'bot-fixture',model:'second'}});
    assert.equal(ctx.workingDirectory.get(child.agent.session),await realpath(customCwd));
    runtime.saveBot({...store.bot('fixture'),configId:'default'});await bridge.run(binding,[msg('switch-back','父轮切回默认')],AbortSignal.timeout(30000));
    child.agent.followup({id:MessageId('child-input'),role:'user',content:[{type:'text',text:'子任务沿用创建时的配置'}],source:{kind:'user'}});await child.agent.whenIdle();
    const childRequest=requests.find(r=>r.sessionId===child.agent.id)!;assert.equal(childRequest?.model,'second');assert.ok(JSON.stringify(childRequest.messages).includes('PERSONA_B'));
    let childCancelled=false;const cancelChild=child.agent.cancel.bind(child.agent);child.agent.cancel=(cause)=>{childCancelled=true;return cancelChild(cause);};
    runtime.saveBot({...store.bot('fixture'),trustedUsers:[]});
    assert.equal(childCancelled,true,'revocation cancels children even after the parent inbox turn has finished');
    const revoked=await ctx.tools.execute({name:'pwsh',arguments:{command:'Write-Output must-not-run'},callId:ToolCallId('revoked-child'),agent:child.agent,signal:AbortSignal.timeout(5000)});assert.equal(revoked.isError,true);await child.dispose();
    await bridge.dispose(binding.sessionId);
    await bridge.run(binding,[msg('third','重启恢复历史')],AbortSignal.timeout(30000));assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('我喜欢绿茶'));assert.equal(ctx.workingDirectory.get(bridge.live.get(binding.sessionId)!.handle.agent.session),await realpath(customCwd));
    await ctx.credentials.set(credentialRef('BOT_TEST_ANALYSIS_KEY'),'fixture-analysis-key');
    const inherited=await runtime.media.analysisProvider!.resolve(store.config('default'),'asr');assert.equal(inherited.endpoint.baseUrl,'https://fixture.invalid/v1');assert.equal(inherited.endpoint.model,'first');assert.equal(inherited.apiKey,'fixture-analysis-key');
    const skill=await ctx.tools.execute({name:'skill',arguments:{name:'media-analysis'},callId:ToolCallId('analysis-skill'),agent:bridge.live.get(binding.sessionId)!.handle.agent,signal:AbortSignal.timeout(5000)});assert.equal(skill.isError,false);assert.ok(JSON.stringify(skill.content).includes('media_analysis'));
    for(let i=0;i<12;i++)await bridge.run(binding,[msg(`long-${i}`,`合成历史第${i}轮：`+'The fixture contains repeated context material for deterministic compression. '.repeat(140))],AbortSignal.timeout(30000));
    assert.ok(compactions>0,'long context should trigger native automatic compaction');assert.ok(bridge.live.get(binding.sessionId)!.handle.agent.session.snapshotEvents().some(e=>String(e.type)==='compaction/end'));
    const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z4AdMOEQH6QSAM1BAQ/oQeJvAAAAAElFTkSuQmCC','base64');
    // Real image admission verifies actual decodable pixels, not an attachment path placeholder.
    const asset=await runtime.assets.save(binding.key,{kind:'image',name:'reference.png',mime:'image/png'},pixels);
    const transformAgent=bridge.live.get(binding.sessionId)!.handle.agent;
    const transformed=await Promise.all(['png','webp'].map(format=>ctx.tools.execute({name:'media_transform',arguments:{operation:'image_convert',inputs:[asset.id],format},callId:ToolCallId('local-transform-'+format),agent:transformAgent,signal:AbortSignal.timeout(15000)})));
    for(let i=0;i<transformed.length;i++){
      const result=toolJson(transformed[i]);assert.equal(result.registeredForDelivery,true);assert.equal(result.assetIds.length,1);
      const output=store.asset(binding.key,result.assetIds[0]);assert.equal(output.mime,i===0?'image/png':'image/webp');assert.ok((await runtime.assets.read(binding.key,output.id)).length>0);
    }
    const currentPhoto=msg('current-photo','直接查看这次消息上传的参考照片');currentPhoto.attachments=[{kind:'image',name:'reference.png',mime:'image/png',handle:asset.id}];
    await bridge.run(binding,[currentPhoto],AbortSignal.timeout(30000));const currentPhotoUser=requests.at(-1)!.messages.findLast(m=>m.role==='user')!;assert.equal(currentPhotoUser.role,'user');assert.ok(currentPhotoUser.content.some(b=>b.type==='image'),'current user attachment must deliver native image pixels');assert.ok(currentPhotoUser.content.some(b=>b.type==='text'&&b.text.includes(`[附件] id=${asset.id}`)),'image pixels must share the same message with their host asset identity');assert.ok(currentPhotoUser.content.some(b=>b.type==='text'&&b.text.includes('[sourceId=current-photo]')));
    // Exercise the production adapter's encoding seam with a local provider callback, never a network provider.
    const imageBlock=currentPhotoUser.content.find(b=>b.type==='image')!;assert.equal(imageBlock.offloaded,undefined);
    const pixelProvider=fauxProvider({provider:'pixel-wire-fixture',models:[{id:'vision',input:['text','image']}]});let encodedImage:{data:string;mimeType:string}|undefined;let providerMessageHasAsset=false;
    pixelProvider.setResponses([(context)=>{for(const message of context.messages){if(message.role!=='user'||!Array.isArray(message.content))continue;const candidate=message.content.find(b=>b.type==='image');if(candidate){encodedImage=candidate;providerMessageHasAsset=message.content.some(b=>b.type==='text'&&b.text.includes(`[附件] id=${asset.id}`));}}return fauxAssistantMessage('PIXELS_RECEIVED');}]);
    const pixelProfile:ResolvedPiAiProviderProfile={provider:'pixel-wire-fixture',displayName:'Local pixel encoding fixture',piProvider:pixelProvider.provider,streamIdleTimeoutMs:10000,maxRequestImageBytes:1048576,requestImagePixelBudget:1048576,requestImageMaxBytes:1048576,retryPolicy:resolveRetryPolicy(undefined,'pixel-fixture'),modelErrors:new Map(),configuredMaxTokens:new Map()};
    const pixelProfiles=new Map([['pixel-wire-fixture',pixelProfile]]);const pixelAdapter=new PiAiAdapter({profiles:()=>pixelProfiles,resolveApiKey:async()=>undefined,resolveAttachments:()=>ctx.attachments,auth:{credentials:new InMemoryCredentialStore(),authContext:{env:async()=>undefined,fileExists:async()=>false}}});
    const pixelChunks:StreamChunk[]=[];for await(const chunk of pixelAdapter.stream({...requests.at(-1)!,provider:'pixel-wire-fixture',model:'vision',messages:[currentPhotoUser],tools:[],signal:AbortSignal.timeout(10000)}))pixelChunks.push(chunk);
    assert.ok(encodedImage,'production adapter must pass actual base64 pixels to provider callback');assert.equal(providerMessageHasAsset,true);const encodedVariant=await ctx.attachments.readImageRequest(imageBlock.attachment,pixelAdapter.imageRequestTarget('pixel-wire-fixture','vision',imageBlock.attachment));assert.deepEqual(Buffer.from(encodedImage.data,'base64'),Buffer.from(encodedVariant.data));assert.equal(encodedImage.mimeType,encodedVariant.mediaType);assert.equal(encodedVariant.width,8);assert.equal(encodedVariant.height,8);assert.ok(pixelChunks.some(c=>c.type==='block-end'&&c.block.type==='text'&&c.block.text.includes('PIXELS_RECEIVED')));
    mediaCall={name:'bot_media',args:{operation:'image_understand',inputs:[asset.id]}};
    await bridge.run(binding,[msg('pixels','读取刚才的图片')],AbortSignal.timeout(30000));
    assert.ok(requests.at(-1)!.messages.some(m=>m.role==='tool'&&m.content.some(b=>b.type==='image')),'native model must receive image tool pixels: '+JSON.stringify(requests.at(-1)!.messages.slice(-3)));
    const docFile=path.join(store.home,'native-scan.pdf');execFileSync(process.env.BOT_PYTHON!,['-c',"from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=200,height=200); w.write(sys.argv[1])",docFile],{windowsHide:true});
    const scan=await runtime.assets.save(binding.key,{kind:'file',name:'scan.pdf',mime:'application/pdf'},await (await import('node:fs/promises')).readFile(docFile));
    mediaCall={name:'bot_media',args:{operation:'document_read',inputs:[scan.id]}};
    const docResult=await bridge.run(binding,[msg('ocr','读取扫描页')],AbortSignal.timeout(30000));assert.deepEqual(docResult.outputs,[{type:'text',text:'FINAL_ONLY'}]);
    assert.ok(requests.at(-1)!.messages.some(m=>m.role==='tool'&&m.content.some(b=>b.type==='image')),'scanned page pixels must reach the current chat model');
    const mediaRun=runtime.media.run.bind(runtime.media);let imageCalls=0;let imageEntered!:()=>void;let finishImage!:()=>void;
    const imageReady=new Promise<void>(resolve=>{imageEntered=resolve;});const imageFinish=new Promise<void>(resolve=>{finishImage=resolve;});
    try{
      runtime.media.run=async(scope,operation,_config,inputs,parameters)=>{assert.equal(scope,binding.key);assert.equal(operation,'image_download');assert.deepEqual(inputs,[]);assert.equal(parameters.url,'https://example.com/original.png');return{assetIds:[asset.id]};};
      mediaCall={name:'media_analysis',args:{kind:'image',url:'https://example.com/original.png'}};
      finalText=`已下载。\n\n![图片](asset://${asset.id})`;
      const downloaded=await bridge.run(binding,[msg('download-original','下载链接中的原图')],AbortSignal.timeout(30000));
      assert.deepEqual(downloaded.outputs,[{type:'text',text:'已下载。'},{type:'asset',assetId:asset.id}]);
      runtime.media.run=async(_scope,operation,_config,inputs,parameters)=>{assert.equal(operation,'video_analyze');assert.deepEqual(inputs,[]);assert.equal(parameters.url,'https://v.douyin.com/34Ae2yNHPXs/');return{text:'VIDEO_LINK_ROUTED',assetIds:[]};};
      mediaCall={name:'media_analysis',args:{kind:'video',url:'https://v.douyin.com/34Ae2yNHPXs/'}};
      await bridge.run(binding,[msg('analyze-video-link','分析视频链接')],AbortSignal.timeout(30000));
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('VIDEO_LINK_ROUTED'));
      runtime.media.run=async(_scope,operation,_config,inputs,parameters)=>{assert.equal(operation,'video_download');assert.deepEqual(inputs,[]);assert.equal(parameters.url,'https://b23.tv/test');return{assetIds:[]};};
      mediaCall={name:'media_analysis',args:{kind:'video',action:'download',url:'https://b23.tv/test'}};
      await bridge.run(binding,[msg('download-video-link','只下载视频')],AbortSignal.timeout(30000));
      await writeFile(path.join(path.dirname(resultPath),'media-links-result.json'),JSON.stringify({status:'PASS',checks:['image download dispatch and automatic delivery registration','image markdown removed from channel text','video URL analysis dispatch','video-only download dispatch']}));

    }finally{runtime.media.run=mediaRun;}
    try{
      runtime.saveBot({...store.bot('fixture'),trustedUsers:['alice']});
      runtime.media.run=async()=>({assetIds:[asset.id]});
      const copyPath=path.join(bridge.live.get(binding.sessionId)!.cwd,'renamed-generated-image.png');await writeFile(copyPath,pixels);
      mediaCall={name:'image_generation',args:{prompt:'Generate a single image'}};
      beforeFinal=async()=>{
        const parent=bridge.live.get(binding.sessionId)!.handle.agent;
        const registered=toolJson(await ctx.tools.execute({name:'bot_send_file',arguments:{path:copyPath,mime:'image/png'},callId:ToolCallId('generated-image-copy'),agent:parent,signal:AbortSignal.timeout(5000)}));
        assert.equal(registered.assetId,asset.id,'path registration must reuse the automatically registered image, even under a different filename');
        const repeated=toolJson(await ctx.tools.execute({name:'bot_send_file',arguments:{path:copyPath},callId:ToolCallId('generated-image-copy-default-mime'),agent:parent,signal:AbortSignal.timeout(5000)}));
        assert.equal(repeated.assetId,asset.id,'omitting the MIME type must still reuse the image');
      };
      const single=await bridge.run(binding,[msg('single-image-delivery','生成一张图片并发给我')],AbortSignal.timeout(30000));
      assert.deepEqual(single.outputs,[{type:'text',text:'FINAL_ONLY'},{type:'asset',assetId:asset.id}],'automatic registration followed by path delivery must produce exactly one image');
      const different=Buffer.from(pixels);different[different.length-1]^=1;await writeFile(copyPath,different);
      const distinct=toolJson(await ctx.tools.execute({name:'bot_send_file',arguments:{path:copyPath},callId:ToolCallId('distinct-file-same-size'),agent:bridge.live.get(binding.sessionId)!.handle.agent,signal:AbortSignal.timeout(5000)}));
      assert.notEqual(distinct.assetId,asset.id,'different bytes with the same size must remain a separate attachment');
      assert.equal(bridge.live.get(binding.sessionId)!.assets.length,2);
    }finally{runtime.media.run=mediaRun;beforeFinal=undefined;runtime.saveBot({...store.bot('fixture'),trustedUsers:[]});}
    runtime.media.run=async(_scope,operation,config,inputs)=>{assert.equal(config.media.image,undefined);assert.equal(operation,'image_edit');assert.deepEqual(inputs,[asset.id]);imageCalls++;if(imageCalls<=2)throw Error('IMAGE_PROVIDER_FAILED');imageEntered();await imageFinish;return{assetIds:[asset.id]};};
    try{
      mediaCall={name:'image_generation',args:{operation:'edit',prompt:'Use the real reference on the moon',inputs:[asset.id]}};
      const generated=await bridge.run(binding,[msg('image-skill','按参考图生成图片')],AbortSignal.timeout(30000));
      assert.equal(imageCalls,1);assert.deepEqual(generated.outputs,[{type:'text',text:'FINAL_ONLY'}]);
      const parent=bridge.live.get(binding.sessionId)!.handle.agent;
      const retry=await ctx.tools.execute({name:'image_generation',arguments:{operation:'edit',prompt:'Retry after failure',inputs:[asset.id]},callId:ToolCallId('retry-image'),agent:parent,signal:AbortSignal.timeout(5000)});assert.equal(retry.isError,true);assert.equal(imageCalls,2,'a failed attempt must not consume the turn image allowance');
      const recoveredPromise=ctx.tools.execute({name:'bot_media',arguments:{operation:'image_edit',prompt:'Retry via compatibility tool',inputs:[asset.id]},callId:ToolCallId('recover-image'),agent:parent,signal:AbortSignal.timeout(5000)});
      await imageReady;const parallel=await ctx.tools.execute({name:'image_generation',arguments:{operation:'edit',prompt:'Must not run concurrently',inputs:[asset.id]},callId:ToolCallId('parallel-image'),agent:parent,signal:AbortSignal.timeout(5000)});finishImage();assert.equal(parallel.isError,true);assert.equal(imageCalls,3);
      const recovered=await recoveredPromise;assert.equal(recovered.isError,false,JSON.stringify(recovered));assert.equal(imageCalls,3);assert.deepEqual(bridge.live.get(binding.sessionId)!.assets,[{type:'asset',assetId:asset.id}]);
      const duplicate=await ctx.tools.execute({name:'bot_media',arguments:{operation:'image_generate',prompt:'duplicate'},callId:ToolCallId('duplicate-image'),agent:parent,signal:AbortSignal.timeout(5000)});assert.equal(duplicate.isError,true);assert.equal(imageCalls,3);
      const c=store.config('default');await runtime.saveConfig({...c,media:{image:{enabled:false}}},c.revision);
      const disabled=await ctx.tools.execute({name:'image_generation',arguments:{prompt:'disabled'},callId:ToolCallId('disabled-image'),agent:parent,signal:AbortSignal.timeout(5000)});assert.equal(disabled.isError,true);assert.equal(imageCalls,3);
    }finally{finishImage();runtime.media.run=mediaRun;}
    const audio=await runtime.assets.save(binding.key,{kind:'audio',name:'voice.wav',mime:'audio/wav'},Buffer.from('fixture'));
    let analysisCalls=0;runtime.media.run=async(_scope,operation,config,inputs)=>{assert.equal(operation,'transcribe');assert.deepEqual(inputs,[audio.id]);assert.equal(config.model?.model,'first');analysisCalls++;return{text:'SCRIPT_TRANSCRIPT',coverage:'AUDIO_MODEL_ANALYSIS',assetIds:[]};};
    try{
      mediaCall={name:'media_analysis',args:{kind:'audio',question:'转写'}};await bridge.run(binding,[msg('analysis','分析最近语音')],AbortSignal.timeout(30000));assert.equal(analysisCalls,1);assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('SCRIPT_TRANSCRIPT'));
      const {personaPrompt,...draft}=store.config('default');await writeFile(path.join(store.personas.directory('default'),'config.json'),JSON.stringify({...draft,skills:['image-generation']}));await runtime.applyPersonaFiles('default');
      for(const call of [{name:'media_analysis',arguments:{kind:'audio',inputs:[audio.id]}},{name:'media_transform',arguments:{operation:'image_convert',inputs:[asset.id]}},{name:'bot_media',arguments:{operation:'transcribe',inputs:[audio.id]}},{name:'skill',arguments:{name:'media-analysis'}}]){const denied=await ctx.tools.execute({...call,callId:ToolCallId('revoked-'+call.name),agent:bridge.live.get(binding.sessionId)!.handle.agent,signal:AbortSignal.timeout(5000)});assert.equal(denied.isError,true);}assert.equal(analysisCalls,1);
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
    const featureChecks:string[]=[];
    runtime.saveBot({...store.bot('fixture'),trustedUsers:['alice']});
    await runtime.switchPersona(scope,'sakura');await bridge.run(store.binding(scope),[msg('session-persona','仅本会话人格覆盖')],AbortSignal.timeout(30000));
    assert.equal(store.bot('fixture').configId,'default');assert.equal(requests.at(-1)!.model,'second');assert.equal(bridge.live.get(binding.sessionId)!.snapshot.config.id,'sakura');
    await runtime.setModel(scope,{provider:'bot-fixture',model:'first'});await bridge.run(store.binding(scope),[msg('session-model','仅本会话模型覆盖')],AbortSignal.timeout(30000));assert.equal(requests.at(-1)!.model,'first');
    const newBinding=await runtime.newSession(scope);assert.notEqual(newBinding.sessionId,binding.sessionId);assert.equal(newBinding.personaId,'sakura');assert.equal(newBinding.modelOverride?.model,'first');
    await bridge.run(newBinding,[msg('override-new','新会话保留覆盖配置')],AbortSignal.timeout(30000));assert.equal(requests.at(-1)!.model,'first');assert.ok(!JSON.stringify(requests.at(-1)!.messages).includes('[sourceId=session-model]'));
    await runtime.setModel(scope,null);await bridge.run(store.binding(scope),[msg('model-reset','恢复人格模型')],AbortSignal.timeout(30000));assert.equal(requests.at(-1)!.model,'second');
    featureChecks.push('per-session persona and model overrides preserve bot defaults','new native session retains persona/model overrides and resets turn history','model reset uses persona model');

    const active=bridge.live.get(newBinding.sessionId)!.handle.agent;const compactBefore=compactions;
    const compactResult=await runtime.compactSession(scope);assert.equal(typeof compactResult,'string');assert.equal(compactions,compactBefore+1,'manual compact must call native compaction exactly once');assert.ok(active.session.snapshotEvents().some(e=>e.type==='compaction/end'));
    featureChecks.push('manual compact dispatches native Harness command and persists summary');
    const dynamicName='native-proof';const skillFiles=(version:string)=>[{path:'SKILL.md',content:`---\nname: ${dynamicName}\ndescription: Native fixture skill\n---\nRead scripts/proof.py from the returned resourceBase.\n${version}\n`},{path:'scripts/proof.py',content:"import os\nfrom pathlib import Path\nimport helper\nprint(helper.PROOF)\nprint('BYTECODE_ENV=' + os.environ.get('PYTHONDONTWRITEBYTECODE', 'unset'))\nPath(helper.PROOF + '.txt').write_text(helper.PROOF, encoding='utf-8')\n"},{path:'scripts/helper.py',content:`PROOF = '${version}'\n`}];
    const currentSkill=store.config('sakura');const v1=await runtime.saveConfig(bridge.skillFiles.stageFiles(currentSkill,dynamicName,skillFiles('DYNAMIC_V1')),currentSkill.revision);
    await bridge.run(store.binding(scope),[msg('skill-v1','使用新技能')],AbortSignal.timeout(30000));
    const readSkill=async(target:typeof active,tag:string)=>ctx.tools.execute({name:'skill',arguments:{name:dynamicName},callId:ToolCallId(tag),agent:target,signal:AbortSignal.timeout(5000)});
    const firstSkill=await readSkill(active,'dynamic-v1');assert.equal(firstSkill.isError,false,JSON.stringify(firstSkill));assert.ok(JSON.stringify(firstSkill).includes('DYNAMIC_V1'));assert.ok(JSON.stringify(firstSkill).includes(v1.skillVersions[dynamicName]));
    const v1Resources=bridge.skillFiles.snapshot(v1)[dynamicName].resourceBase.path;
    const pythonCommand=`& '${process.env.BOT_PYTHON!.replaceAll("'","''")}' '${path.join(v1Resources,'scripts','proof.py').replaceAll("'","''")}'`;
    // Deliberately omit -B: shell initialization itself must protect the immutable resource tree.
    const executedSkill=await ctx.tools.execute({name:'pwsh',arguments:{command:pythonCommand},callId:ToolCallId('dynamic-parent-python-import'),agent:active,signal:AbortSignal.timeout(15000)});assert.equal(executedSkill.isError,false,JSON.stringify(executedSkill));assert.ok(JSON.stringify(executedSkill).includes('DYNAMIC_V1'));assert.ok(JSON.stringify(executedSkill).includes('BYTECODE_ENV=1'));
    assert.deepEqual((await readdir(path.join(v1Resources,'scripts'))).sort(),['helper.py','proof.py']);assert.equal(await readFile(path.join(customCwd,'DYNAMIC_V1.txt'),'utf8'),'DYNAMIC_V1');assert.doesNotThrow(()=>bridge.skillFiles.snapshot(v1));
    const frozenChild=await ctx.agents.create({sessionId:('skills-'+newBinding.sessionId) as any,parentAgent:active,agentOptions:{provider:'bot-fixture',model:'second'}});
    // A child owns a distinct native shell and must not inherit the parent's initialization marker.
    mediaCall={name:'pwsh',args:{command:pythonCommand}};frozenChild.agent.followup({id:MessageId('dynamic-child-python-input'),role:'user',content:[{type:'text',text:'在当前工作目录运行固定版本技能脚本，验证同目录 helper 导入'}],source:{kind:'user'}});await frozenChild.agent.whenIdle();
    const childPythonTool=requests.filter(r=>r.sessionId===frozenChild.agent.id).at(-1)!.messages.filter(m=>m.role==='tool').at(-1)!;assert.equal(childPythonTool.role,'tool');assert.equal(childPythonTool.isError,false,JSON.stringify(childPythonTool));assert.ok(JSON.stringify(childPythonTool).includes('BYTECODE_ENV=1'));assert.ok(JSON.stringify(childPythonTool).includes('DYNAMIC_V1'));
    assert.deepEqual((await readdir(path.join(v1Resources,'scripts'))).sort(),['helper.py','proof.py']);assert.doesNotThrow(()=>bridge.skillFiles.snapshot(v1));
    beforeTool=async()=>{const current=store.config('sakura');await runtime.saveConfig(bridge.skillFiles.stageFiles(current,dynamicName,skillFiles('DYNAMIC_V2')),current.revision);};mediaCall={name:'skill',args:{name:dynamicName}};
    await bridge.run(store.binding(scope),[msg('publish-v2-inflight','本轮内发布下一版技能')],AbortSignal.timeout(30000));
    const toolMessage=requests.at(-1)!.messages.filter(m=>m.role==='tool').at(-1)!;assert.ok(JSON.stringify(toolMessage).includes('DYNAMIC_V1'),'in-flight skill read must keep V1');assert.ok(!JSON.stringify(toolMessage).includes('DYNAMIC_V2'));
    await bridge.run(store.binding(scope),[msg('skill-v2','下一轮技能刷新')],AbortSignal.timeout(30000));const secondSkill=await readSkill(active,'dynamic-v2');assert.equal(secondSkill.isError,false);assert.ok(JSON.stringify(secondSkill).includes('DYNAMIC_V2'));assert.ok(!JSON.stringify(secondSkill).includes('DYNAMIC_V1'));
    const childSkill=await readSkill(frozenChild.agent,'dynamic-child-v1');assert.equal(childSkill.isError,false,JSON.stringify(childSkill));assert.ok(JSON.stringify(childSkill).includes('DYNAMIC_V1'));assert.ok(!JSON.stringify(childSkill).includes('DYNAMIC_V2'));await frozenChild.dispose();
    featureChecks.push('new dynamic skill publishes resource directory and becomes readable next turn','dynamic skill stays frozen within an in-flight model/tool turn','parent refreshes dynamic skill next turn while child keeps original version','native parent and independent child Python imports create no bytecode inside immutable skill resources','skill execution writes output to working directory and next-turn release integrity remains valid');

    const privileged=ctx.tools.schemas(active).map(t=>t.name);assert.ok(privileged.includes('bot_stats'));assert.ok(privileged.includes('bot_evolve'));
    const stats=await ctx.tools.execute({name:'bot_stats',arguments:{range:'all'},callId:ToolCallId('trusted-stats'),agent:active,signal:AbortSignal.timeout(5000)});assert.equal(stats.isError,false,JSON.stringify(stats));const totals=bridge.extensions.stats!.query({range:'all'});assert.ok(totals.summary.calls>0);assert.ok(totals.summary.knownTokens>0);assert.ok(totals.models.some(m=>m.kind==='compaction'&&m.calls>0));assert.ok(totals.models.some(m=>m.kind==='subagent'&&m.calls>0));
    const evo=await ctx.tools.execute({name:'bot_evolve',arguments:{action:'status'},callId:ToolCallId('trusted-evolve'),agent:active,signal:AbortSignal.timeout(5000)});assert.equal(evo.isError,false,JSON.stringify(evo));
    const noHostConfig=store.config('sakura');await runtime.saveConfig({...noHostConfig,allowHostTools:false},noHostConfig.revision);
    await bridge.run(store.binding(scope),[msg('model-without-host','查看会话模型管理能力')],AbortSignal.timeout(30000));const noHostTools=ctx.tools.schemas(active).map(t=>t.name);assert.ok(noHostTools.includes('bot_model'),'trusted model management remains available without host tool permission');assert.ok(!noHostTools.includes('pwsh'));assert.ok(!noHostTools.includes('bot_evolve'));
    const listedModels=await ctx.tools.execute({name:'bot_model',arguments:{action:'list'},callId:ToolCallId('trusted-model-list'),agent:active,signal:AbortSignal.timeout(5000)});assert.equal(listedModels.isError,false,JSON.stringify(listedModels));assert.ok(JSON.stringify(listedModels).includes('bot-fixture'));
    const modelFrozenChild=await ctx.agents.create({sessionId:('model-'+newBinding.sessionId) as any,parentAgent:active,agentOptions:{provider:'bot-fixture',model:'second'}});
    for(const name of ['bot_session','bot_persona','bot_skills'])assert.ok(noHostTools.includes(name),`${name} must not require host permission`);
    const listedPersonas=toolJson(await ctx.tools.execute({name:'bot_persona',arguments:{action:'list'},callId:ToolCallId('trusted-persona-list'),agent:active,signal:AbortSignal.timeout(5000)}));assert.equal(listedPersonas.currentPersonaId,'sakura');assert.ok(listedPersonas.personas.some((item:any)=>item.id==='default'));assert.ok(listedPersonas.personas.some((item:any)=>item.id==='sakura'&&item.current));noHostPaths(listedPersonas);
    const listedSkills=toolJson(await ctx.tools.execute({name:'bot_skills',arguments:{action:'list'},callId:ToolCallId('trusted-skills-list'),agent:active,signal:AbortSignal.timeout(5000)}));assert.equal(listedSkills.personaId,'sakura');assert.ok(listedSkills.skills.some((item:any)=>item.name===dynamicName&&item.enabled));assert.ok(listedSkills.skills.every((item:any)=>typeof item.description==='string'&&typeof item.available==='boolean'));noHostPaths(listedSkills);
    const actionCountBeforeChild=store.list('session-action').length;
    for(const call of [
      {name:'bot_session',arguments:{action:'new'}},{name:'bot_session',arguments:{action:'stop'}},{name:'bot_session',arguments:{action:'compact'}},{name:'bot_session',arguments:{action:'resume',sessionId:newBinding.sessionId}},
      {name:'bot_persona',arguments:{action:'set',personaId:'default'}},{name:'bot_skills',arguments:{action:'disable',name:dynamicName}},{name:'bot_skills',arguments:{action:'enable',name:'media-analysis'}},
      {name:'bot_model',arguments:{action:'set',provider:'bot-fixture',model:'first'}},{name:'bot_model',arguments:{action:'reset'}},
    ]){const denied=await ctx.tools.execute({...call,callId:ToolCallId('child-mutation-'+call.name+'-'+call.arguments.action),agent:modelFrozenChild.agent,signal:AbortSignal.timeout(5000)});assert.equal(denied.isError,true,JSON.stringify(call));assert.match(JSON.stringify(denied),/MAIN_AGENT_REQUIRED/,'child mutation must be rejected by the main-agent gate, not by missing inbox state');}
    assert.equal(store.list('session-action').length,actionCountBeforeChild,'rejected child mutations must not create queued work');
    for(const call of [{name:'bot_session',arguments:{action:'status'}},{name:'bot_session',arguments:{action:'list'}},{name:'bot_model',arguments:{action:'list'}},{name:'bot_persona',arguments:{action:'list'}},{name:'bot_skills',arguments:{action:'list'}}]){const result=toolJson(await ctx.tools.execute({...call,callId:ToolCallId('child-query-'+call.name+'-'+call.arguments.action),agent:modelFrozenChild.agent,signal:AbortSignal.timeout(5000)}));assert.equal(result.action,call.arguments.action);noHostPaths(result);}
    const beforeModelSwitch=requests.length;mediaCall={name:'bot_model',args:{action:'set',provider:'bot-fixture',model:'first'}};
    await bridge.run(store.binding(scope),[msg('natural-model-switch','请把当前会话切换到 first 模型')],AbortSignal.timeout(30000));const switchRequests=requests.slice(beforeModelSwitch).filter(r=>r.sessionId===active.id);assert.ok(switchRequests.length>=2,'tool call and its continuation must both execute');assert.ok(switchRequests.every(r=>r.model==='second'),'the model switch tool must not change its in-flight continuation model');
    const switchTool=switchRequests.at(-1)!.messages.filter(m=>m.role==='tool').at(-1)!;assert.equal(switchTool.role,'tool');assert.equal(switchTool.isError,false,JSON.stringify(switchTool));const switchResult=JSON.parse(switchTool.content.filter(b=>b.type==='text').map(b=>b.text).join(''));assert.equal(switchResult.effective,'next_turn');assert.equal(switchResult.currentTurnModel.model,'second');assert.equal(switchResult.nextTurnModel.model,'first');assert.equal(store.config('sakura').model?.model,'second');
    await bridge.run(store.binding(scope),[msg('model-next-turn','现在用切换后的模型继续')],AbortSignal.timeout(30000));assert.equal(requests.at(-1)!.model,'first');
    modelFrozenChild.agent.followup({id:MessageId('frozen-model-child'),role:'user',content:[{type:'text',text:'父会话切换模型后子任务保持自己的冻结模型'}],source:{kind:'user'}});await modelFrozenChild.agent.whenIdle();assert.equal(requests.filter(r=>r.sessionId===modelFrozenChild.agent.id).at(-1)!.model,'second');await modelFrozenChild.dispose();
    const reenableHost=store.config('sakura');await runtime.saveConfig({...reenableHost,allowHostTools:true},reenableHost.revision);await bridge.run(store.binding(scope),[msg('reenable-host','重新启用本机工具后继续当前会话')],AbortSignal.timeout(30000));
    const reopenedShell=await ctx.tools.execute({name:'pwsh',arguments:{command:"Write-Output 'SHELL_AFTER_PERMISSION_REENABLE'"},callId:ToolCallId('reopened-shell'),agent:active,signal:AbortSignal.timeout(15000)});assert.equal(reopenedShell.isError,false,JSON.stringify(reopenedShell));assert.ok(JSON.stringify(reopenedShell).includes('SHELL_AFTER_PERMISSION_REENABLE'));assert.equal(ctx.permissionPresets.current(active.session),'danger-full-access');
    featureChecks.push('trusted bot_model schema and catalog remain available with host tools disabled','natural-language model tool returns next_turn and keeps the current native continuation on its old model','following native turn uses requested session model without changing shared persona or an existing child model','ordinary users can query basic native session and skills tools but cannot change shared skills','trusted persona and skill catalogs work without host permission and never expose resource paths','child agents can query management tools but every session/persona/skills/model mutation is rejected before queuing');
    const failedPhoto={...msg('fixture-failed-photo','请根据我上传的参考照片生成一张新图片'),timestamp:Date.now()-1000};store.accept(failedPhoto);store.mark(newBinding.key,[failedPhoto.id],'failed');store.put('failure',`native-photo-failure:${newBinding.sessionId}`,{sessionId:newBinding.sessionId,scope:newBinding.key,state:'failed',stage:'attachments',sourceIds:[failedPhoto.id],at:Date.now()-1000,code:'ATTACHMENT_DOWNLOAD_FAILED'});
    await bridge.run(store.binding(scope),[msg('failed-photo-followup','为什么刚才的图片还没有生成')],AbortSignal.timeout(30000));const failureContext=JSON.stringify(requests.at(-1)!.messages);assert.ok(failureContext.includes('宿主记录的先前失败或投递状态'),'subsequent native request must receive durable host failure context');assert.ok(failureContext.includes('未生成新图片'),'failure context must not imply that an image was generated');assert.ok(failureContext.includes(failedPhoto.text),'failure context includes the actual failed user request');
    featureChecks.push('current user photo attachment admits native image pixels alongside its exact host asset reference','production PiAiAdapter passes exact encoded image bytes to a local provider callback without remote calls','existing session releases persistent terminals on permission downgrade and PowerShell works after permission reenable','later followup receives host-recorded attachment failure and explicitly knows no new image was generated');
    const groupScope={...scope,kind:'group' as const,channelId:'fixture-room'};const groupBinding=store.binding(groupScope);await bridge.run(groupBinding,[{...msg('group-features','群聊隔离'),scope:groupScope}],AbortSignal.timeout(30000));const groupAgent=bridge.live.get(groupBinding.sessionId)!.handle.agent;
    for(const name of ['bot_stats','bot_evolve','bot_model','bot_persona']){assert.ok(!ctx.tools.schemas(groupAgent).some(t=>t.name===name),`${name} must be hidden for groups`);const result=await ctx.tools.execute({name,arguments:name==='bot_stats'?{range:'all'}:{action:name==='bot_evolve'?'status':'list'},callId:ToolCallId('group-'+name),agent:groupAgent,signal:AbortSignal.timeout(5000)});assert.equal(result.isError,true);}
    runtime.saveBot({...store.bot('fixture'),trustedUsers:[]});
    for(const name of ['bot_stats','bot_evolve','bot_model','bot_persona']){const result=await ctx.tools.execute({name,arguments:name==='bot_stats'?{range:'all'}:{action:name==='bot_evolve'?'status':'list'},callId:ToolCallId('revoked-feature-'+name),agent:active,signal:AbortSignal.timeout(5000)});assert.equal(result.isError,true,`${name} must deny after trust revocation`);}
    featureChecks.push('statistics, evolution and model management schemas hidden and execution denied for ordinary and group callers','trusted statistics returns actual native main/subagent/compaction accounting','trusted feature tools work and trust revocation denies later calls immediately');

    // Use the real inbox/processing route for queued writes. Only the transport is
    // replaced; no platform connection or external provider is used by this test.
    const controlScope={...scope,channelId:'native-controls',senderId:'native-controls'};const controlKey=scopeKey(controlScope);
    const controlMsg=(id:string,text:string):InboundMessage=>({...msg(id,text),scope:controlScope});
    const qq=runtime.channels.require('qq').adapter;const previousRead=runtime.credentials.read,previousSend=qq.send;const sentControlDeliveries:string[]=[];
    runtime.credentials.read=async botId=>botId==='fixture'?{accountId:'fixture',appSecret:'fixture-secret'}:undefined;
    qq.send=async(bot,_credential,delivery)=>{assert.equal(bot.id,'fixture');assert.equal(delivery.scopeKey,controlKey);sentControlDeliveries.push(delivery.id);return`fixture-accepted-${delivery.id}`;};
    try{
      const oldMarker='NATIVE_MANAGEMENT_OLD_CONTEXT';await runtime.receive(controlMsg('management-warmup',`保存本轮测试标记 ${oldMarker}，后面会通过工具操作会话。`));await runtime.process(controlKey);
      const oldControl=store.binding(controlScope);const controlAgent=bridge.live.get(oldControl.sessionId)!.handle.agent;assert.equal(ctx.permissionPresets.current(controlAgent.session),'read-only');assert.ok(ctx.tools.schemas(controlAgent).some(tool=>tool.name==='bot_session'));
      const queuedControl=async(action:'compact'|'new',id:string)=>{
        const before=requests.length;const current=store.binding(controlScope);let continuationChecked=false;
        beforeFinal=options=>{assert.equal(options.sessionId,current.sessionId);const tool=options.messages.filter(message=>message.role==='tool').at(-1)!;assert.equal(tool.role,'tool');const queued=toolJson(tool);assert.equal(queued.status,'queued');assert.equal(queued.action,action);assert.equal(typeof queued.actionId,'string');assert.equal(store.get<any>('session-action',queued.actionId)?.state,'queued','management action must not run inside its own native turn');assert.equal(store.binding(controlScope).sessionId,current.sessionId);continuationChecked=true;};
        mediaCall={name:'bot_session',args:{action}};await runtime.receive(controlMsg(id,`本轮请通过会话工具执行 ${action} 并返回排队确认。`));await runtime.process(controlKey);
        const turns=requests.slice(before).filter(request=>request.sessionId===current.sessionId);assert.ok(turns.length>=2,'queued write needs an actual native tool roundtrip');assert.equal(continuationChecked,true);
        const tool=turns.at(-1)!.messages.filter(message=>message.role==='tool').at(-1)!;const queued=toolJson(tool);
        const deadline=Date.now()+10000;let record=store.get<any>('session-action',queued.actionId);
        while(record&&['queued','running'].includes(record.state)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,10));record=store.get<any>('session-action',queued.actionId);}
        assert.equal(record?.state,'succeeded',JSON.stringify(record));assert.equal(record.sessionId,current.sessionId);assert.ok(record.sourceIds.includes(id));
        await runtime.flushDeliveries();assert.ok(store.deliveries().some(delivery=>delivery.sourceId===id&&delivery.sessionId===current.sessionId&&delivery.output.text==='FINAL_ONLY'&&delivery.state==='sent'),'native queued acknowledgment must be durably delivered before changing sessions');
        return queued;
      };
      const compactionsBeforeQueued=compactions;await queuedControl('compact','management-compact');assert.equal(compactions,compactionsBeforeQueued+1,'queued compact must execute real native compaction once without waiting for itself');assert.equal(store.binding(controlScope).sessionId,oldControl.sessionId);assert.ok(controlAgent.session.snapshotEvents().some(event=>event.type==='compaction/end'));
      await queuedControl('new','management-new');const freshControl=store.binding(controlScope);assert.notEqual(freshControl.sessionId,oldControl.sessionId);assert.equal(freshControl.personaId,oldControl.personaId);assert.deepEqual(freshControl.modelOverride,oldControl.modelOverride);
      assert.ok(store.deliveries().some(delivery=>delivery.sourceId==='management-new'&&delivery.sessionId===freshControl.sessionId&&delivery.state==='sent'),'new session completion must be persisted and sent in the replacement session');
      await runtime.receive(controlMsg('management-fresh','新会话首轮的测试输入，仅回复确认。'));await runtime.process(controlKey);const freshRequest=requests.filter(request=>request.sessionId===freshControl.sessionId).at(-1)!;assert.ok(freshRequest);const freshHistory=JSON.stringify(freshRequest.messages);assert.ok(freshHistory.includes('[sourceId=management-fresh]'));assert.ok(!freshHistory.includes(oldMarker));assert.ok(!freshHistory.includes('[sourceId=management-compact]'));assert.ok(!freshHistory.includes('[sourceId=management-new]'));assert.ok(sentControlDeliveries.length>=5);
      featureChecks.push('ordinary native bot_session write returns queued while its own turn still runs','queued native compact finishes after the tool turn without deadlock and persists a real compaction event','queued new durably sends acknowledgment before reset and completion after reset','next runtime-received turn uses a new native session with empty prior context');
    }finally{beforeFinal=undefined;mediaCall=undefined;runtime.credentials.read=previousRead;qq.send=previousSend;}
    await writeFile(resultPath,JSON.stringify({status:'PASS',requests:requests.length,compactions,checks:['progress generation uses frozen persona without tools or history mutation','progress usage includes failed requests','frozen snapshot initializes a new native session','native long tool exposes a safe progress stage','real native turn and business tool','final text excludes reasoning','snapshot holds across tool steps','next-turn persona/model switch preserves session/history','ordinary host tools hidden and denied','trusted PowerShell execution without per-call approval','frozen child persona/model after parent switches','revoked permission denied in child agent','private skill read denied','durable session resume','working directory switches next turn without losing session or history','native PowerShell and file delivery use custom directory','children and resumed sessions preserve configured working directory','native provider settings and credentials inherited without copying secrets','published media-analysis skill readable by ordinary user','native automatic long-context compaction','image bytes loaded into native chat model without vision service','scanned PDF rendered and passed to native chat model','image skill inherits environment with no WebUI media setup','reference edit auto-registers one image for delivery','failed image attempts can retry through dedicated and compatibility tools','parallel image calls denied while a retry is running','compatibility call cannot bypass one successful image limit','image skill disable immediately denies calls','audio analysis selects same-session recent attachment and returns script result','analysis revocation denies dedicated and compatibility tools and skill reads',...webChecks,...featureChecks]}));
  };
  setImmediate(()=>void test().catch(async error=>{await writeFile(resultPath,JSON.stringify({status:'FAIL',error:error.stack??String(error),failures:store.list('failure'),events:[...bridge.live.values()].flatMap(l=>l.handle.agent.session.snapshotEvents()).filter(e=>e.type==='turn/end').slice(-2)}));}));
}
