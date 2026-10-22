import {z} from 'zod';
import type {CallerScope} from './types.js';

export const deferredSessionActionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('new')}).strict(),
  z.object({action:z.literal('stop')}).strict(),
  z.object({action:z.literal('compact')}).strict(),
  z.object({action:z.literal('resume'),sessionId:z.string().min(1)}).strict(),
  z.object({action:z.literal('persona'),personaId:z.string().min(1)}).strict(),
  z.object({action:z.literal('skill'),name:z.string().min(1),enabled:z.boolean()}).strict(),
]);
export type DeferredSessionAction=z.infer<typeof deferredSessionActionSchema>;
export interface SessionActionRecord {
  id:string;
  action:DeferredSessionAction;
  scopeKey:string;
  scope:CallerScope;
  sessionId:string;
  generation:number;
  sourceIds:string[];
  sourceId:string;
  trusted:boolean;
  personaId:string;
  personaRevision:number;
  targetPersonaRevision?:number;
  state:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';
  createdAt:number;
  updatedAt:number;
  result?:string;
}

export function sameSessionAction(a:DeferredSessionAction,b:DeferredSessionAction):boolean {
  return JSON.stringify(deferredSessionActionSchema.parse(a))===JSON.stringify(deferredSessionActionSchema.parse(b));
}
export function sameSources(a:readonly string[],b:readonly string[]):boolean {
  const right=[...b].sort();return a.length===b.length&&[...a].sort().every((id,index)=>id===right[index]);
}
