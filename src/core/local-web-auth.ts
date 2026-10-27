interface WebRequest {
  method?:string;
  socket?:{remoteAddress?:string;localAddress?:string};
}

interface WebConnection {
  browserPeer:unknown;
  disposed?:boolean;
  isTrusted(request:unknown):boolean;
  admit(request:unknown):unknown;
  authorizeIndex(request:unknown,response:unknown):boolean;
  authenticatedUrl(baseUrl:string):string;
}

function loopbackAddress(value:unknown):boolean {
  if(typeof value!=='string')return false;
  const address=value.replace(/^::ffff:/i,'');
  if(address==='::1')return true;
  const parts=address.split('.');
  return parts.length===4&&parts[0]==='127'&&parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255);
}

export function loopbackWebRequest(request:WebRequest):boolean {
  return loopbackAddress(request.socket?.remoteAddress)&&loopbackAddress(request.socket?.localAddress);
}

function loopbackListener(host:unknown):boolean {
  if(typeof host!=='string')return false;
  const address=host.replace(/^::ffff:/i,'').split('%',1)[0];
  if(address==='::1')return true;
  const parts=address.split('.');
  return parts.length===4&&parts[0]==='127'&&parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255);
}

/** Allow an unauthenticated browser only across a loopback-only Web listener. */
export function installLocalWebAuthBypass(connection:WebConnection,listenerHost:string):()=>void {
  if(!loopbackListener(listenerHost))return()=>{};
  const originalAdmit=connection.admit;
  const originalAuthorizeIndex=connection.authorizeIndex;
  const originalAuthenticatedUrl=connection.authenticatedUrl;
  connection.admit=function(request:unknown){
    if(!connection.disposed&&loopbackWebRequest(request as WebRequest)&&connection.isTrusted(request))return{peer:connection.browserPeer};
    return originalAdmit.call(connection,request);
  };
  connection.authorizeIndex=function(request:unknown,response:unknown){
    if(loopbackWebRequest(request as WebRequest)&&connection.isTrusted(request)&&((request as WebRequest).method??'GET')==='GET')return true;
    return originalAuthorizeIndex.call(connection,request,response);
  };
  connection.authenticatedUrl=(baseUrl:string)=>baseUrl;
  return()=>{
    connection.admit=originalAdmit;
    connection.authorizeIndex=originalAuthorizeIndex;
    connection.authenticatedUrl=originalAuthenticatedUrl;
  };
}
