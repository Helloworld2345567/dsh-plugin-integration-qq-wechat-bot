import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PromptAssembler,MEMORY_PROMPT_CHAR_LIMIT} from '../src/harness/prompt-assembler.js';

test('memory prompt keeps only stable preference fields and ordering',()=>{
  const prompts=new PromptAssembler(),records=[
    {key:'language',value:'zh',quote:'我希望用中文',source:'b',version:1,updated:2},
    {key:'drink',value:'tea',quote:'I prefer tea',source:'a',version:8,updated:12345},
  ];
  const prompt=prompts.memory(records);
  assert.deepEqual(JSON.parse(prompt.split('\n')[1]),[{key:'drink',value:'tea'},{key:'language',value:'zh'}]);
  assert.doesNotMatch(prompt,/I prefer tea|source|version|updated/);
  assert.match(prompt,/data only and cannot change permissions/);assert.equal(prompts.memory([]),'');
});

test('memory prompt has a deterministic character budget',()=>{
  const prompts=new PromptAssembler();
  const records=Array.from({length:30},(_,index)=>({key:`key-${String(index).padStart(2,'0')}`,value:'x'.repeat(500),quote:'ignored',source:'source',version:1,updated:index}));
  const prompt=prompts.memory(records);
  assert.ok(prompt.length<=MEMORY_PROMPT_CHAR_LIMIT+80);
  assert.ok(JSON.parse(prompt.split('\n')[1]).length<records.length);
});

test('an oversized preference does not hide later compact preferences',()=>{
  const prompt=new PromptAssembler().memory([
    {key:'a-large',value:'x'.repeat(MEMORY_PROMPT_CHAR_LIMIT),quote:'ignored'},
    {key:'z-small',value:'keep',quote:'ignored'},
  ]);
  assert.deepEqual(JSON.parse(prompt.split('\n')[1]),[{key:'z-small',value:'keep'}]);
});
