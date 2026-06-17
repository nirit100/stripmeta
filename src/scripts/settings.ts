import {
  rawSettings, setSetting, notifyChange, persist,
  enablePersist, disablePersist, clearStoredKeys, hasSavedSettings, noPersist,
} from '../lib/state/settings.ts';

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
const clearStorageHint         = document.getElementById('clear-storage-hint')!;
const btnClearStorage          = document.getElementById('btn-clear-storage') as HTMLButtonElement;
const btnResetProcessing       = document.getElementById('btn-reset-processing') as HTMLButtonElement;
const btnResetAppearance       = document.getElementById('btn-reset-appearance') as HTMLButtonElement;
const btnResetTechnical        = document.getElementById('btn-reset-technical') as HTMLButtonElement;

// — No-glass appearance (stored in the DOM class + localStorage, not in settings state) —

function applyNoGlass(enabled: boolean): void {
  document.documentElement.classList.toggle('no-glass', enabled);
  persist('stripmeta-no-glass', enabled);
}

// — Changed-from-default stars —

const DEFAULT_CHECKED: Record<string, boolean> = {
  'toggle-paranoid':          false,
  'toggle-skip-clean':        false,
  'toggle-skip-unsupported':  false,
  'toggle-skip-experimental': true,
  'toggle-include-skipped':   false,
  'toggle-auto-about':        true,
  'toggle-warn-unload':       !import.meta.env.DEV,
  'toggle-no-glass':          false,
  'toggle-persist':           true,
};

function isDefaultChecked(toggle: HTMLInputElement, id: string): boolean {
  return toggle.disabled || toggle.checked === DEFAULT_CHECKED[id];
}

function refreshStars(): void {
  for (const [toggleId] of Object.entries(DEFAULT_CHECKED)) {
    const toggle = document.getElementById(toggleId) as HTMLInputElement | null;
    const star   = document.getElementById(toggleId.replace('toggle-', 'star-'));
    if (!toggle || !star) continue;
    star.classList.toggle('hidden', isDefaultChecked(toggle, toggleId));
  }
}

function refreshResetButtons(): void {
  const groups: Array<[HTMLButtonElement | null, string[]]> = [
    [btnResetProcessing, ['toggle-paranoid', 'toggle-skip-clean', 'toggle-skip-unsupported', 'toggle-skip-experimental', 'toggle-include-skipped']],
    [btnResetAppearance, ['toggle-auto-about', 'toggle-warn-unload', 'toggle-no-glass']],
    [btnResetTechnical,  ['toggle-persist']],
  ];
  for (const [btn, ids] of groups) {
    if (!btn) continue;
    const allDefault = ids.every(id => {
      const t = document.getElementById(id) as HTMLInputElement | null;
      return !t || isDefaultChecked(t, id);
    });
    btn.classList.toggle('hidden', allDefault);
  }
}

// — Category reset buttons —

const RESET_BASE    = 'shrink-0 text-[0.65rem] font-medium transition-colors text-base-content/30 hover:text-base-content/60';
const RESET_PENDING = 'shrink-0 text-[0.65rem] font-medium transition-colors text-warning';

function setupReset(
  btn: HTMLButtonElement,
  onPreview: () => void,
  onConfirm: () => void,
  onAbort: () => void,
  starIds: string[] = [],
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bar: HTMLSpanElement | null = null;
  let stopBlink: () => void = () => {};

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

  btn.addEventListener('click', () => {
    if (timer === null) {
      // Capture visible stars before onPreview changes toggle states
      const activeStars = starIds
        .map(id => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null && !el.classList.contains('hidden'));

      onPreview();
      // No refreshStars() here — stars stay visible so they can blink

      btn.textContent = 'click again to confirm';
      btn.className = RESET_PENDING;
      startBar();

      const anims = activeStars.map(star =>
        star.animate(
          [{ opacity: '1' }, { opacity: '0.15' }, { opacity: '1' }],
          { duration: 700, iterations: Infinity, easing: 'ease-in-out' },
        )
      );
      stopBlink = () => { anims.forEach(a => a.cancel()); stopBlink = () => {}; };

      timer = setTimeout(() => {
        timer = null;
        stopBar();
        stopBlink();
        btn.textContent = 'Reset';
        btn.className = RESET_BASE;
        onAbort();
        refreshStars();
        refreshResetButtons();
      }, 5000);
    } else {
      clearTimeout(timer);
      timer = null;
      stopBar();
      stopBlink();
      btn.textContent = 'Reset';
      btn.className = RESET_BASE;
      onConfirm();
      refreshStars();
      refreshResetButtons();
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

  // Sync toggle DOM state from the stored (raw) settings
  togglePersist.checked            = rawSettings.persist;
  toggleParanoid.checked           = rawSettings.paranoid;
  toggleSkipClean.checked          = !rawSettings.skipClean;
  toggleSkipUnsupported.checked    = !rawSettings.skipUnsupported;
  toggleSkipExperimental.checked   = !rawSettings.skipExperimental;
  toggleIncludeSkipped.checked     = rawSettings.includeSkipped;
  toggleWarnUnload.checked         = rawSettings.warnUnload;
  toggleAutoAbout.checked          = rawSettings.autoAbout;
  toggleNoGlass.checked            = localStorage.getItem('stripmeta-no-glass') === '1';

  // Show stale-data hint if persist was already disabled and old data exists
  if (noPersist && hasSavedSettings()) clearStorageHint.classList.add('hint-visible');

  const labelSkipExperimental = toggleSkipExperimental.closest('label')!;

  // Apply paranoid UI state on load (skipClean + skipExperimental forced; toggles locked checked)
  if (rawSettings.paranoid) {
    toggleSkipClean.checked          = true;
    toggleSkipClean.disabled         = true;
    labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
    toggleSkipExperimental.checked   = true;
    toggleSkipExperimental.disabled  = true;
    labelSkipExperimental.classList.add('opacity-40', 'pointer-events-none');
  }

  // Event listeners — drive the settings store
  toggleParanoid.addEventListener('change', () => {
    setSetting('paranoid', toggleParanoid.checked);
    persist('stripmeta-paranoid', toggleParanoid.checked);
    if (toggleParanoid.checked) {
      toggleSkipClean.checked          = true;
      toggleSkipClean.disabled         = true;
      labelSkipClean.classList.add('opacity-40', 'pointer-events-none');
      toggleSkipExperimental.checked   = true;
      toggleSkipExperimental.disabled  = true;
      labelSkipExperimental.classList.add('opacity-40', 'pointer-events-none');
    } else {
      toggleSkipClean.checked          = !rawSettings.skipClean;
      toggleSkipClean.disabled         = false;
      labelSkipClean.classList.remove('opacity-40', 'pointer-events-none');
      toggleSkipExperimental.checked   = !rawSettings.skipExperimental;
      toggleSkipExperimental.disabled  = false;
      labelSkipExperimental.classList.remove('opacity-40', 'pointer-events-none');
    }
    // Effective skipClean/skipExperimental flip with paranoid — notify their listeners too.
    notifyChange('skipClean');
    notifyChange('skipExperimental');
  });

  toggleSkipClean.addEventListener('change', () => {
    setSetting('skipClean', !toggleSkipClean.checked);
    persist('stripmeta-process-clean', toggleSkipClean.checked);
  });

  toggleSkipUnsupported.addEventListener('change', () => {
    setSetting('skipUnsupported', !toggleSkipUnsupported.checked);
    persist('stripmeta-process-unsupported', toggleSkipUnsupported.checked);
  });

  toggleSkipExperimental.addEventListener('change', () => {
    setSetting('skipExperimental', !toggleSkipExperimental.checked);
    persist('stripmeta-process-experimental', toggleSkipExperimental.checked);
  });

  toggleIncludeSkipped.addEventListener('change', () => {
    setSetting('includeSkipped', toggleIncludeSkipped.checked);
    persist('stripmeta-include-skipped', toggleIncludeSkipped.checked);
  });

  toggleWarnUnload.addEventListener('change', () => {
    setSetting('warnUnload', toggleWarnUnload.checked);
    persist('stripmeta-warn-unload', toggleWarnUnload.checked);
  });

  toggleAutoAbout.addEventListener('change', () => {
    setSetting('autoAbout', toggleAutoAbout.checked);
    persist('stripmeta-auto-about', toggleAutoAbout.checked);
  });

  toggleNoGlass.addEventListener('change', () => applyNoGlass(toggleNoGlass.checked));

  togglePersist.addEventListener('change', () => {
    if (togglePersist.checked) {
      enablePersist(document.documentElement.classList.contains('no-glass'));
      clearStorageHint.classList.remove('hint-visible');
    } else {
      disablePersist();
      if (hasSavedSettings()) clearStorageHint.classList.add('hint-visible');
    }
  });

  btnClearStorage.addEventListener('click', () => {
    clearStoredKeys();
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
    ['star-paranoid', 'star-skip-clean', 'star-skip-unsupported', 'star-skip-experimental', 'star-include-skipped'],
  );

  setupReset(
    btnResetAppearance,
    () => {
      appSaved = {
        autoAbout: toggleAutoAbout.checked,
        warnUnload: toggleWarnUnload.checked,
        noGlass: toggleNoGlass.checked,
      };
      toggleAutoAbout.checked   = true;
      toggleWarnUnload.checked  = !import.meta.env.DEV;
      toggleNoGlass.checked     = false;
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
    ['star-auto-about', 'star-warn-unload', 'star-no-glass'],
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
    ['star-persist'],
  );

  // — btn-clear-info tooltip —

  const btnClearInfo = document.getElementById('btn-clear-info');
  if (btnClearInfo) {
    const tip = document.createElement('div');
    tip.className = 'fixed z-[9999] max-w-56 px-2.5 py-1.5 text-xs rounded-lg shadow-xl pointer-events-none opacity-0 transition-opacity duration-100 bg-base-content text-base-100';
    tip.textContent = btnClearInfo.dataset.tip ?? '';
    document.body.appendChild(tip);

    btnClearInfo.addEventListener('mouseenter', () => {
      const r = btnClearInfo.getBoundingClientRect();
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top  = `${r.top - 6}px`;
      tip.style.transform = 'translate(-50%, -100%)';
      tip.classList.replace('opacity-0', 'opacity-100');
    });
    btnClearInfo.addEventListener('mouseleave', () => {
      tip.classList.replace('opacity-100', 'opacity-0');
    });
  }

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

  body.addEventListener('change', () => { refreshStars(); refreshResetButtons(); });
  refreshStars();
  refreshResetButtons();
}
