import { StripperManager } from './manager.ts';
import { jpegStripper } from './jpeg.ts';
import { pngStripper } from './png.ts';
import { webpStripper } from './webp.ts';
import { heicStripper } from './heic.ts';
import { avifStripper } from './avif.ts';
import { canvasStripper } from './canvas.ts';
import { browserCapabilities } from '../platform/platform.ts';

// Handlers are tried in registration order; first match wins.
// canvasStripper must be last — it defers to capabilities to decide support.
export const defaultStripperManager = new StripperManager(browserCapabilities)
  .register(jpegStripper)
  .register(pngStripper)
  .register(webpStripper)
  .register(heicStripper)
  .register(avifStripper)
  .register(canvasStripper);

// Paranoid mode: skip all native handlers and always re-encode through canvas.
// Output is always JPEG at 0.95 quality, stripping every form of embedded metadata.
export const paranoidStripperManager = new StripperManager(browserCapabilities)
  .register(canvasStripper);

export function stripMetadata(file: File): Promise<Blob> {
  return defaultStripperManager.strip(file);
}
