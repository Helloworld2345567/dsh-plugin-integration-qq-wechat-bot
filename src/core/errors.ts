import {diagnostic,formatDiagnostic,type DiagnosticKey} from '../i18n/diagnostics.js';
import type {MessageDescriptor} from '../i18n/common.js';

export class LocalizedError extends Error {
  constructor(readonly localizedMessage:MessageDescriptor,fallback?:string){super(fallback??formatDiagnostic(localizedMessage,'zh')??localizedMessage.key);}
}
export const localizedError=(key:DiagnosticKey,params?:MessageDescriptor['params'])=>new LocalizedError(diagnostic(key,params));

/** Optimistic-concurrency failure surfaced to the operator and tool layers. */
export class ConflictError extends Error {
  readonly localizedMessage:MessageDescriptor;
  constructor(message = '配置已被其他操作修改，请刷新后重试',descriptor:MessageDescriptor=diagnostic('conflict')) { super(message);this.localizedMessage=descriptor; }
}
