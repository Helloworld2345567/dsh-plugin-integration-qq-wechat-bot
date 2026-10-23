import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChannelRegistry,legacyChannelAdapters} from '../src/core/channel-registry.js';
import type {ChannelAdapter} from '../src/core/types.js';

const adapter=():ChannelAdapter=>({beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'});

test('channel registry validates unique IDs and returns immutable ordered definitions',()=>{
  const first=adapter(),second=adapter();const registry=createChannelRegistry([{id:'fixture-a',displayName:'Fixture A',adapter:first,capabilities:{conversations:['private'],login:['qr'],groupSupport:'unsupported'}},{id:'fixture-b',displayName:'Fixture B',adapter:second,capabilities:{conversations:['private','group'],login:['credentials'],groupSupport:'observed_only'}}]);
  assert.deepEqual(registry.list().map(row=>row.id),['fixture-a','fixture-b']);assert.equal(registry.require('fixture-a').adapter,first);assert.ok(Object.isFrozen(registry.list()));assert.ok(Object.isFrozen(registry.require('fixture-a').capabilities.conversations));assert.throws(()=>registry.require('missing'),/CHANNEL_NOT_REGISTERED/);assert.throws(()=>createChannelRegistry([{...registry.require('fixture-a')},{...registry.require('fixture-a')}]),/CHANNEL_ALREADY_REGISTERED/);
});
test('legacy adapter facade is null-prototype, stable and preserves adapter identity',()=>{
  const one=adapter();const registry=createChannelRegistry([{id:'fixture',displayName:'Fixture',adapter:one,capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'}}]);const facade=legacyChannelAdapters(registry);assert.equal(Object.getPrototypeOf(facade),null);assert.equal(facade.fixture,one);assert.ok(Object.isFrozen(facade));assert.doesNotMatch(JSON.stringify(registry.list().map(({adapter,...definition})=>definition)),/token|secret/i);
});
