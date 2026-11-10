import type {ChannelReplyEnvelope, Delivery, Output, SessionBinding} from '../types.js';
import type {Page} from './common.js';

export type DeliveryState = Delivery['state'];

export interface DeliveryPageFilter {
  scopeKey?: string;
  botId?: string;
  states?: readonly DeliveryState[];
}

export interface DeliveryPageRequest {
  filter: DeliveryPageFilter;
  limit: number;
  cursor?: string;
}

/** Read and recovery operations of the outbound queue. */
export interface DeliveryQueueRepository {
  count(states: readonly string[]): number;
  pendingCount(): number;
  pendingBotIds(): readonly string[];
  nextSendable(botId: string, limit: number): readonly Delivery[];
  find(id: string, state?: DeliveryState): Delivery | undefined;
  findByAsset(scopeKey: string, assetId: string, states?: readonly DeliveryState[]): readonly Delivery[];
  retry(id: string): Delivery | undefined;
  hasEarlierBlocker(delivery: Delivery): boolean;
  pageDeliveries(request: DeliveryPageRequest): Page<Delivery>;
}

/**
 * Outbound delivery intents, attempts and their durable ordering.
 *
 * Enqueue, state transition and retry are the only ways to change a delivery.
 * The adapter never sends a platform message; it only records intent.
 */
export interface DeliveryRepository extends DeliveryQueueRepository {
  deliveries(states?: readonly string[]): Delivery[];
  deliveryState(delivery: Delivery, state: DeliveryState, receipt?: string, error?: string): void;
  enqueue(binding: SessionBinding, sourceId: string, turnId: string, outputs: readonly Output[], reply: Readonly<Record<string, string>>, replyEnvelope?: ChannelReplyEnvelope, progress?: NonNullable<Delivery['progress']>): void;
}
