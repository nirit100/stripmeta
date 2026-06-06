export interface PlatformCapabilities {
  canDecodeImage(mimeType: string): Promise<boolean>;
}

export interface StripperHandler {
  readonly name: string;
  readonly description: string;
  readonly lossless: boolean;
  supports(file: File, capabilities: PlatformCapabilities): Promise<boolean>;
  strip(file: File): Promise<Blob>;
}

export type WarningLevel = 'none' | 'lossy' | 'unsupported';
