/** Harness-facing session ownership seam. Agent runtime types stay here. */
export class AgentSessionHost<Session> {
  readonly sessions = new Map<string, Session>();
  get(id: string): Session | undefined { return this.sessions.get(id); }
  set(id: string, value: Session): void { this.sessions.set(id, value); }
  delete(id: string): void { this.sessions.delete(id); }
  values(): IterableIterator<Session> { return this.sessions.values(); }
  clear(): void { this.sessions.clear(); }
}
