#!/usr/bin/env node
// Guards the release-tag series logic shared by every repository's workflow:
// the alpha counter must follow the series declared in the version file, and
// promoting that file must not reuse tag numbers from the previous series.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nextTagForSeries, readReleaseSeries } from '../.github/scripts/version.mjs';

const V010 = { major: 0, minor: 1, patch: 0 };
const V020 = { major: 0, minor: 2, patch: 0 };

test('an empty tag list starts the series at alpha.1', () => {
  assert.equal(nextTagForSeries([], V010), 'v0.1.0-alpha.1');
});

test('the counter continues from the highest alpha of the same series', () => {
  const tags = ['v0.1.0-alpha.1', 'v0.1.0-alpha.2', 'v0.1.0-alpha.9'];
  assert.equal(nextTagForSeries(tags, V010), 'v0.1.0-alpha.10');
});

test('a new series restarts at alpha.1 without reusing old numbers', () => {
  const tags = ['v0.1.0-alpha.1', 'v0.1.0-alpha.44'];
  assert.equal(nextTagForSeries(tags, V020), 'v0.2.0-alpha.1');
  assert.equal(nextTagForSeries([...tags, 'v0.2.0-alpha.1', 'v0.2.0-alpha.3'], V020),
    'v0.2.0-alpha.4');
});

test('unrelated and malformed tags cannot inflate the counter', () => {
  const tags = [
    'v0.1.0-beta.7', 'v0.1.0-rc.2', 'v0.1.0', 'v9.9.9-alpha.99',
    'v0.1.0-alpha.oops', 'v0.1.0-alpha.-3', 'v0.1.0-alpha.5extra', 'banana', null, 42,
  ];
  assert.equal(nextTagForSeries(tags, V010), 'v0.1.0-alpha.1');
});

test('readReleaseSeries prefers Cargo.toml, then package.json, then VERSION', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'opurom-series-'));
  try {
    writeFileSync(path.join(dir, 'VERSION'), '3.4.5');
    assert.deepEqual(readReleaseSeries(dir), { major: 3, minor: 4, patch: 5 });

    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    assert.deepEqual(readReleaseSeries(dir), { major: 2, minor: 3, patch: 4 });

    writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nversion = "1.2.3"\n');
    assert.deepEqual(readReleaseSeries(dir), { major: 1, minor: 2, patch: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readReleaseSeries rejects a missing source and a non-semver value', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'opurom-series-'));
  try {
    assert.throws(() => readReleaseSeries(dir), /no version found/);
    writeFileSync(path.join(dir, 'VERSION'), '0.1.0-beta.2');
    assert.throws(() => readReleaseSeries(dir), /MAJOR\.MINOR\.PATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
