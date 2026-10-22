import { z } from 'zod';
import path from 'node:path';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const modelSchema = z.object({ provider: z.string().min(1).max(150), model: z.string().min(1).max(200), reasoningEffort: z.string().optional() });
export const skillNameSchema = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const endpointSchema = z.object({
  baseUrl: z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;},'媒体 API 必须使用无凭据、查询或片段的 HTTPS 地址'), model: z.string().min(1), keyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
});
export const imageSkillOverrideSchema=endpointSchema.pick({baseUrl:true,model:true,keyEnv:true}).partial().extend({enabled:z.boolean().default(true)});
export const analysisSkillSchema=z.object({enabled:z.boolean().default(true),provider:z.string().min(1).max(150).optional(),model:z.string().min(1).max(200).optional(),protocol:z.enum(['chat_completions','transcriptions']).default('chat_completions')});
export const configSchema = z.object({
  schemaVersion:z.literal(2).default(2),
  id: idSchema, name: z.string().trim().min(1).max(100), revision: z.number().int().positive().default(1),
  personaPrompt: z.string().min(1).max(32000), model: modelSchema.nullable().default(null),
  // Legacy vision/TTS services and duplicated analysis connection fields are discarded.
  media: z.object({image:imageSkillOverrideSchema.optional(),asr:analysisSkillSchema.optional(),video:analysisSkillSchema.optional()}).default({}),
  tools: z.array(z.string().max(100)).max(100).default(['bot_media', 'bot_send_file', 'bot_remember', 'bot_forget_memory', 'bot_read_social']),
  skills: z.array(skillNameSchema).max(100).refine(value=>new Set(value).size===value.length,'技能名称不得重复').default(['image-generation','media-analysis']),
  skillVersions:z.record(skillNameSchema,z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  allowHostTools: z.boolean().default(true), hostTools: z.array(z.string().max(100)).max(100).default([]),
  imageStyle: z.string().max(4000).default(''),
  archived: z.boolean().default(false),
});
export type BotConfig = z.infer<typeof configSchema>;
export const botSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(100), channel: z.enum(['qq', 'weixin']),
  accountId: z.string().max(200).default(''), configId: idSchema.default('default'),
  enabled: z.boolean().default(false), archived: z.boolean().default(false),
  trustedUsers: z.array(z.string().min(1).max(200)).max(200).default([]),
  workingDirectory:z.string().trim().max(32767).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),'工作目录须为绝对路径').transform(value=>value||undefined).optional(),
});
export type BotInstance = z.infer<typeof botSchema>;
export interface CallerScope { botId: string; platform: 'qq' | 'weixin'; accountId: string; kind: 'private' | 'group'; channelId: string; senderId: string }
export interface MediaInput {
  kind: 'image' | 'audio' | 'video' | 'file'; name: string; mime: string;
  url?: string; bytes?: string; handle?: string; transcript?: string;
  remote?: { query?: string; key?: string; fullUrl?: string };
}
export interface InboundMessage {
  id: string; scope: CallerScope; text: string; attachments: MediaInput[];
  quoted?: { id?: string; text?: string; attachments?: MediaInput[] };
  reply: Record<string, string>; timestamp: number;
}
export interface SessionBinding { key: string; scope: CallerScope; sessionId: string; generation: number; persisted: boolean; personaId?:string; modelOverride?:z.infer<typeof modelSchema>; recentSince?:number }
export interface SessionRecord { id:string; scopeKey:string; scope:CallerScope; generation:number; persisted:boolean; createdAt:number; updatedAt:number; personaId?:string; modelOverride?:z.infer<typeof modelSchema>; recentSince?:number }
export interface TurnSnapshot { config: Readonly<BotConfig>; botId: string; trusted: boolean; sourceIds: string[]; startedAt: number }
export interface Asset { id: string; scopeKey: string; name: string; mime: string; path: string; size: number; kind: MediaInput['kind']; createdAt: number; jobId?: string; sessionId?:string }
export interface Output { type: 'text' | 'asset'; text?: string; assetId?: string }
export interface Delivery { id: string; scopeKey: string; botId: string; sessionId: string; sourceId: string; turnId: string; index: number; output: Output; reply: Record<string,string>; state: 'pending'|'sending'|'sent'|'unknown'|'failed'|'cancelled'; receipt?: string; error?: string; createdAt?:number; updatedAt?:number; sentAt?:number }
export interface Credential { accountId: string; token?: string; appSecret?: string; baseUrl?: string }
export interface LoginState { status: 'pending'|'confirmed'|'expired'|'denied'; qr?: string; ticket?: string; credential?: Credential }
export interface ChannelAdapter {
  beginLogin(signal?: AbortSignal): Promise<LoginState>;
  pollLogin(ticket: string, signal?: AbortSignal): Promise<LoginState>;
  connect(bot: BotInstance, credential: Credential, receive: (message: InboundMessage)=>Promise<void>, signal: AbortSignal, status: (state: string)=>void): Promise<void>;
  materialize(input: MediaInput, signal: AbortSignal): Promise<Buffer>;
  send(bot: BotInstance, credential: Credential, delivery: Delivery, asset: Asset|undefined, signal: AbortSignal): Promise<string>;
}
