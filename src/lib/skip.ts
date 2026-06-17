import type { WarningLevel } from './strippers/types.ts';
import type { MetadataPreview } from './stripMeta.ts';

export interface SkipSettings {
  paranoid: boolean;
  skipUnsupported: boolean;
  skipExperimental: boolean;
  skipClean: boolean;
}

export type SkipReason = 'unsupported' | 'lossy' | 'experimental' | 'no-metadata';

// Read-only lookups, satisfied by both a Map and a FileStore adapter.
export interface Lookup<V> { get(file: File): V | undefined; }

export function getSkipReason(
  file: File,
  settings: SkipSettings,
  levelOf: Lookup<WarningLevel>,
  metadataCache: Lookup<MetadataPreview>,
): SkipReason | null {
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

/**
 * The status-badge presentation for a skip reason. 'unsupported' is hidden
 * (the red ✕ Unsupported badge already conveys it); a null reason means the
 * file is strippable ("Ready").
 */
export function skipStatusLabel(reason: SkipReason | null): { hidden: boolean; text: string } {
  switch (reason) {
    case 'unsupported':  return { hidden: true,  text: '' };
    case 'lossy':        return { hidden: false, text: 'Skipped — lossy only' };
    case 'experimental': return { hidden: false, text: 'Skipped — experimental' };
    case 'no-metadata':  return { hidden: false, text: 'Skipped — no metadata' };
    default:             return { hidden: false, text: 'Ready' };
  }
}
