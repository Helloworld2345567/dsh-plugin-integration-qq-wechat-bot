import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets} from '../src/core/media.js';
import {botSchema,type CallerScope} from '../src/core/types.js';

const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
async function fixture(t:any){const directory=await mkdtemp(path.resolve('.codex/asset-session-'));const store=new Store(directory);store.saveBot(botSchema.parse({id:scope.botId,name:scope.botId,channel:scope.platform}));t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});return{store,assets:new Assets(store)};}
const media={kind:'image' as const,name:'reference.png',mime:'image/png'};

test('new and resumed sessions select only their own recent assets while explicit same-channel references remain readable',async t=>{
  const {store,assets}=await fixture(t);const first=store.binding(scope);const original=await assets.save(first.key,media,Buffer.from('first'));
  const second=store.reset(scope);assert.deepEqual(assets.recent(first.key),[]);const later=await assets.save(first.key,media,Buffer.from('second'));assert.deepEqual(assets.recent(first.key).map(a=>a.id),[later.id]);
  store.activateSession(scope,first.sessionId);assert.deepEqual(assets.recent(first.key).map(a=>a.id),[original.id]);assert.equal((await assets.read(first.key,later.id)).toString(),'second','an explicitly quoted attachment keeps channel ownership');
  store.activateSession(scope,second.sessionId);assert.deepEqual(assets.recent(first.key).map(a=>a.id),[later.id]);assert.equal((await assets.read(first.key,original.id)).toString(),'first');
  await assert.rejects(assets.read(scopeKey({...scope,senderId:'bob',channelId:'bob'}),original.id),/不属于/);
});
test('asset persistence captures session ownership before asynchronous file writes',async t=>{
  const {store,assets}=await fixture(t);const old=store.binding(scope);const saving=assets.save(old.key,media,Buffer.from('old upload'));
  const next=store.reset(scope);const asset=await saving;assert.equal(asset.sessionId,old.sessionId);assert.notEqual(asset.sessionId,next.sessionId);assert.deepEqual(assets.recent(old.key),[]);
  store.activateSession(scope,old.sessionId);assert.deepEqual(assets.recent(old.key).map(a=>a.id),[asset.id]);
});
test('legacy and unassociated assets are excluded from automatic selection without removing explicit access',async t=>{
  const {store,assets}=await fixture(t);const key=scopeKey(scope);store.binding(scope);const uploaded=await assets.save(key,media,Buffer.from('before binding'));const unassociated={...uploaded,sessionId:undefined};store.put('asset',uploaded.id,unassociated);
  const associated=await assets.save(key,media,Buffer.from('legacy'));const {sessionId,...legacy}=associated;store.put('asset',legacy.id,legacy);
  assert.deepEqual(assets.recent(key),[]);assert.equal((await assets.read(key,legacy.id)).toString(),'legacy');assert.equal((await assets.read(key,unassociated.id)).toString(),'before binding');
});
