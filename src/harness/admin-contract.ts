import {createHash} from 'node:crypto';
import {z} from 'zod';
import {botSchema,configSchema} from '../core/types.js';

export const ADMIN_CONTRACT_VERSION=1 as const;
const revisionSchema=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const changedSinceSchema=revisionSchema.optional();
const emptyInput=z.object({changedSince:changedSinceSchema}).strict().default({});

const pageFields={limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(500).optional(),changedSince:changedSinceSchema};
const pageInput=z.object(pageFields).strict().default({limit:50});
export const adminQueryRequestSchema=z.discriminatedUnion('name',[
  z.object({version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('query'),name:z.literal('overview.summary'),input:emptyInput}).strict(),
  z.object({version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('query'),name:z.literal('catalog.config'),input:z.object({id:z.string().min(1).max(80),changedSince:changedSinceSchema}).strict()}).strict(),
  z.object({version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('query'),name:z.literal('bots.list'),input:emptyInput}).strict(),
  z.object({version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('query'),name:z.literal('overview.sessions'),input:pageInput}).strict(),
  z.object({version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('query'),name:z.literal('overview.deliveries'),input:z.object({...pageFields,scopeKey:z.string().min(1).max(128).optional()}).strict().default({limit:50})}).strict(),
  z.object({version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('query'),name:z.literal('automation.list'),input:emptyInput}).strict(),
]);
export type AdminQueryRequest=z.infer<typeof adminQueryRequestSchema>;
export interface PageDto<T>{items:T[];nextCursor:string|null;hasMore:boolean;revision:string;contractVersion:typeof ADMIN_CONTRACT_VERSION}

const commandRequest=(name:string,input:z.ZodTypeAny)=>z.object({
  version:z.literal(ADMIN_CONTRACT_VERSION),kind:z.literal('command'),name:z.literal(name),requestId:z.string().min(1).max(120).optional(),input,
}).strict();
const idInput=z.object({id:z.string().min(1).max(80)}).strict();
const configSaveInput=z.object({config:configSchema,expectedRevision:z.number().int().positive().optional()}).strict();
const configFilesInput=z.object({id:z.string().min(1).max(80)}).strict();
const configCopyInput=z.object({id:z.string().min(1).max(80),newId:z.string().min(1).max(80),name:z.string().trim().min(1).max(100)}).strict();
const botCredentialsInput=z.object({id:z.string().min(1).max(80),credential:z.object({accountId:z.string().min(1).max(200),appSecret:z.string().min(1).max(500)}).strict()}).strict();
const capabilityInput=z.object({configId:z.string().min(1).max(80),revision:z.number().int().positive(),role:z.enum(['image','asr','video','voice']),status:z.enum(['PASS','FAIL','BLOCKED','NOT_RUN']),evidence:z.string().trim().min(1).max(2000)}).strict();
const memoryForgetInput=z.object({scope:z.string().min(1).max(128),key:z.string().min(1).max(100)}).strict();
const memoryCorrectInput=z.object({scope:z.string().min(1).max(128),key:z.string().min(1).max(100),value:z.string().min(1).max(500),version:z.number().int().positive()}).strict();
const sessionCancelInput=z.object({id:z.string().min(1).max(200)}).strict();
const deliveryRetryInput=z.object({id:z.string().min(1).max(200)}).strict();
const loginBeginInput=idInput;
const loginPollInput=z.object({attempt:z.string().min(1).max(200)}).strict();

export const adminCommandRequestSchema=z.discriminatedUnion('name',[
  commandRequest('config.save',configSaveInput),commandRequest('config.files.apply',configFilesInput),commandRequest('config.copy',configCopyInput),
  commandRequest('bot.save',botSchema),commandRequest('bot.start',idInput),commandRequest('bot.stop',idInput),commandRequest('bot.reconnect',idInput),
  commandRequest('bot.credentials',botCredentialsInput),commandRequest('login.begin',loginBeginInput),commandRequest('login.poll',loginPollInput),
  commandRequest('config.directory.open',z.object({botId:z.string().min(1).max(80).optional(),configId:z.string().min(1).max(80).optional()}).strict()),
  commandRequest('capability.record',capabilityInput),commandRequest('memory.forget',memoryForgetInput),commandRequest('memory.correct',memoryCorrectInput),commandRequest('session.cancel',sessionCancelInput),
  commandRequest('delivery.retry',deliveryRetryInput),
  commandRequest('automation.proactive',z.object({scopeKey:z.string().min(1).max(128),action:z.enum(['on','off','status','now','set']),args:z.string().max(1000).default('')}).strict()),
  commandRequest('automation.schedule',z.object({scopeKey:z.string().min(1).max(128),action:z.enum(['list','create','pause','resume','run','delete']),args:z.string().max(1000).default('')}).strict()),
]);
export type AdminCommandRequest=z.infer<typeof adminCommandRequestSchema>;

export interface AdminSummaryBot {id:string;name:string;channel:string;accountId:string;configId:string;enabled:boolean;archived:boolean;status:string;activeSessions:number;credentialConfigured:boolean;trustedUserCount:number;workspaceConfigured:boolean}
export interface AdminSummaryConfig {id:string;name:string;revision:number;archived:boolean;model:{provider:string;model:string}|null;toolCount:number;skillCount:number;allowHostTools:boolean;voice:{enabled:boolean;provider?:string;model?:string;voice?:string;format:'mp3'|'wav'}|null}
export interface AdminSummaryData {
  channels:Array<{id:string;displayName:string;capabilities:{conversations:readonly ('private'|'group')[];login:readonly ('qr'|'credentials')[];groupSupport:'unsupported'|'observed_only'}}>;
  bots:AdminSummaryBot[];
  configs:AdminSummaryConfig[];
  counts:{bots:number;configs:number;sessions:number;jobs:number;failures:number;pendingDeliveries:number;pendingSessionActions:number};
  health:{ready:boolean;quiescing:boolean;activeTasks:number;pendingDeliveries:number;pendingSessionActions:number;connections:Record<string,string>;latency:unknown};
  evolution?:{id:string;phase:string;updatedAt:number}|null;
}
export interface VersionedAdminResult<T> {version:number;contractVersion:typeof ADMIN_CONTRACT_VERSION;revision:string;changedSince?:string;unchanged?:boolean;data?:T}

export function revisionFor(value:unknown):string {return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;}
export function versioned<T>(data:T,changedSince?:string):VersionedAdminResult<T> {
  const revision=revisionFor(data);return changedSince===revision?{version:ADMIN_CONTRACT_VERSION,contractVersion:ADMIN_CONTRACT_VERSION,revision,changedSince,unchanged:true}:{version:ADMIN_CONTRACT_VERSION,contractVersion:ADMIN_CONTRACT_VERSION,revision,...changedSince?{changedSince}:{},data};
}
