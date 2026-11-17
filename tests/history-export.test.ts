import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';
import {NativeHarness} from '../src/harness/bridge.js';

function fixture(readSession:(id:string)=>Promise<unknown>,write?:(scope:string,id:string,events:unknown)=>Promise<void>){
  const records=[{id:'first',scopeKey:'one',persisted:true},{id:'last',scopeKey:'two',persisted:true}];
  const writes:Array<{scope:string;id:string;events:unknown}>=[],locations=new Map<string,{file:string}>(),flushed:unknown[]=[];
  const ctx:any={on:()=>{},effect:()=>{},tools:{guard:()=>{}},sessionQuery:{readSession},sessions:{flush:async(session:unknown)=>{flushed.push(session);}}};
  const repos:any={sessions:{findSession:(id:string)=>records.find(record=>record.id===id)},historyLocations:{find:(id:string)=>locations.get(id)},chatHistory:{write:async(scope:string,id:string,events:unknown)=>{if(write)await write(scope,id,events);writes.push({scope,id,events});locations.set(id,{file:`${scope}/history/${id}.jsonl`});}}};
  return{bridge:new NativeHarness(ctx,repos,{} as any,{} as any,{skills:{} as any}),records,writes,flushed};
}

test('history export reads and writes only the explicitly selected owned session',async()=>{
  const reads:string[]=[];const f=fixture(async id=>{reads.push(id);return{events:[id]};});
  assert.deepEqual(f.writes,[]);
  assert.equal(await f.bridge.exportSessionHistory('last'),'two/history/last.jsonl');
  assert.deepEqual(reads,['last']);assert.deepEqual(f.writes,[{scope:'two',id:'last',events:['last']}]);
  await assert.rejects(f.bridge.exportSessionHistory('unowned'),/SESSION_NOT_FOUND/);assert.deepEqual(reads,['last']);
});

test('history export flushes an active session before reading its native log',async()=>{
  const f=fixture(async()=>{assert.equal(f.flushed.length,1);return{events:[]};}),session={id:'first'};
  f.bridge.live.set('first',{agent:{session}} as any);
  await f.bridge.exportSessionHistory('first');assert.deepEqual(f.flushed,[session]);
});

test('explicit history export reports missing, corrupt and failed native logs without a partial export',async()=>{
  for(const failure of [new SessionQueryError('missing','SESSION_QUERY_SESSION_NOT_FOUND'),new SessionQueryError('corrupt','SESSION_QUERY_CORRUPT_SESSION'),new SessionQueryError('failed','SESSION_QUERY_PERSISTENCE_FAILED')]){
    const f=fixture(async()=>{throw failure;});
    await assert.rejects(f.bridge.exportSessionHistory('first'),error=>error===failure);assert.deepEqual(f.writes,[]);
  }
});

test('history export reports writer failure',async()=>{
  const failure=new Error('export write failed'),f=fixture(async()=>({events:[]}),async()=>{throw failure;});
  await assert.rejects(f.bridge.exportSessionHistory('first'),error=>error===failure);
});
