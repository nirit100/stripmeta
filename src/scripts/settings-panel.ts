function canPersist(): boolean {
  return (document.getElementById('toggle-persist') as HTMLInputElement | null)?.checked ?? true;
}

function applyNoGlass(enabled: boolean) {
  document.documentElement.classList.toggle('no-glass', enabled);
  if (canPersist()) localStorage.setItem('stripmeta-no-glass', enabled ? '1' : '0');
}

let _settingsDetails: HTMLDetailsElement | null = null;
let _settingsBody: HTMLElement | null = null;

export function collapseSettings(): void {
  if (!_settingsDetails?.open) return;
  _settingsBody!.animate(
    [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
    { duration: 150, easing: 'ease' },
  ).onfinish = () => _settingsDetails!.removeAttribute('open');
}

export function initSettingsPanel(): void {
  const details = _settingsDetails = document.getElementById('settings-details') as HTMLDetailsElement;
  const body = _settingsBody = details.querySelector<HTMLElement>('.settings-body')!;

  const toggleNoGlass = document.getElementById('toggle-no-glass') as HTMLInputElement;
  if (localStorage.getItem('stripmeta-no-persist') !== '1') {
    toggleNoGlass.checked = localStorage.getItem('stripmeta-no-glass') === '1';
  }
  toggleNoGlass.addEventListener('change', () => applyNoGlass(toggleNoGlass.checked));

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
    }
  });
}
