/** Exported history files of one channel scope. */
export interface HistoryLocation {
  scopeKey: string;
  sessionId: string;
  file: string;
}

export interface HistoryLocationRepository {
  find(sessionId: string): HistoryLocation | undefined;
  save(location: HistoryLocation): void;
  list(): readonly HistoryLocation[];
}

/** Resolves the per-scope workspace without trusting any model-supplied path. */
export interface WorkspacePort {
  readonly home: string;
  scope(scopeKey: string): Promise<string>;
}
