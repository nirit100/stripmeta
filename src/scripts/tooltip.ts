// Small floating tooltip: shows on hover (desktop) and toggles on tap
// (touch, which never fires hover). Renders one shared element into <body>,
// positioned via getBoundingClientRect so it always escapes ancestor
// overflow:hidden (file cards and the settings panel both clip in-flow
// CSS tooltips).

export type TooltipDir = 'top' | 'bottom' | 'left' | 'right';

let tip: HTMLElement | null = null;
let anchor: HTMLElement | null = null;

function hide(): void {
  tip?.classList.replace('opacity-100', 'opacity-0');
  anchor = null;
}

function show(el: HTMLElement, dir: TooltipDir): void {
  const text = el.dataset.tip;
  if (!text) return;

  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'fixed z-[9999] max-w-56 px-2.5 py-1.5 text-xs rounded-lg shadow-xl pointer-events-none opacity-0 transition-opacity duration-100 bg-base-content text-base-100';
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  anchor = el;

  const r = el.getBoundingClientRect();
  if (dir === 'top' || dir === 'bottom') {
    tip.style.left = `${r.left + r.width / 2}px`;
    tip.style.top  = dir === 'top' ? `${r.top - 6}px` : `${r.bottom + 6}px`;
    tip.style.transform = `translate(-50%, ${dir === 'top' ? '-100%' : '0'})`;
  } else {
    tip.style.top  = `${r.top + r.height / 2}px`;
    tip.style.left = dir === 'left' ? `${r.left - 6}px` : `${r.right + 6}px`;
    tip.style.transform = `translate(${dir === 'left' ? '-100%' : '0'}, -50%)`;
  }
  tip.classList.replace('opacity-0', 'opacity-100');

  // Clamp inside the viewport so edge-anchored badges don't overflow it.
  const tr = tip.getBoundingClientRect();
  if (tr.left < 4) tip.style.left = `${parseFloat(tip.style.left) + (4 - tr.left)}px`;
  if (tr.right > window.innerWidth - 4) tip.style.left = `${parseFloat(tip.style.left) - (tr.right - window.innerWidth + 4)}px`;
}

/**
 * Shows `el.dataset.tip` in a floating tooltip on hover, and toggles it on
 * tap/click so touch devices can read it too. Only one tooltip exists at a
 * time; tapping/clicking anywhere else dismisses it.
 */
export function bindTooltip(el: HTMLElement, dir: TooltipDir = 'top'): void {
  el.addEventListener('mouseenter', () => show(el, dir));
  el.addEventListener('mouseleave', () => { if (anchor === el) hide(); });
  el.addEventListener('click', e => {
    e.stopPropagation();
    anchor === el ? hide() : show(el, dir);
  });
}

document.addEventListener('click', hide);
