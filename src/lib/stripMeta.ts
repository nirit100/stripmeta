import exifr from 'exifr';
import { StripperManager } from './strippers/manager.ts';
import { jpegStripper } from './strippers/jpeg.ts';
import { pngStripper } from './strippers/png.ts';
import { webpStripper } from './strippers/webp.ts';
import { canvasStripper } from './strippers/canvas.ts';
import { browserCapabilities } from './platform.ts';

export type { StripperHandler, WarningLevel } from './strippers/types.ts';
export { StripperManager };

// Handlers are tried in registration order; first match wins.
// canvasStripper must be last — it defers to capabilities to decide support.
export const defaultStripperManager = new StripperManager(browserCapabilities)
  .register(jpegStripper)
  .register(pngStripper)
  .register(webpStripper)
  .register(canvasStripper);

export interface MetadataPreview {
  gps: { latitude: number; longitude: number } | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  software: string | null;
  dateTime: string | null;
}

export async function readMetadata(file: File): Promise<MetadataPreview> {
  const raw = await exifr.parse(file, {
    pick: ['Make', 'Model', 'SerialNumber', 'Software', 'DateTimeOriginal', 'DateTime'],
    gps: true,
  }).catch(() => null);

  if (!raw) {
    return { gps: null, make: null, model: null, serialNumber: null, software: null, dateTime: null };
  }

  const gps = (raw.latitude != null && raw.longitude != null)
    ? { latitude: raw.latitude as number, longitude: raw.longitude as number }
    : null;

  return {
    gps,
    make: raw.Make ?? null,
    model: raw.Model ?? null,
    serialNumber: raw.SerialNumber ?? null,
    software: raw.Software ?? null,
    dateTime: raw.DateTimeOriginal ?? raw.DateTime ?? null,
  };
}

export function stripMetadata(file: File): Promise<Blob> {
  return defaultStripperManager.strip(file);
}
