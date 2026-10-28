import {skillToolManifests, type SkillOperation} from './skill-operations.js';
export interface MediaOperationDescriptor {
  id: string;
  skill?: string;
  tool?: string;
  source?: SkillOperation;
  role?: 'asr' | 'video' | 'tts';
  /** Tool whose permission gates this operation (defaults to the skill tool). */
  permissionTool?: string;
  deliver?: boolean;
  localTransform?: boolean;
  /** Optional timeout; zero means run until completion or cancellation. */
  timeoutMs: number;
  /** Per-scope daily call limit; local transforms do not consume it. */
  quotaUnits: number;
  /** Worker handler name in the versioned protocol. */
  handler: string;
  inputKinds?: readonly string[];
  execute?: (job: unknown, signal?: AbortSignal) => unknown | Promise<unknown>;
}

export class MediaOperationRegistry {
  private readonly entries = new Map<string, MediaOperationDescriptor>();
  constructor(descriptors: readonly MediaOperationDescriptor[] = []) { for (const descriptor of descriptors) this.register(descriptor); }
  register(descriptor: MediaOperationDescriptor): () => void {
    if (!/^[a-z][a-z0-9_]{1,80}$/.test(descriptor.id)) throw new Error('MEDIA_OPERATION_ID_INVALID');
    if (!Number.isSafeInteger(descriptor.timeoutMs) || (descriptor.timeoutMs !== 0 && descriptor.timeoutMs < 1000) || descriptor.timeoutMs > 15 * 60 * 1000) throw new Error('MEDIA_OPERATION_TIMEOUT_INVALID');
    if (!Number.isSafeInteger(descriptor.quotaUnits) || descriptor.quotaUnits < 1) throw new Error('MEDIA_OPERATION_QUOTA_INVALID');
    if (this.entries.has(descriptor.id)) throw new Error(`MEDIA_OPERATION_ALREADY_REGISTERED: ${descriptor.id}`);
    this.entries.set(descriptor.id, Object.freeze({...descriptor, inputKinds: descriptor.inputKinds ? Object.freeze([...descriptor.inputKinds]) : undefined}));
    return () => this.entries.delete(descriptor.id);
  }
  has(id: string): boolean { return this.entries.has(id); }
  get(id: string): MediaOperationDescriptor { const descriptor = this.entries.get(id); if (!descriptor) throw new Error('UNKNOWN_MEDIA_OPERATION'); return descriptor; }
  list(): readonly MediaOperationDescriptor[] { return [...this.entries.values()]; }
  ids(): readonly string[] { return [...this.entries.keys()]; }
  async dispatch<T = unknown>(id: string, job: unknown, signal?: AbortSignal): Promise<T> {
    const descriptor=this.get(id);if(!descriptor.execute)throw new Error('MEDIA_OPERATION_HANDLER_UNAVAILABLE');signal?.throwIfAborted();return await descriptor.execute(job,signal) as T;
  }
}

export const DEFAULT_MEDIA_OPERATIONS: readonly MediaOperationDescriptor[] = Object.freeze([
  ...skillToolManifests.flatMap(manifest => manifest.operations.map(operation => ({...operation, source: operation, skill: manifest.skill, tool: manifest.tool.name, permissionTool: manifest.permissionTool ?? manifest.tool.name, handler: 'skill', timeoutMs: 0}))),
  {id: 'image_generate', handler: 'image', timeoutMs: 0, quotaUnits: 10000, inputKinds: []},
  {id: 'image_edit', handler: 'image', timeoutMs: 0, quotaUnits: 10000, inputKinds: ['image']},
  {id: 'image_understand', handler: 'native', timeoutMs: 0, quotaUnits: 1, inputKinds: ['image']},
  {id: 'document_read', handler: 'document', timeoutMs: 0, quotaUnits: 50, inputKinds: ['file']},
  {id: 'convert_mp4', handler: 'convert_mp4', timeoutMs: 0, quotaUnits: 50, inputKinds: ['video']},
  {id: 'social_read', handler: 'social_read', timeoutMs: 0, quotaUnits: 20, inputKinds: []},
]);

export const mediaOperationRegistry = new MediaOperationRegistry(DEFAULT_MEDIA_OPERATIONS);
export type MediaOperation = string;
