import { describe, it, expect, vi, beforeEach } from 'vitest';

// settings.ts queries DOM elements at module level; they will be null in tests
// (happy-dom returns null for unknown IDs). The refactored code no longer reads
// DOM elements to compute settings values — only localStorage is used at init.

async function importFresh() {
  vi.resetModules();
  return import('../src/scripts/settings');
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

  it('warnUnload is false in DEV (vitest sets import.meta.env.DEV=true)', async () => {
    const { settings } = await importFresh();
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

  it('ignores saved warnUnload value and returns default (true in prod)', async () => {
    setLS({ 'stripmeta-no-persist': '1', 'stripmeta-warn-unload': '0' });
    const { settings } = await importFresh();
    expect(settings.warnUnload).toBe(true);
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
      <input type="checkbox" id="toggle-skip-clean" />
      <input type="checkbox" id="toggle-skip-unsupported" /><label></label>
      <input type="checkbox" id="toggle-include-skipped" />
      <input type="checkbox" id="toggle-warn-unload" />
      <input type="checkbox" id="toggle-auto-about" />
      <input type="checkbox" id="toggle-persist" checked />
      <input type="checkbox" id="toggle-no-glass" />
      <span id="clear-storage-hint"></span>
      <button id="btn-clear-storage"></button>
    `;

    const { settings, onSettingChange, initSettings } = await importFresh();
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
      <input type="checkbox" id="toggle-skip-clean" checked />
      <input type="checkbox" id="toggle-skip-unsupported" /><label></label>
      <input type="checkbox" id="toggle-include-skipped" />
      <input type="checkbox" id="toggle-warn-unload" checked />
      <input type="checkbox" id="toggle-auto-about" checked />
      <input type="checkbox" id="toggle-persist" checked />
      <input type="checkbox" id="toggle-no-glass" />
      <span id="clear-storage-hint"></span>
      <button id="btn-clear-storage"></button>
    `;

    const { settings, initSettings } = await importFresh();
    initSettings();

    expect(settings.skipClean).toBe(true);

    const toggle = document.getElementById('toggle-skip-clean') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(settings.skipClean).toBe(false);
  });
});
