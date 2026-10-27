import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installLocalWebAuthBypass} from '../src/core/local-web-auth.js';

function request(remoteAddress:string,localAddress='127.0.0.1'){
  return {method:'GET',headers:{host:'127.0.0.1:3080'},socket:{remoteAddress,localAddress}};
}

test('local web auth bypass accepts loopback requests and keeps the public listener authenticated',()=>{
  const calls:string[]=[];
  const browserPeer={id:'browser'};
  const connection:any={
    browserPeer,
    isTrusted:()=>true,
    admit:()=>{calls.push('admit');return{rejection:401};},
    authorizeIndex:(_request:any,response:any)=>{calls.push('index');response.writeHead(401);return false;},
    authenticatedUrl:(baseUrl:string)=>`${baseUrl}?token=secret`,
  };
  const restore=installLocalWebAuthBypass(connection,'127.0.0.1');
  assert.deepEqual(connection.admit(request('127.0.0.1')),{peer:browserPeer});
  assert.equal(connection.authorizeIndex(request('127.0.0.1'),{}),true);
  assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080/'),'http://127.0.0.1:3080/');
  assert.deepEqual(connection.admit(request('192.0.2.20','192.0.2.1')),{rejection:401});
  assert.equal(connection.authorizeIndex(request('192.0.2.20','192.0.2.1'),{writeHead:()=>{}}),false);
  assert.deepEqual(calls,['admit','index']);
  restore();
  assert.deepEqual(connection.admit(request('127.0.0.1')),{rejection:401});
  assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080/'),'http://127.0.0.1:3080/?token=secret');
});

test('local web auth bypass is inactive when the listener is not loopback',()=>{
  const connection:any={
    browserPeer:{id:'browser'},
    isTrusted:()=>true,
    admit:()=>({rejection:401}),
    authorizeIndex:()=>false,
    authenticatedUrl:(baseUrl:string)=>`${baseUrl}?token=secret`,
  };
  const restore=installLocalWebAuthBypass(connection,'192.0.2.1');
  assert.deepEqual(connection.admit(request('127.0.0.1','192.0.0.1')),{rejection:401});
  assert.equal(connection.authorizeIndex(request('127.0.0.1','127.0.0.1'),{writeHead:()=>{}}),false);
  assert.equal(connection.authenticatedUrl('http://192.0.2.1:3080/'),'http://192.0.2.1:3080/?token=secret');
  restore();
});
