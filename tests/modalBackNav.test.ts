import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// modalBackNav.ts patches HTMLDialogElement.prototype.showModal and adds a
// single window 'popstate' listener — both are one-time, page-lifetime side
// effects (it's imported exactly once in Layout.astro), so it's imported once
// here too rather than per test. Isolation between tests instead comes from
// closing any dialog a test left open, which drains the module's internal
// stack the same way the real ✕/backdrop/Escape/code paths do.
import '../src/scripts/modalBackNav';

function makeDialog(id: string): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  document.body.appendChild(dialog);
  return dialog;
}

function pressBack(): void {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

beforeEach(() => {
  // Real navigation isn't under test here (and isn't reliably modeled by the
  // DOM environment) — only whether modalBackNav calls these at the right
  // times, so both are stubbed to no-ops for every test.
  vi.spyOn(history, 'pushState').mockImplementation(() => {});
  vi.spyOn(history, 'back').mockImplementation(() => {});
});

afterEach(() => {
  document.querySelectorAll('dialog').forEach(d => {
    if ((d as HTMLDialogElement).open) (d as HTMLDialogElement).close();
  });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('modalBackNav', () => {
  it('pushes a history entry when a dialog opens', async () => {
    const dialog = makeDialog('d1');
    dialog.showModal();

    expect(history.pushState).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
  });

  it('closes the open dialog when Back is pressed', () => {
    const dialog = makeDialog('d1');
    dialog.showModal();

    pressBack();

    expect(dialog.open).toBe(false);
  });

  it('does nothing on Back when no dialog is open', () => {
    expect(() => pressBack()).not.toThrow();
    expect(history.back).not.toHaveBeenCalled();
  });

  it('Back closes only the top-most dialog, leaving earlier ones open', () => {
    const a = makeDialog('a');
    const b = makeDialog('b');
    a.showModal();
    b.showModal();

    pressBack();
    expect(b.open).toBe(false);
    expect(a.open).toBe(true);

    pressBack();
    expect(a.open).toBe(false);
  });

  it('walks the pushed history entry back when a dialog closes some other way (✕/backdrop/Escape/code)', () => {
    const dialog = makeDialog('d1');
    dialog.showModal();

    dialog.close();

    expect(history.back).toHaveBeenCalledOnce();
  });

  it('does not call history.back() again for a close caused by Back itself (no double navigation)', () => {
    const dialog = makeDialog('d1');
    dialog.showModal();

    pressBack();

    expect(dialog.open).toBe(false);
    expect(history.back).not.toHaveBeenCalled();
  });

  it('a dialog closed and reopened is tracked correctly on the next Back press', () => {
    const dialog = makeDialog('d1');

    dialog.showModal();
    dialog.close(); // e.g. the ✕ button
    dialog.showModal(); // reopened

    pressBack();

    expect(dialog.open).toBe(false);
  });

  it('closing a dialog that is not open (already closed) is a no-op — no stray history.back()', () => {
    const dialog = makeDialog('d1');
    dialog.showModal();
    dialog.close();
    vi.mocked(history.back).mockClear();

    dialog.close(); // already closed — native close() no-ops, fires no 'close' event

    expect(history.back).not.toHaveBeenCalled();
  });
});
