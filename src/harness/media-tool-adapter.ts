import type {BotConfig} from '../core/types.js';
import type {MediaOperation} from '../core/media-operation-registry.js';
import type {MediaService} from '../core/media.js';

/** Harness adapter for the versioned core media operation port. */
export class MediaToolAdapter {
  constructor(readonly media: MediaService) {}
  run(scope: string, operation: MediaOperation, config: BotConfig, inputs: string[], parameters: Record<string, unknown>, signal: AbortSignal) {
    return this.media.run(scope, operation, config, inputs, parameters, signal);
  }
}
