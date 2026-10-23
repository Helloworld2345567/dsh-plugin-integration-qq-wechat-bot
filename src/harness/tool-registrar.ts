/** Owns registration/disposal of a capability group for one live agent. */
export class ToolRegistrar<T = unknown> {
  private readonly groups = new Map<string, Array<() => void>>();
  constructor(readonly register: (tool: T) => () => void) {}
  add(group: string, tool: T): void { const list = this.groups.get(group) ?? []; list.push(this.register(tool)); this.groups.set(group, list); }
  clear(group: string): void { for (const dispose of this.groups.get(group) ?? []) dispose(); this.groups.delete(group); }
  dispose(): void { for (const group of this.groups.keys()) this.clear(group); }
}
