import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminClient} from '../src/client/admin-client.js';

function response(body:unknown,status=200):Response{return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}

test('AdminClient single-flights identical queries and remembers revision',async()=>{
  const requests:any[]=[];let resolve!: (value:Response)=>void;const pending=new Promise<Response>(r=>resolve=r);
  const client=new AdminClient({endpoint:'/admin',token:'token',transport:{fetch:async(_input,init)=>{requests.push(JSON.parse(String(init?.body)));return pending;}}});
  const one=client.query<{ok:boolean}>('overview.summary');const two=client.query<{ok:boolean}>('overview.summary');assert.equal(one,two);assert.equal(requests.length,1);resolve(response({version:1,contractVersion:1,revision:'sha256:'+'a'.repeat(64),data:{ok:true}}));assert.deepEqual(await one,{ok:true});
  let nextBody:any;const next=new AdminClient({endpoint:'/admin',token:'token',transport:{fetch:async(_input,init)=>{nextBody=JSON.parse(String(init?.body));return response({version:1,contractVersion:1,revision:'sha256:'+'b'.repeat(64),unchanged:true});}}});assert.equal(await next.query('overview.summary'),undefined);assert.equal(await next.query('overview.summary'),undefined);assert.equal(nextBody.input.changedSince,'sha256:'+'b'.repeat(64));
});

test('AdminClient unwraps the real HTTP result envelope',async()=>{const client=new AdminClient({endpoint:'/admin',token:'token',transport:{fetch:async()=>response({result:{version:1,contractVersion:1,revision:'sha256:'+'c'.repeat(64),data:{ok:true}}})}});assert.deepEqual(await client.query('overview.summary'),{ok:true});});
test('AdminClient default browser transport keeps fetch invocation valid',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{assert.equal(input,'/admin');assert.equal(init?.method,'POST');return response({result:{version:1,contractVersion:1,revision:'sha256:'+'d'.repeat(64),data:{ok:true}}});};
  try{const client=new AdminClient({endpoint:'/admin',token:'token'});assert.deepEqual(await client.query('overview.summary'),{ok:true});}finally{globalThis.fetch=original;}
});

test('late responses cannot overwrite a newer sequence and cancel aborts the request',async()=>{
  const calls:Array<{signal:AbortSignal;resolve:(value:Response)=>void}>=[];const client=new AdminClient({endpoint:'/admin',token:'token',transport:{fetch:async(_input,init)=>new Promise<Response>(resolve=>calls.push({signal:init!.signal!,resolve}))}});
  const first=client.query('overview.summary',{x:1});client.invalidate('overview.summary',{x:1});assert.equal(calls[0].signal.aborted,true);const second=client.query('overview.summary',{x:1});calls[0].resolve(response({revision:'sha256:'+'1'.repeat(64),data:{value:'old'}}));calls[1].resolve(response({revision:'sha256:'+'2'.repeat(64),data:{value:'new'}}));assert.equal(await first,undefined);assert.deepEqual(await second,{value:'new'});
});
