export interface LogEntry {
  level: 'error' | 'warning';
  fileName: string;
  filePath: string;
  message: string;
}

const _entries: LogEntry[] = [];
const _listeners: (() => void)[] = [];

export function logEntry(entry: LogEntry) {
  _entries.push(entry);
  _listeners.forEach(fn => fn());
}

export function clearLog() {
  _entries.length = 0;
  _listeners.forEach(fn => fn());
}

export function getLog(): readonly LogEntry[] {
  return _entries;
}

export function onLogChange(fn: () => void): void {
  _listeners.push(fn);
}

export function humanizeError(err: unknown): string {
  // piexifjs throws a plain string (not Error), so handle both
  const raw = err instanceof Error ? err.message : String(err);
  if (/not jpeg/i.test(raw))              return 'File is not a valid JPEG despite its extension or MIME type';
  if (/canvas encoding failed/i.test(raw)) return 'Browser could not re-encode the image via canvas';
  if (/could not decode image/i.test(raw)) return 'Browser could not decode this image format';
  if (/invalid png/i.test(raw))           return 'PNG file is corrupted or has an unrecognised structure';
  if (/webp.*(invalid|corrupt)/i.test(raw) || /(invalid|corrupt).*webp/i.test(raw))
                                           return 'WebP file is corrupted or invalid';
  return raw.trim() || 'An unexpected error occurred';
}
