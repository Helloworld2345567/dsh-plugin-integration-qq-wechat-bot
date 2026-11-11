import {test} from 'node:test';
import assert from 'node:assert/strict';
import {systemMessages,systemDescriptor,systemMessage,systemErrorText,SystemMessageError,formatSystemMessage,type SystemMessageKey} from '../src/i18n/system.js';
import {botScheduleArgumentsSchema} from '../src/core/automation-contract.js';

test('system message translations have matching placeholders and all English entries are translated',()=>{
  const placeholders=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
  assert.deepEqual(Object.keys(systemMessages.en).sort(),Object.keys(systemMessages.zh).sort());
  for(const key of Object.keys(systemMessages.zh) as SystemMessageKey[]){
    assert.ok(systemMessages.en[key].trim(),key);assert.doesNotMatch(systemMessages.en[key],/\p{Script=Han}/u,key);
    assert.deepEqual(placeholders(systemMessages.en[key]),placeholders(systemMessages.zh[key]),key);
  }
  assert.equal(systemMessage('en','modelSwitched',{provider:'provider-id',model:'model-id'}),'Switched model to provider-id / model-id. Applies from the next turn.');
});

test('system errors retain the compatible text and render their descriptor in the requested language',()=>{
  const error=new SystemMessageError('voiceDisabled',{role:'STS'});
  assert.match(error.message,/未启用/);assert.match(systemErrorText(error,'en','commandFailed'),/STS is not enabled/);
  assert.equal(formatSystemMessage(systemDescriptor('newSession',{id:'owned-id'}),'en'),'Started a new session: owned-id');
  assert.equal(formatSystemMessage({key:'unknown.key'},'en'),undefined);
  const validation=botScheduleArgumentsSchema.safeParse({action:'create',prompt:'a task'});assert.equal(validation.success,false);
  if(!validation.success)assert.equal(systemErrorText(validation.error,'en','commandFailed'),'An execution time is required');
});
