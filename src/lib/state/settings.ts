// Settings store: the persisted app settings, change subscriptions, and
// localStorage persistence. No DOM — the settings panel UI (initSettings, reset
// buttons, animations) lives in scripts/settings.ts and drives this store.
//
// Every per-setting fact comes from settingsSchema.ts; nothing here restates a
// default, a storage key, or an inversion.

import {
  SETTINGS, STORED_STATE_SETTINGS, PERSIST_KEYS,
  fromChecked, toChecked,
} from './settingsSchema.ts';
import type { SettingsState, SettingSpec } from './settingsSchema.ts';

export type { SettingsState, SettingSpec, SettingGroup } from './settingsSchema.ts';
export {
  SETTINGS, PERSIST_KEYS, starIdFor,
  toChecked, fromChecked, storedValue, checkedFromStored,
} from './settingsSchema.ts';

const NO_PERSIST_KEY = 'stripmeta-no-persist';

/** True when the user opted out of persistence — saved values are ignored on load. */
export const noPersist = localStorage.getItem(NO_PERSIST_KEY) === '1';

function lsRead(key: string, def: boolean): boolean {
  if (noPersist) return def;
  const v = localStorage.getItem(key);
  return v === null ? def : v === '1';
}

/** Loads a setting's state value from storage, honouring its inversion. */
function loadState(spec: SettingSpec): boolean {
  return fromChecked(spec, lsRead(spec.storageKey!, spec.defaultChecked));
}

const _state = Object.fromEntries([
  ...STORED_STATE_SETTINGS.map(spec => [spec.key!, loadState(spec)]),
  ['persist', !noPersist],
]) as SettingsState;

/**
 * Settings that paranoid mode forces off while it is on: it re-encodes
 * everything through canvas, so skipping "clean" or experimental files would
 * contradict what the user asked for.
 */
const FORCED_OFF_BY_PARANOID = SETTINGS
  .filter(s => s.forcedBy === 'paranoid' && s.key !== undefined)
  .map(s => s.key!);

function effective<K extends keyof SettingsState>(key: K): boolean {
  if (_state.paranoid && FORCED_OFF_BY_PARANOID.includes(key)) return false;
  return _state[key];
}

/** Effective settings as the app should read them (paranoid forces skipClean/skipExperimental off). */
export const settings: Readonly<SettingsState> = {
  get paranoid()          { return _state.paranoid; },
  get skipClean()         { return effective('skipClean'); },
  get skipUnsupported()   { return effective('skipUnsupported'); },
  get skipExperimental()  { return effective('skipExperimental'); },
  get includeSkipped()    { return _state.includeSkipped; },
  get warnUnload()        { return _state.warnUnload; },
  get autoAbout()         { return _state.autoAbout; },
  get showPreviews()      { return _state.showPreviews; },
  get persist()           { return _state.persist; },
};

/** Raw stored values without the paranoid override — for the panel's init sync. */
export const rawSettings: Readonly<SettingsState> = _state;

// — Change subscriptions —

type Listener = () => void;
const _subscribers = new Map<keyof SettingsState, Listener[]>();

export function onSettingChange(key: keyof SettingsState, fn: Listener): void {
  const list = _subscribers.get(key);
  if (list) list.push(fn);
  else _subscribers.set(key, [fn]);
}

/** Fire a key's listeners without mutating — for cascading effects (e.g. paranoid → skipClean). */
export function notifyChange(key: keyof SettingsState): void {
  _subscribers.get(key)?.forEach(fn => fn());
}

/** Set a raw setting and notify that key's listeners. */
export function setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void {
  _state[key] = value;
  notifyChange(key);
}

// — Persistence —

/** True if any persisted setting key exists in localStorage. */
export function hasSavedSettings(): boolean {
  return PERSIST_KEYS.some(k => localStorage.getItem(k) !== null);
}

/** Write a single setting to localStorage, respecting the persist toggle. */
export function persist(key: string, value: boolean): void {
  if (_state.persist) localStorage.setItem(key, value ? '1' : '0');
}

/**
 * Enable persistence and flush all current settings to localStorage. `noGlass`
 * is passed in because it lives in the DOM (a document class), not in _state.
 */
export function enablePersist(noGlass: boolean): void {
  _state.persist = true;
  localStorage.removeItem(NO_PERSIST_KEY);
  for (const spec of STORED_STATE_SETTINGS) {
    localStorage.setItem(spec.storageKey!, toChecked(spec, _state[spec.key!]) ? '1' : '0');
  }
  // Glass has no entry in the store — its state is a document class, so the
  // caller passes it in.
  const glass = SETTINGS.find(s => s.domId === 'toggle-glass')!;
  localStorage.setItem(glass.storageKey!, noGlass ? '1' : '0');
}

/** Disable persistence; future writes are suppressed and saved values ignored on next load. */
export function disablePersist(): void {
  _state.persist = false;
  localStorage.setItem(NO_PERSIST_KEY, '1');
}

/** Remove all persisted setting keys from localStorage. */
export function clearStoredKeys(): void {
  PERSIST_KEYS.forEach(k => localStorage.removeItem(k));
}
