import type { DetectedFormat } from '../format/detect.ts';
import type { PlatformCapabilities } from '../platform/types.ts';

export type { PlatformCapabilities };

export interface StripperHandler {
  readonly name: string;
  readonly description: string;
  readonly lossless: boolean;
  /** True when the handler is new / not yet battle-tested in the wild. */
  readonly experimental?: boolean;

  /**
   * Whether this handler processes a file of the given identity.
   *
   * Takes the already-detected format rather than the File: identification
   * happens once, in the manager, and a handler decides from the result. Not
   * being handed the bytes is deliberate — it keeps magic-byte knowledge in
   * format/detect.ts instead of drifting back into the handlers.
   */
  claims(detected: DetectedFormat, capabilities: PlatformCapabilities): boolean | Promise<boolean>;

  strip(file: File): Promise<Blob>;
}

export type WarningLevel = 'none' | 'experimental' | 'lossy' | 'unsupported';
