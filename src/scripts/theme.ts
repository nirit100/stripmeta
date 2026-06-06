const KEY = 'stripmeta-theme';
type Theme = 'light' | 'auto' | 'dark';

const ACTIVE   = ['bg-base-100', 'shadow-sm', 'text-base-content'];
const INACTIVE = ['text-base-content/40', 'hover:text-base-content/70'];

function apply(theme: Theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(KEY);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }
  document.querySelectorAll<HTMLElement>('#theme-toggle [data-t]').forEach(btn => {
    const active = btn.dataset.t === theme;
    btn.classList.toggle('bg-base-100', active);
    btn.classList.toggle('shadow-sm', active);
    btn.classList.toggle('text-base-content', active);
    btn.classList.toggle('text-base-content/40', !active);
    btn.classList.toggle('hover:text-base-content/70', !active);
  });
}

const initial = (localStorage.getItem(KEY) as Theme | null) ?? 'auto';
apply(initial);

document.getElementById('theme-toggle')?.querySelectorAll<HTMLElement>('[data-t]').forEach(btn => {
  btn.addEventListener('click', () => apply(btn.dataset.t as Theme));
});
