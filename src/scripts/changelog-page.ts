// Animated fold/unfold for the /changelog timeline's <details> entries.
// Native toggle (instant) is used whenever "Frosted glass & animations" is
// off in settings — checked per click so a live setting change takes effect
// immediately, no reload needed.

const DURATION = 280;
const EASING = 'ease-out';

function animatedToggle(details: HTMLDetailsElement): void {
  const summary = details.querySelector('summary');
  const body = details.querySelector<HTMLElement>('.cl-body');
  if (!summary || !body) return;

  let animation: Animation | null = null;
  let closing = false;
  let expanding = false;

  function finish(isOpen: boolean): void {
    details.open = isOpen;
    animation = null;
    closing = false;
    expanding = false;
    details.style.height = '';
    details.style.overflow = '';
  }

  function expand(): void {
    expanding = true;
    const startHeight = `${details.offsetHeight}px`;
    const endHeight = `${summary!.offsetHeight + body!.offsetHeight}px`;
    animation?.cancel();
    animation = details.animate({ height: [startHeight, endHeight] }, { duration: DURATION, easing: EASING });
    animation.onfinish = () => finish(true);
    animation.oncancel = () => { expanding = false; };
  }

  function openDetails(): void {
    details.style.height = `${details.offsetHeight}px`;
    details.open = true;
    requestAnimationFrame(expand);
  }

  function shrink(): void {
    closing = true;
    const startHeight = `${details.offsetHeight}px`;
    const endHeight = `${summary!.offsetHeight}px`;
    animation?.cancel();
    animation = details.animate({ height: [startHeight, endHeight] }, { duration: DURATION, easing: EASING });
    animation.onfinish = () => finish(false);
    animation.oncancel = () => { closing = false; };
  }

  summary.addEventListener('click', (e) => {
    if (document.documentElement.classList.contains('no-glass')) return; // native instant toggle
    e.preventDefault();
    details.style.overflow = 'hidden';
    if (closing || !details.open) openDetails();
    else if (expanding || details.open) shrink();
  });
}

document.querySelectorAll<HTMLDetailsElement>('.cl-details').forEach(animatedToggle);
