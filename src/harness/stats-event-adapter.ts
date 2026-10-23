import type {StatsService} from '../core/stats.js';

/** Converts native event callbacks into the stable StatsService seam. */
export class StatsEventAdapter {
  constructor(readonly stats: StatsService | (() => StatsService | undefined) | undefined) {}
  private current(): StatsService | undefined { return typeof this.stats === 'function' ? this.stats() : this.stats; }
  record(sessionId: string, event: unknown): void { this.current()?.recordNative(sessionId, event as any); }
  observe(sessionId: string, botId: string, rootSessionId: string, sessionKind: 'agent' | 'subagent'): void { this.current()?.observeSession(sessionId, botId, rootSessionId, sessionKind); }
}
