/**
 * The cheap pre-filter applied when files arrive, before anything is read.
 *
 * This is a filter, not an identification — it only decides what is worth
 * looking at. Everything that gets through is identified from its bytes later;
 * the point here is to be generous, because the MIME type the browser reports
 * is frequently empty for HEIC/HEIF and other formats the OS doesn't know.
 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'pjp',
  'png', 'apng',
  'gif',
  'webp',
  'bmp', 'dib',
  'tif', 'tiff',
  'svg', 'svgz',
  'heic', 'heif', 'heics', 'heifs',
  'avif', 'avifs',
  'ico', 'cur',
]);

export function looksLikeImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}
