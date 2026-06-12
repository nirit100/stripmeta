import type { WarningLevel } from './strippers/types.ts';
import type { MetadataPreview } from './stripMeta.ts';

export interface SkipSettings {
  paranoid: boolean;
  skipUnsupported: boolean;
  skipExperimental: boolean;
  skipClean: boolean;
}

export function getSkipReason(
  file: File,
  settings: SkipSettings,
  levelOf: Map<File, WarningLevel>,
  metadataCache: Map<File, MetadataPreview>,
): 'unsupported' | 'lossy' | 'experimental' | 'no-metadata' | null {
  if (settings.skipUnsupported) {
    const level = levelOf.get(file);
    if (level === 'unsupported') return 'unsupported';
    // 'lossy' means no lossless handler — treat as unsupported unless paranoid mode
    // (paranoid explicitly re-encodes via canvas, so the user accepts lossy output)
    if (!settings.paranoid && level === 'lossy') return 'lossy';
  }
  if (settings.skipExperimental && !settings.paranoid) {
    const level = levelOf.get(file);
    if (level === 'experimental') return 'experimental';
  }
  if (settings.skipClean) {
    const meta = metadataCache.get(file);
    if (meta && !meta.hasAnyMetadata && !meta.parseErrored) {
      return 'no-metadata';
    }
  }
  return null;
}
