import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeHarness} from '../src/harness/bridge.js';

function fixture(){
  const handlers=new Map<string,Function>();
  const parent={id:'parent'},child={id:'child'};
  const ctx:any={on:(event:string,handler:Function)=>handlers.set(event,handler),agents:{list:()=>[parent,child]},tools:{guard:()=>{}}};
  const store:any={statsSessionExists:()=>false,findBinding:()=>undefined,effectiveConfig:()=>{throw Error('CONFIG_UNAVAILABLE');},bot:()=>({})};
  const bridge=new NativeHarness(ctx,store,{} as any,{} as any,{skills:{} as any});
  const root:any={binding:{key:'scope',sessionId:'parent',scope:{botId:'bot'}},voice:{attempted:false}};
  const descendant={...root};
  (bridge as any).scoped.set(parent,root);(bridge as any).scoped.set(child,descendant);
  const call=(sessionId:string,name:string,args:string)=>handlers.get('session/event')!({id:sessionId},{type:'tool/call',data:{name,arguments:args}});
  return{bridge,root,descendant,parent,child,call};
}

test('owned child voice attempts are recorded before argument validation and shared with the parent turn',()=>{
  const f=fixture();f.call('child','bot_voice','{malformed');assert.equal(f.root.voice.attempted,true);
  // Older children retain their frozen turn and cannot suppress the next reply.
  f.root.voice={attempted:false};f.call('child','bot_voice','{}');assert.equal(f.root.voice.attempted,false);assert.equal(f.descendant.voice.attempted,true);
  f.call('parent','bot_voice','{}');assert.equal(f.root.voice.attempted,true);
});

test('compatibility voice calls count as attempts while unrelated calls do not',()=>{
  const f=fixture();f.call('parent','bot_media','{"operation":"transcribe"}');assert.equal(f.root.voice.attempted,false);
  f.call('parent','bot_media','{"operation":"voice_chant"}');assert.equal(f.root.voice.attempted,true);
  f.root.voice.attempted=false;f.call('unowned','bot_voice','{}');assert.equal(f.root.voice.attempted,false);
});

test('direct voice dispatch records its attempt even when configuration lookup fails',async()=>{
  const f=fixture();
  await assert.rejects((f.bridge as any).mediaTool(f.root,f.child,'voice_speak',[],{text:'hello'},new AbortController().signal),/CONFIG_UNAVAILABLE/);
  assert.equal(f.root.voice.attempted,true);
});
