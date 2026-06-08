import type { LogEntry } from '../scripts/logger.ts';

export function buildAnonMap(entries: readonly LogEntry[]): Map<string, string> {
  const fileMap = new Map<string, string>();    // full path → anon path
  const segmentMap = new Map<string, string>(); // individual segment → anon segment
  let fileN = 0;
  let folderN = 0;

  function anonSegment(seg: string, isFile: boolean): string {
    if (!segmentMap.has(seg)) {
      if (isFile) {
        fileN++;
        const dotIdx = seg.lastIndexOf('.');
        const ext = dotIdx > 0 ? seg.slice(dotIdx + 1).toLowerCase() : undefined;
        segmentMap.set(seg, ext ? `image_${fileN}.${ext}` : `image_${fileN}`);
      } else {
        folderN++;
        segmentMap.set(seg, `folder_${folderN}`);
      }
    }
    return segmentMap.get(seg)!;
  }

  for (const e of entries) {
    const key = e.filePath || e.fileName;
    if (!fileMap.has(key)) {
      const parts = key.split(/[\\/]/);
      const anon = parts.map((p, i) => anonSegment(p, i === parts.length - 1)).join('/');
      fileMap.set(key, anon);
    }
  }
  return fileMap;
}
