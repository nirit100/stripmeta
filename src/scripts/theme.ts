const KEY = 'stripmeta-theme';
type Theme = 'light' | 'auto' | 'dark';

const THEME_COLORS: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark:  '#1d232a',
};

function syncThemeColor(theme: Theme) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (!metas.length) return;
  if (theme === 'auto') {
    // Restore per-scheme defaults — browser picks via media query natively.
    metas.forEach(m => { m.content = m.media.includes('light') ? THEME_COLORS.light : THEME_COLORS.dark; });
  } else {
    const color = THEME_COLORS[theme];
    metas.forEach(m => { m.content = color; });
  }
}

function apply(theme: Theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(KEY);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }
  syncThemeColor(theme);
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
