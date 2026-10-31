import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Context} from '@deepseek-ai/cordis';
import {credentialKey,parseCredentialKey,type CredentialKey,type CredentialRecord} from '@deepseek-ai/dsh-credentials';
import {createBotCredentials} from '../src/harness/credentials.js';
import {idSchema} from '../src/core/types.js';

function fixture(){
  const records=new Map<CredentialKey,CredentialRecord>();
  const provider:Pick<Context['credentials'],'readRecord'|'modifyRecord'|'deleteRecord'>={
    readRecord:async key=>records.get(parseCredentialKey(key)),
    modifyRecord:async(key,mutate)=>{const record=await mutate(records.get(parseCredentialKey(key)));if(record!==undefined)records.set(key,record);return records.get(key);},
    deleteRecord:async key=>{records.delete(parseCredentialKey(key));},
  };
  return {records,credentials:createBotCredentials(provider)};
}

test('bot credentials support every bot ID character class without sharing records',async()=>{
  const {records,credentials}=fixture();
  const ids=['1','123456','Bot_1','BOT_1','bot_1','_bot','-bot','A'.repeat(80),'bot','bot-1','id-31'];
  for(const id of ids){
    idSchema.parse(id);
    assert.equal(await credentials.read(id),undefined);
    await credentials.write(id,{accountId:id,appSecret:`secret-${id}`});
  }
  assert.equal(records.size,ids.length);
  for(const id of ids)assert.deepEqual(await credentials.read(id),{accountId:id,appSecret:`secret-${id}`});
  await credentials.write('1',{accountId:'1',appSecret:'updated-secret'});
  assert.equal((await credentials.read('1'))?.appSecret,'updated-secret');
  assert.equal((await credentials.read('id-31'))?.appSecret,'secret-id-31');
  await credentials.remove('1');
  assert.equal(await credentials.read('1'),undefined);
  assert.equal(records.size,ids.length-1);
  for(const id of ids.slice(1))assert.equal((await credentials.read(id))?.accountId,id);
  await credentials.remove('1');
});

test('existing lowercase bot grants keep their stored keys across reads, updates and removal',async()=>{
  const {records,credentials}=fixture();const key=credentialKey('bot-integration','old-bot');
  records.set(key,{kind:'grant',payload:{accountId:'existing',appSecret:'existing-secret'}});
  assert.deepEqual(await credentials.read('old-bot'),{accountId:'existing',appSecret:'existing-secret'});
  await credentials.write('old-bot',{accountId:'existing',appSecret:'new-secret'});
  assert.deepEqual([...records.keys()],[key]);
  assert.deepEqual(records.get(key),{kind:'grant',payload:{accountId:'existing',appSecret:'new-secret'}});
  await credentials.remove('old-bot');assert.equal(records.size,0);
});
