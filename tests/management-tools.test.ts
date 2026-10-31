import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {ToolRunContext} from '@deepseek-ai/dsh-tools';
import {Store} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {BotFeatures} from '../src/core/features.js';
import {BotManagement,botSessionArgumentsSchema,botPersonaArgumentsSchema,botSkillsArgumentsSchema} from '../src/core/management.js';
import {defineBotSessionTool,defineBotPersonaTool,defineBotSkillsTool} from '../src/harness/management-tools.js';
import {botSchema,type CallerScope,type SessionBinding} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {defineBotScheduleTool,defineBotProactiveTool} from '../src/harness/automation-tools.js';

const owner:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
const signal=()=>new AbortController().signal;
async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/management-tools-'));const store=new Store(directory);const assets=new Assets(store);
  const harness:HarnessPort={run:async()=>{throw Error('NO_MODEL_CALL');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const runtime=new BotRuntime(store,assets,new MediaService(store,assets),harness,{} as any,{read:async()=>undefined,write:async()=>{},remove:async()=>{}},60000);const features=new BotFeatures(runtime);const management=new BotManagement(runtime,features);
  const previous=store.config('sakura');store.saveConfig({...previous,allowHostTools:false,model:{provider:'fixture',model:'chat'}},previous.revision);
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',configId:'sakura',enabled:true,trustedUsers:['owner']}));
  const queued:Array<{binding:SessionBinding;action:unknown}>=[];
  Object.defineProperty(runtime,'queueSessionAction',{value:(binding:SessionBinding,_snapshot:unknown,action:{action:string})=>{queued.push({binding,action});return{status:'queued',actionId:`queued-${queued.length}`,action:action.action};}});
  const binding=(scope=owner)=>store.binding(scope);const snapshot=(scope=owner)=>freezeTurn(store.effectiveConfig(binding(scope)),store.bot('bot'),scope,[]);
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});return{store,runtime,features,management,harness,queued,binding,snapshot};
}

test('management schemas reject identities, paths, mismatched action parameters and invalid target syntax',()=>{
  for(const input of [{action:'status',scope:owner},{action:'new',sessionId:'another'},{action:'resume'},{action:'resume',sessionId:'../other'},{action:'compact',page:1},{action:'list',page:0},{action:'list',page:1.5}])assert.equal(botSessionArgumentsSchema.safeParse(input).success,false,JSON.stringify(input));
  for(const input of [{action:'list',personaId:'sakura'},{action:'set'},{action:'set',personaId:'../persona'},{action:'set',personaId:'sakura',botId:'other'}])assert.equal(botPersonaArgumentsSchema.safeParse(input).success,false,JSON.stringify(input));
  for(const input of [{action:'enable'},{action:'disable',name:'../skill'},{action:'list',name:'image-generation'},{action:'enable',name:'image-generation',path:'C:/private'}])assert.equal(botSkillsArgumentsSchema.safeParse(input).success,false,JSON.stringify(input));
  assert.deepEqual(botPersonaArgumentsSchema.parse({action:'set',personaId:'PersonaCase'}),{action:'set',personaId:'PersonaCase'});
});

test('chat automation tools create daily tasks, preserve proactive settings and keep jobs in their own channel',async t=>{
  const f=await fixture(t),binding=f.binding(),snapshot=f.snapshot();
  const schedule=defineBotScheduleTool((args,exec)=>f.management.schedule(binding,snapshot,args,exec.signal));
  const proactive=defineBotProactiveTool((args,exec)=>f.management.proactive(binding,snapshot,args,exec.signal));
  const exec={signal:signal()} as ToolRunContext;
  const created=JSON.parse(await schedule.execute({action:'create',prompt:'说晚安',dailyAt:'00:00',timezone:'Asia/Shanghai'},exec) as string);
  assert.ok(created.jobId);assert.ok(created.nextAt);assert.equal(created.dailyAt,'00:00');assert.equal(created.state,'active');
  const list=JSON.parse(await schedule.execute({action:'list'},exec) as string);assert.equal(list.jobs.length,1);assert.ok(list.now);assert.equal(list.jobs[0].jobId,created.jobId);
  await proactive.execute({action:'on'},exec);const settings=JSON.parse(await proactive.execute({action:'set',dailyLimit:2,quietFrom:'23:00'},exec) as string);
  assert.equal(settings.enabled,true);assert.equal(settings.dailyLimit,2);assert.ok(settings.nextAt);assert.equal(settings.scope,undefined);
  for(const input of [{action:'create',prompt:'oops',delayMs:1000,scope:owner},{action:'create',prompt:'oops',delayMs:1000,dailyAt:'00:00'},{action:'delete',jobId:created.jobId,senderId:'other'}])await assert.rejects(schedule.execute(input,exec));
  const other={...owner,channelId:'other',senderId:'other'};f.store.saveBot({...f.store.bot('bot'),trustedUsers:['owner','other']});
  assert.deepEqual((await f.management.schedule(f.binding(other),f.snapshot(other),{action:'list'},signal())).jobs,[]);
  await assert.rejects(f.management.schedule(f.binding(other),f.snapshot(other),{action:'delete',jobId:created.jobId},signal()),/SCHEDULE_NOT_FOUND/);
  await schedule.execute({action:'pause',jobId:created.jobId},exec);assert.equal(f.runtime.automation.listJobs()[0].enabled,false);
  await schedule.execute({action:'resume',jobId:created.jobId},exec);assert.equal(f.runtime.automation.listJobs()[0].enabled,true);
  await schedule.execute({action:'delete',jobId:created.jobId},exec);assert.equal(f.runtime.automation.listJobs().length,0);
});

test('automation tools reject groups, untrusted callers, revoked trust, stale sessions and cancelled turns',async t=>{
  const f=await fixture(t),binding=f.binding(),snapshot=f.snapshot();
  const calls=(b:SessionBinding,s:any,abort=signal())=>[()=>f.management.schedule(b,s,{action:'create',prompt:'hello',delayMs:1000},abort),()=>f.management.proactive(b,s,{action:'on'},abort)];
  for(const scope of [{...owner,kind:'group' as const},{...owner,senderId:'other',channelId:'other'}])for(const call of calls(f.binding(scope),f.snapshot(scope)))await assert.rejects(call(),/TRUSTED/);
  const cancelled=new AbortController();cancelled.abort();for(const call of calls(binding,snapshot,cancelled.signal))await assert.rejects(call());
  f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});for(const call of calls(binding,snapshot))await assert.rejects(call(),/TRUSTED/);
  f.store.saveBot({...f.store.bot('bot'),trustedUsers:['owner']});f.store.reset(owner);for(const call of calls(binding,snapshot))await assert.rejects(call(),/SESSION_CHANGED/);
  assert.equal(f.runtime.automation.listJobs().length,0);assert.equal(f.runtime.automation.listProactive().length,0);
});

test('tool facades expose only their typed arguments and await the supplied host-bound callbacks',async()=>{
  const calls:unknown[]=[];const callback=async(args:unknown,exec:ToolRunContext)=>{calls.push(args);assert.equal(exec.signal.aborted,false);return{status:'queued',actionId:'fixture'};};
  const session=defineBotSessionTool(callback),persona=defineBotPersonaTool(callback),skills=defineBotSkillsTool(callback);const exec={signal:signal()} as ToolRunContext;
  assert.equal(session.name,'bot_session');assert.deepEqual(Object.keys((session.parameters as any).properties).sort(),['action','page','sessionId']);
  assert.equal(persona.name,'bot_persona');assert.deepEqual(Object.keys((persona.parameters as any).properties).sort(),['action','personaId']);
  assert.equal(skills.name,'bot_skills');assert.deepEqual(Object.keys((skills.parameters as any).properties).sort(),['action','name']);
  assert.equal(session.isConcurrencySafe?.({action:'status'}),true);assert.equal(session.isConcurrencySafe?.({action:'new'}),false);assert.equal(persona.isConcurrencySafe?.({action:'set',personaId:'sakura'}),false);assert.equal(skills.isConcurrencySafe?.({action:'enable',name:'image-generation'}),false);
  for(const [tool,args] of [[session,{action:'new'}],[persona,{action:'set',personaId:'sakura'}],[skills,{action:'disable',name:'image-generation'}]] as const)assert.deepEqual(JSON.parse(await tool.execute(args,exec) as string),{status:'queued',actionId:'fixture'});
  assert.equal(calls.length,3);await assert.rejects(session.execute({action:'new',scope:owner},exec));assert.equal(calls.length,3);
});

test('ordinary and group callers can query only their own session metadata and enabled skills',async t=>{
  const f=await fixture(t);const scopes=[{...owner,senderId:'ordinary',channelId:'ordinary'},{...owner,kind:'group' as const,channelId:'group'}];
  const own=f.binding();
  for(const scope of scopes){
    const binding=f.binding(scope),snapshot=f.snapshot(scope);
    const status:any=await f.management.session(binding,snapshot,{action:'status'},signal());assert.equal(status.sessionId,binding.sessionId);assert.equal(status.persona.id,'sakura');assert.equal(status.state,'idle');
    const list:any=await f.management.session(binding,snapshot,{action:'list'},signal());assert.deepEqual(list.sessions.map((s:any)=>s.sessionId),[binding.sessionId]);assert.ok(!JSON.stringify(list).includes(own.sessionId));
    const help:any=await f.management.session(binding,snapshot,{action:'help'},signal());assert.ok(!help.text.includes('/persona'));assert.ok(!help.text.includes('/stats'));
    const skills:any=await f.management.skills(binding,snapshot,{action:'list'},signal());assert.ok(skills.skills.every((item:any)=>item.enabled));
    await assert.rejects(f.management.persona(binding,snapshot,{action:'list'},signal()),/TRUSTED/);
    await assert.rejects(f.management.skills(binding,snapshot,{action:'disable',name:'image-generation'},signal()),/TRUSTED/);
    await assert.rejects(f.management.session(binding,snapshot,{action:'resume',sessionId:own.sessionId},signal()),/不属于/);
    await f.management.session(binding,snapshot,{action:'new'},signal());assert.equal(f.queued.at(-1)!.binding.key,binding.key);
  }
});

test('trusted catalogs include disabled published skills and project only public metadata',async t=>{
  const f=await fixture(t);const before=f.store.config('sakura');const staged=f.features.skills.stageFiles(before,'weather-helper',[{path:'SKILL.md',content:'---\nname: weather-helper\ndescription: Weather helper\n---\nUse the helper.'}]);
  f.store.saveConfig({...staged,skills:['media-analysis']},before.revision);f.store.put('config','hidden',{...f.store.config('sakura'),id:'hidden',name:'Hidden',archived:true});
  const skills:any=await f.management.skills(f.binding(),f.snapshot(),{action:'list'},signal());assert.deepEqual(new Set(skills.skills.map((s:any)=>s.name)),new Set(['image-generation','media-analysis','voice-generation','weather-helper']));
  assert.equal(skills.skills.find((s:any)=>s.name==='weather-helper').enabled,false);assert.equal(skills.skills.find((s:any)=>s.name==='weather-helper').available,true);assert.equal(skills.skills.find((s:any)=>s.name==='image-generation').builtin,true);
  const persona:any=await f.management.persona(f.binding(),f.snapshot(),{action:'list'},signal());assert.ok(!persona.personas.some((p:any)=>p.id==='hidden'));assert.equal(persona.currentPersonaId,'sakura');
  for(const output of [skills,persona]){const text=JSON.stringify(output);assert.ok(!text.includes('resourceBase'));assert.ok(!text.includes('"path"'));assert.ok(!text.includes('personaPrompt'));assert.ok(!text.includes(f.store.home));}
  const ordinary={...owner,senderId:'ordinary',channelId:'ordinary'};const enabled:any=await f.management.skills(f.binding(ordinary),f.snapshot(ordinary),{action:'list'},signal());assert.deepEqual(enabled.skills.map((s:any)=>s.name),['media-analysis']);
});

test('mutations queue host-bound actions without changing the current session or shared persona',async t=>{
  const f=await fixture(t);const binding=f.binding(),snapshot=f.snapshot();const config=f.store.config('sakura');
  const operations=[()=>f.management.session(binding,snapshot,{action:'new'},signal()),()=>f.management.session(binding,snapshot,{action:'stop'},signal()),()=>f.management.session(binding,snapshot,{action:'compact'},signal()),()=>f.management.session(binding,snapshot,{action:'resume',sessionId:binding.sessionId},signal()),()=>f.management.persona(binding,snapshot,{action:'set',personaId:'default'},signal()),()=>f.management.skills(binding,snapshot,{action:'enable',name:'image-generation'},signal()),()=>f.management.skills(binding,snapshot,{action:'disable',name:'media-analysis'},signal())];
  for(const execute of operations)assert.equal((await execute() as any).status,'queued');
  assert.deepEqual(f.queued.map(item=>item.action),[{action:'new'},{action:'stop'},{action:'compact'},{action:'resume',sessionId:binding.sessionId},{action:'persona',personaId:'default'},{action:'skill',name:'image-generation',enabled:true},{action:'skill',name:'media-analysis',enabled:false}]);
  assert.equal(f.binding().sessionId,binding.sessionId);assert.deepEqual(f.store.config('sakura'),config);assert.deepEqual(snapshot.config,config);
  await assert.rejects(f.management.skills(binding,snapshot,{action:'enable',name:'never-published'},signal()),/SKILL_NOT_PUBLISHED/);assert.equal(f.queued.length,7);
});

test('revocation and newly granted trust deny privileged management while basic reads remain scoped',async t=>{
  const f=await fixture(t);const binding=f.binding(),old=f.snapshot();f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});
  await assert.rejects(f.management.persona(binding,old,{action:'set',personaId:'default'},signal()),/TRUSTED/);
  await assert.rejects(f.management.skills(binding,old,{action:'enable',name:'image-generation'},signal()),/TRUSTED/);
  await f.management.session(binding,old,{action:'status'},signal());
  const untrusted=f.snapshot();f.store.saveBot({...f.store.bot('bot'),trustedUsers:['owner']});
  await assert.rejects(f.management.persona(binding,untrusted,{action:'list'},signal()),/TRUSTED/);
  await assert.rejects(f.management.skills(binding,untrusted,{action:'disable',name:'image-generation'},signal()),/TRUSTED/);assert.equal(f.queued.length,0);
});

test('all management entries reject cancellation, changed generations, inactive sessions and forged bindings',async t=>{
  const f=await fixture(t);const binding=f.binding(),snapshot=f.snapshot();const stopped=new AbortController();stopped.abort();
  const calls=(candidate:SessionBinding,abort:AbortSignal)=>[()=>f.management.session(candidate,snapshot,{action:'status'},abort),()=>f.management.persona(candidate,snapshot,{action:'list'},abort),()=>f.management.skills(candidate,snapshot,{action:'list'},abort)];
  for(const call of calls(binding,stopped.signal))await assert.rejects(call());
  for(const call of calls({...binding,scope:{...binding.scope,senderId:'forged'}},signal()))await assert.rejects(call(),/SESSION_CHANGED/);
  f.store.updateSession({...binding,generation:binding.generation+1});for(const call of calls(binding,signal()))await assert.rejects(call(),/SESSION_CHANGED/);
  const current=f.binding();f.store.reset(owner);for(const call of calls(current,signal()))await assert.rejects(call(),/SESSION_CHANGED/);assert.equal(f.queued.length,0);
});

test('skill toggle rechecks its captured session, persona, revision, trust and caller authorization after validation',async t=>{
  for(const changed of ['session','persona','revision','trust','authorize'] as const){
    await t.test(changed,async t=>{
      const f=await fixture(t);const binding=f.binding();const original=f.store.config('sakura');let checks=0;
      f.harness.validateModel=async()=>{
        if(changed==='session')f.store.reset(owner);
        if(changed==='persona')f.store.updateSession({...binding,personaId:'default'});
        if(changed==='revision')f.store.saveConfig({...original,name:'newer'},original.revision);
        if(changed==='trust')f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});
      };
      await assert.rejects(f.runtime.commandServices.skills!.toggle(binding,'image-generation',false,()=>{checks++;if(changed==='authorize'&&checks===2)throw Error('CALLER_CANCELLED');}),/CHANGED|TRUSTED|CALLER_CANCELLED/);
      assert.ok(f.store.config('sakura').skills.includes('image-generation'));assert.equal(f.store.config('default').skills.includes('image-generation'),true);
    });
  }
});
