// Wires the global help modal (components/HelpModal.astro): opens it from any
// element carrying `data-open-help` (a value matching a `data-help-id` jumps
// straight to that section), keeps the three FAQ items mutually exclusive,
// and keeps the local storage table's "current value" column live.
//
// Native <details> can only animate opening via CSS — closing hides the
// content instantly before a transition can run. So both directions are
// driven here via the Web Animations API, intercepting the summary click.

const ANIM_DURATION = 240;
const ANIM_EASING = 'ease-out';

const modal = document.getElementById('help-modal') as HTMLDialogElement | null;
const faqItems = Array.from(document.querySelectorAll<HTMLDetailsElement>('#help-modal .faq-item'));

interface AnimState {
  animation: Animation | null;
  isClosing: boolean;
  isExpanding: boolean;
}

const states = new WeakMap<HTMLDetailsElement, AnimState>();

function stateOf(item: HTMLDetailsElement): AnimState {
  let s = states.get(item);
  if (!s) { s = { animation: null, isClosing: false, isExpanding: false }; states.set(item, s); }
  return s;
}

function reduceMotion(): boolean {
  return document.documentElement.classList.contains('no-glass');
}

function renderLocalStorageValues(): void {
  document.querySelectorAll<HTMLElement>('#help-modal .ls-value').forEach(cell => {
    const key = cell.dataset.lsKey;
    if (!key) return;
    const raw = localStorage.getItem(key);
    if (raw === null) { cell.textContent = '—'; return; }
    if (key === 'stripmeta:stats_v1') {
      try {
        const s = JSON.parse(raw) as { filesProcessed: number; gpsRemoved: number; datesRemoved: number; bytesStripped: number };
        cell.textContent = `${s.filesProcessed} files\n${s.gpsRemoved} GPS\n${s.datesRemoved} dates\n${s.bytesStripped} B`;
        return;
      } catch { /* fall through to raw */ }
    }
    cell.textContent = raw;
  });
}

function scrollToItem(item: HTMLDetailsElement): void {
  item.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

function onOpened(item: HTMLDetailsElement): void {
  if (item.dataset.helpId === 'storage') renderLocalStorageValues();
  scrollToItem(item);
}

function finishAnimation(item: HTMLDetailsElement, open: boolean): void {
  const state = stateOf(item);
  item.open = open;
  state.animation = null;
  state.isClosing = false;
  state.isExpanding = false;
  item.style.height = '';
  item.style.overflow = '';
}

function animateClose(item: HTMLDetailsElement, summary: HTMLElement): void {
  const state = stateOf(item);
  item.style.overflow = 'hidden';
  state.isClosing = true;
  const startHeight = `${item.offsetHeight}px`;
  const endHeight = `${summary.offsetHeight}px`;
  state.animation?.cancel();
  state.animation = item.animate({ height: [startHeight, endHeight] }, { duration: ANIM_DURATION, easing: ANIM_EASING });
  state.animation.onfinish = () => finishAnimation(item, false);
  state.animation.oncancel = () => { state.isClosing = false; };
}

function animateOpen(item: HTMLDetailsElement, summary: HTMLElement, content: HTMLElement): void {
  const state = stateOf(item);
  item.style.overflow = 'hidden';
  item.style.height = `${item.offsetHeight}px`;
  item.open = true;
  requestAnimationFrame(() => {
    state.isExpanding = true;
    const startHeight = `${item.offsetHeight}px`;
    const endHeight = `${summary.offsetHeight + content.offsetHeight}px`;
    state.animation?.cancel();
    state.animation = item.animate({ height: [startHeight, endHeight] }, { duration: ANIM_DURATION, easing: ANIM_EASING });
    state.animation.onfinish = () => { finishAnimation(item, true); onOpened(item); };
    state.animation.oncancel = () => { state.isExpanding = false; };
  });
}

function closeInstant(item: HTMLDetailsElement): void {
  const state = stateOf(item);
  state.animation?.cancel();
  item.open = false;
  item.style.height = '';
  item.style.overflow = '';
}

function openInstant(item: HTMLDetailsElement): void {
  const state = stateOf(item);
  state.animation?.cancel();
  item.open = true;
  onOpened(item);
}

function closeOthers(except: HTMLDetailsElement): void {
  for (const other of faqItems) {
    if (other === except) continue;
    const otherState = stateOf(other);
    if (other.open || otherState.isExpanding) {
      if (reduceMotion()) closeInstant(other);
      else {
        const otherSummary = other.querySelector<HTMLElement>(':scope > summary');
        if (otherSummary) animateClose(other, otherSummary);
      }
    }
  }
}

faqItems.forEach(item => {
  const summary = item.querySelector<HTMLElement>(':scope > summary');
  const content = item.querySelector<HTMLElement>(':scope > .faq-body-inner');
  if (!summary || !content) return;

  summary.addEventListener('click', (e) => {
    e.preventDefault();
    const state = stateOf(item);
    const isOpenOrOpening = item.open || state.isExpanding;

    if (!isOpenOrOpening || state.isClosing) {
      closeOthers(item);
      if (reduceMotion()) openInstant(item);
      else animateOpen(item, summary, content);
    } else {
      if (reduceMotion()) closeInstant(item);
      else animateClose(item, summary);
    }
  });
});

function openSection(id: string): void {
  const target = faqItems.find(item => item.dataset.helpId === id);
  if (!target) return;

  // Always enforce exclusivity, even if the target is already open — a
  // direct link into one section shouldn't leave some other section (left
  // open from a previous visit to the modal) open alongside it.
  closeOthers(target);

  const targetState = stateOf(target);
  if (target.open && !targetState.isClosing) {
    onOpened(target); // already open (or opening) — just refresh/scroll, don't replay the animation
    return;
  }

  if (reduceMotion()) { openInstant(target); return; }
  const summary = target.querySelector<HTMLElement>(':scope > summary');
  const content = target.querySelector<HTMLElement>(':scope > .faq-body-inner');
  if (summary && content) animateOpen(target, summary, content);
}

document.addEventListener('click', (e) => {
  const trigger = (e.target as HTMLElement).closest<HTMLElement>('[data-open-help]');
  if (!trigger || !modal) return;
  // A trigger may sit inside another interactive element (e.g. a <summary>,
  // which toggles its parent <details> on any click) — stop that from firing.
  e.preventDefault();
  e.stopPropagation();
  modal.showModal();
  renderLocalStorageValues(); // re-read on every open — never show stale values
  const topic = trigger.dataset.openHelp;
  if (topic) openSection(topic);
});

renderLocalStorageValues();
