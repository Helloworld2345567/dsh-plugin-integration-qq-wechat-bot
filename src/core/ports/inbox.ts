import type {InboundMessage} from '../types.js';

/** Accepted inbound messages and their processing state. */
export interface InboxRepository {
  accept(message: InboundMessage): boolean;
  messages(scope: string, states?: readonly string[]): InboundMessage[];
  nextBatch(scope: string, limit: number, deferredSince: number): InboundMessage[];
  pendingWindow(scope: string, limit: number): {count:number;hasDirectImage:boolean};
  source(scope: string, id: string): InboundMessage | undefined;
  updateMessage(scope: string, message: InboundMessage): void;
  mark(scope: string, ids: readonly string[], state: string): void;
  allMessages(states?: readonly string[]): InboundMessage[];
  scopesWithPending(states?: readonly string[]): string[];
  countMessages(): number;
}
