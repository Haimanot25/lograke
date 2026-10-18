#!/usr/bin/env node
/**
 * Prepack step for the npm package: bundle the built web UI and the legal /
 * history files into the package directory so the published tarball is
 * self-contained (server + UI).
 *
 * Requires `frontend/dist` to exist — run `npm run build` at the repo root
 * first. Outputs (gitignored): backend/public/, backend/LICENSE,
 * backend/CHANGELOG.md.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoDir = path.dirname(backendDir);
const distDir = path.join(repoDir, 'frontend', 'dist');
const publicDir = path.join(backendDir, 'public');

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('prepare-package: frontend/dist not found — run `npm run build` in the repo root first.');
  process.exit(1);
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(distDir, publicDir, { recursive: true });

copyFileSync(path.join(repoDir, 'LICENSE'), path.join(backendDir, 'LICENSE'));
copyFileSync(path.join(repoDir, 'CHANGELOG.md'), path.join(backendDir, 'CHANGELOG.md'));

console.log(`prepare-package: bundled ${path.relative(process.cwd(), distDir)} into ${path.relative(process.cwd(), publicDir)} (+ LICENSE, CHANGELOG).`);
