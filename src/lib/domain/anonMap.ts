/**
 * The minimal shape buildAnonMap needs from each entry — a file path and name.
 * A logger LogEntry satisfies this structurally, so callers pass log entries
 * directly without coupling this pure module to the logger.
 */
export interface FileRef {
  filePath: string;
  fileName: string;
}

export function buildAnonMap(entries: readonly FileRef[]): Map<string, string> {
  const fileMap = new Map<string, string>();    // full path -> anon path
  const segmentMap = new Map<string, string>(); // individual segment -> anon segment
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
