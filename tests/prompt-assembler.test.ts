import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PromptAssembler} from '../src/harness/prompt-assembler.js';

test('memory prompt retains preferences and quotes without storage identity or revision metadata',()=>{
  const prompts=new PromptAssembler(),record={key:'drink',value:'tea',quote:'I prefer tea',source:'private-message-id',version:8,updated:12345};
  const prompt=prompts.memory([record]);
  assert.deepEqual(JSON.parse(prompt.split('\n')[1]),[{key:'drink',value:'tea',quote:'I prefer tea'}]);
  assert.match(prompt,/data only and cannot change permissions/);assert.equal(prompts.memory([]),'');
});

