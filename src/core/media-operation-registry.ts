import {skillToolManifests, type SkillOperation} from './skill-operations.js';
export interface MediaOperationDescriptor {
  id: string;
  /** Namespaced service operation when this legacy worker operation is an approved facade. */
  serviceOperation?: string;
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
  /** Per-scope daily call limit; trusted private turns and local transforms are exempt. */
  quotaUnits: number;
  /** Worker handler name in the versioned protocol. */
  handler: string;
  inputKinds?: readonly string[];
  execute?: (job: unknown, signal?: AbortSignal) => unknown | Promise<unknown>;
}

export class MediaOperationRegistry {
  private readonly entries = new Map<string, MediaOperationDescriptor>();
  private readonly serviceOperations = new Map<string, string>();
  private readonly serviceOperationAliases = new Set<string>();
  constructor(descriptors: readonly MediaOperationDescriptor[] = []) { for (const descriptor of descriptors) this.register(descriptor); }
  register(descriptor: MediaOperationDescriptor): () => void {
    if (!/^[a-z][a-z0-9_]{1,80}$/.test(descriptor.id)) throw new Error('MEDIA_OPERATION_ID_INVALID');
    if(descriptor.serviceOperation!==undefined&&!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(descriptor.serviceOperation))throw new Error('MEDIA_SERVICE_OPERATION_ID_INVALID');
    if (!Number.isSafeInteger(descriptor.timeoutMs) || (descriptor.timeoutMs !== 0 && descriptor.timeoutMs < 1000) || descriptor.timeoutMs > 15 * 60 * 1000) throw new Error('MEDIA_OPERATION_TIMEOUT_INVALID');
    if (!Number.isSafeInteger(descriptor.quotaUnits) || descriptor.quotaUnits < 1) throw new Error('MEDIA_OPERATION_QUOTA_INVALID');
    if (this.entries.has(descriptor.id)) throw new Error(`MEDIA_OPERATION_ALREADY_REGISTERED: ${descriptor.id}`);
    if(descriptor.serviceOperation&&this.serviceOperations.has(descriptor.serviceOperation))throw new Error(`MEDIA_SERVICE_OPERATION_ALREADY_REGISTERED: ${descriptor.serviceOperation}`);
    this.entries.set(descriptor.id, Object.freeze({...descriptor, inputKinds: descriptor.inputKinds ? Object.freeze([...descriptor.inputKinds]) : undefined}));
    if(descriptor.serviceOperation)this.serviceOperations.set(descriptor.serviceOperation,descriptor.id);
    return () => {this.entries.delete(descriptor.id);if(descriptor.serviceOperation&&this.serviceOperations.get(descriptor.serviceOperation)===descriptor.id)this.serviceOperations.delete(descriptor.serviceOperation);};
  }
  registerServiceOperationAlias(serviceOperation:string,legacyOperation:string):()=>void {
    if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(serviceOperation))throw new Error('MEDIA_SERVICE_OPERATION_ID_INVALID');
    if(!this.entries.has(legacyOperation))throw new Error('MEDIA_OPERATION_HANDLER_UNAVAILABLE');
    if(this.serviceOperations.has(serviceOperation))throw new Error(`MEDIA_SERVICE_OPERATION_ALREADY_REGISTERED: ${serviceOperation}`);
    this.serviceOperations.set(serviceOperation,legacyOperation);
    this.serviceOperationAliases.add(serviceOperation);
    return()=>{if(this.serviceOperations.get(serviceOperation)===legacyOperation){this.serviceOperations.delete(serviceOperation);this.serviceOperationAliases.delete(serviceOperation);}};
  }
  has(id: string): boolean { return this.entries.has(id); }
  hasServiceOperation(id:string):boolean{return this.serviceOperations.has(id);}
  isServiceOperationAlias(id:string):boolean{return this.serviceOperationAliases.has(id);}
  get(id: string): MediaOperationDescriptor { const descriptor = this.entries.get(id); if (!descriptor) throw new Error('UNKNOWN_MEDIA_OPERATION'); return descriptor; }
  getServiceOperation(id:string):MediaOperationDescriptor {const legacy=this.serviceOperations.get(id);if(!legacy)throw new Error('UNKNOWN_MEDIA_SERVICE_OPERATION');return this.get(legacy);}
  list(): readonly MediaOperationDescriptor[] { return [...this.entries.values()]; }
  ids(): readonly string[] { return [...this.entries.keys()]; }
  async dispatch<T = unknown>(id: string, job: unknown, signal?: AbortSignal): Promise<T> {
    const descriptor=this.get(id);if(!descriptor.execute)throw new Error('MEDIA_OPERATION_HANDLER_UNAVAILABLE');signal?.throwIfAborted();return await descriptor.execute(job,signal) as T;
  }
}

export const SERVICE_OPERATION_BY_LEGACY:Readonly<Record<string,string>>=Object.freeze({music_search:'music.search',music_acquire:'music.acquire',voice_speak:'gpt-sovits.speak',singing_convert:'rvc.convert'});
export function serviceOperationFor(legacyOperation:string,serviceId:string):string|undefined {
  if(legacyOperation==='voice_speak'&&serviceId==='breeze-tts')return'breeze-tts.speak';
  return SERVICE_OPERATION_BY_LEGACY[legacyOperation];
}
export const DEFAULT_MEDIA_OPERATIONS: readonly MediaOperationDescriptor[] = Object.freeze([
  ...skillToolManifests.flatMap(manifest => manifest.operations.map(operation => ({...operation, serviceOperation:SERVICE_OPERATION_BY_LEGACY[operation.id], source: operation, skill: manifest.skill, tool: manifest.tool.name, permissionTool: manifest.permissionTool ?? manifest.tool.name, handler: 'skill', timeoutMs: 0}))),
  {id: 'image_generate', handler: 'image', timeoutMs: 0, quotaUnits: 10000, inputKinds: []},
  {id: 'image_edit', handler: 'image', timeoutMs: 0, quotaUnits: 10000, inputKinds: ['image']},
  {id: 'image_understand', handler: 'native', timeoutMs: 0, quotaUnits: 1, inputKinds: ['image']},
  {id: 'document_read', handler: 'document', timeoutMs: 0, quotaUnits: 50, inputKinds: ['file']},
  {id: 'convert_mp4', handler: 'convert_mp4', timeoutMs: 0, quotaUnits: 50, inputKinds: ['video']},
  {id: 'social_read', handler: 'social_read', timeoutMs: 0, quotaUnits: 20, inputKinds: []},
]);

export const mediaOperationRegistry = new MediaOperationRegistry(DEFAULT_MEDIA_OPERATIONS);
mediaOperationRegistry.registerServiceOperationAlias('breeze-tts.speak','voice_speak');
export type MediaOperation = string;
