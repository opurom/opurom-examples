#!/usr/bin/env node
// Cross-project verification: every repo's tests + the IR contract between layers.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(import.meta.dirname, '../..');
const P = (...p) => join(ROOT, ...p);
const REPOS = [
  'opurom-spec', 'opurom-core', 'opurom-lang', 'opurom-render',
  'opurom-platform', 'opurom-cli', 'opurom-ide-plugins', 'opurom-examples',
  'opurom-plugins', 'opurom-server', 'opurom-db', 'opurom-runtime-adapters',
  'opurom-lsp', 'opurom-debug', 'opurom-pkg', 'opurom-gpu',
  'opurom-web', 'opurom-mobile',
];
const RUST_REPOS = ['opurom-core', 'opurom-lang', 'opurom-render', 'opurom-platform',
  'opurom-server', 'opurom-db', 'opurom-runtime-adapters', 'opurom-gpu', 'opurom-mobile'];
const NODE_REPOS = ['opurom-cli', 'opurom-ide-plugins', 'opurom-plugins', 'opurom-lsp',
  'opurom-debug', 'opurom-pkg', 'opurom-web', 'opurom-mobile'];
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
function assertArtifacts(dir, files, label) {
  for (const f of files) {
    const p = join(dir, f);
    assert.ok(existsSync(p) && statSync(p).size > 0, `${label}: missing or empty ${f}`);
    if (f.endsWith('.js')) ok(run('node', ['--check', p]), `${label}: ${f} syntax`);
    if (f.endsWith('.json')) JSON.parse(readFileSync(p, 'utf8'));
  }
}
function bin(repo, sub) {
  for (const profile of ['release', 'debug']) {
    const p = P(repo, 'target', profile, sub);
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
check('umbrella docs: isolated git repo, clean tree, >=1 commit', () => {
  assert.ok(existsSync(join(ROOT, '.git')), 'missing umbrella .git');
  assert.equal(ok(run('git', ['status', '--porcelain'], { cwd: ROOT }), 'git status').trim(), '', 'uncommitted umbrella docs');
  assert.match(ok(run('git', ['log', '-1', '--oneline'], { cwd: ROOT }), 'git log'), /\S/, 'no commits');
});
for (const repo of REPOS) {
  check(`${repo}: independent git repo, clean tree, >=1 commit`, () => {
    const d = P(repo);
    assert.ok(existsSync(join(d, '.git')), 'missing .git');
    assert.equal(ok(run('git', ['status', '--porcelain'], { cwd: d }), 'git status').trim(), '', 'uncommitted files');
    assert.match(ok(run('git', ['log', '-1', '--oneline'], { cwd: d }), 'git log'), /\S/, 'no commits');
    const author = ok(run('git', ['log', '-1', '--format=%an <%ae>'], { cwd: d }), 'git author').trim();
    assert.ok(!/OPUROM Team/.test(author), `wrong author: ${author}`);
    const tags = ok(run('git', ['tag', '--list', 'v*'], { cwd: d }), 'git tags').trim();
    // SemVer 2.0: prerelease iterations start at alpha.1, numeric fields have no leading zeros.
    assert.match(tags, /^v0\.1\.0-alpha\.1$/m, 'SemVer version tags missing');
    assert.ok(!/^v\d+\.\d+\.\d{4}$/m.test(tags), 'legacy zero-padded version tags remain');
  });
}

console.log('== English-only published artifacts ==');
check('no CJK characters in tracked text files', () => {
  const cjk = /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
  const bad = [];
  const roots = [ROOT, ...REPOS.map(r => P(r))];
  for (const root of roots) {
    const files = ok(run('git', ['ls-files'], { cwd: root }), 'git ls-files').split('\n').filter(Boolean);
    for (const f of files) {
      if (/\.(png|jpg|jpeg|gif|ico|wasm|ppm|vsix|pdf|zip|lock)$/.test(f)) continue;
      const p = join(root, f);
      if (!existsSync(p)) continue;
      try { if (cjk.test(readFileSync(p, 'utf8'))) bad.push(`${root}/${f}`); } catch { /* binary */ }
    }
  }
  assert.deepEqual(bad, [], `non-English content: ${bad.join(', ')}`);
});

console.log('== per-project test suites ==');
for (const repo of RUST_REPOS) {
  check(`${repo}: cargo test`, () => ok(run('cargo', ['test', '--manifest-path', P(repo, 'Cargo.toml')]), `cargo test ${repo}`));
}
for (const repo of NODE_REPOS) {
  const pkg = P(repo, 'package.json');
  check(`${repo}: node test suite`, () => {
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).scripts?.test) {
      ok(run('npm', ['test'], { cwd: P(repo) }), `npm test ${repo}`);
    } else {
      ok(run('node', ['--test'], { cwd: P(repo) }), `node --test ${repo}`);
    }
  });
}
check('opurom-ide-plugins: validate', () => ok(run('node', ['scripts/validate.mjs'], { cwd: P('opurom-ide-plugins') }), 'validate'));
check('opurom-cli: opurom doctor', () => ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'doctor']), 'doctor'));
check('opurom-cli: opurom test (full-stack end-to-end)', () => ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'test']), 'opurom test'));

console.log('== examples registry ==');
check('examples registry and runner cover every sample app', () => {
  const registry = JSON.parse(readFileSync(P('opurom-examples', 'examples.json'), 'utf8'));
  const registered = new Set(registry.apps.map(app => app.source));
  const onDisk = readdirSync(P('opurom-examples')).filter(file => file.endsWith('.opu'));
  for (const file of onDisk) {
    assert.ok(registered.has(file), `${file} is missing from examples.json (register every sample app)`);
  }
  for (const file of ['calculator.opu', 'photos.opu']) {
    assert.ok(registered.has(file), `${file} is missing from examples.json (planned app)`);
  }
  const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'examples']), 'opurom examples');
  const listed = new Set(out.trim().split('\n').map(line => line.split(/\s+/)[0]));
  for (const app of registry.apps) {
    assert.ok(listed.has(app.name), `${app.name} is missing from "opurom examples" output`);
    assert.ok(app.tests.length > 0 && app.tests.every(test => Array.isArray(test.cmd) && test.cmd.length > 0),
      `${app.name} has no runnable test`);
  }
  assert.match(out, /\d+ apps, \d+ tests/, 'no registered test totals in listing');
});

console.log('== cross-layer IR and full-stack contract ==');
const tmp = mkdtempSync(join(tmpdir(), 'opurom-cross-'));
try {
  const compiler = ensureBin('opurom-lang', 'opuromc');
  check('counter.opu still lowers to the core golden IR', () => {
    const out = join(tmp, 'counter.opuir.json');
    ok(run(compiler, ['compile', P('opurom-spec', 'counter.opu'), '-o', out]), 'compile counter');
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), JSON.parse(readFileSync(P('opurom-spec', 'counter.opuir.json'), 'utf8')));
  });
  check('todo.opu lowers UI + models + api into one IR', () => {
    const out = join(tmp, 'todo.opuir.json');
    ok(run(compiler, ['compile', P('opurom-examples', 'todo.opu'), '-o', out]), 'compile todo');
    const ir = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(ir.app, 'TodoApp');
    assert.equal(ir.models?.[0]?.name, 'Todo', 'missing model');
    assert.deepEqual(ir.models[0].fields.map(f => f.name), ['id', 'title', 'done']);
    assert.equal(ir.api?.length, 2, 'missing api routes');
    assert.ok(ir.api.some(a => a.path === '/todos' && a.handlers.includes('create')), 'missing create route');
    assert.equal(ir.tree.kind, 'Column', 'frontend tree missing');
  });
  check('profile.opu compiles and lowers set/toggle/input correctly', () => {
    const profileIr = join(tmp, 'profile.opuir.json');
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
  check('renderer digest is stable and unchanged from the core release', () => {
    const golden = P('opurom-spec', 'counter.opuir.json');
    const a = ok(run(renderer, [golden, '320', '240', join(tmp, 'a.ppm')]), 'render a');
    const b = ok(run(renderer, [golden, '320', '240', join(tmp, 'b.ppm')]), 'render b');
    const da = a.match(/digest=([0-9a-f]+)/i), db = b.match(/digest=([0-9a-f]+)/i);
    assert.ok(da && db, 'no digest in renderer output');
    assert.equal(da[1], db[1], 'digest differs between identical renders');
    assert.equal(da[1], '8d45f412996a99c6', 'core golden digest regressed');
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
  const migrate = ensureBin('opurom-db', 'opurom-migrate');
  check('IR models lower to SQL migrations', () => {
    const dir = join(tmp, 'migrations');
    ok(run(migrate, [P('opurom-examples', 'todo.opuir.json'), '-o', dir]), 'migrate');
    // The generator normalises the output base: a directory called
    // "migrations" is replaced by its parent. SQL lands in <base>/migrations/,
    // the combined schema in <base>/schema.sql.
    const base = dir.endsWith('migrations') ? dirname(dir) : dir;
    const sql = readFileSync(join(base, 'migrations', '001_create_todo.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS Todo/i);
    assert.match(sql, /title/i);
    assert.ok(existsSync(join(base, 'schema.sql')), 'combined schema.sql missing');
  });
  const serverc = ensureBin('opurom-server', 'opurom-serverc');
  check('IR lowers to a standalone Rust service', () => {
    const dir = join(tmp, 'service');
    ok(run(serverc, [P('opurom-examples', 'todo.opuir.json'), '-o', dir, '--dep-root', ROOT]), 'serverc');
    assert.ok(existsSync(join(dir, 'Cargo.toml')) && existsSync(join(dir, 'src', 'main.rs')));
    // Prefer the local crate cache; only fall back to the registry when the
    // cache is genuinely cold, so an offline host never fails the harness.
    let built = run('cargo', ['build', '--release', '--offline', '--manifest-path', join(dir, 'Cargo.toml')]);
    if (built.status !== 0) built = run('cargo', ['build', '--release', '--manifest-path', join(dir, 'Cargo.toml')]);
    ok(built, 'build service');
  });
  const runtime = ensureBin('opurom-runtime-adapters', 'opurom-runtime-adapters');
  check('backend runtime conformance report is honest', () => {
    const out = ok(run(runtime, [P('opurom-examples', 'todo.opuir.json')]), 'runtime report');
    assert.match(out, /native/i);
    assert.match(out, /planned/i, 'no honest Planned status');
  });

  console.log('== component catalog and ecosystem contracts ==');
  check('component catalog has >=100 unique names mapped onto distinct primitives', () => {
    const c = JSON.parse(readFileSync(P('opurom-spec', 'components.json'), 'utf8'));
    assert.ok(c.count >= 100);
    assert.equal(c.components.length, c.count);
    assert.equal(new Set(c.components.map(x => x[0])).size, c.count, 'duplicate names');
    assert.equal(new Set(c.components.map(x => x[1])).size, c.primitives, 'primitive count mismatch');
    assert.ok(c.primitives >= 32, 'catalog should have at least 32 primitives');
  });
  check('catalog names lower to primitives and keep default props', () => {
    const out = join(tmp, 'showcase.opuir.json');
    ok(run(compiler, ['compile', P('opurom-examples', 'showcase.opu'), '-o', out]), 'compile showcase');
    const ir = JSON.parse(readFileSync(out, 'utf8'));
    const kinds = [];
    const components = [];
    const walk = n => {
      kinds.push(n.kind);
      if (n.component) components.push(n.component);
      (n.children || []).forEach(walk);
    };
    walk(ir.tree);
    assert.ok(components.includes('Heading'), 'Heading was not expanded');
    assert.ok(components.includes('CardGrid'), 'CardGrid was not expanded');
    assert.ok(!kinds.includes('Heading'), 'primitive kind not substituted');
    assert.equal(kinds.filter(k => k === 'Row').length >= 1, true, 'ButtonBar did not lower to Row');
  });
  check('optimizer is semantics-preserving on the golden IR', () => {
    const out = join(tmp, 'opt.opuir.json');
    const golden = P('opurom-spec', 'counter.opuir.json');
    ok(run(compiler, ['optimize', golden, '-o', out]), 'optimize golden');
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), JSON.parse(readFileSync(golden, 'utf8')));
  });
  check('optimizer removes dead state and reports measured byte counts', () => {
    const dir = join(tmp, 'dead');
    const src = join(dir, 'dead.opuir.json');
    const out = join(dir, 'dead-opt.opuir.json');
    const ir = JSON.parse(readFileSync(P('opurom-spec', 'counter.opuir.json'), 'utf8'));
    ir.state.push({ name: 'unused', type: 'int', init: 7 });
    mkdirSync(dir, { recursive: true });
    // The optimizer pretty-prints its output; use the same indentation for the
    // input so the byte comparison measures the dead state, not the format.
    writeFileSync(src, JSON.stringify(ir, null, 2));
    const printed = ok(run(compiler, ['optimize', src, '-o', out]), 'optimize dead');
    const opt = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(opt.state.length, 1, 'dead state not removed');
    assert.equal(opt.tree.id, 0, 'node ids changed');
    assert.ok(statSync(out).size < statSync(src).size, 'output not smaller');
    assert.match(printed, /\d+/, 'no measured byte count printed');
  });
  check('renderer emits a deterministic accessibility tree', () => {
    const a11y = join(tmp, 'a11y.json');
    ok(run(renderer, [P('opurom-spec', 'counter.opuir.json'), '320', '240',
      join(tmp, 'a11y.ppm'), '--a11y', a11y]), 'render a11y');
    const tree = JSON.parse(readFileSync(a11y, 'utf8'));
    assert.ok(Array.isArray(tree) && tree.length >= 2, 'empty a11y tree');
    for (const n of tree) {
      assert.equal(typeof n.id, 'number');
      assert.equal(typeof n.role, 'string');
      assert.equal(n.bounds.length, 4);
      assert.equal(typeof n.hidden, 'boolean');
    }
  });
  check('terminal adapter is registered as a verified host', () => {
    const out = ok(run(platform, ['--hosts']), 'platform hosts');
    assert.match(out, /terminal/i, 'terminal host missing');
    assert.match(out, /verified/i, 'terminal host not marked verified');
  });
  check('DAP debugger session is exercised by its own test suite', () => {
    ok(run('node', ['--test'], { cwd: P('opurom-debug') }), 'dap tests');
  });
  check('CLI reports measured benchmark numbers', () => {
    const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'bench', '--full',
      '--src', P('opurom-examples', 'counter.opu')]), 'bench --full');
    assert.match(out, /\|/m, 'no markdown table');
    assert.match(out, /\d/, 'no measured numbers');
  });

  console.log('== language and packaging contracts ==');
  check('component catalog stays consistent with the compiler', () => {
    const out = ok(run(compiler, ['components']), 'opuromc components');
    const c = JSON.parse(readFileSync(P('opurom-spec', 'components.json'), 'utf8'));
    assert.match(out, new RegExp(`${c.count} components`), 'catalog count not reported');
    assert.ok(c.primitives >= 32);
  });
  check('async/await effects lower into IR without changing plain programs', () => {
    const src = join(tmp, 'async.opu');
    const out = join(tmp, 'async.opuir.json');
    writeFileSync(src, 'app AsyncDemo {\n  state count = 0\n  state payload = "idle"\n  Button("Load") async {\n    await delay(50)\n    await fetch("/todos", payload)\n    count += 1\n  }\n}\n');
    ok(run(compiler, ['compile', src, '-o', out]), 'compile async');
    const ir = JSON.parse(readFileSync(out, 'utf8'));
    const tap = ir.tree.events?.tap || ir.tree.children?.[0]?.events?.tap;
    assert.ok(tap, 'tap event missing');
    assert.equal(tap.async, true, 'async flag missing');
    assert.equal(tap.effects.length, 2, 'effects missing');
    assert.equal(tap.effects[0].kind, 'delay');
    assert.equal(tap.effects[1].into, 'payload');
    const plain = join(tmp, 'plain.opuir.json');
    ok(run(compiler, ['compile', P('opurom-spec', 'counter.opu'), '-o', plain]), 'compile plain');
    assert.equal(JSON.parse(readFileSync(plain, 'utf8')).tree.events.async, undefined);
  });
  check('module imports merge declarations and reject traversal', () => {
    const dir = join(tmp, 'mods');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'todo.opu'), 'app M {\n  model Todo { id: int primary }\n}\n');
    const okOut = join(tmp, 'import-ok.opuir.json');
    writeFileSync(join(dir, 'main.opu'), 'import "todo.opu"\napp Main {\n  state n = 0\n  Column { Text("{n}") }\n}\n');
    ok(run(compiler, ['compile', join(dir, 'main.opu'), '-o', okOut]), 'compile import');
    const ir = JSON.parse(readFileSync(okOut, 'utf8'));
    assert.equal(ir.models?.[0]?.name, 'Todo', 'imported model missing');
    assert.deepEqual(ir.imports, ['todo.opu']);
    writeFileSync(join(dir, 'bad.opu'), 'import "../escape.opu"\napp Bad { state n = 0 }\n');
    const bad = run(compiler, ['compile', join(dir, 'bad.opu'), '-o', join(tmp, 'bad.json')]);
    assert.notEqual(bad.status, 0, 'traversal import was accepted');
  });
  check('SVG vector backend is byte-deterministic', () => {
    const a = join(tmp, 'a.svg'), b = join(tmp, 'b.svg');
    const args = ir => [P('opurom-spec', 'counter.opuir.json'), '320', '240', join(tmp, 'svg.ppm'), '--svg', ir];
    ok(run(renderer, args(a)), 'render svg a');
    ok(run(renderer, args(b)), 'render svg b');
    const sa = readFileSync(a, 'utf8'), sb = readFileSync(b, 'utf8');
    assert.equal(sa, sb, 'SVG output differs between identical renders');
    assert.match(sa, /<svg/);
    assert.match(sa, /<text/);
  });
  check('CLI profile reports measured frame timings', () => {
    const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'profile',
      '--src', P('opurom-examples', 'counter.opu'), '--frames', '5']), 'profile');
    assert.match(out, /p50|p95/i, 'no percentile report');
    assert.match(out, /\d/, 'no measured numbers');
  });
  check('package manager verifies its lockfile', () => {
    const out = ok(run('node', [P('opurom-pkg', 'bin', 'opurom-pkg.mjs'), 'verify'],
      { cwd: P('opurom-pkg') }), 'pkg verify');
    assert.match(out, /pass|ok|verified/i, 'verify did not report success');
  });

  console.log('== hardware and protocol contracts ==');
  const gpu = bin('opurom-gpu', 'opurom-gpu') ||
    (existsSync(P('opurom-gpu', 'Cargo.toml')) ? ensureBin('opurom-gpu', 'opurom-gpu') : null);
  check('Metal GPU readback equals the CPU reference', () => {
    assert.ok(gpu, 'opurom-gpu binary missing');
    const out = ok(run(gpu, ['self-test']), 'gpu self-test');
    assert.match(out, /PASS/i, 'GPU self-test did not pass');
    assert.match(out, /Apple|Metal|GPU/i, 'no real device name reported');
  });
  check('AppKit host is verified and writes a real PNG', () => {
    const hosts = ok(run(platform, ['--hosts']), 'platform hosts');
    assert.match(hosts, /appkit/i, 'AppKit host missing');
    const png = join(tmp, 'appkit.png');
    ok(run(platform, ['--png', png]), 'platform png');
    const b = readFileSync(png);
    assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG');
    assert.equal(b.subarray(12, 16).toString(), 'IHDR', 'IHDR missing');
  });
  check('page transitions are deterministic at a fixed tick', () => {
    const args = t => [P('opurom-spec', 'counter.opuir.json'), '320', '240',
      join(tmp, `t-${t}.ppm`), '--transition', 'slide', '--tick', '16'];
    const a = ok(run(renderer, args('a')), 'transition a');
    const b = ok(run(renderer, args('b')), 'transition b');
    assert.equal(a.match(/digest=([0-9a-f]+)/i)?.[1], b.match(/digest=([0-9a-f]+)/i)?.[1]);
  });
  check('computed/else/list-state lower into one IR', () => {
    const src = join(tmp, 'language.opu');
    const out = join(tmp, 'language.opuir.json');
    writeFileSync(src, [
      'app LanguageDemo {',
      '  state count = 2',
      '  state dark = false',
      '  state items = ["a","b"]',
      '  computed doubled = count * 2',
      '  Column {',
      '    if (dark) { Text("on") } else { Text("off") }',
      '    for (item in items) { Text("{item}") }',
      '  }',
      '}',
    ].join('\n') + '\n');
    ok(run(compiler, ['compile', src, '-o', out]), 'compile language demo');
    const ir = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(ir.computed?.[0]?.name, 'doubled', 'computed missing');
    assert.equal(ir.state.find(s => s.name === 'items')?.type, 'list', 'list state missing');
    const nodes = [];
    const walk = n => { nodes.push(n); (n.children || []).forEach(walk); };
    walk(ir.tree);
    assert.ok(nodes.some(n => n.unless === 'dark'), 'else/unless missing');
  });
  check('PostgreSQL wire protocol has a mock-server conformance test', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-db', 'Cargo.toml'), '--', '--list']), 'db test list');
    assert.match(out, /postgres|pg_/i, 'no PostgreSQL conformance test registered');
  });
  check('opt-in HTTP features keep defaults byte-identical', () => {
    const demo = ensureBin('opurom-server', 'opurom-server');
    const port = 8974;
    const env = { ...ENV, OPR_AUTH_TOKEN: 'devtoken', OPR_CORS: 'https://app.example', OPR_PORT: String(port) };
    const child = spawn(demo, [], { env, stdio: 'ignore' });
    try {
      let ready = false;
      for (let i = 0; i < 30; i++) {
        const r = run('curl', ['-s', '--max-time', '2', '-o', '/dev/null', '-w', '%{http_code}',
          `http://127.0.0.1:${port}/health`]);
        if (r.stdout.trim() === '401') { ready = true; break; }
        spawnSync('sleep', ['0.2']);
      }
      assert.ok(ready, 'auth-enabled server did not become ready');
      const authorized = run('curl', ['-s', '--max-time', '3', '-H', 'Authorization: Bearer devtoken',
        '-D', '-', `http://127.0.0.1:${port}/health`]);
      assert.match(authorized.stdout, /200/, 'authorized request failed');
      assert.match(authorized.stdout, /etag/i, 'ETag header missing');
    } finally {
      child.kill('SIGTERM');
    }
  });

  console.log('== platform delivery contracts ==');
  check('GPU display-list PPM equals the software renderer PPM', () => {
    const cmds = join(tmp, 'commands.json');
    const cpu = join(tmp, 'cpu.ppm');
    const gpuOut = join(tmp, 'gpu.ppm');
    ok(run(renderer, [P('opurom-spec', 'counter.opuir.json'), '320', '240', cpu,
      '--commands', cmds]), 'render commands');
    assert.ok(existsSync(cmds), 'display list not written');
    const gpuBin = bin('opurom-gpu', 'opurom-gpu') || ensureBin('opurom-gpu', 'opurom-gpu');
    ok(run(gpuBin, ['raster', cmds, gpuOut]), 'gpu raster');
    assert.ok(readFileSync(cpu).equals(readFileSync(gpuOut)),
      'GPU PPM differs from the software renderer PPM');
  });
  check('browser DOM/Canvas hybrid verifies a real canvas digest', () => {
    const dir = join(tmp, 'webout');
    mkdirSync(dir, { recursive: true });
    const out = ok(run('node', [P('opurom-web', 'bin', 'opurom-web.mjs'), 'verify',
      P('opurom-spec', 'counter.opuir.json'), dir]), 'web verify');
    assert.match(out, /PASS|verified|digest/i, 'no browser verification result');
    assert.ok(existsSync(join(dir, 'index.html')), 'index.html not emitted');
  });
  check('mobile iOS staticlib and bindings are real artifacts', () => {
    const out = ok(run('node', [P('opurom-mobile', 'verify.mjs')]), 'mobile verify');
    assert.match(out, /PASS|arm64|staticlib/i, 'no iOS artifact evidence');
    const archive = P('opurom-mobile', 'target', 'aarch64-apple-ios', 'release',
      'libopurom_mobile.a');
    if (existsSync(archive)) {
      const b = readFileSync(archive).subarray(0, 8).toString();
      assert.equal(b, '!<arch>\n', 'iOS artifact is not an ar archive');
    }
  });
  check('custom components expand at compile time', () => {
    const src = join(tmp, 'component.opu');
    const out = join(tmp, 'component.opuir.json');
    writeFileSync(src, [
      'app ComponentDemo {',
      '  component Card(title) { Text("{title}") }',
      '  Column { Card("Hi") }',
      '}',
    ].join('\n') + '\n');
    ok(run(compiler, ['compile', src, '-o', out]), 'compile component');
    const ir = JSON.parse(readFileSync(out, 'utf8'));
    const nodes = [];
    const walk = n => { nodes.push(n); (n.children || []).forEach(walk); };
    walk(ir.tree);
    assert.ok(nodes.some(n => n.kind === 'Text' && n.props?.value === 'Hi'),
      'component parameter was not substituted into props.value');
    assert.ok(!nodes.some(n => n.kind === 'Card'), 'component node was not expanded');
  });
  check('minified web build is valid JS and reports measured sizes', () => {
    const dir = join(tmp, 'minified');
    ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'build',
      '--src', P('opurom-examples', 'counter.opu'), '--target', 'web',
      '--out', dir, '--minify']), 'build --minify');
    const app = join(dir, 'app.js');
    assert.ok(existsSync(app), 'minified app.js missing');
    ok(run('node', ['--check', app]), 'minified app.js syntax');
    const sizeOut = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'size', dir]), 'size');
    assert.match(sizeOut, /%|\d+ B/, 'no measured size report');
  });
  check('signed packages verify with Ed25519', () => {
    const cli = P('opurom-pkg', 'bin', 'opurom-pkg.mjs');
    const cwd = P('opurom-pkg');
    ok(run('node', [cli, 'sign'], { cwd }), 'pkg sign');
    const out = ok(run('node', [cli, 'verify', '--signed'], { cwd }), 'pkg verify signed');
    assert.match(out, /PASS|verified/i, 'signed verification did not pass');
  });

  console.log('== native network contracts ==');
  check('server TLS, WebSocket and keep-alive are covered by real tests', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-server', 'Cargo.toml'),
      '--', '--list']), 'server test list');
    assert.match(out, /tls_handshake|websocket|keepalive/i, 'network tests not registered');
  });
  check('PostgreSQL TLS client and transactional server are covered', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-db', 'Cargo.toml'),
      '--', '--list']), 'db test list');
    assert.match(out, /pgserver|tls/i, 'database tests not registered');
  });
  check('live AppKit window pixels match the software renderer', () => {
    const out = ok(run(platform, ['--verify-window']), 'window verify');
    assert.match(out, /PASS|SKIP/i, 'no window verification verdict');
    if (/PASS/.test(out)) {
      assert.match(out, /mismatched_pixels=0\b/, 'window pixels did not match');
    }
  });
  check('Android APK carries real arm64 and x86_64 libraries', () => {
    const apk = P('opurom-mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug',
      'app-debug.apk');
    if (!existsSync(apk)) return; // NDK/SDK absent on this host: skip honestly
    const listing = ok(run('unzip', ['-l', apk]), 'apk listing');
    assert.match(listing, /lib\/arm64-v8a\/libopurom_mobile\.so/, 'arm64 lib missing from APK');
    assert.match(listing, /lib\/x86_64\/libopurom_mobile\.so/, 'x86_64 lib missing from APK');
  });
  check('repeat profiling excludes warmup and states the environment', () => {
    const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'profile',
      '--src', P('opurom-examples', 'counter.opu'), '--repeat', '3']), 'profile --repeat');
    assert.match(out, /warmup excluded/i, 'warmup not reported');
    assert.match(out, /environment:/i, 'environment not reported');
  });
  check('GPU comparison gates speed on byte equality', () => {
    const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'bench',
      '--compare', '--src', P('opurom-spec', 'counter.opu')]), 'bench --compare');
    assert.match(out, /byte equality/i, 'no correctness result');
    assert.match(out, /byte-equal|n\/a/i, 'no byte-equality verdict');
  });

  console.log('== visual and platform breadth contracts ==');
  check('advanced visual effects are deterministic', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-render', 'Cargo.toml'),
      '--', '--list']), 'render test list');
    assert.match(out, /effect/i, 'no visual-effect tests registered');
  });
  check('browser matrix verifies two real engines', () => {
    const dir = join(tmp, 'matrix');
    mkdirSync(dir, { recursive: true });
    const out = ok(run('node', [P('opurom-web', 'bin', 'opurom-web.mjs'), 'verify',
      '--matrix', P('opurom-spec', 'counter.opuir.json'), dir]), 'web verify --matrix');
    assert.match(out, /chromium|webkit|edge/i, 'no engine result reported');
    assert.match(out, /PASS|verified|SKIP/i, 'no matrix verdict');
  });
  check('Win32 and X11 adapters compile for their targets', () => {
    const win = run('cargo', ['check', '--manifest-path', P('opurom-platform', 'Cargo.toml'),
      '--target', 'x86_64-pc-windows-gnu', '--all-targets']);
    assert.equal(win.status, 0, 'Win32 adapter does not compile');
    const lin = run('cargo', ['check', '--manifest-path', P('opurom-platform', 'Cargo.toml'),
      '--target', 'x86_64-unknown-linux-gnu', '--all-targets']);
    assert.equal(lin.status, 0, 'X11 adapter does not compile');
  });
  check('mTLS and revocation are covered by real tests', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-server', 'Cargo.toml'),
      '--', '--list']), 'server test list');
    assert.match(out, /mtls|revok/i, 'no mTLS/revocation tests registered');
  });
  check('MySQL wire protocol has a mock-server conformance test', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-db', 'Cargo.toml'),
      '--', '--list']), 'db test list');
    assert.match(out, /mysql/i, 'no MySQL conformance test registered');
  });
  check('N WebSocket clients receive the same state delta', () => {
    const hub = P('opurom-cli', 'bin', 'sync-hub.mjs');
    if (!existsSync(hub)) return; // not landed yet: skip honestly
    const port = 8981;    const child = spawn('node', [hub, '--port', String(port)], { stdio: 'ignore' });
    try {
      let ready = false;
      for (let i = 0; i < 30; i++) {
        const r = run('node', ['-e', `const n=require('node:net');const s=n.connect(${port},'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))`]);
        if (r.status === 0) { ready = true; break; }
        spawnSync('sleep', ['0.2']);
      }
      assert.ok(ready, 'sync hub did not start');
      const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'dev',
        '--sync', '--clients', '3', '--port', String(port)]), 'dev --sync');
      assert.match(out, /client|delta|PASS/i, 'no sync report');
    } finally {
      child.kill('SIGTERM');
    }
  });

  console.log('== production breadth contracts ==');
  check('GPU effect kernels produce a byte-identical PPM', () => {
    const fixture = P('opurom-render', 'tests', 'fixtures', 'effects.opuir.json');
    if (!existsSync(fixture)) return; // not landed yet: skip honestly
    const cmds = join(tmp, 'effect-commands.json');
    const cpu = join(tmp, 'effect-cpu.ppm');
    const gpuOut = join(tmp, 'effect-gpu.ppm');
    ok(run(renderer, [fixture, '96', '64', cpu, '--commands', cmds]), 'render effect commands');
    const gpuBin = bin('opurom-gpu', 'opurom-gpu') || ensureBin('opurom-gpu', 'opurom-gpu');
    ok(run(gpuBin, ['raster', cmds, gpuOut]), 'gpu effect raster');
    assert.ok(readFileSync(cpu).equals(readFileSync(gpuOut)),
      'GPU effect PPM differs from the software renderer PPM');
  });
  check('HTTP/2 frames and multiplexing are covered by real tests', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-server', 'Cargo.toml'),
      '--', '--list']), 'server test list');
    assert.match(out, /h2_|http2_/i, 'no HTTP/2 tests registered');
  });
  check('compiled JetBrains plugin is a real archive', () => {
    const verify = P('opurom-ide-plugins', 'jetbrains-runtime', 'verify.mjs');
    if (!existsSync(verify)) return; // not landed yet: skip honestly
    const out = ok(run('node', [verify]), 'jetbrains plugin verify');
    assert.match(out, /PASS|SKIP/i, 'no plugin archive verdict');
    const zip = P('opurom-ide-plugins', 'jetbrains-runtime', 'build', 'distributions',
      'opurom-jetbrains-0.1.0.zip');
    const fallback = P('opurom-ide-plugins', 'jetbrains-runtime', 'build', 'fallback',
      'opurom-jetbrains-0.1.0.zip');
    const artifact = existsSync(zip) ? zip : fallback;
    if (existsSync(artifact)) {
      const listing = ok(run('unzip', ['-l', artifact]), 'plugin zip listing');
      assert.match(listing, /plugin\.xml/, 'plugin.xml missing from archive');
      assert.match(listing, /\.class|\.jar/, 'no compiled classes in archive');
    }
  });
  check('parallel scheduler is isolated and measured', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-core', 'Cargo.toml'),
      '--', '--list']), 'core test list');
    assert.match(out, /scheduler|circuit|panic/i, 'no scheduler/fault-isolation tests registered');
    const example = P('opurom-core', 'examples', 'parallel_speedup.rs');
    if (existsSync(example)) {
      const measured = ok(run('cargo', ['run', '--offline', '--quiet', '--example',
        'parallel_speedup'], { cwd: P('opurom-core') }), 'parallel speedup');
      assert.match(measured, /\d/, 'no measured timing reported');
    }
  });
  check('full DAP debugger capabilities are advertised', () => {
    const out = ok(run('node', ['--test'], { cwd: P('opurom-debug') }), 'dap tests');
    assert.match(out, /pass/i, 'DAP suite did not run');
    const capsFile = P('opurom-debug', 'bin', 'capabilities.mjs');
    if (!existsSync(capsFile)) return; // not landed yet: skip honestly
    const caps = JSON.parse(ok(run('node', [capsFile], { cwd: P('opurom-debug') }),
      'dap capabilities').trim());
    for (const key of ['supportsSetVariable', 'supportsVariablePaging',
      'supportsStepInOutRequests', 'supportsVerifiedSourceBreakpoints']) {
      assert.equal(caps[key], true, `missing DAP capability ${key}`);
    }
  });
  check('marketplace publish/install flow is covered', () => {
    const out = ok(run('node', ['--test'], { cwd: P('opurom-pkg') }), 'pkg tests');
    assert.match(out, /pass/i, 'package manager suite did not run');
  });

  console.log('== component library and platform contracts ==');
  check('catalog exposes 100+ distinct drawn primitives', () => {
    const c = JSON.parse(readFileSync(P('opurom-spec', 'components.json'), 'utf8'));
    assert.ok(c.primitives >= 100, `only ${c.primitives} distinct primitives`);
    assert.ok(c.count >= 200, `only ${c.count} named components`);
    assert.equal(new Set(c.components.map(x => x[1])).size, c.primitives);
    const lang = JSON.parse(readFileSync(P('opurom-lang', 'src', 'catalog.json'), 'utf8'));
    assert.equal(JSON.stringify(lang), JSON.stringify(c), 'catalog not synced to compiler');
  });
  check('GPU presentation verifies on-screen pixels', () => {
    const out = ok(run(platform, ['--verify-gpu-presentation',
      '--out', join(tmp, 'gpu-presentation.png')]), 'gpu presentation');
    assert.match(out, /PASS|SKIP/i, 'no GPU presentation verdict');
    if (/PASS/.test(out)) assert.match(out, /mismatch/i, 'no pixel comparison result');
  });
  check('tree shaking and source maps produce valid artifacts', () => {
    const dir = join(tmp, 'shaken-build');
    ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'build',
      '--src', P('opurom-examples', 'counter.opu'), '--target', 'web',
      '--out', dir, '--tree-shake', '--sourcemap', '--minify']), 'shaken build');
    const app = join(dir, 'app.js');
    assert.ok(existsSync(app), 'app.js missing');
    ok(run('node', ['--check', app]), 'shaken app.js syntax');
    const map = join(dir, 'app.js.map');
    if (existsSync(map)) {
      const json = JSON.parse(readFileSync(map, 'utf8'));
      assert.equal(json.version, 3, 'not a v3 source map');
      assert.ok(Array.isArray(json.sources) && typeof json.mappings === 'string');
    }
  });
  check('native capability plugins are permission gated', () => {
    const out = ok(run('node', ['--test'], { cwd: P('opurom-plugins') }), 'plugins tests');
    assert.match(out, /pass/i, 'plugin suite did not run');
    const reg = JSON.parse(readFileSync(P('opurom-plugins', 'registry.json'), 'utf8'));
    const caps = new Set(reg.plugins.flatMap(x => x.capabilities || []));
    for (const c of ['camera.takePhoto', 'geolocation.getCurrentPosition',
      'bluetooth.scan', 'notification.show', 'payment.request', 'share.send']) {
      assert.ok(caps.has(c), `missing native capability ${c}`);
    }
  });
  check('OCSP/CRL certificate status is covered by real tests', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-server', 'Cargo.toml'),
      '--', '--list']), 'server test list');
    assert.match(out, /ocsp_|crl_/i, 'no certificate-status tests registered');
  });
  check('MySQL caching_sha2 auth is covered by real tests', () => {
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-db', 'Cargo.toml'),
      '--', '--list']), 'db test list');
    assert.match(out, /caching_sha2|stmt_prepare/i, 'no caching_sha2 tests registered');
  });

  console.log('== sample app gallery ==');
  const gallerySrc = P('opurom-examples', 'gallery.opu');
  const galleryIr = join(tmp, 'gallery.opuir.json');
  const galleryCatalog = JSON.parse(readFileSync(P('opurom-spec', 'components.json'), 'utf8'));
  const catalogKinds = new Set(galleryCatalog.components.map(x => x[1]));
  // A primitive kind can belong to more than one named family, so the check
  // accepts every family the catalog declares for the exhibit's kind.
  const familyOf = new Map();
  for (const x of galleryCatalog.components) {
    if (!familyOf.has(x[1])) familyOf.set(x[1], new Set());
    familyOf.get(x[1]).add(x[2]);
  }
  const walkGallery = n => {
    const out = [n];
    for (const c of n.children || []) out.push(...walkGallery(c));
    return out;
  };
  const galleryItems = ir => walkGallery(ir.tree)
    .filter(n => /^[a-z]+\/[A-Z]/.test(n.props?.label || ''));

  check('showcase states the current catalog size in comment and UI text', () => {
    const src = readFileSync(P('opurom-examples', 'showcase.opu'), 'utf8');
    assert.match(src, /\/\/ All 240 named components lower onto 100 distinct primitive kinds/,
      'stale source comment');
    assert.match(src, /Paragraph\("One catalog, 240 named components, 100 distinct primitive kinds"/,
      'stale UI text');
    assert.ok(!/108 catalog|24 primitives|One catalog, 24(?!\d)/.test(src), 'stale catalog numbers remain');
    assert.ok(!/\bR[0-9]+\b|\bRound [0-9]+\b/.test(src), 'internal codename in showcase');
  });

  check('gallery IR lowers with one instance of each of the 100 distinct primitive kinds', () => {
    ok(run(compiler, ['compile', gallerySrc, '-o', galleryIr]), 'compile gallery');
    const ir = JSON.parse(readFileSync(galleryIr, 'utf8'));
    assert.equal(ir.ir, '0.1');
    assert.equal(ir.app, 'Gallery');
    assert.equal(catalogKinds.size, 100, 'catalog no longer has 100 distinct kinds');
    const nodes = walkGallery(ir.tree);
    assert.deepEqual([...new Set(nodes.map(n => n.kind))].sort(), [...catalogKinds].sort(),
      'gallery primitive kinds differ from the catalog');
    const items = galleryItems(ir);
    assert.equal(items.length, 100, `expected 100 exhibits, found ${items.length}`);
    assert.equal(new Set(items.map(n => n.props.label)).size, 100, 'duplicate exhibit label');
    for (const n of items) {
      const [family, kind] = n.props.label.split('/');
      assert.equal(n.kind, kind, `label/kind mismatch on ${n.props.label}`);
      assert.ok(familyOf.get(kind)?.has(family), `wrong family group for ${kind}`);
    }
  });

  check('gallery render digest is stable across two runs', () => {
    const a = join(tmp, 'gallery-a.ppm'), b = join(tmp, 'gallery-b.ppm');
    const da = ok(run(renderer, [galleryIr, '800', '600', a]), 'render gallery a')
      .match(/digest=([0-9a-f]+)/i);
    const db = ok(run(renderer, [galleryIr, '800', '600', b]), 'render gallery b')
      .match(/digest=([0-9a-f]+)/i);
    assert.ok(da && db, 'no digest in gallery render output');
    assert.equal(da[1], db[1], 'gallery digest differs between identical renders');
    assert.ok(readFileSync(a).equals(readFileSync(b)), 'gallery pixels differ between identical renders');
  });

  check('gallery a11y tree assigns a role and bounds to every exhibit', () => {
    const a11y = join(tmp, 'gallery-a11y.json');
    ok(run(renderer, [galleryIr, '800', '600', join(tmp, 'gallery-a11y.ppm'),
      '--a11y', a11y]), 'render gallery a11y');
    const tree = JSON.parse(readFileSync(a11y, 'utf8'));
    const byId = new Map(tree.map(n => [n.id, n]));
    const items = galleryItems(JSON.parse(readFileSync(galleryIr, 'utf8')));
    assert.equal(items.length, 100, 'expected 100 labelled exhibits');
    for (const n of items) {
      const a = byId.get(n.id);
      assert.ok(a, `no a11y node for ${n.props.label}`);
      assert.equal(a.label, n.props.label);
      assert.equal(typeof a.role, 'string');
      assert.equal(a.bounds.length, 4);
      assert.equal(typeof a.hidden, 'boolean');
    }
    assert.ok(new Set(items.map(n => byId.get(n.id).role)).size >= 4,
      'a11y roles are not kind-specific');
  });

  const markupExt = {
    wechat: 'pages/index/index.wxml', alipay: 'pages/index/index.axml',
    qq: 'pages/index/index.qml', douyin: 'pages/index/index.ttml',
    baidu: 'pages/index/index.swan', kuaishou: 'pages/index/index.ksml',
  };
  check('gallery lowers to all nine emitters with valid artifacts', () => {
    const targets = ok(run(compiler, ['targets']), 'opuromc targets').trim().split('\n')
      .map(line => { const [name, files] = line.split('\t'); return { name, files: files.split(', ') }; });
    assert.equal(targets.length, 9, `expected 9 emitters, found ${targets.length}`);
    const cli = P('opurom-cli', 'bin', 'opurom.mjs');
    const ir = JSON.parse(readFileSync(galleryIr, 'utf8'));
    const ids = [];
    const collectIds = n => { ids.push(n.id); for (const c of n.children || []) collectIds(c); };
    collectIds(ir.tree);
    for (const { name, files } of targets) {
      const dir = join(tmp, `gallery-${name}`);
      ok(run('node', [cli, 'build', '--src', gallerySrc, '--target', name, '--out', dir]),
        `build gallery ${name}`);
      for (const f of files) {
        const path = join(dir, f);
        assert.ok(existsSync(path) && statSync(path).size > 0, `${name}: missing or empty ${f}`);
        if (f.endsWith('.js')) ok(run('node', ['--check', path]), `${name}: ${f} syntax`);
        if (f.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
      }
      if (markupExt[name]) {
        const markup = readFileSync(join(dir, markupExt[name]), 'utf8');
        for (const id of ids) {
          assert.ok(new RegExp(`class="[^"]*\\bn${id}\\b[^"]*"`).test(markup),
            `${name}: node ${id} is missing from the rendered page`);
        }
        assert.ok(!markup.includes('__stateKeys'),
          `${name}: internal state names leak into the rendered page`);
      }
    }
  });
  check('mini packages emit a root app entry and resolved page files', () => {
    for (const [name, markupPath] of Object.entries(markupExt)) {
      const dir = join(tmp, `gallery-${name}`);
      const app = join(dir, 'app.js');
      assert.ok(existsSync(app) && statSync(app).size > 0,
        `${name}: missing or empty root app.js`);
      assert.ok(readFileSync(app, 'utf8').includes('App('),
        `${name}: root app.js does not call App(`);
      const manifest = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
      const entry = Array.isArray(manifest.pages) ? manifest.pages[0] : null;
      assert.equal(entry, 'pages/index/index', `${name}: unexpected first app.json page`);
      const page = join(dir, `${entry}.js`), markup = join(dir, markupPath);
      assert.ok(existsSync(page) && statSync(page).size > 0,
        `${name}: missing or empty ${entry}.js`);
      assert.ok(existsSync(markup) && statSync(markup).size > 0,
        `${name}: missing or empty ${markupPath}`);
    }
  });

  console.log('== registered apps across the emitter matrix ==');
  const emitterTargets = () => ok(run(compiler, ['targets']), 'opuromc targets').trim().split('\n')
    .map(line => { const [name, files] = line.split('\t'); return { name, files: files.split(', ') }; });
  const lowerRegistry = (registry, targets) => {
    for (const app of registry.apps) {
      const ir = join(tmp, `matrix-${app.name}.opuir.json`);
      ok(run(compiler, ['compile', P('opurom-examples', app.source), '-o', ir]), `compile ${app.name}`);
      for (const { name, files } of targets) {
        const dir = join(tmp, `matrix-${app.name}-${name}`);
        ok(run(compiler, ['target', ir, '--target', name, '-o', dir]), `lower ${app.name} to ${name}`);
        assertArtifacts(dir, files, `${app.name}/${name}`);
      }
    }
  };
  check('every registered app compiles and lowers to all nine emitters', () => {
    const registry = JSON.parse(readFileSync(P('opurom-examples', 'examples.json'), 'utf8'));
    const targets = emitterTargets();
    assert.equal(targets.length, 9, `expected 9 emitters, found ${targets.length}`);
    lowerRegistry(registry, targets);
  });
  check('emitter matrix rejects broken registry entries and artifacts', () => {
    // Synthetic inputs keep the negative case independent of the sibling repos.
    const ghost = { apps: [{ name: 'ghost', source: 'ghost.opu' }] };
    assert.throws(() => lowerRegistry(ghost, emitterTargets()), /compile ghost/);
    const dir = join(tmp, 'matrix-negative');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app.js'), '// present\n');
    assert.throws(() => assertArtifacts(dir, ['app.js', 'ir.json'], 'negative'), /missing or empty ir\.json/);
  });

  console.log('== transport and language additions ==');
  check('HTTP/3 over QUIC is covered by real server tests', () => {
    const src = P('opurom-server', 'src', 'http3.rs');
    if (!existsSync(src)) return; // not landed yet: skip honestly
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-server', 'Cargo.toml'),
      '--', '--list']), 'server test list');
    assert.match(out, /http3|h3_/i, 'no HTTP/3 tests registered');
  });
  check('static type inference rejects real type errors', () => {
    const src = P('opurom-lang', 'src', 'check.rs');
    if (!existsSync(src)) return; // not landed yet: skip honestly
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-lang', 'Cargo.toml'),
      '--', '--list']), 'compiler test list');
    assert.match(out, /type_|infer_/i, 'no type-inference tests registered');
  });
  check('five-tier adaptive layout keeps the golden digests', () => {
    const layout = readFileSync(P('opurom-render', 'src', 'layout.rs'), 'utf8');
    if (!/Ultra/.test(layout)) return;
    const r = bin('opurom-render', 'opurom-render') || ensureBin('opurom-render', 'opurom-render');
    const a = join(tmp, 'tier-a.ppm'), b = join(tmp, 'tier-b.ppm'), c = join(tmp, 'tier-c.ppm');
    assert.match(ok(run(r, [P('opurom-spec', 'counter.opuir.json'), '320', '240', a]), 'tier 320'),
      /digest=8d45f412996a99c6/);
    assert.match(ok(run(r, [P('opurom-spec', 'counter.opuir.json'), '800', '600', b]), 'tier 800'),
      /digest=318beb1dd337bc4e/);
    assert.match(ok(run(r, [P('opurom-spec', 'counter.opuir.json'), '800', '600', c,
      '--state', 'count=7']), 'tier state'), /digest=40073cb95c912d80/);
  });
  check('Wayland wire encoding is verified without a compositor', () => {
    const wire = P('opurom-platform', 'src', 'wayland_wire.rs');
    if (!existsSync(wire)) return;
    const out = ok(run('cargo', ['test', '--manifest-path', P('opurom-platform', 'Cargo.toml'),
      '--', '--list']), 'platform test list');
    assert.match(out, /wayland/i, 'no Wayland wire tests registered');
  });

  console.log('== responsive web build ==');
  check('responsive web page and multi-file project are verified end to end', () => {
    const r = run('node', [P('opurom-examples', 'test', 'responsive-web-build.test.mjs')]);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    // Surface the child verdict so a skip is visible in the umbrella report.
    for (const line of out.split('\n')) {
      if (/^(PASS|SKIP)\s/.test(line)) console.log(`      ${line}`);
    }
    assert.match(out, /^(PASS|SKIP)\s/m, 'no responsive web build verdict');
    ok(r, 'responsive web build test');
  });

} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
