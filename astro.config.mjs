// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'child_process';

function getAppVersion() {
  try { execSync('git fetch --tags', { stdio: 'pipe' }); } catch { /* ignore */ }
  try {
    return execSync('git describe --tags --always --dirty', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch { /* fall through */ }
  const sha = process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 8);
  return 'dev';
}

export default defineConfig({
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(getAppVersion()),
    },
  },
});
