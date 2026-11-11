import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {scopeKey} from '../src/core/identity.js';
import {Assets} from '../src/core/media.js';
import {seedLegacyAssetMetadata} from './sqlite-fixtures.js';
import {botSchema,type CallerScope} from '../src/core/types.js';

const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
async function fixture(t:any){const directory=await mkdtemp(path.resolve('.codex/asset-session-'));const store=new SqlitePersistence(directory);store.bots.saveBot(botSchema.parse({id:scope.botId,name:scope.botId,channel:scope.platform}));t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});return{store,assets:new Assets(store.repositories())};}
const media={kind:'image' as const,name:'reference.png',mime:'image/png'};

test('new and resumed sessions select only their own recent assets while explicit same-channel references remain readable',async t=>{
  const {store,assets}=await fixture(t);const first=store.sessions.binding(scope);const original=await assets.save(first.key,media,Buffer.from('first'));
  const second=store.sessions.reset(scope);assert.deepEqual(assets.recent(first.key),[]);const later=await assets.save(first.key,media,Buffer.from('second'));assert.deepEqual(assets.recent(first.key).map(a=>a.id),[later.id]);
  store.sessions.activateSession(scope,first.sessionId);assert.deepEqual(assets.recent(first.key).map(a=>a.id),[original.id]);assert.equal((await assets.read(first.key,later.id)).toString(),'second','an explicitly quoted attachment keeps channel ownership');
  store.sessions.activateSession(scope,second.sessionId);assert.deepEqual(assets.recent(first.key).map(a=>a.id),[later.id]);assert.equal((await assets.read(first.key,original.id)).toString(),'first');
  await assert.rejects(assets.read(scopeKey({...scope,senderId:'bob',channelId:'bob'}),original.id),/不属于/);
});

test('same-channel media history above 512 MiB across sessions still allows received and generated attachments',async t=>{
  const {store,assets}=await fixture(t),first=store.sessions.binding(scope);
  const audio={kind:'audio' as const,name:'song.mp3',mime:'audio/mpeg'};
  // Logical byte lengths exercise persistence totals without allocating large files.
  const historical=()=>Object.defineProperty(Buffer.from('historical audio'),'length',{value:200*1024*1024});
  const original=await assets.save(first.key,audio,historical(),'old-song');
  const current=store.sessions.reset(scope);
  await assets.save(current.key,audio,historical(),'second-song');
  await assets.save(current.key,audio,historical(),'third-song');
  assert.ok(store.assets.allAssets().filter(asset=>asset.scopeKey===current.key).reduce((total,asset)=>total+asset.size,0)>512*1024*1024);

  const received=await assets.save(current.key,media,Buffer.from('new upload'));
  const generated=await assets.save(current.key,audio,Buffer.from('new voice'),'new-voice');
  assert.equal(received.origin,'received');assert.equal(generated.origin,'generated');
  assert.equal(received.sessionId,current.sessionId);assert.equal(generated.sessionId,current.sessionId);
  assert.equal((await assets.read(current.key,received.id)).toString(),'new upload');
  assert.equal((await assets.read(current.key,generated.id)).toString(),'new voice');
  assert.equal((await assets.read(current.key,original.id)).toString(),'historical audio');
  assert.equal(store.assets.asset(current.key,original.id).sessionId,first.sessionId);
});

test('other-channel media history above 2 GiB does not block new attachments or remove historical files',async t=>{
  const {store,assets}=await fixture(t),historical=[];
  for(let index=0;index<5;index++){
    const binding=store.sessions.binding({...scope,channelId:`history-${index}`,senderId:`history-${index}`});
    const bytes=Object.defineProperty(Buffer.from(`historical video ${index}`),'length',{value:500*1024*1024});
    historical.push(await assets.save(binding.key,{kind:'video',name:'clip.mp4',mime:'video/mp4'},bytes));
  }
  assert.ok(store.assets.allAssets().reduce((total,asset)=>total+asset.size,0)>2*1024*1024*1024);

  const current=store.sessions.binding(scope);
  const received=await assets.save(current.key,media,Buffer.from('new upload'));
  const generated=await assets.save(current.key,media,Buffer.from('new image'),'new-image');
  assert.equal(received.origin,'received');assert.equal(generated.origin,'generated');
  assert.equal((await assets.read(current.key,received.id)).toString(),'new upload');
  assert.equal((await assets.read(current.key,generated.id)).toString(),'new image');
  for(const [index,asset] of historical.entries())assert.equal((await assets.read(asset.scopeKey,asset.id)).toString(),`historical video ${index}`);
  await assert.rejects(assets.read(current.key,historical[0].id),/不属于/);
});

test('asset persistence captures session ownership before asynchronous file writes',async t=>{
  const {store,assets}=await fixture(t);const old=store.sessions.binding(scope);const saving=assets.save(old.key,media,Buffer.from('old upload'));
  const next=store.sessions.reset(scope);const asset=await saving;assert.equal(asset.sessionId,old.sessionId);assert.notEqual(asset.sessionId,next.sessionId);assert.deepEqual(assets.recent(old.key),[]);
  store.sessions.activateSession(scope,old.sessionId);assert.deepEqual(assets.recent(old.key).map(a=>a.id),[asset.id]);
});
test('unclaimed cleanup resolves the canonical asset and never removes a registered delivery',async t=>{
  const {store,assets}=await fixture(t),binding=store.sessions.binding(scope),asset=await assets.save(binding.key,media,Buffer.from('claimed'),'derived','generated',binding.sessionId,binding.generation);
  store.deliveries.enqueue(binding,'source','turn',[{type:'asset',assetId:asset.id}],{});assert.equal(await assets.removeUnclaimed(binding.key,asset.id),false);assert.equal((await assets.read(binding.key,asset.id)).toString(),'claimed');
});

test('legacy and unassociated assets are excluded from automatic selection without removing explicit access',async t=>{
  const {store,assets}=await fixture(t);const key=scopeKey(scope);store.sessions.binding(scope);const uploaded=await assets.save(key,media,Buffer.from('before binding'));const unassociated={...uploaded,sessionId:undefined};seedLegacyAssetMetadata(store,unassociated);
  const associated=await assets.save(key,media,Buffer.from('legacy'));const {sessionId,...legacy}=associated;seedLegacyAssetMetadata(store,legacy);
  assert.deepEqual(assets.recent(key),[]);assert.equal((await assets.read(key,legacy.id)).toString(),'legacy');assert.equal((await assets.read(key,unassociated.id)).toString(),'before binding');
});
