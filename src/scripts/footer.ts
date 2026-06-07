const donateButtons = document.querySelectorAll<HTMLElement>('.footer-donate-btn');

// Guarantee clipping and containment — inline styles override any class-based rules
donateButtons.forEach(btn => { btn.style.overflow = 'hidden'; btn.style.position = 'relative'; });

function shineOne(btn: HTMLElement) {
  if (document.documentElement.classList.contains('no-glass')) return;
  btn.querySelectorAll('.footer-shine').forEach(el => el.remove());
  const shine = document.createElement('span');
  shine.className = 'footer-shine';
  btn.appendChild(shine);
  shine.addEventListener('animationend', () => shine.remove(), { once: true });
}

function runShine() {
  donateButtons.forEach((btn, i) => window.setTimeout(() => shineOne(btn), i * 400));
}

let delayTimer: number | null = null;
let repeatTimer: number | null = null;

function startShine() {
  if (delayTimer !== null || repeatTimer !== null) return;
  delayTimer = window.setTimeout(() => {
    delayTimer = null;
    runShine();
    repeatTimer = window.setInterval(runShine, 30_000);
  }, 5_000);
}

function stopShine() {
  if (delayTimer !== null) { clearTimeout(delayTimer); delayTimer = null; }
  if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null; }
}

const observer = new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting)) startShine();
  else stopShine();
}, { threshold: 0.5 });

donateButtons.forEach(btn => observer.observe(btn));
