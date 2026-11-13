import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerMode} from '../src/mode.js';

test('bot chat mode does not duplicate the base image offload projection',async()=>{
  let registered:any;
  const ctx:any={agentPresets:{register:async(value:any)=>{registered=value;return()=>{};},resolve:async()=>({broken:undefined})}};
  await registerMode(ctx);
  const compaction=registered.plugins.find((plugin:any)=>plugin.id==='compaction');
  assert.ok(compaction);
  assert.equal(compaction.config.some((plugin:any)=>plugin.id==='image-offload'),false);
});
