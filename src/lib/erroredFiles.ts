const _files: { file: File; path: string }[] = [];

export function registerErroredFile(file: File, path: string): void {
  _files.push({ file, path });
}

export function clearErroredFiles(): void {
  _files.length = 0;
}

export function getErroredFiles(): { file: File; path: string }[] {
  return [..._files];
}
