export interface MetadataSection {
  name: string;
  entries: { key: string; value: string }[];
}

export interface MetadataPreview {
  gps: { latitude: number; longitude: number } | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  software: string | null;
  dateTime: Date | string | null;
  artist: string | null;
  userComment: string | null;
  hasAnyMetadata: boolean;
  parseErrored?: true;  // exifr threw during parsing! treat as not clean
}
