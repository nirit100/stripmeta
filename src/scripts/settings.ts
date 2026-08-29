import {
  rawSettings, setSetting, notifyChange, persist,
  enablePersist, disablePersist, clearStoredKeys, hasSavedSettings, noPersist,
  SETTINGS, starIdFor, toChecked, fromChecked, storedValue, checkedFromStored,
} from '../lib/state/settings.ts';
import type { SettingSpec, SettingGroup } from '../lib/state/settings.ts';
import { clearStats } from '../lib/state/stats.ts';
import { bindTooltip } from './tooltip.ts';

// Every per-setting fact — default, storage key, inversion, reset group, the
// paranoid lock — comes from the schema. Nothing below names an individual
// setting except the two whose storage genuinely is special.

function toggleEl(spec: SettingSpec): HTMLInputElement | null {
  return document.getElementById(spec.domId) as HTMLInputElement | null;
}

const LOCKED_LABEL_CLASSES = ['opacity-40', 'pointer-events-none'];

function setLabelLocked(toggle: HTMLInputElement, locked: boolean): void {
  const label = toggle.closest('label');
  for (const cls of LOCKED_LABEL_CLASSES) label?.classList.toggle(cls, locked);
}

// — Glass appearance (stored in the DOM class + localStorage, not in settings state).
//   The toggle is positive (on = effects enabled); the `no-glass` class/key invert it. —

const GLASS = SETTINGS.find(s => s.domId === 'toggle-glass')!;

function applyGlass(enabled: boolean): void {
  document.documentElement.classList.toggle('no-glass', !enabled);
  persist(GLASS.storageKey!, storedValue(GLASS, enabled));
}

// — Changed-from-default stars —

/** A disabled toggle is showing a forced value, not a chosen one. */
function isDefaultChecked(spec: SettingSpec): boolean {
  const toggle = toggleEl(spec);
  return !toggle || toggle.disabled || toggle.checked === spec.defaultChecked;
}

function refreshStars(): void {
  for (const spec of SETTINGS) {
    document.getElementById(starIdFor(spec))?.classList.toggle('hidden', isDefaultChecked(spec));
  }
}

const GROUPS: readonly { group: SettingGroup; btnId: string }[] = [
  { group: 'processing', btnId: 'btn-reset-processing' },
  { group: 'appearance', btnId: 'btn-reset-appearance' },
  { group: 'technical',  btnId: 'btn-reset-technical'  },
];

function specsIn(group: SettingGroup): SettingSpec[] {
  return SETTINGS.filter(s => s.group === group);
}

function refreshResetButtons(): void {
  for (const { group, btnId } of GROUPS) {
    const btn = document.getElementById(btnId);
    btn?.classList.toggle('hidden', specsIn(group).every(isDefaultChecked));
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

/**
 * Wires one group's reset button: preview the defaults, then either confirm
 * (dispatch change on each toggle, so the ordinary handlers do the work) or
 * abort back to the snapshot taken before the preview.
 */
function setupGroupReset(group: SettingGroup, btn: HTMLButtonElement, syncForced: () => void): void {
  const specs = specsIn(group);
  let saved = new Map<string, { checked: boolean; disabled: boolean }>();

  setupReset(
    btn,
    () => {
      saved = new Map(specs.flatMap(spec => {
        const toggle = toggleEl(spec);
        return toggle ? [[spec.domId, { checked: toggle.checked, disabled: toggle.disabled }] as const] : [];
      }));
      // Show the defaults, unlocking anything the paranoid lock had held.
      for (const spec of specs) {
        const toggle = toggleEl(spec);
        if (!toggle) continue;
        toggle.checked = spec.defaultChecked;
        setLabelLocked(toggle, false);
      }
      // Lock everything while the confirmation is pending.
      for (const spec of specs) {
        const toggle = toggleEl(spec);
        if (toggle) toggle.disabled = true;
      }
    },
    () => {
      for (const spec of specs) {
        const toggle = toggleEl(spec);
        if (toggle) toggle.disabled = false;
      }
      // Dispatch the forcing setting last, so its handler reads state the
      // others have already updated.
      const isForcer = (s: SettingSpec) => specs.some(o => o.forcedBy === s.key);
      for (const spec of specs.filter(s => !isForcer(s))) toggleEl(spec)?.dispatchEvent(new Event('change'));
      for (const spec of specs.filter(isForcer))            toggleEl(spec)?.dispatchEvent(new Event('change'));
      syncForced();
    },
    () => {
      for (const spec of specs) {
        const toggle = toggleEl(spec);
        const prev = saved.get(spec.domId);
        if (!toggle || !prev) continue;
        toggle.checked = prev.checked;
        toggle.disabled = prev.disabled;
        setLabelLocked(toggle, prev.disabled);
      }
    },
    specs.map(starIdFor),
  );
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
  const clearStorageHint = document.getElementById('clear-storage-hint')!;

  /**
   * Applies the paranoid lock: settings it forces are shown checked and
   * disabled while it is on, and restored from the store when it goes off.
   * Their effective values follow in the store, so the panel and the app agree.
   */
  function syncForced(): void {
    for (const spec of SETTINGS) {
      if (spec.forcedBy === undefined) continue;
      const toggle = toggleEl(spec);
      if (!toggle) continue;
      const forced = rawSettings[spec.forcedBy];
      toggle.checked = forced ? true : toChecked(spec, rawSettings[spec.key!]);
      toggle.disabled = forced;
      setLabelLocked(toggle, forced);
    }
  }

  // Sync every toggle from the stored (raw) settings.
  for (const spec of SETTINGS) {
    const toggle = toggleEl(spec);
    if (!toggle) continue;
    if (spec.key) {
      toggle.checked = toChecked(spec, rawSettings[spec.key]);
    } else {
      // DOM-only (glass): read the stored value back directly.
      toggle.checked = checkedFromStored(spec, localStorage.getItem(spec.storageKey!) === '1');
    }
  }
  syncForced();

  // Show stale-data hint if persist was already disabled and old data exists
  if (noPersist && hasSavedSettings()) clearStorageHint.classList.add('hint-visible');

  for (const spec of SETTINGS) {
    const toggle = toggleEl(spec);
    if (!toggle) continue;

    toggle.addEventListener('change', () => {
      // Persistence is the opt-out flag itself, not an ordinary stored setting.
      if (spec.key === 'persist') {
        if (toggle.checked) {
          enablePersist(document.documentElement.classList.contains('no-glass'));
          clearStorageHint.classList.remove('hint-visible');
        } else {
          disablePersist();
          if (hasSavedSettings()) clearStorageHint.classList.add('hint-visible');
        }
        return;
      }
      // Glass lives in a document class rather than the store.
      if (spec.key === undefined) {
        applyGlass(toggle.checked);
        return;
      }

      setSetting(spec.key, fromChecked(spec, toggle.checked));
      persist(spec.storageKey!, storedValue(spec, toggle.checked));

      // A setting that forces others changed: re-apply the lock, then tell the
      // forced settings' listeners, whose effective values just flipped.
      const forced = SETTINGS.filter(s => s.forcedBy === spec.key);
      if (forced.length > 0) {
        syncForced();
        for (const f of forced) notifyChange(f.key!);
      }
    });
  }

  document.getElementById('btn-clear-storage')!.addEventListener('click', () => {
    clearStoredKeys();
    clearStats();
    clearStorageHint.classList.remove('hint-visible');
    window.dispatchEvent(new CustomEvent('stripmeta:storageCleared'));
  });

  for (const { group, btnId } of GROUPS) {
    const btn = document.getElementById(btnId) as HTMLButtonElement | null;
    if (btn) setupGroupReset(group, btn, syncForced);
  }

  const btnClearInfo = document.getElementById('btn-clear-info');
  if (btnClearInfo) bindTooltip(btnClearInfo);

  // Panel open/close animation
  details.querySelector('summary')!.addEventListener('click', e => {
    // Let dedicated controls inside the summary (e.g. the help button) handle
    // their own click instead of toggling the panel.
    if ((e.target as HTMLElement).closest('[data-open-help]')) return;
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
