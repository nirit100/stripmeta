export class StripState {
  readonly done    = new Set<File>();
  readonly errored = new Set<File>();
  readonly blobs   = new Map<File, Blob>();

  markDone(file: File, blob: Blob): void {
    this.done.add(file);
    this.blobs.set(file, blob);
    this.errored.delete(file);
  }

  markError(file: File): void {
    this.errored.add(file);
  }

  resetErrors(): void {
    this.errored.clear();
  }

  invalidate(): void {
    this.done.clear();
    this.errored.clear();
    this.blobs.clear();
  }

  remove(file: File): void {
    this.done.delete(file);
    this.errored.delete(file);
    this.blobs.delete(file);
  }
}
