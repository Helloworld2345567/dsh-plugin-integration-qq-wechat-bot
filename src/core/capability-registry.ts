/** Typed registry for business capabilities exposed by a Harness adapter. */
export type CapabilityConcurrency = 'parallel' | 'global' | 'scope' | number;

export interface CapabilityContext {
  signal: AbortSignal;
  scopeKey?: string;
  [key: string]: unknown;
}

export interface CapabilityDescriptor<Arguments = unknown, Result = unknown> {
  name: string;
  /** JSON-schema-compatible input description consumed by tool adapters. */
  schema?: unknown;
  /** Optional authorization hook. False or a thrown error rejects the call. */
  authorize?: (arguments_: Arguments, context: CapabilityContext) => boolean | void | Promise<boolean | void>;
  /** parallel is the default; global/scope serialize calls; a number limits concurrency. */
  concurrency?: CapabilityConcurrency;
  execute: (arguments_: Arguments, context: CapabilityContext) => Result | Promise<Result>;
}

type Pending = {run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void};

/**
 * A small, dependency-free registry. Core owns the policy and queue semantics;
 * Harness adapters only register schemas and callbacks.
 */
export class CapabilityRegistry {
  private readonly descriptors = new Map<string, CapabilityDescriptor<any, any>>();
  private readonly active = new Map<string, number>();
  private readonly queues = new Map<string, Pending[]>();

  register<Arguments, Result>(descriptor: CapabilityDescriptor<Arguments, Result>): () => void {
    if (!/^[a-z][a-z0-9_.-]{0,100}$/i.test(descriptor.name)) throw new Error('CAPABILITY_NAME_INVALID');
    if (this.descriptors.has(descriptor.name)) throw new Error(`CAPABILITY_ALREADY_REGISTERED: ${descriptor.name}`);
    this.descriptors.set(descriptor.name, descriptor as CapabilityDescriptor<any, any>);
    return () => {
      if (this.descriptors.get(descriptor.name) === descriptor) this.descriptors.delete(descriptor.name);
    };
  }

  has(name: string): boolean { return this.descriptors.has(name); }
  get(name: string): CapabilityDescriptor | undefined { return this.descriptors.get(name); }
  list(): readonly CapabilityDescriptor[] { return [...this.descriptors.values()]; }

  async execute<Arguments, Result>(name: string, arguments_: Arguments, context: CapabilityContext): Promise<Result> {
    const descriptor = this.descriptors.get(name) as CapabilityDescriptor<Arguments, Result> | undefined;
    if (!descriptor) throw new Error(`CAPABILITY_NOT_FOUND: ${name}`);
    context.signal.throwIfAborted();
    if (descriptor.authorize && (await descriptor.authorize(arguments_, context)) === false) throw new Error('CAPABILITY_NOT_AUTHORIZED');
    const limit = descriptor.concurrency === undefined || descriptor.concurrency === 'parallel' ? Number.POSITIVE_INFINITY : typeof descriptor.concurrency === 'number' ? Math.max(1, Math.floor(descriptor.concurrency)) : 1;
    const key = descriptor.concurrency === 'scope' ? `${name}:${context.scopeKey ?? 'global'}` : name;
    if (limit === Number.POSITIVE_INFINITY) return descriptor.execute(arguments_, context) as Promise<Result>;
    const active = this.active.get(key) ?? 0;
    if (active < limit) return this.runLimited(key, limit, descriptor, arguments_, context) as Promise<Result>;
    return new Promise<Result>((resolve, reject) => {
      const queue = this.queues.get(key) ?? [];
      const pending: Pending = {run: () => this.runLimited(key, limit, descriptor, arguments_, context), resolve: value => resolve(value as Result), reject};
      queue.push(pending);
      this.queues.set(key, queue);
      const cancel = () => {
        const current = this.queues.get(key); if (!current) return;
        const index = current.indexOf(pending);
        if (index >= 0) { current.splice(index, 1); reject(context.signal.reason ?? new Error('ABORT_ERR')); }
      };
      context.signal.addEventListener('abort', cancel, {once: true});
    });
  }

  private async runLimited<Arguments, Result>(key: string, _limit: number, descriptor: CapabilityDescriptor<Arguments, Result>, arguments_: Arguments, context: CapabilityContext): Promise<Result> {
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    try { context.signal.throwIfAborted(); return await descriptor.execute(arguments_, context); }
    finally {
      const next = (this.active.get(key) ?? 1) - 1;
      if (next <= 0) this.active.delete(key); else this.active.set(key, next);
      const queue = this.queues.get(key); const item = queue?.shift();
      if (item) { if (!queue?.length) this.queues.delete(key); void item.run().then(item.resolve, item.reject); }
    }
  }
}
