import type { StripperHandler, WarningLevel } from './types.ts';
import type { PlatformCapabilities } from '../platform/types.ts';
import { detectFormat } from '../format/detect.ts';
import type { DetectedFormat } from '../format/detect.ts';

export class StripperManager {
  private handlers: StripperHandler[] = [];

  constructor(private readonly capabilities: PlatformCapabilities) {}

  register(handler: StripperHandler): this {
    this.handlers.push(handler);
    return this;
  }

  /** First handler to claim `detected`, or null if none does. */
  private async claimant(detected: DetectedFormat): Promise<StripperHandler | null> {
    for (const handler of this.handlers) {
      if (await handler.claims(detected, this.capabilities)) return handler;
    }
    return null;
  }

  async resolve(file: File): Promise<StripperHandler> {
    const detected = await detectFormat(file);
    const handler = await this.claimant(detected);
    if (!handler) throw new Error(`No handler available for ${detected.format === 'unknown' ? (file.type || 'unknown type') : detected.format}`);
    return handler;
  }

  async classify(file: File): Promise<WarningLevel> {
    const handler = await this.claimant(await detectFormat(file));
    if (!handler) return 'unsupported';
    if (!handler.lossless) return 'lossy';
    return handler.experimental ? 'experimental' : 'none';
  }

  async strip(file: File): Promise<Blob> {
    const handler = await this.resolve(file);
    return handler.strip(file);
  }
}
