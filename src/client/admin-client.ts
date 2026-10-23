export interface AdminTransport {
  fetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>;
}
export interface AdminClientOptions {endpoint:string;token:string;transport?:AdminTransport}
export interface VersionedResponse<T>{version:number;contractVersion:number;revision:string;changedSince?:string;unchanged?:boolean;data?:T}
export class AdminClient {
  private readonly transport:AdminTransport;
  private readonly inFlight=new Map<string,{promise:Promise<unknown>;controller:AbortController;sequence:number}>();
  private readonly sequences=new Map<string,number>();
  private readonly revisions=new Map<string,string>();
  private readonly cache=new Map<string,unknown>();
  constructor(readonly options:AdminClientOptions){this.transport=options.transport??{fetch};}
  private key(name:string,input:unknown):string{return JSON.stringify([name,input]);}
  query<T>(name:string,input:Record<string,unknown>={},signal?:AbortSignal):Promise<T|undefined>{
    const key=this.key(name,input);const existing=this.inFlight.get(key);if(existing)return existing.promise as Promise<T|undefined>;
    const controller=new AbortController();const sequence=(this.sequences.get(key)??0)+1;this.sequences.set(key,sequence);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const request=(async():Promise<T|undefined>=>{
      const revision=this.revisions.get(key);const body={version:1,kind:'query',name,input:revision&&!('changedSince'in input)?{...input,changedSince:revision}:input};
      const response=await this.transport.fetch(this.options.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.options.token}`},body:JSON.stringify(body),signal:combined});
      const responseBody=await response.json() as {result?:VersionedResponse<T>;error?:unknown}|VersionedResponse<T>;if(!response.ok)throw new Error(typeof (responseBody as any).error==='string'?(responseBody as any).error:'ADMIN_QUERY_FAILED');const payload=('result'in responseBody&&responseBody.result?responseBody.result:responseBody) as VersionedResponse<T>;
      if(this.sequences.get(key)!==sequence)return undefined;
      if(typeof payload.revision==='string')this.revisions.set(key,payload.revision);
      if(payload.unchanged)return this.cache.get(key) as T|undefined;
      if(payload.data!==undefined)this.cache.set(key,payload.data);return payload.data;
    })();
    this.inFlight.set(key,{promise:request,controller,sequence});void request.then(()=>this.clear(key,request),()=>this.clear(key,request));return request;
  }
  private clear(key:string,promise:Promise<unknown>):void{if(this.inFlight.get(key)?.promise===promise)this.inFlight.delete(key);}
  cancel(name:string,input:Record<string,unknown>={}):void{const key=this.key(name,input);const entry=this.inFlight.get(key);if(entry){entry.controller.abort();this.inFlight.delete(key);}}
  invalidate(name:string,input:Record<string,unknown>={}):void{const key=this.key(name,input);this.revisions.delete(key);this.cache.delete(key);this.cancel(name,input);}
}
