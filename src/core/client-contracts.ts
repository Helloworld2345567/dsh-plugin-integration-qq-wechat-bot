/**
 * Browser-safe type surface for the management client.
 * This module contains no runtime imports or values.
 */
export type {BotConfig,BotSettings,BotInstance} from './types.js';
export type {StatsResult} from './stats.js';
export type {PublicServiceProfile} from './service-management.js';
export interface PrivateSessionView {senderId:string;sessionId:string;platform:string;personaId:string}
import type {Delivery,DeliveryAttempt} from './types.js';
export type DeliveryRecordView=Pick<Delivery,'id'|'botId'|'purpose'|'state'|'receipt'|'error'|'createdAt'|'sentAt'|'sessionId'|'turnId'>&{
  output:Pick<Delivery['output'],'type'>;
  attempt?:Pick<DeliveryAttempt,'number'|'phase'|'startedAt'|'lastError'|'causeCode'|'causeMessage'|'httpStatus'|'platformCode'|'platformMessage'|'platformTraceId'>;
};
