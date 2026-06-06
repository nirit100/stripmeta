import type { StripperHandler } from './types.ts';
import { jpegStripper } from './jpeg.ts';
import { pngStripper } from './png.ts';
import { canvasStripper } from './canvas.ts';

export class StripperManager {
  private handlers: StripperHandler[] = [];

  register(handler: StripperHandler): this {
    this.handlers.push(handler);
    return this;
  }

  resolve(file: File): StripperHandler {
    const handler = this.handlers.find(h => h.canHandle(file));
    if (!handler) throw new Error(`No handler available for ${file.type || 'unknown type'}`);
    return handler;
  }

  strip(file: File): Promise<Blob> {
    return this.resolve(file).strip(file);
  }
}

// Default manager — handlers are tried in registration order; first match wins.
// canvasStripper must be last since it accepts everything as a fallback.
export const defaultStripperManager = new StripperManager()
  .register(jpegStripper)
  .register(pngStripper)
  .register(canvasStripper);
