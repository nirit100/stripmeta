export interface PlatformCapabilities {
  canDecodeImage(mimeType: string): Promise<boolean>;
}

export interface StripperHandler {
  readonly name: string;
  readonly description: string;
  readonly lossless: boolean;
  /** True when the handler is new / not yet battle-tested in the wild. */
  readonly experimental?: boolean;
  supports(file: File, capabilities: PlatformCapabilities): Promise<boolean>;
  strip(file: File): Promise<Blob>;
}

export type WarningLevel = 'none' | 'experimental' | 'lossy' | 'unsupported';
