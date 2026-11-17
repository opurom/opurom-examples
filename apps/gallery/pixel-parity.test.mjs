#!/usr/bin/env node
// Pixel parity assertions for the structural Gallery batch. Flutter authority:
// flutter-gallery-src/lib/demos/material/bottom_navigation_demo.dart:113-128
// (BottomNavigationBar backgroundColor = colorScheme.primary) and the pinned
// 1080x2400 golden frames in opurom-dist/flutter-golden-apk/screens/.
// Run locally with: node --test apps/gallery/pixel-parity.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const source = path.join(root, 'apps/gallery/opurom_gallery.opu');
const candidate = (repo, names) => {
  for (const name of names) {
    for (const profile of ['debug', 'release']) {
      const p = path.resolve(root, '..', repo, 'target', profile, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
};
const compiler = process.env.OPUROM_LANG_BIN || candidate('opurom-dist/lang-clean', ['opuromc']) || candidate('opurom-lang', ['opuromc']);
const renderer = process.env.OPUROM_RENDER_BIN || candidate('opurom-render', ['opurom-render', 'opurom_render']);
const WIDTH = 1080;
const HEIGHT = 2400;

function run(tool, args) {
  assert.ok(tool, 'native toolchain binary not found');
  const r = spawnSync(tool, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, `${path.basename(tool)} failed: ${r.stderr}`);
  return r;
}

function renderRoute(route) {
  const tmp = mkdtempSync(path.join(tmpdir(), `gallery-${route}-`));
  const ir = path.join(tmp, 'ir.json');
  run(compiler, ['compile', source, '-o', ir]);
  const doc = JSON.parse(readFileSync(ir, 'utf8'));
  doc.initialRoute = route;
  const routeIr = path.join(tmp, 'route.json');
  writeFileSync(routeIr, JSON.stringify(doc));
  const ppm = path.join(tmp, 'frame.ppm');
  run(renderer, [routeIr, String(WIDTH), String(HEIGHT), ppm]);
  return readFileSync(ppm);
}

function rowsMatching(ppm, rgb, minPixels) {
  const start = ppm.indexOf('\n255\n');
  assert.ok(start > 0, 'frame must be a binary P6 PPM');
  const pixels = ppm.subarray(start + 5);
  const rows = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    let hits = 0;
    for (let x = 0; x < WIDTH; x += 6) {
      const i = (y * WIDTH + x) * 3;
      if (pixels[i] === rgb[0] && pixels[i + 1] === rgb[1] && pixels[i + 2] === rgb[2]) hits += 1;
    }
    if (hits >= minPixels) rows.push(y);
  }
  return rows;
}

function runs(rows) {
  const out = [];
  for (const y of rows) {
    if (!out.length || y !== out[out.length - 1][1] + 1) out.push([y, y]);
    else out[out.length - 1][1] = y;
  }
  return out;
}

const PRIMARY = [98, 0, 238];
const SURFACE_TINT = [239, 243, 243];
const band = (frame) => runs(rowsMatching(frame, PRIMARY, 90));

test('BottomNav and BottomNavCalendar keep the primary bottom bar', () => {
  for (const route of ['BottomNav', 'BottomNavCalendar']) {
    const spans = band(renderRoute(route));
    assert.ok(spans.some(([a, b]) => a === 275 && b === 421), `${route} title band`);
    assert.ok(spans.some(([a, b]) => a === 2085 && b === 2231), `${route} bottom bar`);
  }
});

test('Colors title band ends at the measured y=547', () => {
  const spans = rowsMatching(renderRoute('Colors'), PRIMARY, 90);
  assert.equal(spans[0], 275);
  assert.ok(Math.abs(spans[spans.length - 1] - 547) <= 2, 'golden purple extent');
});

test('SettingsThemeOptions has no primary band and aligned dropdown tiles', () => {
  const frame = renderRoute('SettingsThemeOptions');
  assert.equal(band(frame).length, 0, 'golden has no primary band');
  const tiles = runs(rowsMatching(frame, SURFACE_TINT, 20)).slice(0, 4);
  const golden = [[333, 476], [509, 652], [685, 827], [861, 1003]];
  tiles.forEach(([a, b], i) => {
    assert.ok(Math.abs(a - golden[i][0]) <= 2 && Math.abs(b - golden[i][1]) <= 2,
      `dropdown ${i} at ${a}..${b}`);
  });
});