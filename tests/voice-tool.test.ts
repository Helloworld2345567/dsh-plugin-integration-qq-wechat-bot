import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSchema,configSchema} from '../src/core/types.js';
import {BUSINESS_TOOLS,permitted} from '../src/core/policy.js';
import {botVoiceArgumentsSchema} from '../src/core/features.js';
import {defineBotVoiceControlTool} from '../src/harness/management-tools.js';

const scope={botId:'bot',platform:'qq',accountId:'account',kind:'private' as const,channelId:'owner',senderId:'owner'};
const bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['owner']});
const config=configSchema.parse({id:'default',name:'Default',personaPrompt:'P'});

test('voice control schema and permission are restricted to trusted private users',()=>{
  assert.deepEqual(botVoiceArgumentsSchema.parse({role:'tts',action:'list'}),{role:'tts',action:'list'});
  assert.deepEqual(botVoiceArgumentsSchema.parse({role:'sts',action:'set',id:'rvc/voice'}),{role:'sts',action:'set',id:'rvc/voice'});
  for(const value of [{role:'tts',action:'set'},{role:'sts',action:'reset',id:'rvc/voice'},{role:'other',action:'list'}])assert.equal(botVoiceArgumentsSchema.safeParse(value).success,false);
  assert.equal(BUSINESS_TOOLS.has('bot_voice_control'),true);
  assert.equal(permitted('bot_voice_control',config,bot,scope),true);
  assert.equal(permitted('bot_voice_control',config,bot,{...scope,kind:'group',channelId:'room'}),false);
  assert.equal(permitted('bot_voice_control',config,bot,{...scope,senderId:'other',channelId:'other'}),false);
});

test('voice control tool exposes only typed role/action/id and forwards validated arguments',async()=>{
  const calls:unknown[]=[];const tool=defineBotVoiceControlTool(async(args)=>{calls.push(args);return{role:args.role,action:args.action,override:false,effective:'current'};});
  assert.equal(tool.name,'bot_voice_control');
  assert.deepEqual(Object.keys((tool.parameters as any).properties).sort(),['action','id','role']);
  assert.equal(tool.isConcurrencySafe?.({role:'tts',action:'list'}),true);
  assert.equal(tool.isConcurrencySafe?.({role:'tts',action:'set',id:'edge/voice'}),false);
  const exec={signal:new AbortController().signal} as ToolRunContext;
  assert.deepEqual(JSON.parse(await tool.execute({role:'tts',action:'list'},exec) as string),{role:'tts',action:'list',override:false,effective:'current'});
  assert.deepEqual(JSON.parse(await tool.execute({role:'sts',action:'set',id:'rvc/voice'},exec) as string),{role:'sts',action:'set',override:false,effective:'current'});
  assert.deepEqual(calls,[{role:'tts',action:'list'},{role:'sts',action:'set',id:'rvc/voice'}]);
  await assert.rejects(tool.execute({role:'tts',action:'set'},exec));
});
