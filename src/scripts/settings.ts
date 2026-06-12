// — DOM refs (only used inside initSettings) —

const toggleAutoAbout          = document.getElementById('toggle-auto-about') as HTMLInputElement;
const toggleParanoid           = document.getElementById('toggle-paranoid') as HTMLInputElement;
const toggleSkipClean          = document.getElementById('toggle-skip-clean') as HTMLInputElement;
const toggleSkipUnsupported    = document.getElementById('toggle-skip-unsupported') as HTMLInputElement;
const toggleSkipExperimental   = document.getElementById('toggle-skip-experimental') as HTMLInputElement;
const toggleIncludeSkipped     = document.getElementById('toggle-include-skipped') as HTMLInputElement;
const toggleWarnUnload         = document.getElementById('toggle-warn-unload') as HTMLInputElement;
const togglePersist            = document.getElementById('toggle-persist') as HTMLInputElement;
const toggleNoGlass            = document.getElementById('toggle-no-glass') as HTMLInputElement;
const clearStorageHint      = document.getElementById('clear-storage-hint')!;
const btnClearStorage       = document.getElementById('btn-clear-storage') as HTMLButtonElement;
const btnResetProcessing    = document.getElementById('btn-reset-processing') as HTMLButtonElement;
const btnResetAppearance    = document.getElementById('btn-reset-appearance') as HTMLButtonElement;
const btnResetTechnical     = document.getElementById('btn-reset-technical') as HTMLButtonElement;

// — Cached state (initialized from localStorage, no DOM dependency) —

interface SettingsState {
  paranoid: boolean;
  skipClean: boolean;
  skipUnsupported: boolean;
  skipExperimental: boolean;
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
  paranoid:         lsRead('stripmeta-paranoid',              false),
  skipClean:        !lsRead('stripmeta-process-clean',         false),
  skipUnsupported:  !lsRead('stripmeta-process-unsupported',   false),
  skipExperimental: !lsRead('stripmeta-process-experimental',  true),
  includeSkipped:   lsRead('stripmeta-include-skipped',        false),
  warnUnload:       lsRead('stripmeta-warn-unload',            import.meta.env.DEV ? false : true),
  autoAbout:        lsRead('stripmeta-auto-about',             true),
  persist:          !_noPersist,
};

export const settings: Readonly<SettingsState> = {
  get paranoid()          { return _state.paranoid; },
  get skipClean()         { return _state.paranoid ? false : _state.skipClean; },
  get skipUnsupported()   { return _state.skipUnsupported; },
  get skipExperimental()  { return _state.paranoid ? false : _state.skipExperimental; },
  get includeSkipped()    { return _state.includeSkipped; },
  get warnUnload()        { return _state.warnUnload; },
  get autoAbout()         { return _state.autoAbout; },
  get persist()           { return _state.persist; },
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
  'stripmeta-process-experimental',
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

// — Category reset buttons —

const RESET_BASE    = 'shrink-0 text-[0.65rem] font-medium transition-colors text-base-content/30 hover:text-base-content/60';
const RESET_PENDING = 'shrink-0 text-[0.65rem] font-medium transition-colors text-warning';

function setupReset(
  btn: HTMLButtonElement,
  onPreview: () => void,
  onConfirm: () => void,
  onAbort: () => void,
  toLock: HTMLInputElement[] = [],
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bar: HTMLSpanElement | null = null;
  let cancelBlink: () => void = () => {};

  function startBar() {
    btn.style.position = 'relative';
    bar = document.createElement('span');
    bar.style.cssText = 'position:absolute;bottom:0;left:0;height:2px;width:100%;background:currentColor;opacity:0.4;border-radius:1px;pointer-events:none';
    btn.appendChild(bar);
    bar.animate([{ width: '100%' }, { width: '0%' }], { duration: 5000, easing: 'linear', fill: 'forwards' });
  }

  function stopBar() {
    bar?.remove();
    bar = null;
    btn.style.position = '';
  }

  function startBlink() {
    const restores = toLock.map(t => {
      const target = t.closest('label') ?? t;
      const anim = target.animate(
        [
          { backgroundColor: 'transparent' },
          { backgroundColor: 'rgba(251, 191, 36, 0.18)' },
          { backgroundColor: 'transparent' },
        ],
        { duration: 900, iterations: Infinity, easing: 'ease-in-out' },
      );
      return () => { anim.cancel(); };
    });
    cancelBlink = () => { restores.forEach(f => f()); cancelBlink = () => {}; };
  }

  btn.addEventListener('click', () => {
    if (timer === null) {
      onPreview();
      btn.textContent = 'click again to confirm';
      btn.className = RESET_PENDING;
      startBar();
      startBlink();
      timer = setTimeout(() => {
        timer = null;
        stopBar();
        cancelBlink();
        btn.textContent = 'Reset';
        btn.className = RESET_BASE;
        onAbort();
      }, 5000);
    } else {
      clearTimeout(timer);
      timer = null;
      stopBar();
      cancelBlink();
      btn.textContent = 'Reset';
      btn.className = RESET_BASE;
      onConfirm();
    }
  });
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
  togglePersist.checked            = _state.persist;
  toggleParanoid.checked           = _state.paranoid;
  toggleSkipClean.checked          = !_state.skipClean;
  toggleSkipUnsupported.checked    = !_state.skipUnsupported;
  toggleSkipExperimental.checked   = !_state.skipExperimental;
  toggleIncludeSkipped.checked     = _state.includeSkipped;
  toggleWarnUnload.checked         = _state.warnUnload;
  toggleAutoAbout.checked          = _state.autoAbout;
  toggleNoGlass.checked            = localStorage.getItem('stripmeta-no-glass') === '1';

  // Show stale-data hint if persist was already disabled and old data exists
  if (_noPersist && hasSavedSettings()) clearStorageHint.classList.add('hint-visible');

  const labelSkipExperimental = toggleSkipExperimental.closest('label')!;

  // Apply paranoid UI state on load (skipClean + skipExperimental forced; toggles locked checked)
  if (_state.paranoid) {
    toggleSkipClean.checked          = true;
    toggleSkipClean.disabled         = true;
    labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
    toggleSkipExperimental.checked   = true;
    toggleSkipExperimental.disabled  = true;
    labelSkipExperimental.classList.add('opacity-40', 'pointer-events-none');
  }

  // Event listeners — update _state, persist, notify
  toggleParanoid.addEventListener('change', () => {
    _state.paranoid = toggleParanoid.checked;
    persist('stripmeta-paranoid', _state.paranoid);
    if (_state.paranoid) {
      toggleSkipClean.checked          = true;
      toggleSkipClean.disabled         = true;
      labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
      toggleSkipExperimental.checked   = true;
      toggleSkipExperimental.disabled  = true;
      labelSkipExperimental.classList.add('opacity-40', 'pointer-events-none');
    } else {
      toggleSkipClean.checked          = !_state.skipClean;
      toggleSkipClean.disabled         = false;
      labelSkipClean.classList.remove('opacity-40', 'pointer-events-none');
      toggleSkipExperimental.checked   = !_state.skipExperimental;
      toggleSkipExperimental.disabled  = false;
      labelSkipExperimental.classList.remove('opacity-40', 'pointer-events-none');
    }
    notify('paranoid');
    notify('skipClean');
    notify('skipExperimental');
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

  toggleSkipExperimental.addEventListener('change', () => {
    _state.skipExperimental = !toggleSkipExperimental.checked;
    persist('stripmeta-process-experimental', toggleSkipExperimental.checked);
    notify('skipExperimental');
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
      localStorage.setItem('stripmeta-paranoid',              _state.paranoid ? '1' : '0');
      localStorage.setItem('stripmeta-process-clean',         (!_state.skipClean) ? '1' : '0');
      localStorage.setItem('stripmeta-process-unsupported',   (!_state.skipUnsupported) ? '1' : '0');
      localStorage.setItem('stripmeta-process-experimental',  (!_state.skipExperimental) ? '1' : '0');
      localStorage.setItem('stripmeta-include-skipped',       _state.includeSkipped ? '1' : '0');
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

  // — Reset buttons —

  // Saved visual state for abort (captured on first click)
  let procSaved = { paranoid: false, skipClean: false, skipUnsupported: false, skipExperimental: true, includeSkipped: false, cleanDisabled: false, expDisabled: false };
  let appSaved  = { autoAbout: true, warnUnload: true, noGlass: false };
  let techSaved = { persist: true };

  setupReset(
    btnResetProcessing,
    () => {
      procSaved = {
        paranoid:         toggleParanoid.checked,
        skipClean:        toggleSkipClean.checked,
        skipUnsupported:  toggleSkipUnsupported.checked,
        skipExperimental: toggleSkipExperimental.checked,
        includeSkipped:   toggleIncludeSkipped.checked,
        cleanDisabled:    toggleSkipClean.disabled,
        expDisabled:      toggleSkipExperimental.disabled,
      };
      // Show defaults visually; unlock any paranoid-locked toggles
      toggleParanoid.checked          = false;
      toggleSkipClean.checked         = false;
      toggleSkipClean.disabled        = false;
      labelSkipClean.classList.remove('opacity-40', 'pointer-events-none');
      toggleSkipUnsupported.checked   = false;
      toggleSkipExperimental.checked  = true;
      toggleSkipExperimental.disabled = false;
      labelSkipExperimental.classList.remove('opacity-40', 'pointer-events-none');
      toggleIncludeSkipped.checked    = false;
      // Lock all during pending
      toggleParanoid.disabled         = true;
      toggleSkipClean.disabled        = true;
      toggleSkipUnsupported.disabled  = true;
      toggleSkipExperimental.disabled = true;
      toggleIncludeSkipped.disabled   = true;
    },
    () => {
      // Re-enable before dispatching so paranoid handler can re-manage skip-clean/skip-experimental
      toggleParanoid.disabled         = false;
      toggleSkipClean.disabled        = false;
      toggleSkipUnsupported.disabled  = false;
      toggleSkipExperimental.disabled = false;
      toggleIncludeSkipped.disabled   = false;
      // Dispatch non-paranoid toggles first so paranoid's restore reads the updated _state
      toggleSkipClean.dispatchEvent(new Event('change'));
      toggleSkipUnsupported.dispatchEvent(new Event('change'));
      toggleSkipExperimental.dispatchEvent(new Event('change'));
      toggleIncludeSkipped.dispatchEvent(new Event('change'));
      toggleParanoid.dispatchEvent(new Event('change'));
    },
    () => {
      toggleParanoid.checked          = procSaved.paranoid;
      toggleParanoid.disabled         = false;
      toggleSkipClean.checked         = procSaved.skipClean;
      toggleSkipClean.disabled        = procSaved.cleanDisabled;
      if (procSaved.cleanDisabled) labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
      else labelSkipClean.classList.remove('opacity-40', 'pointer-events-none');
      toggleSkipUnsupported.checked   = procSaved.skipUnsupported;
      toggleSkipUnsupported.disabled  = false;
      toggleSkipExperimental.checked  = procSaved.skipExperimental;
      toggleSkipExperimental.disabled = procSaved.expDisabled;
      if (procSaved.expDisabled) labelSkipExperimental.classList.add('opacity-40', 'pointer-events-none');
      else labelSkipExperimental.classList.remove('opacity-40', 'pointer-events-none');
      toggleIncludeSkipped.checked    = procSaved.includeSkipped;
      toggleIncludeSkipped.disabled   = false;
    },
    [toggleParanoid, toggleSkipClean, toggleSkipUnsupported, toggleSkipExperimental, toggleIncludeSkipped],
  );

  setupReset(
    btnResetAppearance,
    () => {
      appSaved = {
        autoAbout: toggleAutoAbout.checked,
        warnUnload: toggleWarnUnload.checked,
        noGlass: toggleNoGlass.checked,
      };
      toggleAutoAbout.checked  = true;
      toggleWarnUnload.checked = !import.meta.env.DEV;
      toggleNoGlass.checked    = false;
      toggleAutoAbout.disabled  = true;
      toggleWarnUnload.disabled = true;
      toggleNoGlass.disabled    = true;
    },
    () => {
      toggleAutoAbout.disabled  = false;
      toggleWarnUnload.disabled = false;
      toggleNoGlass.disabled    = false;
      toggleAutoAbout.dispatchEvent(new Event('change'));
      toggleWarnUnload.dispatchEvent(new Event('change'));
      toggleNoGlass.dispatchEvent(new Event('change'));
    },
    () => {
      toggleAutoAbout.checked   = appSaved.autoAbout;
      toggleAutoAbout.disabled  = false;
      toggleWarnUnload.checked  = appSaved.warnUnload;
      toggleWarnUnload.disabled = false;
      toggleNoGlass.checked     = appSaved.noGlass;
      toggleNoGlass.disabled    = false;
    },
    [toggleAutoAbout, toggleWarnUnload, toggleNoGlass],
  );

  setupReset(
    btnResetTechnical,
    () => {
      techSaved = { persist: togglePersist.checked };
      togglePersist.checked  = true;
      togglePersist.disabled = true;
    },
    () => {
      togglePersist.disabled = false;
      togglePersist.dispatchEvent(new Event('change'));
    },
    () => {
      togglePersist.checked  = techSaved.persist;
      togglePersist.disabled = false;
    },
    [togglePersist],
  );

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
