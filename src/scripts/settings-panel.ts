export function initSettingsPanel(): void {
  const details = document.getElementById('settings-details') as HTMLDetailsElement;
  const body = details.querySelector<HTMLElement>('.settings-body')!;

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
