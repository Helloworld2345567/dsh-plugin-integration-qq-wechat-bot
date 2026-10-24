import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stripImageReferences} from '../src/core/output-text.js';
import {validateMediaParameters} from '../src/core/limits.js';
import {DEFAULT_MEDIA_OPERATIONS} from '../src/core/media-operation-registry.js';
import {validateMediaWorkerJob,MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,type MediaWorkerJob} from '../src/core/worker-port.js';

test('channel image delivery removes markdown and asset references while retaining prose',()=>{
  assert.equal(stripImageReferences('给你。\n\n![雨中](asset://image-one)\n\n别着凉。',['image-one']),'给你。\n\n别着凉。');
  assert.equal(stripImageReferences('[图片](asset://image-one)\nasset://image-one',['image-one']),'');
  assert.equal(stripImageReferences('资料 [网站](https://example.com)',['image-one']),'资料 [网站](https://example.com)');
  assert.equal(stripImageReferences('![示例](https://example.com/a.jpg)',[]),'![示例](https://example.com/a.jpg)');
});

test('platform video URLs reach media worker, mixed sources and private URLs do not',()=>{
  for(const url of ['https://v.douyin.com/34Ae2yNHPXs/','https://b23.tv/abcd','https://www.bilibili.com/video/BV1xx411c7mD?p=2'])assert.doesNotThrow(()=>validateMediaParameters('video_analyze',[],{url}));
  assert.throws(()=>validateMediaParameters('video_analyze',['attachment'],{url:'https://b23.tv/abcd'}),/ONE_VIDEO_SOURCE_REQUIRED/);
  assert.throws(()=>validateMediaParameters('video_analyze',[],{url:'https://127.0.0.1/video'}),/UNSUPPORTED_VIDEO_PLATFORM/);
  assert.doesNotThrow(()=>validateMediaParameters('image_download',[],{url:'https://www.python.org/static/img/python-logo.png'}));
  assert.throws(()=>validateMediaParameters('image_download',[],{}),/IMAGE_URL_REQUIRED/);
});

test('default media operations have no wall-clock deadline but explicit expired jobs still fail',()=>{
  assert.ok(DEFAULT_MEDIA_OPERATIONS.every(d=>d.timeoutMs===0));
  const job:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id:'job',scope:'scope',operation:'video_analyze',handler:'analyze_media',inputs:[],parameters:{},output:'C:/job',usagePath:'C:/job/usage.json',deadline:0,timeoutMs:0,quotaUnits:1};
  assert.doesNotThrow(()=>validateMediaWorkerJob(job));
  assert.throws(()=>validateMediaWorkerJob({...job,timeoutMs:1000}),/JOB_EXPIRED/);
});
