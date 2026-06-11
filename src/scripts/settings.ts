// — DOM refs (only used inside initSettings) —

const toggleAutoAbout       = document.getElementById('toggle-auto-about') as HTMLInputElement;
const toggleParanoid        = document.getElementById('toggle-paranoid') as HTMLInputElement;
const toggleSkipClean       = document.getElementById('toggle-skip-clean') as HTMLInputElement;
const toggleSkipUnsupported = document.getElementById('toggle-skip-unsupported') as HTMLInputElement;
const toggleIncludeSkipped  = document.getElementById('toggle-include-skipped') as HTMLInputElement;
const toggleWarnUnload      = document.getElementById('toggle-warn-unload') as HTMLInputElement;
const togglePersist         = document.getElementById('toggle-persist') as HTMLInputElement;
const toggleNoGlass         = document.getElementById('toggle-no-glass') as HTMLInputElement;
const clearStorageHint      = document.getElementById('clear-storage-hint')!;
const btnClearStorage       = document.getElementById('btn-clear-storage') as HTMLButtonElement;

// — Cached state (initialized from localStorage, no DOM dependency) —

interface SettingsState {
  paranoid: boolean;
  skipClean: boolean;
  skipUnsupported: boolean;
  includeSkipped: boolean;
  warnUnload: boolean;
  autoAbout: boolean;
  persist: boolean;
}

const _noPersist = localStorage.getItem('stripmeta-no-persist') === '1';

function lsRead(key: string, def: boolean): boolean {
  if (_noPersist) return def;
  const v = localStorage.getItem(key);
  return v === null ? def : v === '1';
}

const _state: SettingsState = {
  paranoid:        lsRead('stripmeta-paranoid',            false),
  skipClean:       !lsRead('stripmeta-process-clean',       false),
  skipUnsupported: !lsRead('stripmeta-process-unsupported', false),
  includeSkipped:  lsRead('stripmeta-include-skipped',      false),
  warnUnload:      lsRead('stripmeta-warn-unload',          import.meta.env.DEV ? false : true),
  autoAbout:       lsRead('stripmeta-auto-about',           true),
  persist:         !_noPersist,
};

export const settings: Readonly<SettingsState> = {
  get paranoid()        { return _state.paranoid; },
  get skipClean()       { return _state.paranoid ? false : _state.skipClean; },
  get skipUnsupported() { return _state.skipUnsupported; },
  get includeSkipped()  { return _state.includeSkipped; },
  get warnUnload()      { return _state.warnUnload; },
  get autoAbout()       { return _state.autoAbout; },
  get persist()         { return _state.persist; },
};

// — Change subscriptions —

type Listener = () => void;
const _subscribers = new Map<keyof SettingsState, Listener[]>();

export function onSettingChange(key: keyof SettingsState, fn: Listener): void {
  const list = _subscribers.get(key);
  if (list) list.push(fn);
  else _subscribers.set(key, [fn]);
}

function notify(key: keyof SettingsState): void {
  _subscribers.get(key)?.forEach(fn => fn());
}

// — Persistence helpers —

const PERSIST_KEYS = [
  'stripmeta-paranoid',
  'stripmeta-process-clean',
  'stripmeta-process-unsupported',
  'stripmeta-include-skipped',
  'stripmeta-no-glass',
  'stripmeta-warn-unload',
  'stripmeta-auto-about',
] as const;

function hasSavedSettings(): boolean {
  return PERSIST_KEYS.some(k => localStorage.getItem(k) !== null);
}

function persist(key: string, value: boolean): void {
  if (_state.persist) localStorage.setItem(key, value ? '1' : '0');
}

function applyNoGlass(enabled: boolean): void {
  document.documentElement.classList.toggle('no-glass', enabled);
  persist('stripmeta-no-glass', enabled);
}

// — Settings panel animation —

let _settingsDetails: HTMLDetailsElement | null = null;
let _settingsBody: HTMLElement | null = null;

export function collapseSettings(): void {
  if (!_settingsDetails?.open) return;
  _settingsBody!.animate(
    [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
    { duration: 150, easing: 'ease' },
  ).onfinish = () => _settingsDetails!.removeAttribute('open');
}

// — Init (index page only) —

export function initSettings(): void {
  const details = _settingsDetails = document.getElementById('settings-details') as HTMLDetailsElement;
  const body = _settingsBody = details.querySelector<HTMLElement>('.settings-body')!;
  const labelSkipClean = toggleSkipClean.closest('label')!;

  // Sync toggle DOM state from _state
  togglePersist.checked         = _state.persist;
  toggleParanoid.checked        = _state.paranoid;
  toggleSkipClean.checked       = !_state.skipClean;
  toggleSkipUnsupported.checked = !_state.skipUnsupported;
  toggleIncludeSkipped.checked  = _state.includeSkipped;
  toggleWarnUnload.checked      = _state.warnUnload;
  toggleAutoAbout.checked       = _state.autoAbout;
  toggleNoGlass.checked         = localStorage.getItem('stripmeta-no-glass') === '1';

  // Show stale-data hint if persist was already disabled and old data exists
  if (_noPersist && hasSavedSettings()) clearStorageHint.classList.add('hint-visible');

  // Apply paranoid UI state on load (skipClean forced; toggle-skip-clean locked checked)
  if (_state.paranoid) {
    toggleSkipClean.checked   = true;
    toggleSkipClean.disabled  = true;
    labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
  }

  // Event listeners — update _state, persist, notify
  toggleParanoid.addEventListener('change', () => {
    _state.paranoid = toggleParanoid.checked;
    persist('stripmeta-paranoid', _state.paranoid);
    if (_state.paranoid) {
      toggleSkipClean.checked  = true;
      toggleSkipClean.disabled = true;
      labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
    } else {
      toggleSkipClean.checked  = !_state.skipClean;
      toggleSkipClean.disabled = false;
      labelSkipClean.classList.remove('opacity-40', 'pointer-events-none');
    }
    notify('paranoid');
  });

  toggleSkipClean.addEventListener('change', () => {
    _state.skipClean = !toggleSkipClean.checked;
    persist('stripmeta-process-clean', toggleSkipClean.checked);
    notify('skipClean');
  });

  toggleSkipUnsupported.addEventListener('change', () => {
    _state.skipUnsupported = !toggleSkipUnsupported.checked;
    persist('stripmeta-process-unsupported', toggleSkipUnsupported.checked);
    notify('skipUnsupported');
  });

  toggleIncludeSkipped.addEventListener('change', () => {
    _state.includeSkipped = toggleIncludeSkipped.checked;
    persist('stripmeta-include-skipped', _state.includeSkipped);
    notify('includeSkipped');
  });

  toggleWarnUnload.addEventListener('change', () => {
    _state.warnUnload = toggleWarnUnload.checked;
    persist('stripmeta-warn-unload', _state.warnUnload);
    notify('warnUnload');
  });

  toggleAutoAbout.addEventListener('change', () => {
    _state.autoAbout = toggleAutoAbout.checked;
    persist('stripmeta-auto-about', _state.autoAbout);
    notify('autoAbout');
  });

  toggleNoGlass.addEventListener('change', () => applyNoGlass(toggleNoGlass.checked));

  togglePersist.addEventListener('change', () => {
    _state.persist = togglePersist.checked;
    if (_state.persist) {
      localStorage.removeItem('stripmeta-no-persist');
      localStorage.setItem('stripmeta-paranoid',            _state.paranoid ? '1' : '0');
      localStorage.setItem('stripmeta-process-clean',       (!_state.skipClean) ? '1' : '0');
      localStorage.setItem('stripmeta-process-unsupported', (!_state.skipUnsupported) ? '1' : '0');
      localStorage.setItem('stripmeta-include-skipped',     _state.includeSkipped ? '1' : '0');
      localStorage.setItem('stripmeta-no-glass',            document.documentElement.classList.contains('no-glass') ? '1' : '0');
      localStorage.setItem('stripmeta-warn-unload',         _state.warnUnload ? '1' : '0');
      localStorage.setItem('stripmeta-auto-about',          _state.autoAbout ? '1' : '0');
      clearStorageHint.classList.remove('hint-visible');
    } else {
      localStorage.setItem('stripmeta-no-persist', '1');
      if (hasSavedSettings()) clearStorageHint.classList.add('hint-visible');
    }
  });

  btnClearStorage.addEventListener('click', () => {
    PERSIST_KEYS.forEach(k => localStorage.removeItem(k));
    clearStorageHint.classList.remove('hint-visible');
    window.dispatchEvent(new CustomEvent('stripmeta:storageCleared'));
  });

  // Panel open/close animation
  details.querySelector('summary')!.addEventListener('click', e => {
    e.preventDefault();
    if (details.open) {
      body.animate(
        [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
        { duration: 150, easing: 'ease' },
      ).onfinish = () => details.removeAttribute('open');
    } else {
      details.setAttribute('open', '');
      body.animate(
        [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 200, easing: 'ease' },
      );
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rect = details.getBoundingClientRect();
        const overflow = rect.bottom - window.innerHeight;
        if (overflow <= 0) return;
        if (rect.height <= window.innerHeight) {
          window.scrollBy({ top: overflow + 32, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: rect.top - 16, behavior: 'smooth' });
        }
      }));
    }
  });
}
