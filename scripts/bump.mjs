#!/usr/bin/env node
// Usage: node scripts/bump.mjs [patch|minor|major|<version>]
// Bumps version in package.json, commits, and creates a git tag.

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const type = process.argv[2] ?? 'patch';

const pkgPath = new URL('../package.json', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

function bump(version, type) {
  if (/^\d+\.\d+\.\d+$/.test(type)) return type; // explicit version
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump type: ${type}. Use patch, minor, major, or an explicit x.y.z version.`);
}

const next = bump(current, type);
const tag = `v${next}`;

// Check for uncommitted changes
const status = execSync('git status --porcelain').toString().trim();
if (status) {
  console.error('Working tree is dirty. Commit or stash changes before bumping.');
  process.exit(1);
}

// Check tag doesn't already exist
try {
  execSync(`git rev-parse ${tag}`, { stdio: 'pipe' });
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
} catch { /* tag doesn't exist, good */ }

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

execSync(`git add package.json`);
execSync(`git commit -m "chore: bump to ${tag}"`);
execSync(`git tag ${tag}`);

console.log(`Bumped ${current} → ${next} and created tag ${tag}`);
console.log(`Push with: git push && git push origin ${tag}`);
