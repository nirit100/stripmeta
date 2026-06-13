#!/usr/bin/env node
// Generates all PWA and favicon assets from public/logo_orig.png.
// Run: node scripts/gen-icons.mjs
// Requires: ImageMagick 7 (magick)

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGO = path.join(root, 'public/logo_orig.png');
const BG   = '#1d232a';

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

// Generates SIZE×SIZE icon with BG fill, centered logo at logoPct of SIZE,
// and optional rounded corners at radiusPct of SIZE.
function icon(size, dest, { logoPct = 0.82, radiusPct = 0.15, rounded = true } = {}) {
  const logoSize = Math.round(size * logoPct);
  const radius   = Math.round(size * radiusPct);
  const last     = size - 1;

  const maskOp = rounded
    ? `\\( +clone -alpha extract -fill black -colorize 100 -fill white -draw "roundrectangle 0,0 ${last},${last} ${radius},${radius}" \\) -compose CopyOpacity -composite`
    : '';

  run(`magick \
    -size ${size}x${size} xc:"${BG}" \
    \\( "${LOGO}" -resize ${logoSize}x${logoSize} \\) \
    -gravity Center -composite \
    ${maskOp} \
    "${dest}"`);

  console.log(`  ✓  ${dest}`);
}

// Multi-size .ico — transparent background, no rounding (too small to matter).
function favicon(dest) {
  const sizes = [16, 32, 48];
  const tmp = sizes.map(s => `/tmp/favicon_stripmeta_${s}.png`);

  sizes.forEach((s, i) => {
    run(`magick "${LOGO}" -resize ${s}x${s} "${tmp[i]}"`);
  });

  run(`magick ${tmp.join(' ')} "${dest}"`);
  console.log(`  ✓  ${dest}`);
}

console.log('Generating icons from logo_orig.png…\n');

icon(512, 'public/icons/512.png');
icon(512, 'public/icons/512-maskable.png', { logoPct: 0.72, rounded: false });
icon(192, 'public/icons/192.png');
icon(180, 'public/icons/apple-touch.png');
favicon('public/favicon.ico');

console.log('\nDone.');
