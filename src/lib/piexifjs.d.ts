declare module 'piexifjs' {
  const piexif: {
    remove(jpegDataUrl: string): string;
    load(jpegDataUrl: string): Record<string, unknown>;
    dump(exifObj: Record<string, unknown>): string;
    insert(exifBytes: string, jpegDataUrl: string): string;
  };
  export default piexif;
}
