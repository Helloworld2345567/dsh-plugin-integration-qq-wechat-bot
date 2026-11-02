import {z} from 'zod';

export const serviceErrorCategorySchema=z.enum([
  'NOT_CONFIGURED','DEPENDENCY_UNAVAILABLE','INVALID_INPUT','TIMEOUT','CANCELLED','PROVIDER_ERROR','OUTPUT_INVALID','UNKNOWN_STATE',
]);
export type ServiceErrorCategory=z.infer<typeof serviceErrorCategorySchema>;
export const serviceErrorSchema=z.object({
  category:serviceErrorCategorySchema,
  providerCode:z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/).optional(),
  safeDiagnostic:z.string().max(1000).optional(),
  retryable:z.boolean(),
  blocksService:z.boolean(),
  correlationId:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/).optional(),
}).strict().superRefine((value,ctx)=>{if(value.category==='UNKNOWN_STATE'&&!value.blocksService)ctx.addIssue({code:'custom',path:['blocksService'],message:'unknown service state must block the service instance'});});
export type ServiceError=z.infer<typeof serviceErrorSchema>;

const SECRET_PATTERN=/(?:bearer\s+|api[_-]?key\s*[=:]|token\s*[=:]|secret\s*[=:]|password\s*[=:]|credential\s*[=:])[^\s,;]+/gi;
const URL_PATTERN=/\b(?:https?|file):\/\/[^\s<>'"`]+/gi;
const WINDOWS_PATH=/(?:^|[\s'"`(])(?:[A-Za-z]:[\\/]|\\\\)[^\s'"`),;]*/g;
const POSIX_PATH=/(?:^|[\s'"`(])\/(?:home|Users|var|tmp|opt|srv|mnt|media|root|run|etc)\/[^\s'"`),;]*/g;
const TRACE_PATTERN=/(?:\n|^)\s*(?:at\s+.+\(.+?:\d+:\d+\)|File\s+"[^"]+",\s+line\s+\d+.*)/g;
const LOCATOR_PATTERN=/(?:^|\s)(?:git\+|npm:|github:|s3:|gs:|asset:|model:)[^\s]+/gi;

export function sanitizeServiceDiagnostic(value:unknown,fallback='SERVICE_OPERATION_FAILED'):string {
  const raw=typeof value==='string'?value:value instanceof Error?value.message:fallback;
  const sanitized=raw.replaceAll('\0','').replace(TRACE_PATTERN,' [trace redacted]').replace(SECRET_PATTERN,'[credential redacted]').replace(URL_PATTERN,'[locator redacted]').replace(WINDOWS_PATH,match=>`${match[0]??''}[path redacted]`).replace(POSIX_PATH,match=>`${match[0]??''}[path redacted]`).replace(LOCATOR_PATTERN,' [locator redacted]').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
  return (sanitized||fallback).slice(0,1000);
}

const PUBLIC_PRIVATE_PATTERN=/(?:\b(?:endpoint|base\s*url|port|credential|password|secret|token|api[_-]?key|locator|traceback)\b\s*[=:]?|\b(?:localhost|127\.0\.0\.1|\[?::1\]?):\d{1,5}\b|:\d{2,5}\b|\b[^\s/\\]+\.(?:ckpt|pth|pt|safetensors|index|onnx)\b)/i;
/** Public catalog labels and diagnostics fail closed when they resemble private configuration. */
export function sanitizePublicServiceText(value:unknown,fallback='Service information unavailable'):string {
  const sanitized=sanitizeServiceDiagnostic(value,fallback);
  return PUBLIC_PRIVATE_PATTERN.test(sanitized)||/\[(?:path|locator|credential|trace) redacted\]/i.test(sanitized)?fallback:sanitized;
}

export class ServiceContractError extends Error {
  readonly serviceError:ServiceError;
  constructor(error:ServiceError,cause?:unknown){
    const parsed=serviceErrorSchema.parse({...error,safeDiagnostic:error.safeDiagnostic===undefined?undefined:sanitizeServiceDiagnostic(error.safeDiagnostic)});
    super(parsed.safeDiagnostic??parsed.category,{cause});this.name='ServiceContractError';this.serviceError=parsed;
  }
}

export function toServiceError(error:unknown,defaults:Partial<ServiceError>={}):ServiceError {
  if(error instanceof ServiceContractError)return error.serviceError;
  const aborted=error instanceof Error&&(error.name==='AbortError'||/abort|cancel/i.test(error.message));
  const timeout=error instanceof Error&&/timeout|deadline/i.test(error.message);
  const category=defaults.category??(aborted?'CANCELLED':timeout?'TIMEOUT':'PROVIDER_ERROR');
  return serviceErrorSchema.parse({category,retryable:defaults.retryable??false,blocksService:defaults.blocksService??category==='UNKNOWN_STATE',...defaults,safeDiagnostic:sanitizeServiceDiagnostic(defaults.safeDiagnostic??error)});
}

export function serviceFailure(error:ServiceError,cause?:unknown):never {throw new ServiceContractError(error,cause);}
