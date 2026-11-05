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

/** One event of the readable chat history export. */
export interface ChatHistoryEvent {
  type: string;
  data?: {source?:{kind?:string}; message?:{content:Array<{type?:string}>}; stream?:unknown; [key:string]:unknown};
  [key:string]:unknown;
}

/** Resolves the per-scope workspace without trusting any model-supplied path. */
export interface WorkspacePort {
  readonly home: string;
  scope(scopeKey: string): Promise<string>;
}
