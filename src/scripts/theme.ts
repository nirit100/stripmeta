const KEY = 'stripmeta-theme';
type Theme = 'light' | 'auto' | 'dark';

const THEME_COLORS: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark:  '#1d232a',
};

function resolvedDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function syncThemeColor(theme: Theme) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const isDark = theme === 'dark' || (theme === 'auto' && resolvedDark());
  meta.content = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
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

// Keep theme-color in sync when OS preference changes while in auto mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = (localStorage.getItem(KEY) as Theme | null) ?? 'auto';
  if (current === 'auto') syncThemeColor('auto');
});

document.getElementById('theme-toggle')?.querySelectorAll<HTMLElement>('[data-t]').forEach(btn => {
  btn.addEventListener('click', () => apply(btn.dataset.t as Theme));
});
