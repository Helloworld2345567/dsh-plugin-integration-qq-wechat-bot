import type {MediaFile, MediaResult} from './media.js';

export const MEDIA_WORKER_PROTOCOL = 'dsh.media-worker';
export const MEDIA_WORKER_PROTOCOL_VERSION = 1;
export interface MediaWorkerJob {
  protocol: typeof MEDIA_WORKER_PROTOCOL;
  protocolVersion: number;
  id: string;
  scope: string;
  operation: string;
  /** Registry-owned worker handler. The worker never dispatches on ad-hoc code. */
  handler: string;
  inputs: MediaFile[];
  parameters: Record<string, unknown>;
  endpoint?: Record<string, unknown>;
  output: string;
  usagePath: string;
  deadline: number;
  timeoutMs: number;
  quotaUnits: number;
  /** Host-assigned encoder budget, never taken from tool parameters. */
  processingSlots?: number;
}
/** Provider secrets are carried out-of-band and are never serialized into a job. */
export type WorkerCredentials = Readonly<Record<string, string>>;
export interface WorkerPort { run(job: MediaWorkerJob, signal: AbortSignal, credentials?: WorkerCredentials): Promise<MediaResult>; }

const MAX_TEXT = 4096;
const MAX_PARAMETER_BYTES = 256 * 1024;
const MAX_TIMEOUT = 15 * 60 * 1000;
const MAX_OUTPUT_FILES = 100;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const validateFile = (value: unknown): void => {
  if (!isRecord(value) || !boundedString(value.path) || !boundedString(value.name, 512) || !boundedString(value.mime, 256) || !boundedString(value.kind, 32)) throw new Error('MEDIA_WORKER_INPUT_INVALID');
};

export function validateMediaWorkerResult(value: unknown): asserts value is MediaResult {
  if (!isRecord(value)) throw new Error('MEDIA_WORKER_RESULT_INVALID');
  for (const key of ['text', 'coverage'] as const) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('MEDIA_WORKER_RESULT_INVALID');
  if (value.incomplete !== undefined && typeof value.incomplete !== 'boolean') throw new Error('MEDIA_WORKER_RESULT_INVALID');
  for (const key of ['assets', 'contextAssets'] as const) {
    if (value[key] !== undefined) {
      if (!Array.isArray(value[key]) || value[key].length > MAX_OUTPUT_FILES) throw new Error('MEDIA_WORKER_RESULT_INVALID');
      for (const file of value[key]) validateFile(file);
    }
  }
}

export function validateMediaWorkerJob(job: MediaWorkerJob): void {
  if(job.processingSlots!==undefined&&(!Number.isInteger(job.processingSlots)||job.processingSlots<1||job.processingSlots>2))throw new Error('MEDIA_WORKER_SLOTS_INVALID');
  if (job.protocol !== MEDIA_WORKER_PROTOCOL || job.protocolVersion !== MEDIA_WORKER_PROTOCOL_VERSION) throw new Error('MEDIA_WORKER_PROTOCOL_UNSUPPORTED');
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(job.id) || !/^[a-zA-Z0-9._:-]{1,256}$/.test(job.scope) || !/^[a-z][a-z0-9_]{1,80}$/.test(job.operation) || !/^[a-z][a-z0-9_]{1,80}$/.test(job.handler) || !Array.isArray(job.inputs) || job.inputs.length > 8) throw new Error('MEDIA_WORKER_JOB_INVALID');
  for (const input of job.inputs) validateFile(input);
  if (!isRecord(job.parameters)) throw new Error('MEDIA_WORKER_PARAMETERS_INVALID');
  let parameterBytes: number;
  try { parameterBytes = Buffer.byteLength(JSON.stringify(job.parameters)); } catch { throw new Error('MEDIA_WORKER_PARAMETERS_INVALID'); }
  if (parameterBytes > MAX_PARAMETER_BYTES) throw new Error('MEDIA_WORKER_PARAMETERS_TOO_LARGE');
  if (!boundedString(job.output) || !boundedString(job.usagePath)) throw new Error('MEDIA_WORKER_PATH_INVALID');
  if (job.endpoint !== undefined) {
    if (!isRecord(job.endpoint) || !boundedString(job.endpoint.model, 256) || !boundedString(job.endpoint.baseUrl, 2048) || !/^[A-Z][A-Z0-9_]{0,127}$/.test(String(job.endpoint.keyEnv ?? ''))) throw new Error('MEDIA_WORKER_ENDPOINT_INVALID');
  }
  if (!Number.isSafeInteger(job.deadline) || (job.deadline !== 0 || job.timeoutMs !== 0) && job.deadline <= Date.now()) throw new Error('MEDIA_WORKER_JOB_EXPIRED');
  if (!Number.isSafeInteger(job.timeoutMs) || (job.timeoutMs !== 0 && job.timeoutMs < 1000) || job.timeoutMs > MAX_TIMEOUT) throw new Error('MEDIA_WORKER_TIMEOUT_INVALID');
  if (!Number.isSafeInteger(job.quotaUnits) || job.quotaUnits < 1 || job.quotaUnits > 10000) throw new Error('MEDIA_WORKER_QUOTA_INVALID');
}
