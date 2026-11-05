import {createHash} from 'node:crypto';
import type {CallerScope} from './types.js';

/**
 * Stable isolation key for one channel identity.  Channel identity owns
 * sessions, attachments, memories and outputs; a model never supplies it.
 */
export function scopeKey(scope: CallerScope): string {
  return createHash('sha256').update(JSON.stringify([scope.platform, scope.botId, scope.accountId, scope.kind, scope.channelId, scope.senderId])).digest('hex');
}
