// Settings store: the persisted app settings, change subscriptions, and
// localStorage persistence. No DOM — the settings panel UI (initSettings, reset
// buttons, animations) lives in scripts/settings.ts and drives this store.

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

const NO_PERSIST_KEY = 'stripmeta-no-persist';

/** True when the user opted out of persistence — saved values are ignored on load. */
export const noPersist = localStorage.getItem(NO_PERSIST_KEY) === '1';

function lsRead(key: string, def: boolean): boolean {
  if (noPersist) return def;
  const v = localStorage.getItem(key);
  return v === null ? def : v === '1';
}

const _state: SettingsState = {
  paranoid:         lsRead('stripmeta-paranoid',               false),
  skipClean:        !lsRead('stripmeta-process-clean',         false),
  skipUnsupported:  !lsRead('stripmeta-process-unsupported',   false),
  skipExperimental: !lsRead('stripmeta-process-experimental',  true),
  includeSkipped:   lsRead('stripmeta-include-skipped',        false),
  warnUnload:       lsRead('stripmeta-warn-unload',            import.meta.env.DEV ? false : true),
  autoAbout:        lsRead('stripmeta-auto-about',             true),
  showPreviews:     lsRead('stripmeta-show-previews',          true),
  persist:          !noPersist,
};

/** Effective settings as the app should read them (paranoid forces skipClean/skipExperimental off). */
export const settings: Readonly<SettingsState> = {
  get paranoid()          { return _state.paranoid; },
  get skipClean()         { return _state.paranoid ? false : _state.skipClean; },
  get skipUnsupported()   { return _state.skipUnsupported; },
  get skipExperimental()  { return _state.paranoid ? false : _state.skipExperimental; },
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

const PERSIST_KEYS = [
  'stripmeta-paranoid',
  'stripmeta-process-clean',
  'stripmeta-process-unsupported',
  'stripmeta-process-experimental',
  'stripmeta-include-skipped',
  'stripmeta-no-glass',
  'stripmeta-warn-unload',
  'stripmeta-auto-about',
  'stripmeta-show-previews',
] as const;

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
  localStorage.setItem('stripmeta-paranoid',              _state.paranoid ? '1' : '0');
  localStorage.setItem('stripmeta-process-clean',         (!_state.skipClean) ? '1' : '0');
  localStorage.setItem('stripmeta-process-unsupported',   (!_state.skipUnsupported) ? '1' : '0');
  localStorage.setItem('stripmeta-process-experimental',  (!_state.skipExperimental) ? '1' : '0');
  localStorage.setItem('stripmeta-include-skipped',       _state.includeSkipped ? '1' : '0');
  localStorage.setItem('stripmeta-no-glass',              noGlass ? '1' : '0');
  localStorage.setItem('stripmeta-warn-unload',           _state.warnUnload ? '1' : '0');
  localStorage.setItem('stripmeta-auto-about',            _state.autoAbout ? '1' : '0');
  localStorage.setItem('stripmeta-show-previews',         _state.showPreviews ? '1' : '0');
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
