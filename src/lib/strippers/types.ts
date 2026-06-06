export interface StripperHandler {
  readonly name: string;
  readonly description: string;
  canHandle(file: File): boolean;
  strip(file: File): Promise<Blob>;
}
