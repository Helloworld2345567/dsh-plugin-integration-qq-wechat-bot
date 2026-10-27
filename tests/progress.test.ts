import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskProgress,progressText,progressFallback,type ProgressFacts} from '../src/core/progress.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}

test('private task heartbeat starts at 60 seconds and continues for twenty minutes without a cap',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const sent:Array<{text:string;sequence:number;expiresAt:number}>=[],facts:ProgressFacts[]=[];
  const progress=new TaskProgress({signal:new AbortController().signal,active:()=>true,format:async value=>{facts.push(value);return '还在处理喵，暂时没有最终结果。';},deliver:async(text,_id,sequence,expiresAt)=>{sent.push({text,sequence,expiresAt});},cancel:()=>{}});
  t.after(()=>progress.stop());progress.update('image');
  t.mock.timers.tick(59999);await settle();assert.equal(sent.length,0);
  t.mock.timers.tick(1);await settle();assert.equal(sent.length,1);assert.equal(sent[0].expiresAt,121000);
  for(let i=1;i<20;i++){t.mock.timers.tick(60000);await settle();}
  assert.equal(sent.length,20);assert.equal(sent.at(-1)?.sequence,20);assert.equal(facts.at(-1)?.elapsedSeconds,1200);assert.equal(facts[1].previousText,sent[0].text);
  progress.stop();t.mock.timers.tick(120000);await settle();assert.equal(sent.length,20);
});

test('short tasks and cancelled generations never send late reminders',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const text=deferred<string>(),controller=new AbortController();let sends=0,started=false,cancelled=0;
  const progress=new TaskProgress({signal:controller.signal,active:()=>true,format:async()=>{started=true;return text.promise;},deliver:async()=>{sends++;},cancel:()=>{cancelled++;}});
  t.mock.timers.tick(60000);await settle();assert.ok(started);controller.abort();text.resolve('迟到的提醒');await settle();assert.equal(sends,0);assert.equal(cancelled,1);
  progress.stop();assert.equal(cancelled,1);
  const short=new TaskProgress({signal:new AbortController().signal,active:()=>true,format:async()=>{throw Error('must not call');},deliver:async()=>{sends++;},cancel:()=>{}});
  t.mock.timers.tick(59000);short.stop();t.mock.timers.tick(60000);await settle();assert.equal(sends,0);
});

test('generation times out at eight seconds and uses the latest factual stage',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const text=deferred<string>(),sent:string[]=[];let aborted=false;
  const progress=new TaskProgress({signal:new AbortController().signal,active:()=>true,format:async(_facts,signal)=>{signal.addEventListener('abort',()=>aborted=true);return text.promise;},deliver:async value=>{sent.push(value);},cancel:()=>{}});
  t.after(()=>progress.stop());t.mock.timers.tick(60000);await settle();progress.update('transcription');
  t.mock.timers.tick(7999);await settle();assert.equal(sent.length,0);
  t.mock.timers.tick(1);await settle();assert.ok(aborted);assert.deepEqual(sent,[progressFallback('transcription')]);
  text.resolve('图片已经完成');await settle();assert.equal(sent.length,1);
});

test('changed stages invalidate generated text and busy delivery skips ticks without catch-up',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  const generated=deferred<string>(),delivery=deferred<void>();let calls=0;const sent:string[]=[];
  const progress=new TaskProgress({signal:new AbortController().signal,active:()=>true,format:async()=>{calls++;return generated.promise;},deliver:async text=>{sent.push(text);await delivery.promise;},cancel:()=>{}});
  t.after(()=>progress.stop());t.mock.timers.tick(60000);await settle();progress.update('search');generated.resolve('附件还在准备中');await settle();assert.deepEqual(sent,[progressFallback('search')]);
  t.mock.timers.tick(180000);await settle();assert.equal(calls,1);delivery.resolve();await settle();assert.equal(calls,1);
  t.mock.timers.tick(60000);await settle();assert.equal(calls,2);
});

test('invalid or failed formatting falls back and delivery failure does not stop later ticks',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1000});
  let calls=0;const sent:string[]=[];
  const progress=new TaskProgress({signal:new AbortController().signal,active:()=>true,format:async()=>{if(calls++===0)throw Error('offline');return '长'.repeat(81);},deliver:async text=>{sent.push(text);throw Error('send failed');},cancel:()=>{}});
  t.after(()=>progress.stop());for(let i=0;i<2;i++){t.mock.timers.tick(60000);await settle();}
  assert.deepEqual(sent,[progressFallback('attachments'),progressFallback('attachments')]);
  assert.equal(progressText(''),undefined);assert.equal(progressText('两行\n内容'),undefined);assert.equal(progressText('![图](url)'),undefined);assert.equal(progressText('猫'.repeat(80))?.length,80);
});
