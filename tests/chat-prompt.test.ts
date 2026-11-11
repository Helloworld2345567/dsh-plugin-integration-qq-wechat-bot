import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildChatPrompt,CHAT_PROMPT_SECTIONS,CHAT_PROMPT_CONTEXTS,CHAT_SUPPRESSED_SECTIONS,CHAT_SUPPRESSED_CONTEXTS,type ChatPromptInput} from '../src/harness/chat-prompt.js';

const input:ChatPromptInput={personaPrompt:'用温柔的中文回答。',platform:'qq',loadedTools:new Set(),skillNames:[]};
const section=(value:ReturnType<typeof buildChatPrompt>,name:string)=>value.sections.find(item=>item.name===name)!.text;

test('plain chat carries its persona and channel rules without unloaded capability guidance',()=>{
  const prompt=buildChatPrompt(input),text=prompt.sections.map(item=>item.text).join('\n');
  assert.equal(section(prompt,'bot-persona'),input.personaPrompt);
  assert.match(text,/chatting through qq/);assert.match(text,/next turn/);assert.match(text,/only platformSent=true/);
  assert.match(text,/call bot_tools in this turn/);assert.match(text,/Loading does not execute them/);assert.match(text,/Answer ordinary conversation directly/);
  assert.doesNotMatch(text,/sourceId|revision|bot_voice|bot_sing|bot_schedule|candidateRoot|image-generation/);
  assert.deepEqual(prompt.contexts.map(item=>item.text),['']);
});

test('the compatibility media entry keeps image retry limits and explicit speech consent',()=>{
  const prompt=buildChatPrompt({...input,loadedTools:new Set(['bot_media'])});
  assert.match(section(prompt,'bot-images'),/never run image generation in parallel/);
  assert.match(section(prompt,'bot-images'),/do not automatically retry an unknown or timed-out result/);
  assert.match(section(prompt,'bot-voice'),/only for an explicit speech request/);
  assert.equal(section(prompt,'bot-singing'),'');
});

test('remembering is disclosed only with the tool and retains host-owned source attribution',()=>{
  assert.equal(section(buildChatPrompt(input),'bot-memory-guide'),'');
  const prompt=buildChatPrompt({...input,loadedTools:new Set(['bot_remember'])});
  assert.match(section(prompt,'bot-memory-guide'),/stable preferences stated by the user/);
  assert.match(section(prompt,'bot-memory-guide'),/complete, exact line from the current user message/);
  assert.match(section(prompt,'bot-memory-guide'),/host resolves its source/);
  assert.match(section(prompt,'bot-memory-guide'),/Do not save permissions, identity bindings, credentials/);
  assert.doesNotMatch(section(prompt,'bot-memory-guide'),/sourceId/);
});

test('loaded media instructions retain execution limits and disappear when tools become unavailable',()=>{
  const prompt=buildChatPrompt({...input,loadedTools:new Set(['image_generation','bot_sing','bot_send_file'])});
  assert.match(section(prompt,'bot-images'),/never run image generation in parallel/);
  assert.match(section(prompt,'bot-images'),/do not automatically retry an unknown or timed-out result/);
  assert.match(section(prompt,'bot-singing'),/only once and do not retry a failure with another source/);
  assert.match(section(prompt,'bot-media'),/resend=true/);
  assert.equal(section(prompt,'bot-voice'),'');
  const revoked=buildChatPrompt({...input,loadedTools:new Set(['bot_send_file'])});
  assert.equal(section(revoked,'bot-images'),'');assert.equal(section(revoked,'bot-singing'),'');
});

test('management and automation guidance is disclosed independently and preserves authorization boundaries',()=>{
  const management=buildChatPrompt({...input,loadedTools:new Set(['bot_model'])});
  assert.match(section(management,'bot-management'),/explicit user request/);
  assert.match(section(management,'bot-management'),/acknowledge and end the turn/);
  assert.equal(section(management,'bot-automation'),'');
  const automation=buildChatPrompt({...input,loadedTools:new Set(['bot_schedule'])});
  assert.match(section(automation,'bot-automation'),/contents are not preloaded/);
  assert.match(section(automation,'bot-automation'),/returned jobId/);
  assert.equal(section(automation,'bot-management'),'');
});

test('subtasks retain frozen ownership while skill context exposes names only',()=>{
  const prompt=buildChatPrompt({...input,isSubtask:true,automaticVoice:true,loadedTools:new Set(['skill']),skillNames:['image-generation','media-analysis','image-generation']});
  assert.match(section(prompt,'bot-chat'),/only the main task delivers/);
  assert.match(section(prompt,'bot-chat'),/do not duplicate it with a tool/);
  assert.equal(prompt.contexts[0].text,'Available skills: image-generation, media-analysis.');
  assert.match(section(prompt,'bot-skill-resources'),/resourceBase is read-only/);
});

test('dynamic providers have stable slots and channel scopes suppress only irrelevant Web GUI contributions',()=>{
  const plain=buildChatPrompt(input),loaded=buildChatPrompt({...input,loadedTools:new Set(['bot_voice','bot_evolve'])});
  assert.deepEqual(plain.sections.map(({name,order})=>({name,order})),CHAT_PROMPT_SECTIONS);
  assert.deepEqual(loaded.sections.map(({name,order})=>({name,order})),CHAT_PROMPT_SECTIONS);
  assert.deepEqual(plain.contexts.map(({name,order})=>({name,order})),CHAT_PROMPT_CONTEXTS);
  assert.deepEqual(CHAT_SUPPRESSED_SECTIONS,['ui:deliverable-file-references','app:web-surface','harness:source']);
  assert.deepEqual(CHAT_SUPPRESSED_CONTEXTS,['app:web-surface','harness:source']);
});
