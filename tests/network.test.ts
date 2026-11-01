import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import net from 'node:net';
import https from 'node:https';
import dns from 'node:dns/promises';
import {syncBuiltinESMExports} from 'node:module';
import {download,jsonRequest,RemoteError} from '../src/core/network.js';

test('jsonRequest preserves the undici cause code for network failures',async t=>{
  const fetch=mock.method(globalThis,'fetch',async()=>{const cause=Object.assign(new Error('dns lookup failed'),{code:'ENOTFOUND'});throw Object.assign(new TypeError('fetch failed'),{cause});});
  t.after(()=>fetch.mock.restore());
  await assert.rejects(jsonRequest('https://api.example.invalid'),error=>error instanceof RemoteError&&error.code==='REMOTE_NETWORK_FAILED'&&error.causeCode==='ENOTFOUND'&&/ENOTFOUND/.test(error.message));
});

test('jsonRequest preserves bounded QQ rejection details without echoing request secrets',async t=>{
  const token='fixture-access-token',secret='fixture-client-secret';
  const fetch=mock.method(globalThis,'fetch',async()=>Response.json({code:400100,message:`file too large; ${token}; ${secret}; url=https://upload.example/private?token=hidden; Authorization: Bearer another-secret; file_info=private-receipt`},{status:400,headers:{'x-tps-trace-id':'qq-trace-123'}}));
  t.after(()=>fetch.mock.restore());
  await assert.rejects(jsonRequest('https://api.example.invalid',{headers:{Authorization:`QQBot ${token}`},body:JSON.stringify({clientSecret:secret})}),error=>{
    assert.ok(error instanceof RemoteError);assert.equal(error.status,400);assert.equal(error.platformCode,'400100');assert.equal(error.platformTraceId,'qq-trace-123');
    assert.match(error.platformMessage??'',/file too large/);assert.doesNotMatch(JSON.stringify(error),/fixture-access-token|fixture-client-secret|upload\.example|hidden|another-secret|private-receipt/);
    assert.equal(error.message,'REMOTE_REQUEST_FAILED (HTTP 400)');return true;
  });
});

test('oversized and malformed error bodies keep the HTTP rejection and cancel excess data',async t=>{
  let cancelled=false;
  const oversized=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(64*1024+1));},cancel(){cancelled=true;}}),{status:413,headers:{'x-tps-trace-id':'trace-overflow'}});
  const responses=[oversized,new Response('<html>secret https://private.example</html>',{status:400})];
  const fetch=mock.method(globalThis,'fetch',async()=>responses.shift()!);t.after(()=>fetch.mock.restore());
  await assert.rejects(jsonRequest('https://api.example.invalid'),error=>error instanceof RemoteError&&error.status===413&&error.platformMessage===undefined&&error.platformTraceId==='trace-overflow');assert.equal(cancelled,true);
  await assert.rejects(jsonRequest('https://api.example.invalid'),error=>error instanceof RemoteError&&error.status===400&&error.platformMessage===undefined&&!JSON.stringify(error).includes('private.example'));
});

test('provider diagnostics are truncated and invalid trace identifiers are excluded',async t=>{
  const fetch=mock.method(globalThis,'fetch',async()=>Response.json({error:{code:'FILE_TOO_LARGE',message:'文件过大 '.repeat(1000),trace_id:'https://private.example/token'}},{status:400}));t.after(()=>fetch.mock.restore());
  await assert.rejects(jsonRequest('https://api.example.invalid'),error=>{assert.ok(error instanceof RemoteError);assert.equal(error.platformCode,'FILE_TOO_LARGE');assert.equal(error.platformMessage?.length,512);assert.equal(error.platformTraceId,undefined);return true;});
  const legacy=new RemoteError('REMOTE_NETWORK_FAILED',undefined,'ECONNRESET','connection reset');assert.equal(legacy.causeCode,'ECONNRESET');assert.equal(legacy.causeMessage,'connection reset');
});

test('JSON APIs accept successful empty acknowledgements and reject malformed success data safely',async t=>{
  const responses=[new Response('',{status:200}),new Response(null,{status:204}),new Response('private non-JSON response',{status:200})];
  const fetch=mock.method(globalThis,'fetch',async()=>responses.shift()!);t.after(()=>fetch.mock.restore());
  assert.deepEqual(await jsonRequest('https://api.example.invalid'),{});assert.deepEqual(await jsonRequest('https://api.example.invalid'),{});
  await assert.rejects(jsonRequest('https://api.example.invalid'),error=>error instanceof RemoteError&&error.code==='REMOTE_RESPONSE_INVALID'&&!error.message.includes('private'));
});

test('download pinned lookup supports Node 24 autoSelectFamily all-address callback',async t=>{
  const fixture=net.createServer(socket=>socket.end());
  await new Promise<void>((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise<void>(resolve=>fixture.close(()=>resolve())));
  const port=(fixture.address() as net.AddressInfo).port;let sawAll=false;let transportCalls=0;
  const get=mock.method(https,'get',((url:URL,options:any,receive:(response:any)=>void)=>{
    transportCalls++;assert.equal(url.hostname,'1.1.1.1');
    const request=new EventEmitter() as any;
    // Preserve download's lookup result shape. Only a valid result is mapped to
    // the local fixture; the original malformed scalar never opens a socket.
    const socket=net.createConnection({host:'fixture.invalid',port,autoSelectFamily:true,lookup:((host:string,lookupOptions:any,callback:any)=>{
      sawAll=lookupOptions.all===true;
      options.lookup(host,lookupOptions,(error:Error|null,addresses:any,family?:number)=>{
        if(Array.isArray(addresses)){assert.deepEqual(addresses,[{address:'1.1.1.1',family:4}]);callback(error,[{address:'127.0.0.1',family:4}]);}
        else callback(error,addresses,family);
      });
    }) as any});
    request.destroy=(error?:Error)=>{socket.destroy(error);return request;};
    socket.once('error',error=>request.emit('error',error));
    socket.once('connect',()=>{const response=new PassThrough() as any;response.statusCode=200;response.headers={};receive(response);response.end(Buffer.from('local-image-fixture'));socket.end();});
    return request;
  }) as any);
  t.after(()=>get.mock.restore());
  assert.equal((await download('https://1.1.1.1/fixture',AbortSignal.timeout(2000))).toString(),'local-image-fixture');
  assert.equal(sawAll,true);assert.equal(transportCalls,1);
});

test('download continues refusing private and unsafe targets before opening transport',async t=>{
  let calls=0;const get=mock.method(https,'get',(()=>{calls++;throw Error('transport must not run');}) as any);t.after(()=>get.mock.restore());
  for(const url of ['https://127.0.0.1/image','https://10.0.0.1/image','https://[::1]/image','http://1.1.1.1/image','https://user:secret@1.1.1.1/image','https://1.1.1.1:444/image'])await assert.rejects(download(url,AbortSignal.timeout(1000)),/PRIVATE_MEDIA_ADDRESS|UNSAFE_MEDIA_URL/);
  assert.equal(calls,0);
});

test('download pinned lookup retains single-address and IPv6 callback forms',async t=>{
  const get=mock.method(https,'get',((url:URL,options:any,receive:(response:any)=>void)=>{
    const expected=url.hostname.replace(/^\[|\]$/g,'');const family=net.isIP(expected);
    options.lookup('ignored.invalid',{all:false},(error:Error|null,address:string,resultFamily:number)=>{assert.equal(error,null);assert.equal(address,expected);assert.equal(resultFamily,family);});
    options.lookup('ignored.invalid',{all:true},(error:Error|null,addresses:any)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:expected,family}]);});
    const request=new EventEmitter();queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=200;response.headers={};receive(response);response.end(Buffer.from('fixture'));});return request;
  }) as any);t.after(()=>get.mock.restore());
  for(const url of ['https://1.1.1.1/image','https://[2606:4700:4700::1111]/image'])assert.equal((await download(url,AbortSignal.timeout(1000))).toString(),'fixture');
});

test('download validates a redirect target before opening its transport',async t=>{
  let calls=0;const get=mock.method(https,'get',((_url:URL,_options:any,receive:(response:any)=>void)=>{
    calls++;const request=new EventEmitter();queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=302;response.headers={location:'https://127.0.0.1/private'};receive(response);response.end();});return request;
  }) as any);t.after(()=>get.mock.restore());
  await assert.rejects(download('https://1.1.1.1/redirect',AbortSignal.timeout(1000)),/PRIVATE_MEDIA_ADDRESS/);assert.equal(calls,1);
});

test('download accepts TUN fake DNS only for an exact HTTPS attachment host and keeps hostname verification',async t=>{
  const host='multimedia.nt.qq.com.cn';let chosen={address:'198.18.0.95',family:4};
  const lookup=mock.method(dns,'lookup',(async()=>[chosen]) as any);syncBuiltinESMExports();
  const get=mock.method(https,'get',((url:URL,options:any,receive:(response:any)=>void)=>{
    assert.equal(url.protocol,'https:');assert.equal(url.hostname,host);
    assert.equal(options.rejectUnauthorized,undefined);assert.equal(options.checkServerIdentity,undefined);assert.equal(options.servername,undefined);
    options.lookup(host,{all:true},(error:Error|null,addresses:any)=>{assert.equal(error,null);assert.deepEqual(addresses,[chosen]);});
    const request=new EventEmitter();queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=200;response.headers={};receive(response);response.end(Buffer.from('voice-fixture'));});return request;
  }) as any);
  t.after(()=>{get.mock.restore();lookup.mock.restore();syncBuiltinESMExports();});
  for(const answer of [{address:'198.18.0.95',family:4},{address:'198.19.255.254',family:4},{address:'2001:2::5c',family:6},{address:'2001:0002:0000:1::5c',family:6}]){
    chosen=answer;assert.equal((await download(`https://${host}/voice`,AbortSignal.timeout(1000),1024,0,{hosts:new Set([host])})).toString(),'voice-fixture');
  }
});

test('download keeps fake IP exceptions scoped to exact HTTPS domains and refuses private DNS answers',async t=>{
  const host='multimedia.nt.qq.com.cn';let answers=[{address:'198.18.0.95',family:4}];let transportCalls=0;
  const lookup=mock.method(dns,'lookup',(async()=>answers) as any);syncBuiltinESMExports();
  const get=mock.method(https,'get',(()=>{transportCalls++;throw Error('transport must not run');}) as any);
  t.after(()=>{get.mock.restore();lookup.mock.restore();syncBuiltinESMExports();});
  await assert.rejects(download(`https://${host}/voice`,AbortSignal.timeout(1000)),/PRIVATE_MEDIA_ADDRESS/);
  await assert.rejects(download(`https://${host}/voice`,AbortSignal.timeout(1000),1024,0,{hostSuffixes:new Set(['qq.com.cn'])}),/PRIVATE_MEDIA_ADDRESS/);
  await assert.rejects(download(`http://${host}/voice`,AbortSignal.timeout(1000),1024,0,{hosts:new Set([host]),allowHttp:true}),/PRIVATE_MEDIA_ADDRESS/);
  for(const address of ['198.18.0.95','198.19.255.254','2001:2::5c']){
    await assert.rejects(download(`https://${address.includes(':')?`[${address}]`:address}/voice`,AbortSignal.timeout(1000),1024,0,{hosts:new Set([address])}),/PRIVATE_MEDIA_ADDRESS/);
  }
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','192.0.2.1','198.51.100.1','203.0.113.1','::1','fc00::1','fe80::1','2001:db8::1','2001:10::1','2001:20::1','::ffff:198.18.0.95']){
    answers=[{address:'198.18.0.95',family:4},{address,family:net.isIP(address)}];
    await assert.rejects(download(`https://${host}/voice`,AbortSignal.timeout(1000),1024,0,{hosts:new Set([host])}),/PRIVATE_MEDIA_ADDRESS/,address);
  }
  assert.equal(transportCalls,0);
});

test('download reapplies the exact host policy when a fake-DNS attachment redirects',async t=>{
  const host='multimedia.nt.qq.com.cn';let transportCalls=0;
  const lookup=mock.method(dns,'lookup',(async()=>[{address:'198.18.0.95',family:4}]) as any);syncBuiltinESMExports();
  const get=mock.method(https,'get',((_url:URL,_options:any,receive:(response:any)=>void)=>{
    transportCalls++;const request=new EventEmitter();queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=302;response.headers={location:'https://other.example/voice'};receive(response);response.end();});return request;
  }) as any);
  t.after(()=>{get.mock.restore();lookup.mock.restore();syncBuiltinESMExports();});
  await assert.rejects(download(`https://${host}/voice`,AbortSignal.timeout(1000),1024,0,{hosts:new Set([host])}),/UNSAFE_MEDIA_HOST/);
  assert.equal(transportCalls,1);
});
