import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeLifecycleFacade} from '../src/core/runtime-lifecycle.js';

test('runtime lifecycle facade coalesces states and close is idempotent',async()=>{const calls:string[]=[];const runtime={initialize:async()=>{calls.push('initialize')},pauseProcessing:()=>calls.push('pause'),quiesce:async()=>{calls.push('quiesce')},resumeProcessing:()=>calls.push('resume'),close:async()=>{calls.push('close')}};const lifecycle=new RuntimeLifecycleFacade(runtime);await lifecycle.initialize();await lifecycle.initialize();assert.equal(lifecycle.state(),'running');lifecycle.pause('upgrade');await lifecycle.quiesce('operation');lifecycle.resume('operation');await lifecycle.close();await lifecycle.close();assert.deepEqual(calls,['initialize','pause','quiesce','resume','close']);});
