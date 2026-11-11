import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';
import {NativeHarness} from '../src/harness/bridge.js';

function fixture(readSession:(id:string)=>Promise<unknown>,write?:(scope:string,id:string,events:unknown)=>Promise<void>){
  const records=[{id:'first',scopeKey:'one',persisted:true},{id:'missing',scopeKey:'one',persisted:true},{id:'blank',scopeKey:'two',persisted:false},{id:'last',scopeKey:'two',persisted:true}];
  const writes:Array<{scope:string;id:string;events:unknown}>=[];
  const ctx:any={on:()=>{},effect:()=>{},tools:{guard:()=>{}},sessionQuery:{readSession}};
  const repos:any={sessions:{sessionsAll:()=>records},chatHistory:{write:write??(async(scope:string,id:string,events:unknown)=>{writes.push({scope,id,events});})}};
  return{bridge:new NativeHarness(ctx,repos,{} as any,{} as any,{skills:{} as any}),records,writes};
}

test('history export skips missing native logs across module instances and exports the remaining persisted sessions',async()=>{
  const {SessionQueryError:HostSessionQueryError}=await import(`${import.meta.resolve('@deepseek-ai/dsh-session-query')}?history-export`);
  const missing=new HostSessionQueryError('session not found','SESSION_QUERY_SESSION_NOT_FOUND');
  assert.equal(missing instanceof SessionQueryError,false);
  const reads:string[]=[];
  const f=fixture(async id=>{reads.push(id);if(id==='missing')throw missing;return{events:[id]};});
  const before=structuredClone(f.records);
  await f.bridge.exportHistory();
  assert.deepEqual(reads,['first','missing','last']);
  assert.deepEqual(f.writes,[{scope:'one',id:'first',events:['first']},{scope:'two',id:'last',events:['last']}]);
  assert.deepEqual(f.records,before);
});

test('history export propagates corrupt or failed reads and does not classify message text as missing',async()=>{
  for(const failure of [new SessionQueryError('corrupt','SESSION_QUERY_CORRUPT_SESSION'),new SessionQueryError('failed','SESSION_QUERY_PERSISTENCE_FAILED'),new Error('session not found')]){
    const f=fixture(async()=>{throw failure;});
    await assert.rejects(f.bridge.exportHistory(),error=>error===failure);
    assert.deepEqual(f.writes,[]);
  }
});

test('history export does not suppress a writer failure even if it has the missing-session code',async()=>{
  const failure=new SessionQueryError('export failed','SESSION_QUERY_SESSION_NOT_FOUND');
  const f=fixture(async()=>({events:[]}),async()=>{throw failure;});
  await assert.rejects(f.bridge.exportHistory(),error=>error===failure);
});
