import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {scopeKey} from '../../../src/core/identity.js';
import type {CallerScope,InboundMessage} from '../../../src/core/types.js';

test('existing inboxes preserve deferred expiry and only decode the selected FIFO batch',async t=>{
  await mkdir('.codex',{recursive:true});
  const home=await mkdtemp(path.resolve('.codex/inbox-routing-'));
  const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'alice',senderId:'alice'};
  const key=scopeKey(scope);
  const message=(id:string,timestamp:number):InboundMessage=>({id,timestamp,scope,text:id,attachments:[],reply:{}});
  const prior=new DatabaseSync(path.join(home,'bots.sqlite'));
  try{
    prior.exec("CREATE TABLE inbox(scope TEXT,id TEXT,json TEXT,state TEXT DEFAULT 'pending',PRIMARY KEY(scope,id))");
    const insert=prior.prepare('INSERT INTO inbox VALUES(?,?,?,?)');
    for(const [id,time,state] of [['expired',10,'deferred'],['reference',21,'deferred'],['ordinary',22,'pending']] as const){
      insert.run(key,id,JSON.stringify(message(id,time)),state);
    }
  }finally{prior.close();}
  const store=new SqlitePersistence(home,path.join(home,'personas')),inbox=store.inbox;
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const direct:InboundMessage={...message('draw',24),text:'/draw mountains',directImageCommand:true};
  inbox.accept(direct);
  inbox.accept({...message('later',25),attachments:[{kind:'image',mime:'image/png',name:'large.png',bytes:'A'.repeat(512*1024)}]});
  assert.deepEqual(inbox.pendingWindow(key,1),{count:1,hasDirectImage:false});
  assert.deepEqual(inbox.pendingWindow(key,8),{count:3,hasDirectImage:true});

  const decoded:string[]=[],parse=JSON.parse;
  const spy=t.mock.method(JSON,'parse',(...args:Parameters<typeof JSON.parse>)=>{
    const value=parse(...args);
    if(value?.scope?.botId==='bot'&&Array.isArray(value.attachments))decoded.push(value.id);
    return value;
  });
  const batch=inbox.nextBatch(key,8,20);
  assert.deepEqual(batch.map(row=>row.id),['reference','ordinary']);
  assert.deepEqual(decoded,['reference','ordinary']);
  assert.equal(inbox.stateOf(key,'expired'),'cancelled');
  inbox.mark(key,batch.map(row=>row.id),'complete');
  decoded.length=0;
  assert.deepEqual(inbox.nextBatch(key,8,20).map(row=>row.id),['draw']);
  assert.deepEqual(decoded,['draw']);
  spy.mock.restore();
});
