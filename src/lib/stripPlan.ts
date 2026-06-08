export interface FileEntry {
  file: File;
  path: string;
}

export function computeToProcess(
  entries: FileEntry[],
  getSkipReason: (file: File) => string | null,
  stripDoneOf: ReadonlySet<File>,
): FileEntry[] {
  return entries.filter(e => getSkipReason(e.file) === null && !stripDoneOf.has(e.file));
}

export function collectBlobs(
  entries: FileEntry[],
  getSkipReason: (file: File) => string | null,
  stripDoneOf: ReadonlySet<File>,
  strippedBlobOf: ReadonlyMap<File, Blob>,
  includeSkipped: boolean,
): { path: string; blob: Blob }[] {
  const result: { path: string; blob: Blob }[] = [];
  for (const { file, path } of entries) {
    if (stripDoneOf.has(file)) {
      result.push({ path, blob: strippedBlobOf.get(file)! });
    } else if (getSkipReason(file) !== null && includeSkipped) {
      result.push({ path, blob: file });
    }
  }
  return result;
}
