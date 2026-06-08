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

// — Public settings object —

export const settings = {
  get paranoid()        { return toggleParanoid.checked; },
  get skipClean()       { return !toggleSkipClean.checked; },
  get skipUnsupported() { return !toggleSkipUnsupported.checked; },
  get includeSkipped()  { return toggleIncludeSkipped.checked; },
  get warnUnload()      { return toggleWarnUnload.checked; },
  get autoAbout()       { return toggleAutoAbout.checked; },
  get persist()         { return togglePersist.checked; },
};

// — Change subscriptions —

type Listener = () => void;
const _subscribers = new Map<keyof typeof settings, Listener[]>();

export function onSettingChange(key: keyof typeof settings, fn: Listener): void {
  const list = _subscribers.get(key);
  if (list) list.push(fn);
  else _subscribers.set(key, [fn]);
}

function notify(key: keyof typeof settings): void {
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
  if (togglePersist.checked) localStorage.setItem(key, value ? '1' : '0');
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

// — Init —

export function initSettings(): void {
  const details = _settingsDetails = document.getElementById('settings-details') as HTMLDetailsElement;
  const body = _settingsBody = details.querySelector<HTMLElement>('.settings-body')!;
  const labelSkipUnsupported = toggleSkipUnsupported.closest('label')!;

  // Restore from localStorage
  const noPersist = localStorage.getItem('stripmeta-no-persist') === '1';
  togglePersist.checked = !noPersist;
  if (!noPersist) {
    const pv = localStorage.getItem('stripmeta-paranoid');
    const sc = localStorage.getItem('stripmeta-process-clean');
    const su = localStorage.getItem('stripmeta-process-unsupported');
    const is = localStorage.getItem('stripmeta-include-skipped');
    const wu = localStorage.getItem('stripmeta-warn-unload');
    const aa = localStorage.getItem('stripmeta-auto-about');
    if (pv !== null) toggleParanoid.checked        = pv === '1';
    if (sc !== null) toggleSkipClean.checked       = sc === '1';
    if (su !== null) toggleSkipUnsupported.checked = su === '1';
    if (is !== null) toggleIncludeSkipped.checked  = is === '1';
    if (wu !== null) toggleWarnUnload.checked       = wu === '1';
    else if (import.meta.env.DEV) toggleWarnUnload.checked = false;
    if (aa !== null) toggleAutoAbout.checked        = aa === '1';
    toggleNoGlass.checked = localStorage.getItem('stripmeta-no-glass') === '1';
  } else if (import.meta.env.DEV) {
    toggleWarnUnload.checked = false;
  }

  // Show stale-data hint if persist was already disabled and old data exists
  if (noPersist && hasSavedSettings()) clearStorageHint.classList.add('hint-visible');

  // Apply paranoid UI state on load
  let savedSkipUnsupported = toggleSkipUnsupported.checked;
  if (settings.paranoid) {
    savedSkipUnsupported = false;
    toggleSkipUnsupported.checked = true;
    toggleSkipUnsupported.disabled = true;
    labelSkipUnsupported.classList.add('opacity-40', 'pointer-events-none');
  }

  // Event listeners
  toggleParanoid.addEventListener('change', () => {
    persist('stripmeta-paranoid', settings.paranoid);
    if (settings.paranoid) {
      savedSkipUnsupported = toggleSkipUnsupported.checked;
      toggleSkipUnsupported.checked = true;
      toggleSkipUnsupported.disabled = true;
      labelSkipUnsupported.classList.add('opacity-40', 'pointer-events-none');
    } else {
      toggleSkipUnsupported.disabled = false;
      toggleSkipUnsupported.checked = savedSkipUnsupported;
      labelSkipUnsupported.classList.remove('opacity-40', 'pointer-events-none');
    }
    notify('paranoid');
  });

  toggleSkipClean.addEventListener('change', () => {
    persist('stripmeta-process-clean', toggleSkipClean.checked);
    notify('skipClean');
  });

  toggleSkipUnsupported.addEventListener('change', () => {
    persist('stripmeta-process-unsupported', toggleSkipUnsupported.checked);
    notify('skipUnsupported');
  });

  toggleIncludeSkipped.addEventListener('change', () => {
    persist('stripmeta-include-skipped', toggleIncludeSkipped.checked);
    notify('includeSkipped');
  });

  toggleWarnUnload.addEventListener('change', () => {
    persist('stripmeta-warn-unload', toggleWarnUnload.checked);
    notify('warnUnload');
  });

  toggleAutoAbout.addEventListener('change', () => {
    persist('stripmeta-auto-about', toggleAutoAbout.checked);
    notify('autoAbout');
  });

  toggleNoGlass.addEventListener('change', () => applyNoGlass(toggleNoGlass.checked));

  togglePersist.addEventListener('change', () => {
    if (togglePersist.checked) {
      localStorage.removeItem('stripmeta-no-persist');
      localStorage.setItem('stripmeta-paranoid',         settings.paranoid ? '1' : '0');
      localStorage.setItem('stripmeta-process-clean',     toggleSkipClean.checked ? '1' : '0');
      localStorage.setItem('stripmeta-process-unsupported', toggleSkipUnsupported.checked ? '1' : '0');
      localStorage.setItem('stripmeta-include-skipped',  toggleIncludeSkipped.checked ? '1' : '0');
      localStorage.setItem('stripmeta-no-glass',         document.documentElement.classList.contains('no-glass') ? '1' : '0');
      localStorage.setItem('stripmeta-warn-unload',      toggleWarnUnload.checked ? '1' : '0');
      localStorage.setItem('stripmeta-auto-about',       toggleAutoAbout.checked ? '1' : '0');
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
          // Panel fits — scroll down with breathing room
          window.scrollBy({ top: overflow + 32, behavior: 'smooth' });
        } else {
          // Panel taller than viewport — bring top to 16px from screen edge
          window.scrollBy({ top: rect.top - 16, behavior: 'smooth' });
        }
      }));
    }
  });
}
