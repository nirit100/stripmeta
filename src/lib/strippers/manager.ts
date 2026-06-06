import type { StripperHandler, PlatformCapabilities, WarningLevel } from './types.ts';

export class StripperManager {
  private handlers: StripperHandler[] = [];

  constructor(private readonly capabilities: PlatformCapabilities) {}

  register(handler: StripperHandler): this {
    this.handlers.push(handler);
    return this;
  }

  async resolve(file: File): Promise<StripperHandler> {
    for (const handler of this.handlers) {
      if (await handler.supports(file, this.capabilities)) return handler;
    }
    throw new Error(`No handler available for ${file.type || 'unknown type'}`);
  }

  async classify(file: File): Promise<WarningLevel> {
    for (const handler of this.handlers) {
      if (await handler.supports(file, this.capabilities)) {
        return handler.lossless ? 'none' : 'lossy';
      }
    }
    return 'unsupported';
  }

  strip(file: File): Promise<Blob> {
    return this.resolve(file).then(h => h.strip(file));
  }
}
