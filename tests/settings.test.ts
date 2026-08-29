import { describe, it, expect, vi, beforeEach } from 'vitest';

// The settings store (lib/state/settings) is pure — only localStorage at init.
// The DOM panel controller (scripts/settings) imports it; the two DOM tests
// below pull initSettings from there, sharing the same freshly-reset store.

async function importFresh() {
  vi.resetModules();
  return import('../src/lib/state/settings');
}

function setLS(entries: Record<string, string>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(entries)) {
    localStorage.setItem(k, v);
  }
}

beforeEach(() => {
  localStorage.clear();
});

// ─── Default values ───────────────────────────────────────────────────────────

describe('default state (empty localStorage)', () => {
  it('paranoid is false', async () => {
    const { settings } = await importFresh();
    expect(settings.paranoid).toBe(false);
  });

  it('skipClean is true (toggle-skip-clean unchecked by default)', async () => {
    const { settings } = await importFresh();
    expect(settings.skipClean).toBe(true);
  });

  it('skipUnsupported is true (toggle-skip-unsupported unchecked by default)', async () => {
    const { settings } = await importFresh();
    expect(settings.skipUnsupported).toBe(true);
  });

  it('includeSkipped is false', async () => {
    const { settings } = await importFresh();
    expect(settings.includeSkipped).toBe(false);
  });

  it('warnUnload defaults to false in DEV, true in prod (vitest sets DEV=true)', async () => {
    const { settings } = await importFresh();
    // vitest sets import.meta.env.DEV=true, so the prod default (true) does not apply
    expect(settings.warnUnload).toBe(false);
  });

  it('autoAbout is true (toggle checked by default)', async () => {
    const { settings } = await importFresh();
    expect(settings.autoAbout).toBe(true);
  });

  it('persist is true (toggle checked by default)', async () => {
    const { settings } = await importFresh();
    expect(settings.persist).toBe(true);
  });
});

// ─── Values loaded from localStorage ─────────────────────────────────────────

describe('settings loaded from localStorage (persist on)', () => {
  it('reads paranoid=true', async () => {
    setLS({ 'stripmeta-paranoid': '1' });
    const { settings } = await importFresh();
    expect(settings.paranoid).toBe(true);
  });

  it('reads paranoid=false', async () => {
    setLS({ 'stripmeta-paranoid': '0' });
    const { settings } = await importFresh();
    expect(settings.paranoid).toBe(false);
  });

  it('reads skipClean=false when process-clean is enabled', async () => {
    setLS({ 'stripmeta-process-clean': '1' });
    const { settings } = await importFresh();
    expect(settings.skipClean).toBe(false);
  });

  it('reads skipClean=true when process-clean is disabled', async () => {
    setLS({ 'stripmeta-process-clean': '0' });
    const { settings } = await importFresh();
    expect(settings.skipClean).toBe(true);
  });

  it('reads skipUnsupported=false when process-unsupported is enabled', async () => {
    setLS({ 'stripmeta-process-unsupported': '1' });
    const { settings } = await importFresh();
    expect(settings.skipUnsupported).toBe(false);
  });

  it('reads includeSkipped=true', async () => {
    setLS({ 'stripmeta-include-skipped': '1' });
    const { settings } = await importFresh();
    expect(settings.includeSkipped).toBe(true);
  });

  it('reads warnUnload=false', async () => {
    setLS({ 'stripmeta-warn-unload': '0' });
    const { settings } = await importFresh();
    expect(settings.warnUnload).toBe(false);
  });

  it('reads autoAbout=false', async () => {
    setLS({ 'stripmeta-auto-about': '0' });
    const { settings } = await importFresh();
    expect(settings.autoAbout).toBe(false);
  });

  it('reads persist=false when no-persist is set', async () => {
    setLS({ 'stripmeta-no-persist': '1' });
    const { settings } = await importFresh();
    expect(settings.persist).toBe(false);
  });
});

// ─── noPersist mode ───────────────────────────────────────────────────────────

describe('noPersist mode (stripmeta-no-persist=1)', () => {
  it('ignores saved paranoid value and returns default (false)', async () => {
    setLS({ 'stripmeta-no-persist': '1', 'stripmeta-paranoid': '1' });
    const { settings } = await importFresh();
    expect(settings.paranoid).toBe(false);
  });

  it('ignores saved process-clean value and returns default skipClean (true)', async () => {
    setLS({ 'stripmeta-no-persist': '1', 'stripmeta-process-clean': '1' });
    const { settings } = await importFresh();
    expect(settings.skipClean).toBe(true);
  });

  it('ignores saved autoAbout value and returns default (true)', async () => {
    setLS({ 'stripmeta-no-persist': '1', 'stripmeta-auto-about': '0' });
    const { settings } = await importFresh();
    expect(settings.autoAbout).toBe(true);
  });

  it('ignores saved warnUnload and uses DEV default (false) in test env', async () => {
    setLS({ 'stripmeta-no-persist': '1', 'stripmeta-warn-unload': '0' });
    const { settings } = await importFresh();
    expect(settings.warnUnload).toBe(false);
  });

  it('persist is false', async () => {
    setLS({ 'stripmeta-no-persist': '1' });
    const { settings } = await importFresh();
    expect(settings.persist).toBe(false);
  });
});

// ─── onSettingChange ──────────────────────────────────────────────────────────

describe('onSettingChange', () => {
  it('calls listener when the relevant key is notified via a DOM toggle', async () => {
    // Wire up a real checkbox so initSettings can attach its listener.
    document.body.innerHTML = `
      <details id="settings-details"><summary></summary><div class="settings-body"></div></details>
      <input type="checkbox" id="toggle-paranoid" />
      <label><input type="checkbox" id="toggle-skip-clean" /></label>
      <input type="checkbox" id="toggle-skip-unsupported" />
      <label><input type="checkbox" id="toggle-skip-experimental" checked /></label>
      <input type="checkbox" id="toggle-include-skipped" />
      <input type="checkbox" id="toggle-warn-unload" />
      <input type="checkbox" id="toggle-auto-about" />
      <input type="checkbox" id="toggle-persist" checked />
      <input type="checkbox" id="toggle-glass" checked />
      <input type="checkbox" id="toggle-show-previews" checked />
      <span id="clear-storage-hint"></span>
      <button id="btn-clear-storage"></button>
      <button id="btn-reset-processing"></button>
      <button id="btn-reset-appearance"></button>
      <button id="btn-reset-technical"></button>
    `;

    const { settings, onSettingChange } = await importFresh();
    const { initSettings } = await import('../src/scripts/settings');
    initSettings();

    const listener = vi.fn();
    onSettingChange('paranoid', listener);

    const toggle = document.getElementById('toggle-paranoid') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(listener).toHaveBeenCalledOnce();
    expect(settings.paranoid).toBe(true);
  });

  it('updates _state so settings reflects the new value without DOM access', async () => {
    document.body.innerHTML = `
      <details id="settings-details"><summary></summary><div class="settings-body"></div></details>
      <input type="checkbox" id="toggle-paranoid" />
      <label><input type="checkbox" id="toggle-skip-clean" checked /></label>
      <input type="checkbox" id="toggle-skip-unsupported" />
      <label><input type="checkbox" id="toggle-skip-experimental" checked /></label>
      <input type="checkbox" id="toggle-include-skipped" />
      <input type="checkbox" id="toggle-warn-unload" checked />
      <input type="checkbox" id="toggle-auto-about" checked />
      <input type="checkbox" id="toggle-persist" checked />
      <input type="checkbox" id="toggle-glass" checked />
      <input type="checkbox" id="toggle-show-previews" checked />
      <span id="clear-storage-hint"></span>
      <button id="btn-clear-storage"></button>
      <button id="btn-reset-processing"></button>
      <button id="btn-reset-appearance"></button>
      <button id="btn-reset-technical"></button>
    `;

    const { settings } = await importFresh();
    const { initSettings } = await import('../src/scripts/settings');
    initSettings();

    expect(settings.skipClean).toBe(true);

    const toggle = document.getElementById('toggle-skip-clean') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(settings.skipClean).toBe(false);
  });
});

// ─── Settings not previously covered ──────────────────────────────────────────

describe('skipExperimental', () => {
  it('defaults to false — experimental formats are processed unless turned off', async () => {
    const { settings } = await importFresh();
    expect(settings.skipExperimental).toBe(false);
  });

  it('is true when the "process experimental" toggle was stored off', async () => {
    setLS({ 'stripmeta-process-experimental': '0' });
    const { settings } = await importFresh();
    expect(settings.skipExperimental).toBe(true);
  });
});

describe('showPreviews', () => {
  it('defaults to true', async () => {
    const { settings } = await importFresh();
    expect(settings.showPreviews).toBe(true);
  });

  it('reads a stored false', async () => {
    setLS({ 'stripmeta-show-previews': '0' });
    const { settings } = await importFresh();
    expect(settings.showPreviews).toBe(false);
  });
});

describe('paranoid overrides the effective skip settings', () => {
  it('forces skipClean and skipExperimental off while it is on', async () => {
    setLS({ 'stripmeta-process-clean': '0', 'stripmeta-process-experimental': '0' });
    const { settings, rawSettings, setSetting } = await importFresh();

    expect(settings.skipClean).toBe(true);
    expect(settings.skipExperimental).toBe(true);

    setSetting('paranoid', true);

    // Effective values flip; the stored preferences underneath are untouched,
    // so turning paranoid off restores exactly what the user had chosen.
    expect(settings.skipClean).toBe(false);
    expect(settings.skipExperimental).toBe(false);
    expect(rawSettings.skipClean).toBe(true);
    expect(rawSettings.skipExperimental).toBe(true);

    setSetting('paranoid', false);
    expect(settings.skipClean).toBe(true);
    expect(settings.skipExperimental).toBe(true);
  });

  it('does not override skipUnsupported', async () => {
    const { settings, setSetting } = await importFresh();
    setSetting('paranoid', true);
    expect(settings.skipUnsupported).toBe(true);
  });
});

describe('hasSavedSettings', () => {
  it('is false with empty storage', async () => {
    const { hasSavedSettings } = await importFresh();
    expect(hasSavedSettings()).toBe(false);
  });

  it('is true once any persisted key exists', async () => {
    setLS({ 'stripmeta-no-glass': '1' });
    const { hasSavedSettings } = await importFresh();
    expect(hasSavedSettings()).toBe(true);
  });

  it('ignores the no-persist flag, which is not itself a setting', async () => {
    setLS({ 'stripmeta-no-persist': '1' });
    const { hasSavedSettings } = await importFresh();
    expect(hasSavedSettings()).toBe(false);
  });
});

describe('enablePersist', () => {
  it('clears the opt-out and flushes every setting to storage', async () => {
    setLS({ 'stripmeta-no-persist': '1' });
    const { enablePersist, settings } = await importFresh();

    enablePersist(true /* noGlass */);

    expect(localStorage.getItem('stripmeta-no-persist')).toBeNull();
    expect(settings.persist).toBe(true);
    // Every persisted key is written, so a later load reproduces this state.
    for (const key of [
      'stripmeta-paranoid', 'stripmeta-process-clean', 'stripmeta-process-unsupported',
      'stripmeta-process-experimental', 'stripmeta-include-skipped', 'stripmeta-no-glass',
      'stripmeta-warn-unload', 'stripmeta-auto-about', 'stripmeta-show-previews',
    ]) {
      expect(localStorage.getItem(key), key).not.toBeNull();
    }
  });

  it('writes the inverted keys as the toggle would show them', async () => {
    const { enablePersist } = await importFresh();
    enablePersist(false);
    // Defaults: clean and unsupported are skipped, experimental is processed.
    expect(localStorage.getItem('stripmeta-process-clean')).toBe('0');
    expect(localStorage.getItem('stripmeta-process-unsupported')).toBe('0');
    expect(localStorage.getItem('stripmeta-process-experimental')).toBe('1');
    expect(localStorage.getItem('stripmeta-no-glass')).toBe('0');
  });

  it('round-trips: what it writes is what a fresh load reads back', async () => {
    const first = await importFresh();
    first.setSetting('paranoid', true);
    first.setSetting('skipClean', false);
    first.setSetting('showPreviews', false);
    first.enablePersist(false);

    const reloaded = await importFresh();
    expect(reloaded.settings.paranoid).toBe(true);
    expect(reloaded.rawSettings.skipClean).toBe(false);
    expect(reloaded.settings.showPreviews).toBe(false);
  });
});

describe('persist toggle', () => {
  it('disablePersist suppresses later writes', async () => {
    const { disablePersist, persist } = await importFresh();
    disablePersist();
    persist('stripmeta-paranoid', true);
    expect(localStorage.getItem('stripmeta-paranoid')).toBeNull();
    expect(localStorage.getItem('stripmeta-no-persist')).toBe('1');
  });

  it('persist writes while persistence is on', async () => {
    const { persist } = await importFresh();
    persist('stripmeta-paranoid', true);
    expect(localStorage.getItem('stripmeta-paranoid')).toBe('1');
  });
});

describe('clearStoredKeys', () => {
  it('removes every setting key but leaves unrelated storage alone', async () => {
    setLS({
      'stripmeta-paranoid': '1',
      'stripmeta-no-glass': '1',
      'stripmeta-show-previews': '0',
      'stripmeta:stats_v1': '{}',
      'unrelated': 'x',
    });
    const { clearStoredKeys } = await importFresh();
    clearStoredKeys();

    expect(localStorage.getItem('stripmeta-paranoid')).toBeNull();
    expect(localStorage.getItem('stripmeta-no-glass')).toBeNull();
    expect(localStorage.getItem('stripmeta-show-previews')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('x');
  });
});
