import type { MetadataPreview } from './stripMeta.ts';
import { formatGps } from './format.ts';

// A presentation-neutral description of one preview badge. The DOM layer turns
// these into elements: 'gps' becomes an interactive button (opens the map
// popover), 'plain' becomes a static badge with optional tooltip text.
export type PreviewBadge =
  | { kind: 'gps'; lat: number; lon: number; coord: string }
  | { kind: 'plain'; cls: string; text: string; tip?: string };

/**
 * Formats an EXIF date for the preview badge. Accepts a real Date or the raw
 * EXIF "YYYY:MM:DD HH:MM:SS" string (whose colon date separators JS can't
 * parse), falling back to the original string if it isn't a valid date.
 */
export function formatPreviewDate(dateTime: Date | string): string {
  const d = dateTime instanceof Date
    ? dateTime
    : new Date(String(dateTime).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
  return !isNaN(d.getTime()) ? d.toDateString() : String(dateTime);
}

/**
 * Maps a metadata preview to the ordered list of badges to display on a file
 * card. Order is fixed (GPS, camera, serial, date, software, artist, comment,
 * unreadable) and only present fields produce a badge.
 */
export function buildPreviewBadges(p: MetadataPreview): PreviewBadge[] {
  const badges: PreviewBadge[] = [];

  if (p.gps) {
    const { latitude, longitude } = p.gps;
    badges.push({ kind: 'gps', lat: latitude, lon: longitude, coord: formatGps(latitude, longitude) });
  }
  if (p.make || p.model) {
    const cam = [p.make, p.model].filter(Boolean).join(' ');
    badges.push({ kind: 'plain', cls: 'badge-neutral max-w-[9rem]', text: '📷 ' + cam, tip: cam });
  }
  if (p.serialNumber) {
    badges.push({ kind: 'plain', cls: 'badge-warning', text: 'S/N', tip: p.serialNumber });
  }
  if (p.dateTime) {
    badges.push({ kind: 'plain', cls: 'badge-neutral font-mono', text: '📅 ' + formatPreviewDate(p.dateTime) });
  }
  if (p.software) {
    badges.push({ kind: 'plain', cls: 'badge-neutral max-w-[9rem]', text: '🛠️ ' + p.software, tip: p.software });
  }
  if (p.artist) {
    badges.push({ kind: 'plain', cls: 'badge-error max-w-[9rem]', text: '👤 ' + p.artist, tip: p.artist });
  }
  if (p.userComment) {
    badges.push({ kind: 'plain', cls: 'badge-warning', text: '💬 Comment', tip: p.userComment });
  }
  if (p.parseErrored) {
    badges.push({ kind: 'plain', cls: 'badge-warning', text: '⚠ unreadable', tip: 'Metadata could not be parsed' });
  }

  return badges;
}
