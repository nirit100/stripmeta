export interface ObjectUrlFactory {
  createObjectURL(obj: Blob): string;
  revokeObjectURL(url: string): void;
}

/**
 * Owns the object URLs behind file thumbnails.
 *
 * Revoking is tied to the entry rather than left to the call site: `create`
 * releases any URL the file already had, so re-rendering a card can't strand
 * the previous one (which would pin the whole file in memory).
 */
export class ThumbUrls {
  private readonly urls = new Map<File, string>();

  constructor(private readonly factory: ObjectUrlFactory = URL) {}

  /** A fresh object URL for `file`, releasing any previous one. */
  create(file: File): string {
    this.release(file);
    const url = this.factory.createObjectURL(file);
    this.urls.set(file, url);
    return url;
  }

  get(file: File): string | undefined {
    return this.urls.get(file);
  }

  release(file: File): void {
    const url = this.urls.get(file);
    if (url === undefined) return;
    this.urls.delete(file);
    this.factory.revokeObjectURL(url);
  }

  releaseAll(): void {
    for (const url of this.urls.values()) this.factory.revokeObjectURL(url);
    this.urls.clear();
  }

  get size(): number {
    return this.urls.size;
  }
}
