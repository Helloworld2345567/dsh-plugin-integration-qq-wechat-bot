import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ToolSchema} from '@deepseek-ai/dsh-llm';
import type {PromptAssembly} from '@deepseek-ai/dsh-system-prompt';
import {loadTools,projectTools,toolCatalogDescription,toolInstructions,TOOL_LOADER} from '../src/harness/tool-disclosure.js';

const tool=(name:string,description=`Full ${name} instructions.`):ToolSchema=>({name,description,parameters:{type:'object',properties:{privateArgument:{type:'string'}}}});
const assembly=(tools:ToolSchema[],sections:string[]=[]):PromptAssembly=>({tools,sections:sections.map(name=>({name,text:`${name} instructions`})),contexts:[{name:'bot-memory',text:'Keep my preference'}],variables:{cwd:'workspace'}});

test('a turn exposes the loader and completion tool, then adds only requested schemas',()=>{
  const input=assembly([tool(TOOL_LOADER),tool('read'),tool('bot_voice'),tool('structured_output')]),loaded=new Set<string>();
  const initial=projectTools(input,loaded);
  assert.deepEqual(initial.tools.map(item=>item.name),[TOOL_LOADER,'structured_output']);
  assert.match(initial.tools[0]!.description,/read: Read local files/);
  assert.doesNotMatch(initial.tools[0]!.description,/privateArgument|structured_output|Full read instructions/);
  assert.deepEqual(loadTools(['read','read'],input.tools,loaded),['read']);
  assert.deepEqual(projectTools(input,loaded).tools.map(item=>item.name),[TOOL_LOADER,'read','structured_output']);
  assert.equal(input.tools.length,4,'projection does not unregister tools');
  assert.equal(input.tools[0]!.description,`Full ${TOOL_LOADER} instructions.`);
});

test('unavailable tool requests do not partially load the batch or survive a removed capability',()=>{
  const available=[tool('read'),tool('write')],loaded=new Set(['read']);
  assert.throws(()=>loadTools(['write','missing'],available,loaded),/TOOL_NOT_AVAILABLE: missing/);
  assert.deepEqual([...loaded],['read']);
  assert.throws(()=>loadTools(['structured_output'],[tool('structured_output')],loaded),/TOOL_NOT_AVAILABLE/);
  assert.deepEqual(projectTools(assembly([tool(TOOL_LOADER),tool('write')]),loaded).tools.map(item=>item.name),[TOOL_LOADER]);
});

test('loading tools keeps the system prompt stable and preserves user instructions and completion guidance',()=>{
  const input=assembly([tool(TOOL_LOADER),tool('read'),tool('session_event_read'),tool('extension'),tool('structured_output')],['tool:read','tool:write','tool:session-query','tool:extension','tool:structured_output','user-persona','AGENTS.md','tool:custom-guidance']);
  const initial=projectTools(input,new Set());
  assert.deepEqual(initial.sections.map(section=>section.name),['tool:structured_output','user-persona','AGENTS.md','tool:custom-guidance']);
  const next=projectTools(input,new Set(['read','session_event_read','extension']));
  assert.deepEqual(next.sections,initial.sections);
  assert.strictEqual(next.contexts,input.contexts);
  assert.strictEqual(next.variables,input.variables);
});

test('the loader can return instructions for selected tools, including shared and extension sections',()=>{
  const input=assembly([],['tool:read','tool:write','tool:session-query','tool:extension','user-persona','AGENTS.md']);
  const loaded=new Set(['read','session_event_read','extension']);
  assert.deepEqual(toolInstructions(input.sections,loaded),['tool:read instructions','tool:session-query instructions','tool:extension instructions']);
  assert.deepEqual(toolInstructions(input.sections,new Set()),[]);
  assert.deepEqual(toolInstructions([{name:'tool:read',text:'  '}],loaded),[]);
});

test('unknown tools have short first-sentence catalog entries without argument schemas',()=>{
  const description=toolCatalogDescription([tool('extension','First sentence. More details and examples.'),tool('long_extension','x'.repeat(200)),tool('chinese_extension','读取公开内容。然后执行额外操作。')]);
  assert.match(description,/extension: First sentence\./);
  assert.match(description,/chinese_extension: 读取公开内容。/);
  assert.doesNotMatch(description,/More details|然后|privateArgument/);
  assert.ok(description.indexOf('chinese_extension:')<description.indexOf('extension:'));
  assert.equal(description.split('\n').find(line=>line.startsWith('long_extension: ')),`long_extension: ${'x'.repeat(100)}`);
});
