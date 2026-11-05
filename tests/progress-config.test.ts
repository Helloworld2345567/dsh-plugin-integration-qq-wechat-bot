import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configSchema} from '../src/core/types.js';
import {TaskProgress,type ProgressFacts} from '../src/core/progress.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('processing reply defaults preserve the existing heartbeat and validate the interval',()=>{
  const config=configSchema.parse({schemaVersion:4,id:'progress',name:'Progress',personaPrompt:'A'});
  assert.deepEqual(config.progressReply,{enabled:true,intervalSeconds:60});
  assert.equal(configSchema.parse({...config,progressReply:{enabled:false,intervalSeconds:10}}).progressReply.enabled,false);
  assert.throws(()=>configSchema.parse({...config,progressReply:{enabled:true,intervalSeconds:9}}));
  assert.throws(()=>configSchema.parse({...config,progressReply:{enabled:true,intervalSeconds:3601}}));
});

test('processing reply uses the configured interval and expiry window',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const sent:Array<{expiresAt:number}>=[];const progress=new TaskProgress({signal:new AbortController().signal,active:()=>true,intervalMs:10_000,format:async(_facts:ProgressFacts)=>'处理中',deliver:async(_text,_run, _sequence,expiresAt)=>{sent.push({expiresAt});},cancel:()=>{}});
  t.after(()=>progress.stop());t.mock.timers.tick(9_999);await settle();assert.equal(sent.length,0);t.mock.timers.tick(1);await settle();assert.deepEqual(sent,[{expiresAt:21_000}]);
});
