import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { botSchema, configSchema, type BotConfig, type BotInstance, type CallerScope, type InboundMessage, type SessionBinding, type SessionRecord, type Delivery, type Output, type Asset } from './types.js';
import {PersonaFiles,defaultPersonasRoot,sameConfig} from './personas.js';

export function scopeKey(scope: CallerScope): string { return createHash('sha256').update(JSON.stringify([scope.platform, scope.botId, scope.accountId, scope.kind, scope.channelId, scope.senderId])).digest('hex'); }
export class ConflictError extends Error { constructor(message='配置已被其他操作修改，请刷新后重试') { super(message); } }
export class Store {
  readonly db: DatabaseSync;
  readonly personas:PersonaFiles;
  constructor(readonly home: string,personasRoot=defaultPersonasRoot(home)) {
    mkdirSync(home, { recursive:true }); this.db = new DatabaseSync(path.join(home, 'bots.sqlite'));
    this.personas=new PersonaFiles(personasRoot);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS inbox(scope TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,scope TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL,UNIQUE(scope,id));
      CREATE TABLE IF NOT EXISTS memory(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source TEXT NOT NULL,quote TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS forgotten(scope TEXT NOT NULL,source TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(scope,source,key));
      CREATE TABLE IF NOT EXISTS memory_sources(scope TEXT NOT NULL,key TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(scope,key,source));`);
    for(const id of this.personas.ids()){
      // Preserve externally changed files and their journal; the panel exposes the recovery error.
      try{this.personas.recover(id,this.get<BotConfig>('config',id));}catch{}
    }
    if (!this.get('config','default')) {
      this.put('config', 'default', configSchema.parse({ id:'default', name:'默认', personaPrompt:'你是自然、真诚、具体的中文聊天伙伴。回应用户实际意图，默认简洁，任务结果按需要展开。不编造记忆、工具执行或媒体内容。保留工具、skills和运行环境信息。' }));
      this.put('config', 'sakura', configSchema.parse({ id:'sakura', name:'小樱', personaPrompt:'你是成年猫娘小樱：银白长发、翠绿色眼睛、白色猫耳和尾巴、黑白女仆装。自然简短地交流，日常文字尽量不超过100字，任务结果可以展开。按用户意图决定是否调用图片工具，每轮最多一张生成图。参考图编辑必须使用真实原图。不输出配图描述，不编造工具或媒体观察。' }));
    }
    for(const raw of this.list<BotConfig>('config')){
      if(raw.schemaVersion!==2){
        // Keep historical revisions intact; publish one migrated effective configuration.
        if(!this.get('config-version',`${raw.id}:${raw.revision}`))this.put('config-version',`${raw.id}:${raw.revision}`,raw);
        const media={...raw.media};for(const role of ['asr','video'] as const){if(media[role]&&('baseUrl' in media[role]||'keyEnv' in media[role]))media[role]={enabled:true,protocol:'chat_completions'};}
        const next=configSchema.parse({...raw,media,skills:[...new Set([...raw.skills,'media-analysis'])],revision:raw.revision+1});
        this.transaction(()=>{this.put('config-version',`${next.id}:${next.revision}`,next);this.put('config',next.id,next);});
      }
    }
    for(const config of this.configs())if(!this.get('config-version',`${config.id}:${config.revision}`))this.put('config-version',`${config.id}:${config.revision}`,config);
    for(const config of this.configs()){
      try{
        const baseline=this.get<{digest:string}>('persona-files',config.id);
        const unchanged=baseline?.digest===this.personas.currentDigest(config.id);
        if(!this.personas.hasFiles(config.id)||(unchanged&&!sameConfig(this.personas.read(config.id).config,config)))this.personas.publish(config,fingerprint=>this.transaction(()=>this.put('persona-files',config.id,{digest:fingerprint})));
        else if(!this.get('persona-files',config.id)&&sameConfig(this.personas.read(config.id).config,config))this.put('persona-files',config.id,{digest:this.personas.currentDigest(config.id)});
      }catch{/* An invalid draft must not stop bots using the last applied configuration. */}
    }
    this.backfillSessions();
  }
  close(): void { this.db.close(); }
  recover():void {this.db.exec("UPDATE inbox SET state='interrupted' WHERE state='processing'; UPDATE deliveries SET state='unknown' WHERE state='sending'");}
  claimRuntime(owner:string):void {this.transaction(()=>{const previous=this.get<{owner:string;pid:number}>('runtime','owner');if(previous){let alive=true;try{process.kill(previous.pid,0);}catch(error){alive=(error as NodeJS.ErrnoException).code!=='ESRCH';}if(alive)throw new Error('此数据目录已有活动 Harness 消费实例');}this.put('runtime','owner',{owner,pid:process.pid});});}
  releaseRuntime(owner:string):void {this.transaction(()=>{if(this.get<{owner:string}>('runtime','owner')?.owner===owner)this.db.prepare("DELETE FROM records WHERE kind='runtime' AND id='owner'").run();});}
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE'); try { const value=fn(); this.db.exec('COMMIT'); return value; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  get<T>(kind:string,id:string):T|undefined { const row=this.db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id) as {json:string}|undefined; return row ? JSON.parse(row.json) as T : undefined; }
  list<T>(kind:string):T[] { return (this.db.prepare('SELECT json FROM records WHERE kind=? ORDER BY id').all(kind) as {json:string}[]).map(r=>JSON.parse(r.json) as T); }
  put(kind:string,id:string,value:unknown):void { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,id,JSON.stringify(value)); }
  configs():BotConfig[] { return this.list<BotConfig>('config').map(c=>configSchema.parse(c)); }
  config(id:string):BotConfig { const c=this.get<BotConfig>('config',id); if (!c || c.archived) throw new Error('配置不存在或已归档'); return configSchema.parse(c); }
  personaStatus(id:string):{id:string;directory:string;state:'synced'|'draft'|'error';error?:string} {
    try{
      const directory=this.personas.directory(id);const file=this.personas.read(id);const baseline=this.get<{digest:string}>('persona-files',id);
      return{id,directory,state:baseline?.digest===file.digest&&sameConfig(file.config,this.get<BotConfig>('config',id)!)?'synced':'draft'};
    }catch(error){return{id,directory:path.join(this.personas.root,id),state:'error',error:error instanceof Error?error.message:'PERSONA_FILES_INVALID'};}
  }
  saveConfig(input:unknown,expectedRevision?:number,fileDigest?:string):BotConfig {
    const value=configSchema.parse(input);
    const check=()=>{
      const previous=this.get<BotConfig>('config',value.id);
      if(previous && previous.revision!==expectedRevision) throw new ConflictError();
      if(value.archived && (this.bots().some(b=>!b.archived && b.configId===value.id)||this.list<SessionBinding>('binding').some(b=>b.personaId===value.id))) throw new Error('请先解除机器人或活动会话配置绑定');
      return previous;
    };
    this.personas.recover(value.id,this.get<BotConfig>('config',value.id));
    const previous=check();const baseline=this.get<{digest:string}>('persona-files',value.id);
    if(fileDigest!==undefined){
      if(this.personas.read(value.id).digest!==fileDigest)throw new ConflictError('人格文件在校验期间被修改，请重新应用');
    }else if(this.personas.hasFiles(value.id)&&(!baseline||this.personas.currentDigest(value.id)!==baseline.digest))throw new ConflictError('人格文件有未应用修改，请先校验并应用文件，或恢复文件后再保存面板');
    if(fileDigest!==undefined&&previous&&sameConfig(previous,value)){
      this.transaction(()=>{check();this.put('persona-files',value.id,{digest:fileDigest});});return previous;
    }
    const next={...value,revision:previous ? previous.revision+1 : 1};
    return this.personas.publish(next,fingerprint=>this.transaction(()=>{
      check();this.put('config-version',`${next.id}:${next.revision}`,next);this.put('config',next.id,next);this.put('persona-files',next.id,{digest:fingerprint});return next;
    }));
  }
  bots():BotInstance[] { return this.list<BotInstance>('bot'); }
  bot(id:string):BotInstance { const bot=this.get<BotInstance>('bot',id); if(!bot) throw new Error('机器人不存在'); return bot; }
  saveBot(input:unknown):BotInstance {
    const value=botSchema.parse(input); this.config(value.configId);
    return this.transaction(()=>{
      if(value.accountId && this.bots().some(b=>b.id!==value.id && !b.archived && b.channel===value.channel && b.accountId===value.accountId)) throw new Error('该平台账号已经绑定其他机器人');
      const previous=this.get<BotInstance>('bot',value.id);
      if(previous&&(previous.channel!==value.channel||(previous.accountId&&previous.accountId!==value.accountId)))throw new Error('已有机器人的渠道身份不可修改；请创建新机器人');
      this.put('bot',value.id,value); return value;
    });
  }
  accept(message:InboundMessage):boolean { const scope=scopeKey(message.scope); return this.db.prepare('INSERT OR IGNORE INTO inbox(scope,id,json) VALUES(?,?,?)').run(scope,message.id,JSON.stringify(message)).changes===1; }
  messages(scope:string,states=['pending']):InboundMessage[] { return (this.db.prepare(`SELECT json FROM inbox WHERE scope=? AND state IN (${states.map(()=>'?').join(',')}) ORDER BY rowid`).all(scope,...states) as {json:string}[]).map(r=>JSON.parse(r.json)); }
  source(scope:string,id:string):InboundMessage|undefined { const r=this.db.prepare('SELECT json FROM inbox WHERE scope=? AND id=?').get(scope,id) as {json:string}|undefined; return r ? JSON.parse(r.json) : undefined; }
  updateMessage(scope:string,message:InboundMessage):void {this.db.prepare('UPDATE inbox SET json=? WHERE scope=? AND id=?').run(JSON.stringify(message),scope,message.id);}
  mark(scope:string,ids:string[],state:string):void { for(const id of ids) this.db.prepare('UPDATE inbox SET state=? WHERE scope=? AND id=?').run(state,scope,id); }
  scopesWithPending(states=['pending']):string[] { return (this.db.prepare(`SELECT DISTINCT scope FROM inbox WHERE state IN (${states.map(()=>'?').join(',')})`).all(...states) as {scope:string}[]).map(r=>r.scope); }
  binding(scope:CallerScope):SessionBinding { const key=scopeKey(scope); let b=this.get<SessionBinding>('binding',key); if(!b) { b={key,scope,sessionId:randomUUID(),generation:0,persisted:false,recentSince:Date.now()}; this.updateSession(b); } else this.recordSession(b); return b; }
  private recordSession(binding:SessionBinding):void {
    const previous=this.get<SessionRecord>('session',binding.sessionId);if(previous&&previous.scopeKey!==binding.key)throw new Error('SESSION_OWNERSHIP_MISMATCH');
    const now=Date.now();this.put('session',binding.sessionId,{id:binding.sessionId,scopeKey:binding.key,scope:binding.scope,generation:binding.generation,persisted:binding.persisted,createdAt:previous?.createdAt??now,updatedAt:now,personaId:binding.personaId,modelOverride:binding.modelOverride,recentSince:binding.recentSince} satisfies SessionRecord);
  }
  updateSession(binding:SessionBinding):SessionBinding {if(binding.key!==scopeKey(binding.scope))throw new Error('SESSION_OWNERSHIP_MISMATCH');this.recordSession(binding);this.put('binding',binding.key,binding);return binding;}
  markSessionPersisted(binding:SessionBinding):void {const current=this.get<SessionBinding>('binding',binding.key);if(current?.sessionId===binding.sessionId)this.updateSession({...current,persisted:true});else{const record=this.session(binding.scope,binding.sessionId);this.put('session',record.id,{...record,persisted:true,updatedAt:Date.now()});}}
  private backfillSessions():void {
    const bindings=this.list<SessionBinding>('binding').filter(binding=>{
      const scope=binding?.scope;if(!scope||!['qq','weixin'].includes(scope.platform)||!['private','group'].includes(scope.kind))return false;
      if(![scope.botId,scope.accountId,scope.channelId,scope.senderId,binding.sessionId].every(value=>typeof value==='string'&&value.length>0))return false;
      return binding.key===scopeKey(scope);
    });
    for(const binding of bindings)this.recordSession(binding);
    // Delivery rows prove an old session belongs to an existing channel identity; no global history scan.
    for(const delivery of this.deliveries()){
      if(this.get('session',delivery.sessionId))continue;const owner=bindings.find(b=>b.key===delivery.scopeKey&&b.scope.botId===delivery.botId);if(!owner)continue;
      this.put('session',delivery.sessionId,{id:delivery.sessionId,scopeKey:owner.key,scope:owner.scope,generation:0,persisted:true,createdAt:delivery.createdAt??0,updatedAt:delivery.updatedAt??delivery.createdAt??0} satisfies SessionRecord);
    }
  }
  session(scope:CallerScope,id:string):SessionRecord {const record=this.get<SessionRecord>('session',id);if(!record||record.scopeKey!==scopeKey(scope))throw new Error('会话不存在或不属于当前渠道身份');return record;}
  sessions(scope:CallerScope):SessionRecord[]{this.binding(scope);return this.list<SessionRecord>('session').filter(item=>item.scopeKey===scopeKey(scope)).sort((a,b)=>b.updatedAt-a.updatedAt);}
  effectiveConfig(binding:SessionBinding):BotConfig {const config=this.config(binding.personaId??this.bot(binding.scope.botId).configId);return binding.modelOverride?{...config,model:{...binding.modelOverride}}:config;}
  recentSince(key:string):number{return this.get<SessionBinding>('binding',key)?.recentSince??0;}
  sessionRecentSince(key:string):number{return this.recentSince(key);}
  reset(scope:CallerScope):SessionBinding {const old=this.binding(scope);const next={...old,sessionId:randomUUID(),generation:old.generation+1,persisted:false,recentSince:Date.now()};return this.updateSession(next);}
  activateSession(scope:CallerScope,id:string):SessionBinding {const old=this.binding(scope);const record=this.session(scope,id);return this.updateSession({key:old.key,scope,sessionId:id,generation:old.generation+1,persisted:record.persisted,personaId:record.personaId,modelOverride:record.modelOverride,recentSince:record.recentSince});}
  enqueue(binding:SessionBinding,sourceId:string,turnId:string,outputs:Output[],reply:Record<string,string>):void {
    outputs.forEach((output,index)=>{
      const id=createHash('sha256').update(JSON.stringify([binding.key,binding.sessionId,sourceId,turnId,index])).digest('hex');
      const now=Date.now();const d:Delivery={id,scopeKey:binding.key,botId:binding.scope.botId,sessionId:binding.sessionId,sourceId,turnId,index,output,reply,state:'pending',createdAt:now,updatedAt:now};
      this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?)').run(id,binding.key,JSON.stringify(d),'pending');
    });
  }
  deliveries(states?:string[]):Delivery[] { const where=states?.length ? ` WHERE state IN (${states.map(()=>'?').join(',')})` : ''; return (this.db.prepare(`SELECT json,state FROM deliveries${where} ORDER BY rowid`).all(...(states??[])) as {json:string;state:Delivery['state']}[]).map(r=>({...JSON.parse(r.json),state:r.state})); }
  deliveryState(delivery:Delivery,state:Delivery['state'],receipt?:string,error?:string):void {const now=Date.now();this.db.prepare('UPDATE deliveries SET json=?,state=? WHERE id=?').run(JSON.stringify({...delivery,state,receipt,error,updatedAt:now,...(state==='sent'?{sentAt:now}:{})}),state,delivery.id); }
  remember(scope:string,key:string,value:string,source:string,quote:string):void {
    if(!key.trim() || key.length>100 || value.length>500) throw new Error('记忆长度无效');
    const input=this.source(scope,source);
    if(!input || !quote.trim() || !input.text.split(/\r?\n/).some(line=>line.trim()===quote.trim()) || !/^(?:我(?:喜欢|不喜欢|希望|习惯|偏好|叫|是)|请记住|以后|下次|每次|不要再)/.test(quote.trim()) || /(?:网页|转发|引用|工具结果|以下内容|```|https?:\/\/)/.test(input.text)) throw new Error('记忆必须来自用户本人表达的稳定偏好，并提供完整原文行');
    if(this.db.prepare("SELECT 1 FROM forgotten WHERE scope=? AND source=? AND key IN (?, '*')").get(scope,source,key)) throw new Error('该来源的记忆已被删除或更正');
    this.db.prepare('INSERT OR IGNORE INTO memory_sources VALUES(?,?,?)').run(scope,key,source);
    this.db.prepare('INSERT INTO memory VALUES(?,?,?,?,?,1,0,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,source=excluded.source,quote=excluded.quote,version=memory.version+1,deleted=0,updated=excluded.updated').run(scope,key,value,source,quote,Date.now());
  }
  memories(scope:string):Record<string,unknown>[] { return this.db.prepare('SELECT key,value,source,quote,version,updated FROM memory WHERE scope=? AND deleted=0 ORDER BY updated DESC LIMIT 30').all(scope) as Record<string,unknown>[]; }
  private blockMemorySources(scope:string,key:string):void {const rows=this.db.prepare('SELECT source FROM memory_sources WHERE scope=? AND key=? UNION SELECT source FROM memory WHERE scope=? AND key=?').all(scope,key,scope,key) as {source:string}[];for(const row of rows)this.db.prepare('INSERT OR IGNORE INTO forgotten VALUES(?,?,?)').run(scope,row.source,'*');}
  correctMemory(scope:string,key:string,value:string,version:number):void {this.transaction(()=>{const result=this.db.prepare('UPDATE memory SET value=?,version=version+1,updated=? WHERE scope=? AND key=? AND version=? AND deleted=0').run(value,Date.now(),scope,key,version);if(result.changes!==1)throw new ConflictError();this.blockMemorySources(scope,key);});}
  forget(scope:string,key:string):void { this.transaction(()=>{this.blockMemorySources(scope,key);this.db.prepare('UPDATE memory SET deleted=1,updated=? WHERE scope=? AND key=?').run(Date.now(),scope,key);}); }
  asset(scope:string,id:string):Asset { const asset=this.get<Asset>('asset',id); if(!asset || asset.scopeKey!==scope) throw new Error('附件不存在或不属于当前会话'); return asset; }
}
