#!/usr/bin/env node
// Cross-project verification: every repo's tests + the IR contract between layers.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(import.meta.dirname, '../..');
const P = (...p) => join(ROOT, ...p);
const REPOS = [
  'opurom-spec', 'opurom-core', 'opurom-lang', 'opurom-render',
  'opurom-platform', 'opurom-cli', 'opurom-ide-plugins', 'opurom-examples',
];
const ENV = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
let failures = 0;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', env: ENV, ...opts });
}
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
function ok(r, label) {
  assert.equal(r.status, 0, `${label} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  return r.stdout || '';
}
function bin(name, sub) {
  for (const profile of ['release', 'debug']) {
    const p = P(name, 'target', profile, sub);
    if (existsSync(p)) return p;
  }
  return null;
}
function ensureBin(repo, sub) {
  const found = bin(repo, sub);
  if (found) return found;
  ok(run('cargo', ['build', '--manifest-path', P(repo, 'Cargo.toml')]), `cargo build ${repo}`);
  const built = bin(repo, sub);
  assert.ok(built, `${sub} binary missing after cargo build`);
  return built;
}

console.log('== repo hygiene ==');
for (const repo of REPOS) {
  check(`${repo}: independent git repo, clean tree, >=1 commit`, () => {
    const d = P(repo);
    assert.ok(existsSync(join(d, '.git')), 'missing .git');
    assert.equal(ok(run('git', ['status', '--porcelain'], { cwd: d }), 'git status').trim(), '', 'uncommitted files');
    assert.match(ok(run('git', ['log', '-1', '--oneline'], { cwd: d }), 'git log'), /\S/, 'no commits');
  });
}

console.log('== per-project test suites ==');
for (const repo of ['opurom-core', 'opurom-lang', 'opurom-render', 'opurom-platform']) {
  check(`${repo}: cargo test`, () => ok(run('cargo', ['test', '--manifest-path', P(repo, 'Cargo.toml')]), `cargo test ${repo}`));
}
check('opurom-cli: node --test', () => ok(run('node', ['--test'], { cwd: P('opurom-cli') }), 'node --test'));
check('opurom-ide-plugins: validate', () => ok(run('node', ['scripts/validate.mjs'], { cwd: P('opurom-ide-plugins') }), 'validate'));
check('opurom-cli: opurom doctor', () => ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'doctor']), 'doctor'));
check('opurom-cli: opurom test (end-to-end)', () => ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'test']), 'opurom test'));

console.log('== cross-layer IR contract ==');
const tmp = mkdtempSync(join(tmpdir(), 'opurom-cross-'));
try {
  const compiler = ensureBin('opurom-lang', 'opuromc');
  const profileIr = join(tmp, 'profile.opuir.json');
  check('profile.opu compiles and lowers set/toggle/input correctly', () => {
    ok(run(compiler, ['compile', P('opurom-examples', 'profile.opu'), '-o', profileIr]), 'compile profile');
    const ir = JSON.parse(readFileSync(profileIr, 'utf8'));
    assert.equal(ir.ir, '0.1');
    assert.deepEqual(ir.state.map(s => [s.name, s.type]), [['name', 'string'], ['dark', 'bool']]);
    const actions = [];
    const walk = n => { for (const a of Object.values(n.events || {})) actions.push(a); (n.children || []).forEach(walk); };
    walk(ir.tree);
    assert.ok(actions.some(a => a.op === 'toggle' && a.target === 'dark'), 'missing toggle');
    assert.ok(actions.some(a => a.op === 'set' && a.target === 'name' && a.value === 'world'), 'missing set');
    assert.ok(actions.some(a => a.op === 'set' && a.target === 'name' && a.value === undefined), 'missing input binding');
  });
  const renderer = ensureBin('opurom-render', 'opurom-render');
  check('renderer produces a stable digest for the golden IR', () => {
    const golden = P('opurom-spec', 'counter.opuir.json');
    const a = ok(run(renderer, [golden, '480', '320', join(tmp, 'a.ppm')]), 'render a');
    const b = ok(run(renderer, [golden, '480', '320', join(tmp, 'b.ppm')]), 'render b');
    const da = a.match(/digest=([0-9a-f]+)/i), db = b.match(/digest=([0-9a-f]+)/i);
    assert.ok(da && db, 'no digest in renderer output');
    assert.equal(da[1], db[1], 'digest differs between identical renders');
  });
  const core = ensureBin('opurom-core', 'opurom-core');
  check('kernel applies the golden IR tap event', () => {
    const out = ok(run(core, [P('opurom-spec', 'counter.opuir.json')], { input: 'tap 4\nstate\nquit\n' }), 'core run');
    assert.match(out, /count/i, 'no state in output');
  });
  const platform = ensureBin('opurom-platform', 'opurom-platform');
  check('platform registry lists every target', () => {
    const out = ok(run(platform, []), 'platform registry');
    for (const name of ['android', 'ios', 'harmony-mobile', 'windows', 'macos', 'linux', 'web', 'wechat', 'kuaishou']) {
      assert.match(out, new RegExp(name), `missing ${name}`);
    }
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
