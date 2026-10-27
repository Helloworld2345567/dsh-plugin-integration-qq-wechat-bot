import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,type ChannelAdapter,type InboundMessage} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {StatsService} from '../src/core/stats.js';
import {SqliteStatsData} from '../src/core/sqlite-stats-data.js';

test('fixture channel registers without Runtime or Stats channel branches',async t=>{
  const home=await mkdtemp(path.resolve('.codex/fixture-channel-'));const store=new Store(home);const sent:string[]=[];
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from('fixture'),send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text??'');return'fixture-receipt';}};
  const channels=createChannelRegistry([{id:'fixture',displayName:'Fixture',adapter,capabilities:{conversations:['private'],login:['credentials'],groupSupport:'unsupported'}}]);
  store.saveBot(botSchema.parse({id:'fixture-bot',name:'Fixture',channel:'fixture',accountId:'account',enabled:true}));const assets=new Assets(store);
  let runtime!:BotRuntime;const harness:HarnessPort={run:async(binding,messages)=>({turnId:'fixture-turn',outputs:[{type:'text',text:'fixture-output'}],snapshot:freezeTurn(runtime.effectiveConfig(binding),store.bot('fixture-bot'),binding.scope,messages.map(message=>message.id))}),cancel:()=>{},dispose:async()=>{},validateModel:async()=>{}};
  runtime=new BotRuntime(store,assets,new MediaService(store,assets),harness,channels,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000,180000);t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  const message:InboundMessage={id:'message',scope:{botId:'fixture-bot',platform:'fixture',accountId:'account',kind:'private',channelId:'user',senderId:'user'},text:'hello',attachments:[],reply:{target:'user'},timestamp:Date.now()};await runtime.receive(message);await runtime.process(scopeKey(message.scope));assert.deepEqual(sent,['fixture-output']);
  const stats=new StatsService(new SqliteStatsData(store),()=>runtime.states,()=>store.bots(),Date.now,channels);assert.equal(stats.query({range:'all'}).bots[0].groupSupport,'unsupported');await assert.rejects(runtime.receive({...message,id:'unknown',scope:{...message.scope,platform:'missing'}}),/CHANNEL_NOT_REGISTERED/);
});
