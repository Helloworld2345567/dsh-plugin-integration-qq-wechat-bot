import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_LIMITS,INPUT_LIMITS,validateBatch} from '../src/core/limits.js';
import type {InboundMessage,MediaInput} from '../src/core/types.js';

const MiB=1024*1024;
const message=(id:string,attachment:MediaInput):InboundMessage=>({id,scope:{botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'},text:'请把这段纯人声换成你的音色',attachments:[attachment],reply:{},timestamp:0});
const source=(kind:'audio'|'file',patch:Partial<MediaInput>={}):MediaInput=>({kind,name:'song.wav',mime:'audio/wav',handle:'source',...patch});
const options={audioSourceMessageIds:new Set(['song'])};

test('authorized STS audio and file payloads use audio limits without consuming the text budget',()=>{
  for(const kind of ['audio','file'] as const){
    assert.doesNotThrow(()=>validateBatch([message('song',source(kind))],()=>MiB,options));
    assert.doesNotThrow(()=>validateBatch([message('song',source(kind,{handle:undefined,bytes:Buffer.alloc(MiB).toString('base64')}))],undefined,options));
    assert.throws(()=>validateBatch([message('song',source(kind))],()=>MiB),/BATCH_INPUT_TOO_LARGE/);
  }
});

test('STS still enforces single audio, combined attachments and text limits',()=>{
  assert.throws(()=>validateBatch([message('song',source('audio'))],()=>AUDIO_LIMITS.inputBytes+1,options),/MEDIA_TOO_LARGE/);
  const batch=['song','second','third'].map(id=>message(id,source('file')));
  assert.throws(()=>validateBatch(batch,()=>40*MiB,{audioSourceMessageIds:new Set(batch.map(item=>item.id))}),/BATCH_ATTACHMENT_BYTES_LIMIT/);
  assert.throws(()=>validateBatch([{...message('song',source('audio')),text:'x'.repeat(INPUT_LIMITS.batchInputBytes+1)}],()=>MiB,options),/BATCH_INPUT_TOO_LARGE/);
});

test('STS exclusion only applies to authorized current-message audio and file attachments',()=>{
  assert.throws(()=>validateBatch([message('other',source('file'))],()=>MiB,options),/BATCH_INPUT_TOO_LARGE/);
  const quoted={...message('song',source('audio')),quoted:{attachments:[source('file')]}};
  assert.throws(()=>validateBatch([quoted],()=>MiB,options),/BATCH_INPUT_TOO_LARGE/);
  const image={...message('song',source('audio')),attachments:[{kind:'image' as const,name:'image.png',mime:'image/png',handle:'image'}]};
  assert.throws(()=>validateBatch([image],()=>MiB,options),/BATCH_INPUT_TOO_LARGE/);
});
