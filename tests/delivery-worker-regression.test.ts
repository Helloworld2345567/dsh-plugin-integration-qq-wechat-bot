import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,type ChannelAdapter,type Credential} from '../src/core/types.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {DurableDeliveryWorker} from '../src/core/delivery-worker.js';

function adapter():ChannelAdapter{return{beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};}
async function fixture(t:any){const home=await mkdtemp(path.resolve('.codex/delivery-worker-regression-'));const store=new SqlitePersistence(home);const channel=adapter();const channels=createChannelRegistry([{id:'qq',displayName:'QQ',adapter:channel,capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'}}]);store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));const binding=store.sessions.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});store.deliveries.enqueue(binding,'source','turn',[{type:'text',text:'reply'}],{});t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,channels};}
test('disabled bots do not block an already queued delivery',async t=>{const f=await fixture(t);f.store.bots.saveBot({...f.store.bots.bot('bot'),enabled:false});const worker=new DurableDeliveryWorker(f.store.repositories(),f.channels,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}});await worker.flush();assert.equal(f.store.deliveries.deliveries(['sent']).length,1);await worker.close();});

test('disabling while credentials are pending does not cancel the queued delivery',async t=>{const f=await fixture(t);let entered!:()=>void;const waiting=new Promise<void>(resolve=>entered=resolve);let release!:()=>void;const credential=new Promise<Credential|undefined>(resolve=>release=()=>resolve({accountId:'account'}));const worker=new DurableDeliveryWorker(f.store.repositories(),f.channels,{read:async()=>{entered();return credential;},write:async()=>{},remove:async()=>{}});const flushing=worker.flush();await waiting;f.store.bots.saveBot({...f.store.bots.bot('bot'),enabled:false});release();await flushing;assert.equal(f.store.deliveries.deliveries(['sent']).length,1);await worker.close();});
