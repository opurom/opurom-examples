#!/usr/bin/env node
// Test entry for CI: run the cross-project harness when the sibling
// repositories are present (the umbrella checkout), otherwise fall back to
// this repository's own tests so a single-repo clone stays green.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const workspace = resolve(root, '..');
const siblingsPresent =
  existsSync(join(workspace, 'opurom-lang', 'Cargo.toml')) &&
  existsSync(join(workspace, 'opurom-render', 'Cargo.toml'));

if (siblingsPresent) {
  const r = spawnSync('node', [join(here, 'cross-layer.mjs')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const tests = readdirSync(here).filter((f) => f.endsWith('.test.mjs'));
const r = spawnSync('node', ['--test', ...tests.map((f) => join(here, f))], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
