import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import net from 'node:net';
import https from 'node:https';
import {download} from '../src/core/network.js';

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
