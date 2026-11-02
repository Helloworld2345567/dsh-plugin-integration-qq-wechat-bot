import path from 'node:path';
import {z} from 'zod';

export const SERVICE_CONTRACT_VERSION=1 as const;
export const SERVICE_HOST_API_VERSION='1.0.0' as const;
export const SERVICE_MANIFEST_FILE='service-plugin.json' as const;

const boundedJsonSchema=z.record(z.string().max(200),z.unknown()).refine(value=>Buffer.byteLength(JSON.stringify(value))<=256*1024,'schema exceeds 256 KiB');
export const serviceIdSchema=z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80);
export const profileIdSchema=z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(80);
export const packageIdSchema=z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/).max(214);
export const semanticVersionSchema=z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).max(100);
export const versionRangeSchema=z.string().trim().min(1).max(200).refine(value=>/^[0-9A-Za-z.*+<>=^~| -]+$/.test(value),'invalid version range characters');
export const namespacedOperationSchema=z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/).max(160);
export const identifierSchema=z.string().regex(/^[a-z][a-z0-9_.-]*$/).max(160);
export const sha256Schema=z.string().regex(/^[a-f0-9]{64}$/);

export const schemaRefSchema=z.object({
  dialect:z.literal('https://json-schema.org/draft/2020-12/schema'),
  id:z.string().min(1).max(200).optional(),
  schema:boundedJsonSchema,
}).strict();
export type SchemaRef=z.infer<typeof schemaRefSchema>;

export const dependencyDescriptorSchema=z.object({
  serviceId:serviceIdSchema,
  versionRange:versionRangeSchema,
  optional:z.boolean().default(false),
}).strict();
export type DependencyDescriptor=z.infer<typeof dependencyDescriptorSchema>;

export const credentialRefDescriptorSchema=z.object({
  id:identifierSchema,
  required:z.boolean().default(true),
  injection:z.enum(['environment','process-channel']),
}).strict();
export type CredentialRefDescriptor=z.infer<typeof credentialRefDescriptorSchema>;

export const serviceCapabilityDescriptorSchema=z.object({
  operation:namespacedOperationSchema,
  inputKinds:z.array(z.enum(['image','audio','video','file','text'])).max(16).readonly(),
  outputKinds:z.array(z.enum(['image','audio','video','file','text'])).max(16).readonly(),
  parameterSchema:schemaRefSchema,
  permission:identifierSchema,
  tool:z.string().regex(/^[a-z][a-z0-9_]*$/).max(100).optional(),
  quotaPolicy:identifierSchema,
  concurrencyPolicy:identifierSchema,
  deliveryPolicy:z.enum(['never','host_decides','allowed']),
}).strict().superRefine((value,ctx)=>{
  if(value.operation.split('.',1)[0].length===0)ctx.addIssue({code:'custom',path:['operation'],message:'operation namespace is required'});
});
export type ServiceCapabilityDescriptor=z.infer<typeof serviceCapabilityDescriptorSchema>;

export const servicePluginManifestSchema=z.object({
  manifestVersion:z.literal(SERVICE_CONTRACT_VERSION),
  serviceId:serviceIdSchema,
  packageId:packageIdSchema,
  version:semanticVersionSchema,
  hostApiRange:versionRangeSchema,
  entry:z.string().min(1).max(500).refine(value=>{
    if(value.includes('\\')||path.posix.isAbsolute(value)||path.win32.isAbsolute(value))return false;
    const normalized=path.posix.normalize(value);
    return normalized===value&&normalized!=='.'&&!normalized.startsWith('../')&&!normalized.split('/').includes('..');
  },'entry must be a normalized package-relative POSIX path'),
  protocols:z.array(z.string().regex(/^[a-z][a-z0-9_.-]*@(?:0|[1-9]\d*)$/).max(120)).min(1).max(32).refine(value=>new Set(value).size===value.length,'protocols must be unique').readonly(),
  capabilities:z.array(serviceCapabilityDescriptorSchema).min(1).max(100).readonly(),
  profileSchema:schemaRefSchema,
  dependencies:z.array(dependencyDescriptorSchema).max(50).readonly(),
  credentialRefs:z.array(credentialRefDescriptorSchema).max(50).default([]).readonly(),
  artifactSha256:sha256Schema,
  signature:z.string().regex(/^ed25519:[a-zA-Z0-9_-]{1,80}:[A-Za-z0-9+/]+={0,2}$/).max(2048).optional(),
}).strict().superRefine((value,ctx)=>{
  const operations=new Set<string>(),credentials=new Set<string>(),dependencies=new Set<string>();
  for(const [index,capability] of value.capabilities.entries()){
    if(!capability.operation.startsWith(`${value.serviceId}.`))ctx.addIssue({code:'custom',path:['capabilities',index,'operation'],message:'operation must use the service namespace'});
    if(operations.has(capability.operation))ctx.addIssue({code:'custom',path:['capabilities',index,'operation'],message:'duplicate operation'});operations.add(capability.operation);
  }
  for(const [index,credential] of value.credentialRefs.entries()){if(credentials.has(credential.id))ctx.addIssue({code:'custom',path:['credentialRefs',index,'id'],message:'duplicate credential reference'});credentials.add(credential.id);}
  for(const [index,dependency] of value.dependencies.entries()){if(dependency.serviceId===value.serviceId)ctx.addIssue({code:'custom',path:['dependencies',index,'serviceId'],message:'service cannot depend on itself'});if(dependencies.has(dependency.serviceId))ctx.addIssue({code:'custom',path:['dependencies',index,'serviceId'],message:'duplicate dependency'});dependencies.add(dependency.serviceId);}
});
export type ServicePluginManifest=z.infer<typeof servicePluginManifestSchema>;

export const serviceProfileRefSchema=z.object({serviceId:serviceIdSchema,profileId:profileIdSchema}).strict();
export type ServiceProfileRef=z.infer<typeof serviceProfileRefSchema>;
export const profileStateSchema=z.enum(['ready','partial','blocked','missing','disabled','revoked']);
export type ProfileState=z.infer<typeof profileStateSchema>;
export const serviceProfileRevisionSchema=z.object({
  serviceId:serviceIdSchema,
  profileId:profileIdSchema,
  revision:z.number().int().positive(),
  contentHash:sha256Schema,
  state:profileStateSchema,
  capabilities:z.array(namespacedOperationSchema).max(100).refine(value=>new Set(value).size===value.length,'capabilities must be unique').readonly(),
  displayName:z.string().trim().min(1).max(160),
  modelLabel:z.string().trim().min(1).max(240).optional(),
  updatedAt:z.number().int().nonnegative(),
}).strict().superRefine((value,ctx)=>{for(const [index,operation] of value.capabilities.entries())if(!operation.startsWith(`${value.serviceId}.`))ctx.addIssue({code:'custom',path:['capabilities',index],message:'profile capability must use the service namespace'});});
export type ServiceProfileRevision=z.infer<typeof serviceProfileRevisionSchema>;
export interface ResolvedServiceProfileRevision extends ServiceProfileRevision {readonly managedConfig:Readonly<Record<string,unknown>>}

export const serviceJobStateSchema=z.enum(['queued','running','cancel_requested','cancelled','succeeded','failed','unknown']);
export type ServiceJobState=z.infer<typeof serviceJobStateSchema>;
export const serviceJobSchema=z.object({
  jobId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).max(128),
  operation:namespacedOperationSchema,
  profile:serviceProfileRevisionSchema,
  inputHandles:z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).max(256)).max(16).readonly(),
  parameters:z.record(z.string().max(120),z.unknown()).refine(value=>Buffer.byteLength(JSON.stringify(value))<=256*1024,'parameters exceed 256 KiB'),
  outputDirectory:z.string().min(1).max(32767).refine(value=>path.isAbsolute(value),'output directory must be host-assigned and absolute'),
  idempotencyKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).max(200),
  deadline:z.number().int().positive(),
}).strict().superRefine((value,ctx)=>{
  if(!value.operation.startsWith(`${value.profile.serviceId}.`))ctx.addIssue({code:'custom',path:['operation'],message:'operation and profile service differ'});
  if(!value.profile.capabilities.includes(value.operation))ctx.addIssue({code:'custom',path:['profile','capabilities'],message:'profile does not provide operation'});
});
export type ServiceJob=z.infer<typeof serviceJobSchema>;

export const healthResultSchema=z.object({state:z.enum(['unknown','ready','degraded','unavailable','blocked','disabled']),checkedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),safeDiagnostic:z.string().max(1000).optional()}).strict().refine(value=>value.expiresAt>=value.checkedAt,{path:['expiresAt'],message:'health expiry cannot precede check time'});
export type HealthResult=z.infer<typeof healthResultSchema>;
export const acceptanceStateSchema=z.enum(['NOT_RUN','PASS','FAIL','EXPIRED','BLOCKED']);
export const capabilityAcceptanceSchema=z.object({serviceId:serviceIdSchema,profileId:profileIdSchema,profileRevision:z.number().int().positive(),profileContentHash:sha256Schema,personaId:z.string().min(1).max(80),personaRevision:z.number().int().positive(),operation:namespacedOperationSchema,state:acceptanceStateSchema,evidenceType:identifierSchema,evidence:z.string().max(2000),checkedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),source:z.enum(['operator','automated','migration'])}).strict().refine(value=>value.expiresAt>=value.checkedAt,{path:['expiresAt'],message:'acceptance expiry cannot precede check time'}).superRefine((value,ctx)=>{if(!value.operation.startsWith(`${value.serviceId}.`))ctx.addIssue({code:'custom',path:['operation'],message:'acceptance operation must use the service namespace'});});
export type CapabilityAcceptance=z.infer<typeof capabilityAcceptanceSchema>;
export const cancelResultSchema=z.discriminatedUnion('state',[
  z.object({state:z.literal('cancelled')}).strict(),
  z.object({state:z.literal('cancel_requested')}).strict(),
  z.object({state:z.literal('unknown'),blocksService:z.literal(true)}).strict(),
  z.object({state:z.literal('not_supported')}).strict(),
]);
export type CancelResult=z.infer<typeof cancelResultSchema>;
export const serviceOutputSchema=z.object({kind:z.enum(['image','audio','video','file']),handle:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(256),name:z.string().min(1).max(512)}).strict();
export const serviceResultSchema=z.object({text:z.string().max(64*1024).optional(),outputs:z.array(serviceOutputSchema).max(100).default([]).readonly(),observations:z.unknown().optional()}).strict();
export type ServiceResult=z.infer<typeof serviceResultSchema>;

export interface ServiceAdapter {
  readonly serviceId:string;
  listProfiles(signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>;
  health(profile:ServiceProfileRef,signal:AbortSignal):Promise<HealthResult>;
  execute(request:ServiceJob,signal:AbortSignal):Promise<ServiceResult>;
  cancel(jobId:string,signal?:AbortSignal):Promise<CancelResult>;
  dispose():Promise<void>;
}

export interface TurnServiceSnapshot {serviceId:string;profileId:string;profileRevision:number;profileContentHash:string}

export function parseServicePluginManifest(value:unknown):ServicePluginManifest{return servicePluginManifestSchema.parse(value);}
export function parseServiceJob(value:unknown):ServiceJob{return serviceJobSchema.parse(value);}
