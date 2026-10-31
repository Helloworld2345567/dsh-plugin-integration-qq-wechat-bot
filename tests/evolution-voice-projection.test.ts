import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeHarness,projectEvolutionToolResult} from '../src/harness/bridge.js';
import {configSchema,botSchema,type CallerScope} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';

function config(){return configSchema.parse({id:'voice',name:'Voice',personaPrompt:'Persona',allowHostTools:true,media:{voice:{enabled:true,protocol:'gpt_sovits',replyMode:'auto',voice:'speaker',gptSovits:{baseUrl:'http://127.0.0.1:9880',modelVersion:'v4',gptWeightsPath:'private/gpt.ckpt',sovitsWeightsPath:'private/sovits.pth',refAudioPath:'private/reference.wav',promptText:'PRIVATE_REFERENCE_TEXT',promptLang:'all_zh',textLang:'all_zh'}}}});}
function change(){const before=config();return{id:'change',kind:'persona',scopeKey:'scope',configId:before.id,goal:'Change persona',before,after:{...before,revision:2,personaPrompt:'Updated'},phase:'succeeded',createdAt:1,updatedAt:2};}

test('evolution content changes hide only the trusted GPT-SoVITS connection while retaining the persona summary',()=>{
  const stored=change(),original=structuredClone(stored);
  const projected:any=projectEvolutionToolResult(stored);
  for(const key of ['before','after']){
    assert.equal(projected[key].media.voice.gptSovits,undefined);
    assert.equal(projected[key].media.voice.protocol,'gpt_sovits');assert.equal(projected[key].media.voice.replyMode,'auto');assert.equal(projected[key].media.voice.voice,'speaker');assert.equal(projected[key].media.voice.format,'wav');
    assert.equal(projected[key].id,'voice');assert.equal(projected[key].revision,key==='before'?1:2);
  }
  assert.deepEqual(stored,original);assert.equal(stored.before.media.voice!.gptSovits!.promptText,'PRIVATE_REFERENCE_TEXT');
  assert.doesNotMatch(JSON.stringify(projected),/127\.0\.0\.1|gpt\.ckpt|sovits\.pth|reference\.wav|PRIVATE_REFERENCE_TEXT/);
});

test('history projection handles content entries without recursively rewriting unrelated task data',()=>{
  const upgrade={id:'upgrade',kind:'upgrade',phase:'draft',candidateRoot:'candidate/path',changes:[{file:'readme.md',change:'modified'}]};
  const unrelated={before:{media:{voice:{gptSovits:{text:'ordinary data'}}}},details:{config:config()}};
  const result:any=projectEvolutionToolResult([change(),upgrade,unrelated]);
  assert.equal(result[0].before.media.voice.gptSovits,undefined);assert.equal(result[1],upgrade);assert.equal(result[2],unrelated);
  assert.equal((projectEvolutionToolResult(config()) as any).media.voice.gptSovits,undefined);
  const speech=configSchema.parse({id:'plain',name:'Plain',personaPrompt:'Text',media:{voice:{enabled:true,protocol:'speech',voice:'alloy'}}});
  assert.equal(projectEvolutionToolResult(speech),speech);
});

test('registered bot_evolve serializes the projection rather than mutating its service result',async()=>{
  const persona=config(),stored=change(),agent={id:'agent'},tools=new Map<string,any>();
  const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
  const bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['owner']});
  const binding={key:'scope',scope,sessionId:'agent',generation:0,persisted:true};
  const ctx:any={on:()=>{},agents:{list:()=>[agent]},tools:{guard:()=>{},register:(tool:any)=>{tools.set(tool.name,tool);return()=>tools.delete(tool.name);}}};
  const store:any={statsSessionExists:()=>false,findBinding:()=>binding,effectiveConfig:()=>persona,bot:()=>bot};
  const bridge=new NativeHarness(ctx,store,{} as any,{} as any,{skills:{} as any,evolve:async()=>[stored]});
  const live:any={binding,snapshot:freezeTurn(persona,bot,scope,[]),voice:{attempted:false},skills:{}};
  (bridge as any).scoped.set(agent,live);(bridge as any).tools(ctx,live);
  const result=await tools.get('bot_evolve').execute({action:'history'},{agent,signal:new AbortController().signal});
  assert.equal(JSON.parse(result)[0].before.media.voice.gptSovits,undefined);assert.doesNotMatch(result,/PRIVATE_REFERENCE_TEXT|private\/|127\.0\.0\.1/);
  assert.equal(stored.before.media.voice!.gptSovits!.gptWeightsPath,'private/gpt.ckpt');
});
