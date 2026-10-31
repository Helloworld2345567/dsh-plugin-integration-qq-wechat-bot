import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { botSchema, configSchema, idSchema, type BotConfig, type BotInstance, type CallerScope, type InboundMessage, type SessionBinding, type SessionRecord, type Delivery, type Output, type Asset, type TurnMetric, type TurnSnapshot } from './types.js';
import {validateInboundMessage} from './limits.js';
import type {CursorStore,JsonValue} from './channel-ports.js';
import {SqliteStatsProjection} from './stats-projection.js';
import {decodeCursor,encodeCursor,filterHash} from './pagination.js';
import type {Page} from './repositories.js';
import {PersonaFiles,defaultPersonasRoot,sameConfig} from './personas.js';
import {assertGptSovitsReferenceCompatibility} from './voice-config.js';

export function scopeKey(scope: CallerScope): string { return createHash('sha256').update(JSON.stringify([scope.platform, scope.botId, scope.accountId, scope.kind, scope.channelId, scope.senderId])).digest('hex'); }
export class ConflictError extends Error { constructor(message='配置已被其他操作修改，请刷新后重试') { super(message); } }
export interface SessionActionRecordLike {id:string;scopeKey:string;scope:CallerScope;sessionId:string;state:string;createdAt:number;updatedAt:number;[key:string]:any}
export type StoreLifecycleStage='opened'|'initialized'|'migrated'|'recovered'|'started'|'closed';
export class Store {
  readonly db: DatabaseSync;
  readonly personas:PersonaFiles;
  stats!:SqliteStatsProjection;
  private stage:StoreLifecycleStage='opened';
  /** Composition-root entry point. Opening allocates the database; later stages perform schema and recovery work. */
  static open(home:string,personasRoot=defaultPersonasRoot(home),options:{secureDefaults?:boolean}={}):Store { return new Store(home,personasRoot,{...options,defer:true}); }
  constructor(readonly home: string,personasRoot=defaultPersonasRoot(home),readonly options:{secureDefaults?:boolean;defer?:boolean}={}) {
    const secureDefaults=options.secureDefaults===true;
    mkdirSync(home, { recursive:true }); this.db = new DatabaseSync(path.join(home, 'bots.sqlite'));
    this.personas=new PersonaFiles(personasRoot);
    if(options.defer)return;
    this.initializeStorage(secureDefaults);
  }
  private initializeStorage(secureDefaults:boolean):void {
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS inbox(scope TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,scope TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT 0,bot_id TEXT NOT NULL DEFAULT '',turn_id TEXT NOT NULL DEFAULT '',output_index INTEGER NOT NULL DEFAULT 0,UNIQUE(scope,id));
      CREATE TABLE IF NOT EXISTS memory(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source TEXT NOT NULL,quote TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS forgotten(scope TEXT NOT NULL,source TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(scope,source,key));
      CREATE TABLE IF NOT EXISTS memory_sources(scope TEXT NOT NULL,key TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(scope,key,source));
      CREATE TABLE IF NOT EXISTS asset_index(id TEXT PRIMARY KEY,scope TEXT NOT NULL,session TEXT,kind TEXT NOT NULL,created_at INTEGER NOT NULL,size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS collection_revisions(name TEXT PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_scope_state ON inbox(scope,state);
      CREATE INDEX IF NOT EXISTS records_kind_id ON records(kind,id);
      CREATE INDEX IF NOT EXISTS records_stats_native_session ON records(kind, json_extract(json,'$.sessionId')) WHERE kind='stats-native';
      CREATE INDEX IF NOT EXISTS records_stats_auxiliary_session ON records(kind, json_extract(json,'$.sessionId')) WHERE kind='stats-auxiliary';`);
    const deliveryColumns=new Set((this.db.prepare('PRAGMA table_info(deliveries)').all() as {name:string}[]).map(row=>row.name));for(const [name,sql] of [['created_at','INTEGER NOT NULL DEFAULT 0'],['bot_id',"TEXT NOT NULL DEFAULT ''"],['turn_id',"TEXT NOT NULL DEFAULT ''"],['output_index','INTEGER NOT NULL DEFAULT 0']] as const)if(!deliveryColumns.has(name))this.db.exec(`ALTER TABLE deliveries ADD COLUMN ${name} ${sql}`);
    for(const row of this.db.prepare("SELECT id,json FROM deliveries WHERE created_at=0 OR bot_id='' OR turn_id=''").all() as {id:string;json:string}[]){try{const delivery=JSON.parse(row.json) as Delivery;this.db.prepare('UPDATE deliveries SET created_at=?,bot_id=?,turn_id=?,output_index=? WHERE id=?').run(delivery.createdAt??0,delivery.botId??'',delivery.turnId??'',delivery.index??0,row.id);}catch{/* Invalid legacy rows remain at the deterministic tail. */}}
    this.db.exec('CREATE INDEX IF NOT EXISTS deliveries_state_scope ON deliveries(state,scope);CREATE INDEX IF NOT EXISTS deliveries_scope_state_id ON deliveries(scope,state,id);CREATE INDEX IF NOT EXISTS deliveries_bot_state_created ON deliveries(bot_id,state,created_at DESC,id DESC);CREATE INDEX IF NOT EXISTS deliveries_scope_created ON deliveries(scope,created_at DESC,id DESC);CREATE INDEX IF NOT EXISTS deliveries_turn_index ON deliveries(scope,turn_id,output_index,state);CREATE INDEX IF NOT EXISTS asset_scope_session_kind_created ON asset_index(scope,session,kind,created_at DESC,id DESC);');
    for(const row of this.db.prepare("SELECT id,json FROM records WHERE kind='asset'").all() as {id:string;json:string}[]){try{const asset=JSON.parse(row.json) as Asset;this.indexAsset(asset);}catch{/* Invalid legacy metadata remains inaccessible. */}}
    this.stats=new SqliteStatsProjection(this.db);
    for(const id of this.personas.ids()){
      // Preserve externally changed files and their journal; the panel exposes the recovery error.
      try{this.personas.recover(id,this.get<BotConfig>('config',id));}catch{}
    }
    if (!this.get('config','default')) {
      const hostTools=secureDefaults?false:undefined;
      const voiceDefaults={enabled:false,protocol:'edge_tts' as const,format:'mp3' as const};
      this.put('config', 'default', configSchema.parse({ id:'default', name:'默认', personaPrompt:'你是自然、真诚、具体的中文聊天伙伴。回应用户实际意图，默认简洁，任务结果按需要展开。不编造记忆、工具执行或媒体内容。保留工具、skills和运行环境信息。',media:{voice:voiceDefaults},...(hostTools===undefined?{}:{allowHostTools:hostTools}) }));
      this.put('config', 'sakura', configSchema.parse({ id:'sakura', name:'小樱', personaPrompt:'你是成年猫娘小樱：银白长发、翠绿色眼睛、白色猫耳和尾巴、黑白女仆装。自然简短地交流，日常文字尽量不超过100字，任务结果可以展开。按用户意图决定是否调用图片工具，每轮最多一张生成图。参考图编辑必须使用真实原图。不输出配图描述，不编造工具或媒体观察。',media:{voice:voiceDefaults},...(hostTools===undefined?{}:{allowHostTools:hostTools}) }));
    }
    for(const raw of this.list<BotConfig>('config')){
      const legacySpeech=(raw as any).media?.voice?.protocol==='speech';
      if(raw.schemaVersion!==3||legacySpeech){
        // Keep historical revisions intact; publish one migrated effective configuration.
        if(!this.get('config-version',`${raw.id}:${raw.revision}`))this.put('config-version',`${raw.id}:${raw.revision}`,raw);
        const media={...raw.media};for(const role of ['asr','video'] as const){if(media[role]&&('baseUrl' in media[role]||'keyEnv' in media[role]))media[role]={enabled:true,protocol:'chat_completions'};}
        // Voice output was not present in the previous schema.  Publish an
        // explicit, closed declaration so an upgrade cannot incur TTS usage.
        // A former OpenAI-compatible speech declaration is converted to the
        // keyless Edge TTS protocol while keeping voice disabled until the
        // operator explicitly enables it.
        media.voice={enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3'};
        const next=configSchema.parse({...raw,schemaVersion:3,media,tools:[...new Set([...(raw.tools??[]),'bot_voice'])],skills:[...new Set([...(raw.skills??[]),'media-analysis','voice-generation'])],revision:raw.revision+1});
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
    this.backfillSessions();this.stage='initialized';
  }
  lifecycleStage():StoreLifecycleStage{return this.stage;}
  initialize():this {if(this.stage==='closed')throw new Error('STORE_CLOSED');if(this.stage==='opened')this.initializeStorage(this.options.secureDefaults===true);return this;}
  migrate():this {this.initialize();if(this.stage!=='closed')this.stage='migrated';return this;}
  recover():void {if(this.stage==='closed')throw new Error('STORE_CLOSED');const sending=this.deliveries(['sending']);this.db.exec("UPDATE inbox SET state='interrupted' WHERE state='processing'; UPDATE deliveries SET state='unknown' WHERE state='sending'");for(const delivery of sending)this.stats.observeDelivery({...delivery,state:'unknown'});for(const delivery of this.deliveries(['pending']))if(delivery.purpose==='progress')this.deliveryState(delivery,'cancelled');this.stage='recovered';}
  start():this {if(this.stage==='closed')throw new Error('STORE_CLOSED');this.stage='started';return this;}
  close(): void {if(this.stage==='closed')return;this.stage='closed';this.db.close();}
  updateTurnMetric(id:string,patch:Partial<Omit<TurnMetric,'id'>>):void {
    const previous=this.get<TurnMetric>('turn-metric',id);const next={...previous,...patch,id} as TurnMetric;
    if(!next.scopeKey||!next.sourceId||!Number.isSafeInteger(next.receivedAt))throw new Error('TURN_METRIC_INVALID');
    if(previous&& (previous.scopeKey!==next.scopeKey||previous.sourceId!==next.sourceId||previous.receivedAt!==next.receivedAt)) throw new Error('TURN_METRIC_OWNERSHIP_MISMATCH');
    this.put('turn-metric',id,next);
  }
  markTurnStage(scope:string,ids:string[],field:Extract<keyof TurnMetric,`${string}At`>,at=Date.now()):void {
    for(const sourceId of ids){const id=`inbox:${scope}:${sourceId}`;if(this.get<TurnMetric>( 'turn-metric',id))this.updateTurnMetric(id,{[field]:at});}
  }
  metricPercentiles(field:Extract<keyof TurnMetric,`${string}At`>,from=0,to=Date.now()):{count:number;p50:number|null;p95:number|null;max:number|null}{
    const values=this.turnMetrics().map(metric=>{const start=metric.receivedAt;const end=metric[field];return typeof end==='number'&&start>=from&&end<=to?end-start:undefined}).filter((value):value is number=>value!==undefined).sort((a,b)=>a-b);
    const percentile=(rank:number)=>values.length?values[Math.min(values.length-1,Math.ceil(values.length*rank)-1)]:null;return{count:values.length,p50:percentile(.5),p95:percentile(.95),max:values.at(-1)??null};
  }
  turnMetrics():TurnMetric[]{return this.list<TurnMetric>('turn-metric');}
  updateTurnMetrics(scope:string,sourceIds:string[],patch:Partial<Omit<TurnMetric,'id'>>):void {
    for(const sourceId of sourceIds){const id=`inbox:${scope}:${sourceId}`;if(this.get<TurnMetric>('turn-metric',id))this.updateTurnMetric(id,patch);}
  }
  updateTurnMetricsByTurn(scope:string,turnId:string,patch:Partial<Omit<TurnMetric,'id'>>):void {
    for(const metric of this.turnMetrics())if(metric.scopeKey===scope&&metric.turnId===turnId)this.updateTurnMetric(metric.id,patch);
  }
  retain(now=Date.now(),windows={inbox:30,delivery:30,metric:30,failure:30}):{inbox:number;delivery:number;metric:number;failure:number}{
    const cutoff=(days:number)=>now-days*86_400_000;const result={inbox:0,delivery:0,metric:0,failure:0};
    const inboxRows=this.db.prepare('SELECT scope,id,json FROM inbox').all() as {scope:string;id:string;json:string}[];
    for(const row of inboxRows){const value=JSON.parse(row.json) as InboundMessage;if(value.timestamp<cutoff(windows.inbox)&&['complete','failed','cancelled','interrupted'].includes(String((this.db.prepare('SELECT state FROM inbox WHERE scope=? AND id=?').get(row.scope,row.id) as {state:string}).state))){result.inbox+=Number(this.db.prepare('DELETE FROM inbox WHERE scope=? AND id=?').run(row.scope,row.id).changes);}}
    const deliveries=this.deliveries();for(const delivery of deliveries){const at=delivery.updatedAt??delivery.createdAt??0;if(at<cutoff(windows.delivery)&&['sent','failed','cancelled','unknown'].includes(delivery.state))result.delivery+=Number(this.db.prepare('DELETE FROM deliveries WHERE id=?').run(delivery.id).changes);}
    for(const metric of this.turnMetrics()){const at=metric.sentAt??metric.modelCompletedAt??metric.receivedAt;if(at<cutoff(windows.metric)&&['complete','failed','cancelled'].includes(metric.state??''))result.metric+=Number(this.db.prepare("DELETE FROM records WHERE kind='turn-metric' AND id=?").run(metric.id).changes);}
    for(const row of this.db.prepare("SELECT id,json FROM records WHERE kind='failure'").all() as {id:string;json:string}[]){const failure=JSON.parse(row.json) as {at:number;state:string};if(failure.at<cutoff(windows.failure)&&['failed','cancelled'].includes(failure.state))result.failure+=Number(this.db.prepare("DELETE FROM records WHERE kind='failure' AND id=?").run(row.id).changes);}
    return result;
  }
  claimRuntime(owner:string):void {this.transaction(()=>{const previous=this.get<{owner:string;pid:number}>('runtime','owner');if(previous){let alive=true;try{process.kill(previous.pid,0);}catch(error){alive=(error as NodeJS.ErrnoException).code!=='ESRCH';}if(alive)throw new Error('此数据目录已有活动 Harness 消费实例');}this.put('runtime','owner',{owner,pid:process.pid});});}
  releaseRuntime(owner:string):void {this.transaction(()=>{if(this.get<{owner:string}>('runtime','owner')?.owner===owner)this.db.prepare("DELETE FROM records WHERE kind='runtime' AND id='owner'").run();});}
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE'); try { const value=fn(); this.db.exec('COMMIT'); return value; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  get<T>(kind:string,id:string):T|undefined { const row=this.db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id) as {json:string}|undefined; return row ? JSON.parse(row.json) as T : undefined; }
  list<T>(kind:string):T[] { return (this.db.prepare('SELECT json FROM records WHERE kind=? ORDER BY id').all(kind) as {json:string}[]).map(r=>JSON.parse(r.json) as T); }
  put(kind:string,id:string,value:unknown):void { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,id,JSON.stringify(value)); }
  findBinding(key:string):SessionBinding|undefined{return this.get('binding',key);}
  findSession(id:string):SessionRecord|undefined{return this.get('session',id);}
  findTurnSnapshot(id:string):TurnSnapshot|undefined{return this.get('turn-snapshot',id);}
  saveTurnSnapshot(id:string,value:TurnSnapshot):void{this.put('turn-snapshot',id,value);}
  failures():readonly Record<string,any>[] {return this.list('failure');}
  saveFailure(id:string,value:unknown):void{this.put('failure',id,value);}
  sessionActions<T extends SessionActionRecordLike=SessionActionRecordLike>():T[]{return this.list('session-action');}
  findSessionAction<T extends SessionActionRecordLike=SessionActionRecordLike>(id:string):T|undefined{return this.get('session-action',id);}
  saveSessionAction(id:string,value:SessionActionRecordLike):void{this.put('session-action',id,value);}
  jobs():readonly Record<string,any>[] {return this.list('job');}
  findJob(id:string):Record<string,any>|undefined{return this.get('job',id);}
  saveJob(id:string,value:unknown):void{this.put('job',id,value);}
  patchJob(id:string,patch:Record<string,unknown>):Record<string,unknown>{const next={...this.findJob(id),...patch};this.saveJob(id,next);return next;}
  consumeMediaQuota(key:string,limit:number):void{this.transaction(()=>{const used=this.get<number>('media-quota',key)??0;if(used>=limit)throw Error('MEDIA_DAILY_LIMIT');this.put('media-quota',key,used+1);});}
  saveAsset(asset:Asset):void{this.transaction(()=>{this.put('asset',asset.id,asset);this.indexAsset(asset);});}
  capabilityStatuses():readonly unknown[]{return this.list('capability-status');}
  saveCapabilityStatus(id:string,value:unknown):void{this.put('capability-status',id,value);}
  evolutionTasks<T>():T[]{return this.list('evolution');}
  saveEvolutionTask(id:string,value:unknown):void{this.put('evolution',id,value);}
  contentChanges<T>():T[]{return this.list('evolution-content');}
  findContentChange<T>(id:string):T|undefined{return this.get('evolution-content',id);}
  saveContentChange(id:string,value:unknown):void{this.put('evolution-content',id,value);}
  sessionsAll():SessionRecord[]{return this.list('session');}
  bindings():SessionBinding[]{return this.list('binding');}
  configVersions():readonly BotConfig[]{return this.list('config-version');}
  personaDirectory(id?:string):string{return this.personas.directory(id);}
  personaRoot():string{return this.personas.root;}
  readPersonaDraft(id:string){return this.personas.read(id);}
  storageHome():string{return this.home;}
  findTurnMetric(id:string):TurnMetric|undefined{return this.get('turn-metric',id);}
  statsSessionExists(id:string):boolean{return!!this.get('stats-session',id);}
  statsOwnedStart(id:string):number{return this.get<number>('stats-owned-start',id)??0;}
  saveStatsOwnedStart(id:string,value:number):void{this.put('stats-owned-start',id,value);}
  private revision(name:string):number{const row=this.db.prepare('SELECT revision FROM collection_revisions WHERE name=?').get(name) as {revision:number}|undefined;return row?.revision??0;}
  private bump(name:string):void{this.db.prepare('INSERT INTO collection_revisions VALUES(?,1) ON CONFLICT(name) DO UPDATE SET revision=revision+1').run(name);}
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
      assertGptSovitsReferenceCompatibility(value,this.configs());
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
  accept(message:InboundMessage):boolean {
    const validation=validateInboundMessage(message);if(validation)throw new Error(validation);
    const scope=scopeKey(message.scope);const accepted=this.db.prepare('INSERT OR IGNORE INTO inbox(scope,id,json) VALUES(?,?,?)').run(scope,message.id,JSON.stringify(message)).changes===1;
    if(accepted){this.updateTurnMetric(`inbox:${scope}:${message.id}`,{scopeKey:scope,sourceId:message.id,receivedAt:message.timestamp,state:'received'});this.stats.observeReceived(message);}
    return accepted;
  }
  messages(scope:string,states=['pending']):InboundMessage[] { return (this.db.prepare(`SELECT json FROM inbox WHERE scope=? AND state IN (${states.map(()=>'?').join(',')}) ORDER BY rowid`).all(scope,...states) as {json:string}[]).map(r=>JSON.parse(r.json)); }
  source(scope:string,id:string):InboundMessage|undefined { const r=this.db.prepare('SELECT json FROM inbox WHERE scope=? AND id=?').get(scope,id) as {json:string}|undefined; return r ? JSON.parse(r.json) : undefined; }
  updateMessage(scope:string,message:InboundMessage):void {this.db.prepare('UPDATE inbox SET json=? WHERE scope=? AND id=?').run(JSON.stringify(message),scope,message.id);}
  mark(scope:string,ids:string[],state:string):void {
    for(const id of ids){
      this.db.prepare('UPDATE inbox SET state=? WHERE scope=? AND id=?').run(state,scope,id);
      const metricId=`inbox:${scope}:${id}`;const metric=this.get<TurnMetric>('turn-metric',metricId);if(!metric)continue;
      const metricState=['received','processing','complete','failed','cancelled'].includes(state)?state as TurnMetric['state']:undefined;
      this.updateTurnMetric(metricId,{...(metricState?{state:metricState}:{}),queuedAt:metric.queuedAt??(state!=='received'?Date.now():undefined)});
    }
  }
  allMessages(states?:string[]):InboundMessage[]{const where=states?.length?` WHERE state IN (${states.map(()=>'?').join(',')})`:'';return(this.db.prepare(`SELECT json FROM inbox${where} ORDER BY rowid`).all(...(states??[])) as {json:string}[]).map(row=>JSON.parse(row.json) as InboundMessage);}
  recordCount(kind:string):number{return Number((this.db.prepare('SELECT COUNT(*) count FROM records WHERE kind=?').get(kind) as {count:number|bigint}).count);}
  cursorStore():CursorStore {return{read:(channelId,botId)=>this.get<JsonValue>('channel-cursor',`${channelId}:${botId}`)??this.get<JsonValue>('cursor',botId),write:(channelId,botId,value)=>this.transaction(()=>{this.put('channel-cursor',`${channelId}:${botId}`,value);this.put('cursor',botId,value);})};}
  scopesWithPending(states=['pending']):string[] { return (this.db.prepare(`SELECT DISTINCT scope FROM inbox WHERE state IN (${states.map(()=>'?').join(',')})`).all(...states) as {scope:string}[]).map(r=>r.scope); }
  binding(scope:CallerScope):SessionBinding { const key=scopeKey(scope); let b=this.get<SessionBinding>('binding',key); if(!b) { b={key,scope,sessionId:randomUUID(),generation:0,persisted:false,recentSince:Date.now()}; this.updateSession(b); } else this.recordSession(b); return b; }
  private recordSession(binding:SessionBinding):void {
    const previous=this.get<SessionRecord>('session',binding.sessionId);if(previous&&previous.scopeKey!==binding.key)throw new Error('SESSION_OWNERSHIP_MISMATCH');
    const now=Date.now();this.put('session',binding.sessionId,{id:binding.sessionId,scopeKey:binding.key,scope:binding.scope,generation:binding.generation,persisted:binding.persisted,createdAt:previous?.createdAt??now,updatedAt:now,personaId:binding.personaId,modelOverride:binding.modelOverride,recentSince:binding.recentSince} satisfies SessionRecord);
  }
  updateSession(binding:SessionBinding):SessionBinding {if(binding.key!==scopeKey(binding.scope))throw new Error('SESSION_OWNERSHIP_MISMATCH');this.recordSession(binding);this.put('binding',binding.key,binding);this.bump('sessions');return binding;}
  markSessionPersisted(binding:SessionBinding):void {const current=this.get<SessionBinding>('binding',binding.key);if(current?.sessionId===binding.sessionId)this.updateSession({...current,persisted:true});else{const record=this.session(binding.scope,binding.sessionId);this.put('session',record.id,{...record,persisted:true,updatedAt:Date.now()});}}
  private backfillSessions():void {
    const bindings=this.list<SessionBinding>('binding').filter(binding=>{
      const scope=binding?.scope;if(!scope||!idSchema.safeParse(scope.platform).success||!['private','group'].includes(scope.kind))return false;
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
  sessions(scope:CallerScope):SessionRecord[]{this.binding(scope);return this.list<SessionRecord>('session').filter(item=>item.scopeKey===scopeKey(scope)).sort((a,b)=>b.updatedAt-a.updatedAt||b.id.localeCompare(a.id));}
  pageSessions(filter:{scopeKey?:string},limit:number,cursor?:string):Page<SessionRecord>{const revision=this.revision('sessions'),fingerprint=filterHash(filter),keyset=decodeCursor(cursor,'sessions',fingerprint,revision),params:Array<string|number>=[];let where='';if(filter.scopeKey){where=' WHERE json_extract(json,\'$.scopeKey\')=?';params.push(filter.scopeKey);}if(keyset){where+=where?' AND ':' WHERE ';where+='(CAST(json_extract(json,\'$.updatedAt\') AS INTEGER)<? OR (CAST(json_extract(json,\'$.updatedAt\') AS INTEGER)=? AND id<?))';params.push(keyset.time,keyset.time,keyset.id);}const rows=this.db.prepare(`SELECT id,json FROM records${where}${where?' AND':' WHERE'} kind='session' ORDER BY CAST(json_extract(json,'$.updatedAt') AS INTEGER) DESC,id DESC LIMIT ?`).all(...params,limit+1) as {id:string;json:string}[],more=rows.length>limit,items=rows.slice(0,limit).map(row=>JSON.parse(row.json) as SessionRecord),last=items.at(-1);return{items,nextCursor:more&&last?encodeCursor({v:1,collection:'sessions',filter:fingerprint,revision,time:last.updatedAt,id:last.id}):null,revision:`sessions:${revision}`};}
  effectiveConfig(binding:SessionBinding):BotConfig {const config=this.config(binding.personaId??this.bot(binding.scope.botId).configId);return binding.modelOverride?{...config,model:{...binding.modelOverride}}:config;}
  recentSince(key:string):number{return this.get<SessionBinding>('binding',key)?.recentSince??0;}
  sessionRecentSince(key:string):number{return this.recentSince(key);}
  reset(scope:CallerScope):SessionBinding {const old=this.binding(scope);const next={...old,sessionId:randomUUID(),generation:old.generation+1,persisted:false,recentSince:Date.now()};return this.updateSession(next);}
  activateSession(scope:CallerScope,id:string):SessionBinding {const old=this.binding(scope);const record=this.session(scope,id);return this.updateSession({key:old.key,scope,sessionId:id,generation:old.generation+1,persisted:record.persisted,personaId:record.personaId,modelOverride:record.modelOverride,recentSince:record.recentSince});}
  enqueue(binding:SessionBinding,sourceId:string,turnId:string,outputs:Output[],reply:Record<string,string>,replyEnvelope?:Delivery['replyEnvelope'],progress?:NonNullable<Delivery['progress']>):void {
    // SAVEPOINT also works inside the foreground completion transaction.
    this.db.exec('SAVEPOINT enqueue_delivery');
    try{
    if(!progress)this.updateTurnMetrics(binding.key,[sourceId],{sessionId:binding.sessionId,turnId});
    // Asset registration is a durable claim.  A later turn may mention the
    // same generated asset again, but it must not create a second intent after
    // the first one was accepted, is still unresolved, or needs explicit
    // recovery.  `resend` is the deliberate escape hatch for a new intent.
    const claimedAssetIds=new Set((this.db.prepare("SELECT json_extract(json,'$.output.assetId') assetId FROM deliveries WHERE scope=? AND state IN ('pending','sending','unknown','failed','sent') AND json_extract(json,'$.output.type')='asset'").all(binding.key) as {assetId:string|null}[]).map(row=>row.assetId).filter((id):id is string=>!!id));
    outputs.forEach((output,index)=>{
      if(output.type==='asset'&&output.assetId&&!output.resend){
        if(claimedAssetIds.has(output.assetId))return;
        claimedAssetIds.add(output.assetId);
      }
      const id=createHash('sha256').update(JSON.stringify([binding.key,binding.sessionId,sourceId,turnId,index])).digest('hex');
      if(this.deliveryRepository().find(id))return;
      const replySequence=binding.scope.platform==='qq'?this.nextReplySequence(binding.scope.botId,replyEnvelope?.payload??reply):undefined;
      const now=Date.now();const d:Delivery={...(progress?{purpose:'progress' as const,progress}:{}),...(replySequence===undefined?{}:{replySequence}),id,scopeKey:binding.key,botId:binding.scope.botId,sessionId:binding.sessionId,sourceId,turnId,index,output,reply,...replyEnvelope?{replyEnvelope}:{},state:'pending',createdAt:now,updatedAt:now};
      const inserted=this.db.prepare('INSERT OR IGNORE INTO deliveries(id,scope,json,state,created_at,bot_id,turn_id,output_index) VALUES(?,?,?,?,?,?,?,?)').run(id,binding.key,JSON.stringify(d),'pending',now,d.botId,d.turnId,d.index).changes===1;if(inserted){this.stats.observeDelivery(d);this.bump('deliveries');}
    });
    this.db.exec('RELEASE enqueue_delivery');
    }catch(error){this.db.exec('ROLLBACK TO enqueue_delivery');this.db.exec('RELEASE enqueue_delivery');throw error;}
  }
  private nextReplySequence(botId:string,reply:Record<string,string>):number {
    const key=JSON.stringify([botId,reply.kind,reply.target,reply.msgId]);
    let previous=this.get<number>('reply-sequence',key);
    if(previous===undefined){
      const row=this.db.prepare("SELECT MAX(COALESCE(json_extract(json,'$.replySequence'),output_index+1)) value FROM deliveries WHERE bot_id=? AND COALESCE(json_extract(json,'$.replyEnvelope.payload.kind'),json_extract(json,'$.reply.kind'))=? AND COALESCE(json_extract(json,'$.replyEnvelope.payload.target'),json_extract(json,'$.reply.target'))=? AND COALESCE(json_extract(json,'$.replyEnvelope.payload.msgId'),json_extract(json,'$.reply.msgId'))=?").get(botId,reply.kind??'',reply.target??'',reply.msgId??'') as {value:number|null};
      previous=row.value??0;
    }
    const next=previous+1;this.put('reply-sequence',key,next);return next;
  }
  deliveries(states?:string[]):Delivery[] { const where=states?.length ? ` WHERE state IN (${states.map(()=>'?').join(',')})` : ''; return (this.db.prepare(`SELECT json,state FROM deliveries${where} ORDER BY rowid`).all(...(states??[])) as {json:string;state:Delivery['state']}[]).map(r=>({...JSON.parse(r.json),state:r.state})); }
  deliveryRepository(){
    const decode=(rows:{json:string;state:Delivery['state']}[])=>rows.map(row=>({...JSON.parse(row.json),state:row.state} as Delivery));
    return{
      count:(states:readonly string[])=>Number((this.db.prepare(`SELECT COUNT(*) count FROM deliveries WHERE state IN (${states.map(()=>'?').join(',')})`).get(...states) as {count:number|bigint}).count),
      pendingBotIds:()=>(this.db.prepare("SELECT DISTINCT bot_id id FROM deliveries WHERE state='pending' AND bot_id<>''").all() as {id:string}[]).map(row=>row.id),
      // Unknown and failed rows are no longer permanent barriers. They have
      // already left the pending queue, so later outputs may make progress
      // while the original row is reconciled or explicitly retried.
      nextSendable:(botId:string,limit:number)=>decode(this.db.prepare(`SELECT json,state FROM deliveries pending WHERE bot_id=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM deliveries blocker WHERE blocker.scope=pending.scope AND blocker.turn_id=pending.turn_id AND blocker.output_index<pending.output_index AND blocker.state IN ('pending','sending')) ORDER BY created_at,id LIMIT ?`).all(botId,limit) as {json:string;state:Delivery['state']}[]),
      find:(id:string,state?:Delivery['state'])=>{const row=this.db.prepare(`SELECT json,state FROM deliveries WHERE id=?${state?' AND state=?':''}`).get(id,...(state?[state]:[])) as {json:string;state:Delivery['state']}|undefined;return row?decode([row])[0]:undefined;},
      findByAsset:(scopeKey:string,assetId:string,states?:readonly Delivery['state'][]):readonly Delivery[]=>{
        const selected=states?.length?states:['pending','sending','unknown','failed','sent'] as const;
        if(!selected.length)return[];
        const placeholders=selected.map(()=>'?').join(',');
        return decode(this.db.prepare(`SELECT json,state FROM deliveries WHERE scope=? AND json_extract(json,'$.output.type')='asset' AND json_extract(json,'$.output.assetId')=? AND state IN (${placeholders}) ORDER BY created_at,id`).all(scopeKey,assetId,...selected) as {json:string;state:Delivery['state']}[]);
      },
      retry:(id:string):Delivery|undefined=>this.retryDelivery(id),
      hasEarlierBlocker:(delivery:Delivery)=>!!this.db.prepare("SELECT 1 FROM deliveries WHERE scope=? AND turn_id=? AND output_index<? AND state IN ('pending','sending') LIMIT 1").get(delivery.scopeKey,delivery.turnId,delivery.index),
      pageDeliveries:(request:any)=>{const revision=this.revision('deliveries'),fingerprint=filterHash(request.filter),cursor=decodeCursor(request.cursor,'deliveries',fingerprint,revision),conditions:string[]=[],params:Array<string|number>=[];if(request.filter.scopeKey){conditions.push('scope=?');params.push(request.filter.scopeKey);}if(request.filter.botId){conditions.push('bot_id=?');params.push(request.filter.botId);}if(request.filter.states?.length){conditions.push(`state IN (${request.filter.states.map(()=>'?').join(',')})`);params.push(...request.filter.states);}if(cursor){conditions.push('(created_at<? OR (created_at=? AND id<?))');params.push(cursor.time,cursor.time,cursor.id);}const rows=decode(this.db.prepare(`SELECT json,state FROM deliveries${conditions.length?' WHERE '+conditions.join(' AND '):''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params,request.limit+1) as {json:string;state:Delivery['state']}[]),more=rows.length>request.limit,items=rows.slice(0,request.limit),last=items.at(-1);return{items,nextCursor:more&&last?encodeCursor({v:1,collection:'deliveries',filter:fingerprint,revision,time:last.createdAt??0,id:last.id}):null,revision:`deliveries:${revision}`};},
    };
  }
  retryDelivery(id:string):Delivery|undefined {
    const row=this.db.prepare('SELECT json,state FROM deliveries WHERE id=?').get(id) as {json:string;state:Delivery['state']}|undefined;
    if(!row||!['unknown','failed'].includes(row.state))return;
    const current={...JSON.parse(row.json),state:row.state} as Delivery;
    if(current.purpose==='progress')throw new Error('PROGRESS_DELIVERY_EXPIRED');
    const next:Delivery={...current,state:'pending',receipt:undefined,error:undefined,sentAt:undefined,updatedAt:Date.now()};
    const changed=this.db.prepare("UPDATE deliveries SET json=?,state=? WHERE id=? AND state IN ('unknown','failed')").run(JSON.stringify(next),'pending',id).changes;
    if(!changed)return this.deliveryRepository().find(id);
    this.stats.observeDelivery(next);this.bump('deliveries');return next;
  }
  deliveryState(delivery:Delivery,state:Delivery['state'],receipt?:string,error?:string):void {const now=Date.now();const next={...delivery,state,receipt,error,updatedAt:now,...(state==='sent'?{sentAt:now}:{})};this.db.prepare('UPDATE deliveries SET json=?,state=? WHERE id=?').run(JSON.stringify(next),state,delivery.id);this.stats.observeDelivery(next);this.bump('deliveries'); }
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
  indexAsset(asset:Asset):void{this.db.prepare('INSERT INTO asset_index VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,session=excluded.session,kind=excluded.kind,created_at=excluded.created_at,size=excluded.size').run(asset.id,asset.scopeKey,asset.sessionId??null,asset.kind,asset.createdAt,asset.size);}
  assetUsage(scope:string):{scope:number;total:number}{const owned=this.db.prepare('SELECT COALESCE(SUM(size),0) value FROM asset_index WHERE scope=?').get(scope) as {value:number|bigint},total=this.db.prepare('SELECT COALESCE(SUM(size),0) value FROM asset_index').get() as {value:number|bigint};return{scope:Number(owned.value),total:Number(total.value)};}
  recentAssets(scope:string,sessionId:string,kind?:string,limit=24):Asset[]{const rows=this.db.prepare(`SELECT a.id,r.json FROM asset_index a JOIN records r ON r.kind='asset' AND r.id=a.id WHERE a.scope=? AND a.session=?${kind?' AND a.kind=?':''} AND a.created_at>? ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).all(scope,sessionId,...(kind?[kind]:[]),Date.now()-600000,limit) as {id:string;json:string}[];const result:Asset[]=[];for(const row of rows){const asset=JSON.parse(row.json) as Asset;if(asset.scopeKey!==scope||asset.sessionId!==sessionId||kind&&asset.kind!==kind){this.indexAsset(asset);continue;}result.push(asset);}return result;}
  asset(scope:string,id:string):Asset { const asset=this.get<Asset>('asset',id); if(!asset || asset.scopeKey!==scope) throw new Error('附件不存在或不属于当前会话'); return asset; }
}
