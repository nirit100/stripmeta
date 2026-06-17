import type { FileEntry } from './stripPlan.ts';
import type { WarningLevel, MetadataPreview } from './stripMeta.ts';
import type { SkipSettings, SkipReason } from './skip.ts';
import type { LevelCounts } from './banner.ts';
import type { DirStats } from './dirStats.ts';
import { getSkipReason } from './skip.ts';
import { StripState } from './stripState.ts';
import { computeDirStats } from './dirStats.ts';
import { isFlatMode, sortForFlatList } from './flatList.ts';
import { entriesUnder } from './fileTree.ts';

/** Per-file analysis: classification result plus the metadata preview once read. */
export interface FileModel {
  level: WarningLevel;
  canConvertPng: boolean;
  preview?: MetadataPreview;
}

/**
 * The session data model: the list of file entries, their per-file analysis,
 * and the strip results. Replaces what used to be a handful of parallel
 * module-global maps (levelOf / canConvertPngOf / metadataCache) kept in sync
 * by hand. Pure data + derivation — no DOM — so it is unit-testable on its own.
 *
 * DOM bookkeeping (row elements, object URLs, etc.) deliberately lives outside
 * this class; the store only knows about files and their derived facts.
 */
export class FileStore {
  entries: FileEntry[] = [];
  private readonly models = new Map<File, FileModel>();
  readonly strip = new StripState();

  get size(): number { return this.entries.length; }
  get isEmpty(): boolean { return this.entries.length === 0; }

  /** True once classification has populated models — the "analysed" flag. */
  get classified(): boolean { return this.models.size > 0; }

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Appends entries not already present (by File identity); returns the added ones. */
  add(incoming: FileEntry[]): FileEntry[] {
    const existing = new Set(this.entries.map(e => e.file));
    const fresh = incoming.filter(e => !existing.has(e.file));
    this.entries = [...this.entries, ...fresh];
    return fresh;
  }

  /**
   * Replaces classification results for the current entries. Existing previews
   * are preserved (metadata is read separately, after classification, and must
   * survive a re-classify e.g. on a paranoid-mode toggle).
   */
  setClassification(results: Map<File, { level: WarningLevel; canConvertPng: boolean }>): void {
    const next = new Map<File, FileModel>();
    for (const [file, { level, canConvertPng }] of results) {
      next.set(file, { level, canConvertPng, preview: this.models.get(file)?.preview });
    }
    this.models.clear();
    for (const [file, model] of next) this.models.set(file, model);
  }

  /** Records the metadata preview for a file. */
  setPreview(file: File, preview: MetadataPreview): void {
    const model = this.models.get(file);
    if (model) model.preview = preview;
    else this.models.set(file, { level: 'none', canConvertPng: false, preview });
  }

  /** Removes a single entry and all its derived state. */
  remove(entry: FileEntry): void {
    this.models.delete(entry.file);
    this.strip.remove(entry.file);
    this.entries = this.entries.filter(e => e !== entry);
  }

  /** Removes every entry whose file is in `files` (e.g. a whole directory). */
  removeFiles(files: File[]): void {
    const drop = new Set(files);
    for (const file of drop) { this.models.delete(file); this.strip.remove(file); }
    this.entries = this.entries.filter(e => !drop.has(e.file));
  }

  /** Resets everything to the empty state. */
  clear(): void {
    this.entries = [];
    this.models.clear();
    this.strip.invalidate();
  }

  // ── Per-file queries ────────────────────────────────────────────────────────

  level(file: File): WarningLevel | undefined { return this.models.get(file)?.level; }
  canConvertPng(file: File): boolean { return this.models.get(file)?.canConvertPng ?? false; }
  preview(file: File): MetadataPreview | undefined { return this.models.get(file)?.preview; }

  /** Why this file would be skipped under the given settings, or null if it will be stripped. */
  skipReason(file: File, settings: SkipSettings): SkipReason | null {
    return getSkipReason(
      file, settings,
      { get: f => this.models.get(f)?.level },
      { get: f => this.models.get(f)?.preview },
    );
  }

  // ── Aggregate queries ────────────────────────────────────────────────────────

  /** Per-level counts across all entries, for the warning banner. */
  bannerCounts(): LevelCounts {
    let lossy = 0, unsupported = 0, experimental = 0;
    for (const e of this.entries) {
      switch (this.models.get(e.file)?.level) {
        case 'lossy':        lossy++; break;
        case 'unsupported':  unsupported++; break;
        case 'experimental': experimental++; break;
      }
    }
    return { lossy, unsupported, experimental };
  }

  /** Status tally for the files under a directory path. */
  dirStats(path: string, settings: SkipSettings): DirStats {
    return computeDirStats(entriesUnder(this.entries, path), {
      skipReason: f => this.skipReason(f, settings),
      done: this.strip.done,
      errored: this.strip.errored,
    });
  }

  /** True when no entry carries a directory path (the flat, non-tree layout). */
  isFlat(): boolean { return isFlatMode(this.entries); }

  /** Entries ordered for the flat list (strippable first, then by warning level). */
  flatSorted(settings: SkipSettings): FileEntry[] {
    return sortForFlatList(this.entries, {
      skipReason: f => this.skipReason(f, settings),
      level: f => this.level(f),
    });
  }

  /** True if any entry is strippable but not yet stripped (used to restore the Strip button). */
  hasPendingStrippable(settings: SkipSettings): boolean {
    return this.entries.some(e => this.skipReason(e.file, settings) === null && !this.strip.done.has(e.file));
  }
}
