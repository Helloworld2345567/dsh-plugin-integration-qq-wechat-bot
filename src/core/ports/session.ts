import type {CallerScope, SessionBinding, SessionRecord} from '../types.js';
import type {Page} from './common.js';

export interface SessionPageFilter {
  scopeKey?: string;
}

export interface SessionRepository {
  session(scope: CallerScope, id: string): SessionRecord;
  sessions(scope: CallerScope): SessionRecord[];
  sessionsAll(): SessionRecord[];
  findSession(id: string): SessionRecord | undefined;
  pageSessions(filter: SessionPageFilter, limit: number, cursor?: string): Page<SessionRecord>;
  sessionRecentSince(key: string): number;
  countSessions(): number;
}

/**
 * The channel-identity binding and its current session generation.  These two
 * values change together, so one adapter owns both tables.
 */
export interface BindingRepository {
  binding(scope: CallerScope): SessionBinding;
  findBinding(key: string): SessionBinding | undefined;
  bindings(): SessionBinding[];
  updateSession(binding: SessionBinding): SessionBinding;
  markSessionPersisted(binding: SessionBinding): void;
  reset(scope: CallerScope): SessionBinding;
  activateSession(scope: CallerScope, id: string): SessionBinding;
  recentSince(key: string): number;
  countBindings(): number;
}
