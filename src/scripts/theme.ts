const KEY = 'stripmeta-theme';
type Theme = 'light' | 'auto' | 'dark';

const THEME_COLORS: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark:  '#1d232a',
};

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function syncThemeColor(theme: Theme) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = theme === 'auto'
    ? (systemDark.matches ? THEME_COLORS.dark : THEME_COLORS.light)
    : THEME_COLORS[theme];
}

// Keep the bar in sync when the OS flips colour scheme while in auto mode.
systemDark.addEventListener('change', () => {
  if (((localStorage.getItem(KEY) as Theme | null) ?? 'auto') === 'auto') syncThemeColor('auto');
});

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
