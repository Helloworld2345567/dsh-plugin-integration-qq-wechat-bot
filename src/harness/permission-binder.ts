/** Small adapter for the mutable permission preset service. */
export class PermissionBinder {
  private readonly bound = new WeakMap<object, string>();
  current(owner: object): string | undefined { return this.bound.get(owner); }
  bind(owner: object, preset: string): void { this.bound.set(owner, preset); }
  revoke(owner: object): void { this.bound.delete(owner); }
}
