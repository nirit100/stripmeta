import type { SkipSettings } from './skip.ts';

export interface LevelCounts {
  lossy: number;
  unsupported: number;
  experimental: number;
}

/**
 * Builds the warning-banner lines (as HTML strings) explaining how the current
 * file set will be handled, given the per-level counts and the user's skip
 * settings. Returns an empty array when there is nothing to warn about.
 *
 * Wording mirrors the three concerns, in order:
 *   • unsupported — cannot be decoded in this browser
 *   • lossy       — no lossless handler; skipped, or re-encoded as JPEG
 *   • experimental — HEIC/AVIF; skipped, or handled with a caveat
 */
export function computeBannerLines(counts: LevelCounts, settings: SkipSettings): string[] {
  const { lossy, unsupported, experimental } = counts;
  const lines: string[] = [];

  if (unsupported) {
    lines.push(`<span class="text-error font-medium">${unsupported} file${unsupported > 1 ? 's' : ''} cannot be processed</span> — format not supported in this browser.`);
  }

  if (lossy) {
    const plural = lossy > 1;
    if (!settings.paranoid && settings.skipUnsupported) {
      lines.push(`<span class="text-warning font-medium">${lossy} file${plural ? 's' : ''} will be skipped</span> — no lossless handler exists for ${plural ? 'their' : 'its'} format${plural ? 's' : ''}.`);
    } else {
      const reason = settings.paranoid ? 'because paranoid mode is enabled.' : `no lossless handler exists for ${plural ? 'their' : 'its'} format${plural ? 's' : ''}.`;
      lines.push(`<span class="text-warning font-medium">${lossy} file${plural ? 's' : ''} will be re-encoded as JPEG</span> — ${reason}`);
    }
  }

  if (experimental) {
    const p = experimental > 1;
    if (settings.skipExperimental && !settings.paranoid) {
      lines.push(`<span class="text-base-content/60 font-medium">${experimental} file${p ? 's' : ''} will be skipped</span> — experimental format${p ? 's' : ''} (HEIC/AVIF) disabled in settings.`);
    } else {
      lines.push(`<span class="text-warning font-medium">${experimental} file${p ? 's' : ''} will use an experimental handler</span> — review the output carefully before sharing.`);
    }
  }

  return lines;
}
