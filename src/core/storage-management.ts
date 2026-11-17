import {rm} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {assetFolder} from './media-paths.js';
import type {Asset} from './types.js';
import type {RuntimeRepositories} from './ports/application.js';

const botId=z.string().min(1).max(80);
export const workspaceStorageFilterSchema=z.object({botId,kind:z.enum(['image','video','audio','file']).optional(),origin:z.enum(['received','generated','sent']).optional(),before:z.number().int().positive().optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(100)}).strict();
export const workspaceStorageCleanupSchema=z.object({botId,assetIds:z.array(z.string().min(1).max(200)).min(1).max(200)}).strict();
export const workspaceStoragePinSchema=z.object({botId,assetId:z.string().min(1).max(200),pinned:z.boolean()}).strict();
export type StorageFilter=z.input<typeof workspaceStorageFilterSchema>;
export type StorageProtection='retained'|'current-session'|'active-task'|'delivery';
type StorageRepos=Pick<RuntimeRepositories,'bots'|'sessions'|'media'|'deliveries'|'botHistory'>;
const originOf=(asset:Asset)=>asset.origin??(asset.jobId?'generated':'received');
const amount=(assets:readonly Asset[])=>({count:assets.length,bytes:assets.reduce((sum,asset)=>sum+asset.size,0)});

/** Operator storage controls only act on registered, bot-owned media. */
export class WorkspaceStorageService {
  constructor(readonly repos:StorageRepos,readonly scopeBusy:(scope:string)=>boolean=()=>false){}
  private owned(bot:string):Asset[]{
    this.repos.bots.bot(bot);
    const scopes=this.repos.botHistory.snapshot(bot).scopes;
    return this.repos.media.assets.allAssets().filter(asset=>scopes.has(asset.scopeKey));
  }
  private protections():(asset:Asset)=>StorageProtection|undefined{
    const current=new Map(this.repos.sessions.bindings().map(binding=>[binding.key,binding.sessionId]));
    const jobs=this.repos.media.jobs.jobs().filter(job=>['queued','running'].includes(job.state??'')),scopes=new Set(jobs.map(job=>job.scope)),jobIds=new Set(jobs.map(job=>job.id));
    const deliveries=new Set<string>();
    for(const delivery of this.repos.deliveries.deliveries(['pending','sending','unknown','failed']))for(const id of [delivery.output.assetId,delivery.attempt?.assetId])if(id)deliveries.add(`${delivery.scopeKey}:${id}`);
    return asset=>{
      if(asset.pinned)return 'retained';
      if(asset.sessionId&&current.get(asset.scopeKey)===asset.sessionId)return 'current-session';
      if(this.scopeBusy(asset.scopeKey)||scopes.has(asset.scopeKey)||asset.jobId&&jobIds.has(asset.jobId))return 'active-task';
      if(deliveries.has(`${asset.scopeKey}:${asset.id}`))return 'delivery';
    };
  }
  preview(input:StorageFilter){
    const filter=workspaceStorageFilterSchema.parse(input),all=this.owned(filter.botId);
    const matched=all.filter(asset=>(!filter.kind||asset.kind===filter.kind)&&(!filter.origin||originOf(asset)===filter.origin)&&(!filter.before||asset.createdAt<filter.before)).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
    const protection=this.protections(),rows=matched.map(asset=>({asset,protection:protection(asset)})),groups=new Map<string,Asset[]>();
    for(const asset of matched){const key=JSON.stringify([asset.kind,originOf(asset),new Date(asset.createdAt).toISOString().slice(0,10)]),group=groups.get(key)??[];group.push(asset);groups.set(key,group);}
    return {botId:filter.botId,total:amount(all),matched:amount(matched),reclaimable:amount(rows.filter(row=>!row.protection).map(row=>row.asset)),groups:[...groups].map(([key,assets])=>{const [kind,origin,date]=JSON.parse(key);return {kind,origin,date,...amount(assets)};}),offset:filter.offset,limit:filter.limit,hasMore:filter.offset+filter.limit<rows.length,items:rows.slice(filter.offset,filter.offset+filter.limit).map(({asset,protection})=>({id:asset.id,name:asset.name,kind:asset.kind,origin:originOf(asset),size:asset.size,createdAt:asset.createdAt,scopeKey:asset.scopeKey,sessionId:asset.sessionId,pinned:asset.pinned===true,protection}))};
  }
  pin(input:z.input<typeof workspaceStoragePinSchema>){
    const value=workspaceStoragePinSchema.parse(input),asset=this.owned(value.botId).find(item=>item.id===value.assetId);
    if(!asset)throw Error('WORKSPACE_ASSET_NOT_OWNED');
    this.repos.media.assets.saveAsset({...asset,pinned:value.pinned});
    return {id:asset.id,pinned:value.pinned};
  }
  async cleanup(input:z.input<typeof workspaceStorageCleanupSchema>){
    const value=workspaceStorageCleanupSchema.parse(input),ids=[...new Set(value.assetIds)],owned=new Map(this.owned(value.botId).map(asset=>[asset.id,asset]));
    if(ids.some(id=>!owned.has(id)))throw Error('WORKSPACE_ASSET_NOT_OWNED');
    const deleted:Asset[]=[],skipped:Array<{id:string;reason:StorageProtection|'missing'}>=[];
    for(const id of ids){
      const asset=this.repos.media.assets.findAsset(id);
      if(!asset){skipped.push({id,reason:'missing'});continue;}
      if(asset.scopeKey!==owned.get(id)!.scopeKey)throw Error('WORKSPACE_ASSET_NOT_OWNED');
      const reason=this.protections()(asset);if(reason){skipped.push({id,reason});continue;}
      if(!asset.workspace)throw Error('ASSET_CLEANUP_WORKSPACE_REQUIRED');
      const folder=path.resolve(assetFolder(asset.workspace,asset)),relative=path.relative(path.resolve(asset.workspace),folder);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.resolve(asset.path)!==path.join(folder,asset.name))throw Error('ASSET_CLEANUP_PATH_INVALID');
      await rm(folder,{recursive:true,force:true});
      this.repos.media.assets.deleteAsset(asset.scopeKey,id);deleted.push(asset);
    }
    return {...amount(deleted),skipped};
  }
}
