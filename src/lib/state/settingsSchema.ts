/**
 * The single description of every setting.
 *
 * Each fact about a setting — its storage key, its default, whether the toggle
 * shows the negation of the stored value, which reset group it belongs to —
 * used to be restated in the state initialiser, the persist-key list, the
 * flush-on-enable writer, the panel's default-checked map, and the reset
 * snapshot. Five places, and the inversion in four of them. It lives here now,
 * and everything else is derived.
 */

export interface SettingsState {
  paranoid: boolean;
  skipClean: boolean;
  skipUnsupported: boolean;
  skipExperimental: boolean;
  includeSkipped: boolean;
  warnUnload: boolean;
  autoAbout: boolean;
  showPreviews: boolean;
  persist: boolean;
}

export type SettingGroup = 'processing' | 'appearance' | 'technical';

export interface SettingSpec {
  /** Checkbox element id in the settings panel. */
  domId: string;
  group: SettingGroup;
  /** Default as the *toggle* shows it. */
  defaultChecked: boolean;

  /**
   * State key. Absent for toggles with no entry in SettingsState — `glass`
   * lives in a document class rather than the store.
   */
  key?: keyof SettingsState;
  /** localStorage key. Absent for `persist`, which manages its own opt-out flag. */
  storageKey?: string;
  /**
   * The state value is the negation of the toggle: "Process files with no
   * metadata" is checked exactly when `skipClean` is false. Storage still
   * matches the toggle, since the key is named for the toggle.
   */
  inverted?: boolean;
  /**
   * The stored value is the negation of the toggle. Only `glass`, whose key is
   * named `no-glass` while its toggle reads "enable effects".
   */
  storageInverted?: boolean;
  /** While this setting is on, the toggle is forced checked and locked. */
  forcedBy?: keyof SettingsState;
}

export const SETTINGS: readonly SettingSpec[] = [
  { domId: 'toggle-paranoid',           group: 'processing', defaultChecked: false, key: 'paranoid',         storageKey: 'stripmeta-paranoid' },
  { domId: 'toggle-skip-clean',         group: 'processing', defaultChecked: false, key: 'skipClean',        storageKey: 'stripmeta-process-clean',        inverted: true, forcedBy: 'paranoid' },
  { domId: 'toggle-skip-unsupported',   group: 'processing', defaultChecked: false, key: 'skipUnsupported',  storageKey: 'stripmeta-process-unsupported',  inverted: true },
  { domId: 'toggle-skip-experimental',  group: 'processing', defaultChecked: true,  key: 'skipExperimental', storageKey: 'stripmeta-process-experimental', inverted: true, forcedBy: 'paranoid' },
  { domId: 'toggle-include-skipped',    group: 'processing', defaultChecked: false, key: 'includeSkipped',   storageKey: 'stripmeta-include-skipped' },

  { domId: 'toggle-auto-about',         group: 'appearance', defaultChecked: true,  key: 'autoAbout',        storageKey: 'stripmeta-auto-about' },
  { domId: 'toggle-warn-unload',        group: 'appearance', defaultChecked: !import.meta.env.DEV, key: 'warnUnload', storageKey: 'stripmeta-warn-unload' },
  { domId: 'toggle-show-previews',      group: 'appearance', defaultChecked: true,  key: 'showPreviews',     storageKey: 'stripmeta-show-previews' },
  // No state key: the glass effect is a document class, read back from storage
  // on load by the inline theme script rather than through the settings store.
  { domId: 'toggle-glass',              group: 'appearance', defaultChecked: true,  storageKey: 'stripmeta-no-glass', storageInverted: true },

  // No storage key: persistence is the opt-out flag itself, and must survive
  // clearStoredKeys, so it is written separately.
  { domId: 'toggle-persist',            group: 'technical',  defaultChecked: true,  key: 'persist' },
] as const;

/** Specs backed by a localStorage key — everything clearStoredKeys clears. */
export const PERSISTED_SETTINGS = SETTINGS.filter(s => s.storageKey !== undefined);

/** Specs backed by both a state key and storage — the ordinary load/save path. */
export const STORED_STATE_SETTINGS = SETTINGS.filter(s => s.key !== undefined && s.storageKey !== undefined);

export const PERSIST_KEYS: readonly string[] = PERSISTED_SETTINGS.map(s => s.storageKey!);

/** The star element paired with a toggle, marking it as changed from default. */
export function starIdFor(spec: SettingSpec): string {
  return spec.domId.replace('toggle-', 'star-');
}

/** The toggle position that represents a state value. */
export function toChecked(spec: SettingSpec, stateValue: boolean): boolean {
  return spec.inverted ? !stateValue : stateValue;
}

/** The state value a toggle position represents. */
export function fromChecked(spec: SettingSpec, checked: boolean): boolean {
  return spec.inverted ? !checked : checked;
}

/** The value to write to storage for a toggle position. */
export function storedValue(spec: SettingSpec, checked: boolean): boolean {
  return spec.storageInverted ? !checked : checked;
}

/** The toggle position a stored value represents. */
export function checkedFromStored(spec: SettingSpec, stored: boolean): boolean {
  return spec.storageInverted ? !stored : stored;
}
