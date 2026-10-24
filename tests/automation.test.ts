import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {AutomationScheduler,chunkText} from '../src/core/automation.js';
import {Store,scopeKey} from '../src/core/store.js';
import {botSchema} from '../src/core/types.js';

async function fixture(){const home=await mkdtemp(path.resolve('.codex/automation-'));const store=new Store(home);const scope={botId:'bot',platform:'qq',accountId:'account',kind:'private' as const,channelId:'user',senderId:'trusted'};store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['trusted']}));store.accept({id:'source',scope,text:'上次我们聊了旅行。',attachments:[],reply:{target:'user',kind:'private',msgId:'source'},timestamp:Date.now()-3600000});const calls:{prompt:string}[]=[];const scheduler=new AutomationScheduler(store,{runPrompt:async(_binding,prompt)=>{calls.push({prompt});return{turnId:'turn',outputs:[{type:'text',text:'这是一段主动消息。'}]};},flush:async()=>{}});return{home,store,scope,scheduler,calls};}

test('chunkText prefers boundaries and preserves all text',()=>{const input='第一段。\n\n第二段内容。';assert.deepEqual(chunkText(input,8),['第一段。','第二段内容。']);});
test('proactive run uses an isolated run and enqueues ordered output',async t=>{const f=await fixture();t.after(async()=>{f.store.close();await rm(f.home,{recursive:true,force:true});});f.scheduler.configureProactive(f.scope,{enabled:false,cooldownMinutes:0});const run=await f.scheduler.runProactive(f.scope,true);assert.equal(run.state,'succeeded');assert.equal(f.calls.length,1);assert.equal(f.store.deliveries()[0].output.text,'这是一段主动消息。');assert.equal(f.store.list('job-run').length,0);});
test('proactive daily limit blocks after successful run',async t=>{const f=await fixture();t.after(async()=>{f.store.close();await rm(f.home,{recursive:true,force:true});});f.scheduler.configureProactive(f.scope,{enabled:false,cooldownMinutes:0,dailyLimit:1});assert.equal((await f.scheduler.runProactive(f.scope,true)).state,'succeeded');assert.equal((await f.scheduler.runProactive(f.scope,true)).error,'PROACTIVE_DAILY_LIMIT');});
