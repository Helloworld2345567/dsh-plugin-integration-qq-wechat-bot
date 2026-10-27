import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
import {botSchema,type ChannelAdapter,type Credential} from '../src/core/types.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {DurableDeliveryWorker} from '../src/core/delivery-worker.js';

function adapter():ChannelAdapter{return{beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};}
async function fixture(t:any){const home=await mkdtemp(path.resolve('.codex/delivery-worker-regression-'));const store=new Store(home);const channel=adapter();const channels=createChannelRegistry([{id:'qq',displayName:'QQ',adapter:channel,capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'}}]);store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));const binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});store.enqueue(binding,'source','turn',[{type:'text',text:'reply'}],{});t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,channels};}
function boundedRepository(store:Store){const original=store.deliveryRepository();let reads=0;const repository={...original,nextSendable:(botId:string,limit:number)=>{reads++;if(reads>1)throw Error('UNEXPECTED_RESCAN');return original.nextSendable(botId,limit);}};return{repository,reads:()=>reads};}

test('disabled before send exits the lane without rescanning pending rows',async t=>{const f=await fixture(t);f.store.saveBot({...f.store.bot('bot'),enabled:false});const bounded=boundedRepository(f.store);(f.store as any).deliveryRepository=()=>bounded.repository;const worker=new DurableDeliveryWorker(f.store,f.channels,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}});await worker.flush();assert.equal(bounded.reads(),1);assert.equal(f.store.deliveries(['pending']).length,1);await worker.close();});

test('disabling while credentials are pending exits after the second send check',async t=>{const f=await fixture(t);let entered!:()=>void;const waiting=new Promise<void>(resolve=>entered=resolve);let release!:()=>void;const credential=new Promise<Credential|undefined>(resolve=>release=()=>resolve({accountId:'account'}));const bounded=boundedRepository(f.store);(f.store as any).deliveryRepository=()=>bounded.repository;const worker=new DurableDeliveryWorker(f.store,f.channels,{read:async()=>{entered();return credential;},write:async()=>{},remove:async()=>{}});const flushing=worker.flush();await waiting;f.store.saveBot({...f.store.bot('bot'),enabled:false});release();await flushing;assert.equal(bounded.reads(),1);await worker.close();});
