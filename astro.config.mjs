// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function getAppVersion() {
  try { execSync('git fetch --tags', { stdio: 'pipe' }); } catch { /* ignore */ }
  try {
    return execSync('git describe --tags --always --dirty', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch { /* fall through */ }
  const sha = process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 8);
  return 'dev';
}

const appVersion = getAppVersion();

/** Stamps __SW_VERSION__ in the copied public/sw.js after the build. */
function injectSwVersion() {
  return {
    name: 'inject-sw-version',
    hooks: {
      /** @param {{ dir: URL }} opts */
      'astro:build:done'({ dir }) {
        const swPath = fileURLToPath(new URL('sw.js', dir));
        const content = fs.readFileSync(swPath, 'utf8').replace('__SW_VERSION__', appVersion);
        fs.writeFileSync(swPath, content);
      },
    },
  };
}

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [injectSwVersion()],
  vite: {
    plugins: [tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
  },
});
