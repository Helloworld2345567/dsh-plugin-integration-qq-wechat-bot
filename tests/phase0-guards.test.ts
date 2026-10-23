import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {assertRemoteUrl} from '../src/core/network.js';
import {INPUT_LIMITS,validateBatch,validateInboundMessage,validateMediaParameters} from '../src/core/limits.js';
import type {CallerScope,InboundMessage} from '../src/core/types.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'channel',senderId:'sender'};
const message=(overrides:Partial<InboundMessage>={}):InboundMessage=>({id:'message',scope,text:'hello',attachments:[],reply:{target:'sender'},timestamp:Date.now(),...overrides});

async function storeFixture(t: any,secureDefaults=false){
  const home=await mkdtemp(path.resolve('.codex/phase0-guards-'));
  const store=new Store(home,undefined,{secureDefaults});
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  return store;
}

test('production Store defaults disable host tools while legacy parsing remains compatible',async t=>{
  const secure=await storeFixture(t,true);assert.equal(secure.config('default').allowHostTools,false);
  const legacy=await storeFixture(t,false);assert.equal(legacy.config('default').allowHostTools,true);
});

test('inbound hard caps reject oversized text, attachments and untrusted identities',()=>{
  assert.equal(validateInboundMessage(message()),undefined);
  assert.equal(validateInboundMessage(message({text:'x'.repeat(32*1024+1)})),'MESSAGE_TOO_LARGE');
  assert.equal(validateInboundMessage(message({scope:{...scope,platform:'invalid platform' as any}})),'INVALID_CHANNEL_IDENTITY');
  assert.equal(validateInboundMessage(message({scope:{...scope,platform:'fixture'}})),undefined,'well-formed registration is checked by Runtime, not structural validation');
  assert.equal(validateInboundMessage(message({attachments:Array.from({length:INPUT_LIMITS.attachmentCount+1},(_,i)=>({kind:'file',name:`${i}`,mime:'text/plain'} as any))})),'ATTACHMENT_COUNT_LIMIT');
  assert.equal(validateInboundMessage(message({attachments:[{kind:'file',name:'payload',mime:'application/octet-stream',bytes:Buffer.alloc(2).toString('base64')}]})),undefined);
});

test('media parameter policy rejects remote video URLs, nonstandard ports and oversized prompts',()=>{
  assert.throws(()=>validateMediaParameters('video_analyze',[],{url:'https://video.example/clip'}),/REMOTE_VIDEO_URL_NOT_ALLOWED/);
  assert.throws(()=>validateMediaParameters('social_read',[],{url:'https://example.com:444/post'}),/UNSAFE_MEDIA_URL/);
  assert.throws(()=>validateMediaParameters('image_generate',[],{prompt:'x'.repeat(8*1024+1)}),/MEDIA_PROMPT_TOO_LARGE/);
  assert.doesNotThrow(()=>validateMediaParameters('social_read',[],{url:'https://example.com/post'}));
});

test('URL policy requires HTTPS, allowed ports and exact host or suffix matches',()=>{
  assert.equal(assertRemoteUrl('https://example.com/path').hostname,'example.com');
  assert.throws(()=>assertRemoteUrl('http://example.com/path'),/UNSAFE_MEDIA_URL/);
  assert.throws(()=>assertRemoteUrl('https://example.com:444/path'),/UNSAFE_MEDIA_URL/);
  assert.equal(assertRemoteUrl('https://cdn.example.com/path',{hostSuffixes:new Set(['example.com']),allowPorts:new Set([''])}).hostname,'cdn.example.com');
  assert.throws(()=>assertRemoteUrl('https://badexample.com/path',{hostSuffixes:new Set(['example.com']),allowPorts:new Set([''])}),/UNSAFE_MEDIA_HOST/);
});

test('batch limits include already materialized asset sizes and metrics expose percentiles',async t=>{
  const store=await storeFixture(t);const key=scopeKey(scope);store.accept(message());const id=`inbox:${key}:message`;
  store.updateTurnMetric(id,{modelStartedAt:Date.now()});
  assert.equal(store.metricPercentiles('modelStartedAt').count,1);
  assert.throws(()=>validateBatch([message({attachments:[{kind:'file',name:'old',mime:'application/octet-stream',handle:'asset'}]})],()=>INPUT_LIMITS.batchAttachmentBytes+1),/BATCH_ATTACHMENT_BYTES_LIMIT/);
  store.mark(key,['message'],'complete');const result=store.retain(Date.now(),{inbox:0,delivery:0,metric:0,failure:0});assert.equal(result.inbox,1);assert.equal(store.get('turn-metric',id),undefined);
});
