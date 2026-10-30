import {skillOperationManifests, validateSkillSource} from './skill-operations.js';
import {Buffer} from 'node:buffer';
import type {InboundMessage} from './types.js';

/** Hard caps are deliberately centralized so channel adapters, tools and workers share one contract. */
export const INPUT_LIMITS = Object.freeze({
  messageTextBytes: 32 * 1024,
  quotedTextBytes: 32 * 1024,
  attachmentCount: 8,
  attachmentBytes: 50 * 1024 * 1024,
  batchMessages: 8,
  batchInputBytes: 256 * 1024,
  batchAttachmentBytes: 100 * 1024 * 1024,
  promptBytes: 8 * 1024,
  questionBytes: 8 * 1024,
  textParameterBytes: 32 * 1024,
  urlBytes: 2 * 1024,
  parameterBytes: 64 * 1024,
  identifierBytes: 200,
  replyFieldBytes: 4 * 1024,
});

export const VIDEO_LIMITS = Object.freeze({
  attachmentBytes: 500 * 1024 * 1024,
  deliveryBytes: 200 * 1024 * 1024,
  batchAttachmentBytes: 1000 * 1024 * 1024,
});

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringWithin = (value: unknown, limit: number): value is string => typeof value === 'string' && byteLength(value) <= limit;

function decodedBytes(value: string): number | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return;
  try {
    const bytes = Buffer.from(value, 'base64');
    // Canonical re-encoding catches values that Node's permissive decoder accepts.
    if (bytes.toString('base64') !== value) return;
    return bytes.length;
  } catch {
    return;
  }
}

function validateMediaInput(input: unknown): string | undefined {
  if (!isRecord(input)) return 'INVALID_MEDIA_INPUT';
  if (!['image', 'audio', 'video', 'file'].includes(String(input.kind))) return 'INVALID_MEDIA_KIND';
  if (!stringWithin(input.name, 512) || !stringWithin(input.mime, 200)) return 'MEDIA_METADATA_TOO_LARGE';
  for (const key of ['url', 'handle'] as const) {
    if (input[key] !== undefined && !stringWithin(input[key], INPUT_LIMITS.urlBytes)) return 'MEDIA_REFERENCE_TOO_LARGE';
  }
  if (input.bytes !== undefined) {
    if (typeof input.bytes !== 'string') return 'INVALID_MEDIA_BYTES';
    const size = decodedBytes(input.bytes);
    if (size === undefined) return 'INVALID_MEDIA_BYTES';
    if (size > (input.kind === 'video' ? VIDEO_LIMITS.attachmentBytes : INPUT_LIMITS.attachmentBytes)) return 'MEDIA_TOO_LARGE';
  }
  if (input.transcript !== undefined && !stringWithin(input.transcript, INPUT_LIMITS.textParameterBytes)) return 'MEDIA_TRANSCRIPT_TOO_LARGE';
  if (input.remote !== undefined) {
    if (!isRecord(input.remote)) return 'INVALID_MEDIA_REMOTE';
    for (const value of Object.values(input.remote)) if (value !== undefined && !stringWithin(value, INPUT_LIMITS.urlBytes)) return 'MEDIA_REFERENCE_TOO_LARGE';
  }
  return;
}

function validateReply(value: unknown): string | undefined {
  if (!isRecord(value) || Object.keys(value).length > 16) return 'INVALID_REPLY_METADATA';
  for (const item of Object.values(value)) if (!stringWithin(item, INPUT_LIMITS.replyFieldBytes)) return 'REPLY_METADATA_TOO_LARGE';
  return;
}

/** Validate host-observed input before it is admitted to the durable inbox. */
export function validateInboundMessage(message: InboundMessage): string | undefined {
  if (!isRecord(message) || !stringWithin(message.id, INPUT_LIMITS.identifierBytes)) return 'INVALID_MESSAGE_ID';
  if (!isRecord(message.scope)) return 'INVALID_CHANNEL_IDENTITY';
  for (const key of ['botId', 'platform', 'accountId', 'kind', 'channelId', 'senderId'] as const) {
    if (!stringWithin(message.scope[key], INPUT_LIMITS.identifierBytes)) return 'INVALID_CHANNEL_IDENTITY';
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(message.scope.platform) || !['private', 'group'].includes(message.scope.kind)) return 'INVALID_CHANNEL_IDENTITY';
  if (!Number.isSafeInteger(message.timestamp) || message.timestamp < 0) return 'INVALID_MESSAGE_TIMESTAMP';
  if (!stringWithin(message.text, INPUT_LIMITS.messageTextBytes)) return 'MESSAGE_TOO_LARGE';
  if (!Array.isArray(message.attachments) || message.attachments.length > INPUT_LIMITS.attachmentCount) return 'ATTACHMENT_COUNT_LIMIT';
  let attachmentBytes = 0, videoBytes = 0;
  for (const attachment of message.attachments) {
    const error = validateMediaInput(attachment);
    if (error) return error;
    if (attachment.bytes) {
      const size = decodedBytes(attachment.bytes) ?? 0;
      if (attachment.kind === 'video') videoBytes += size; else attachmentBytes += size;
    }
  }
  if (attachmentBytes > INPUT_LIMITS.attachmentBytes || videoBytes > VIDEO_LIMITS.attachmentBytes) return 'ATTACHMENT_BYTES_LIMIT';
  if (message.quoted !== undefined) {
    if (!isRecord(message.quoted)) return 'INVALID_QUOTED_MESSAGE';
    if (message.quoted.id !== undefined && !stringWithin(message.quoted.id, INPUT_LIMITS.identifierBytes)) return 'INVALID_QUOTED_MESSAGE';
    if (message.quoted.text !== undefined && !stringWithin(message.quoted.text, INPUT_LIMITS.quotedTextBytes)) return 'QUOTED_MESSAGE_TOO_LARGE';
    if (message.quoted.attachments !== undefined) {
      if (!Array.isArray(message.quoted.attachments) || message.quoted.attachments.length > INPUT_LIMITS.attachmentCount) return 'ATTACHMENT_COUNT_LIMIT';
      for (const attachment of message.quoted.attachments) {
        const error = validateMediaInput(attachment);
        if (error) return error;
        if (attachment.bytes) {
          const size = decodedBytes(attachment.bytes) ?? 0;
          if (attachment.kind === 'video') videoBytes += size; else attachmentBytes += size;
        }
      }
      if (attachmentBytes > INPUT_LIMITS.attachmentBytes || videoBytes > VIDEO_LIMITS.attachmentBytes) return 'ATTACHMENT_BYTES_LIMIT';
    }
  }
  const replyError=validateReply(message.reply);if(replyError)return replyError;
  if(message.replyEnvelope!==undefined){if(!isRecord(message.replyEnvelope)||message.replyEnvelope.channelId!==message.scope.platform||message.replyEnvelope.version!==1||!isRecord(message.replyEnvelope.payload))return'INVALID_REPLY_ENVELOPE';return validateReply(message.replyEnvelope.payload);}
  return;
}

export function messageInputBytes(message: InboundMessage, assetSize?: (handle: string) => number): number {
  const text = byteLength(message.text) + (message.quoted?.text ? byteLength(message.quoted.text) : 0);
  const attachments = [...message.attachments, ...(message.quoted?.attachments ?? [])];
  // Video bytes use their own budget below.
  return text + attachments.filter(input => input.kind !== 'video').reduce((total, input) => total + (input.bytes ? decodedBytes(input.bytes) ?? 0 : input.handle ? assetSize?.(input.handle) ?? 0 : 0), 0);
}

export function validateBatch(messages: readonly InboundMessage[], assetSize?: (handle: string) => number): void {
  if (messages.length > INPUT_LIMITS.batchMessages) throw new Error('BATCH_MESSAGE_LIMIT');
  const attachments = messages.flatMap(message => [...message.attachments, ...(message.quoted?.attachments ?? [])]);
  let attachmentBytes = 0, videoBytes = 0;
  for (const input of attachments) {
    const size = input.bytes ? decodedBytes(input.bytes) ?? 0 : input.handle ? assetSize?.(input.handle) ?? 0 : 0;
    if (input.kind === 'video') videoBytes += size; else attachmentBytes += size;
  }
  if (attachmentBytes > INPUT_LIMITS.batchAttachmentBytes || videoBytes > VIDEO_LIMITS.batchAttachmentBytes) throw new Error('BATCH_ATTACHMENT_BYTES_LIMIT');
  if (messages.reduce((total, message) => total + messageInputBytes(message, assetSize), 0) > INPUT_LIMITS.batchInputBytes) throw new Error('BATCH_INPUT_TOO_LARGE');
}

/** Validate parameters crossing the model-to-media seam before a worker is spawned. */
export function validateMediaParameters(operation: string, inputs: string[], parameters: Record<string, unknown>): void {
  if (!Array.isArray(inputs) || inputs.length > INPUT_LIMITS.attachmentCount || inputs.some(input => !stringWithin(input, INPUT_LIMITS.identifierBytes))) throw new Error('MEDIA_INPUT_LIMIT');
  let serialized: string;
  try { serialized = JSON.stringify(parameters); } catch { throw new Error('MEDIA_PARAMETERS_INVALID'); }
  if (byteLength(serialized) > INPUT_LIMITS.parameterBytes) throw new Error('MEDIA_PARAMETERS_TOO_LARGE');
  const textLimits:ReadonlyArray<readonly [string, number]> = [['prompt', INPUT_LIMITS.promptBytes], ['question', INPUT_LIMITS.questionBytes], ['text', INPUT_LIMITS.textParameterBytes], ['url', INPUT_LIMITS.urlBytes]];
  for (const [key, limit] of textLimits) {
    const value = parameters[key];
    if (value !== undefined && !stringWithin(value, limit)) throw new Error(`MEDIA_${key.toUpperCase()}_TOO_LARGE`);
  }
  const url = parameters.url;
  if (url !== undefined) {
    if (typeof url !== 'string') throw new Error('MEDIA_URL_INVALID');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) throw new Error();
    } catch { throw new Error('UNSAFE_MEDIA_URL'); }
  }
  for (const key of ['startSeconds', 'durationSeconds']) {
    const value = parameters[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 36000)) throw new Error('INVALID_MEDIA_RANGE');
  }
  const declaration = skillOperationManifests.flatMap(manifest => manifest.operations).find(item => item.id === operation);
  if(declaration?.localTransform){
    if(inputs.length!==1)throw new Error('ONE_MEDIA_INPUT_REQUIRED');
    if(parameters.url!==undefined)throw new Error('TRANSFORM_ATTACHMENT_REQUIRED');
    for(const [key,min,max] of [['quality',1,100],['maxWidth',1,16384],['maxHeight',1,16384],['maxBytes',1,20*1024*1024],['fps',12,50]] as const){const value=parameters[key];if(value!==undefined&&(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max))throw new Error('INVALID_TRANSFORM_PARAMETERS');}
    if(parameters.format!==undefined&&!['jpeg','png','webp','avif'].includes(String(parameters.format)))throw new Error('UNSUPPORTED_IMAGE_FORMAT');
    if(operation==='convert_gif'&&parameters.maxBytes!==undefined)throw new Error('GIF_SIZE_LIMIT_FIXED');
    if(operation==='image_resize'&&parameters.maxWidth===undefined&&parameters.maxHeight===undefined)throw new Error('IMAGE_SIZE_REQUIRED');
    if(operation==='convert_gif'&&parameters.durationSeconds===0)throw new Error('INVALID_MEDIA_RANGE');
  }
  if (declaration) validateSkillSource(declaration, inputs, parameters);
  if (operation === 'social_read' && url === undefined) throw new Error('SOCIAL_URL_REQUIRED');
}
