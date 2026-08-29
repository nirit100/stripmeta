/**
 * What the app needs to know about the browser it is running in.
 *
 * Declared here, alongside the implementation, rather than in strippers/ —
 * an interface belongs with whoever implements it, not whoever consumes it.
 */
export interface PlatformCapabilities {
  canDecodeImage(mimeType: string): Promise<boolean>;
}
