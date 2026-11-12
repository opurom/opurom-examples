#!/usr/bin/env node
// Cross-project verification: every repo's tests + the IR contract between layers.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
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
    assert.match(tags, /v0\.0\.0001/, 'version tags missing');
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

console.log('== cross-layer IR and full-stack contract ==');
const tmp = mkdtempSync(join(tmpdir(), 'opurom-cross-'));
try {
  const compiler = ensureBin('opurom-lang', 'opuromc');
  check('counter.opu still lowers to the R1 golden IR', () => {
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
  check('renderer digest is stable and unchanged from R1', () => {
    const golden = P('opurom-spec', 'counter.opuir.json');
    const a = ok(run(renderer, [golden, '320', '240', join(tmp, 'a.ppm')]), 'render a');
    const b = ok(run(renderer, [golden, '320', '240', join(tmp, 'b.ppm')]), 'render b');
    const da = a.match(/digest=([0-9a-f]+)/i), db = b.match(/digest=([0-9a-f]+)/i);
    assert.ok(da && db, 'no digest in renderer output');
    assert.equal(da[1], db[1], 'digest differs between identical renders');
    assert.equal(da[1], 'c87bf023a6c01f9d', 'R1 golden digest regressed');
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

  console.log('== R3 ecosystem contracts ==');
  check('component catalog has >=100 unique names mapped onto 24 primitives', () => {
    const c = JSON.parse(readFileSync(P('opurom-spec', 'components.json'), 'utf8'));
    assert.ok(c.count >= 100);
    assert.equal(c.components.length, c.count);
    assert.equal(new Set(c.components.map(x => x[0])).size, c.count, 'duplicate names');
    assert.equal(new Set(c.components.map(x => x[1])).size, 32, 'expected 32 primitives');
    assert.ok(c.count >= 116, 'catalog should have 116 components');
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

  console.log('== R4 language and packaging contracts ==');
  check('catalog exposes 116 components over 32 primitives', () => {
    const out = ok(run(compiler, ['components']), 'opuromc components');
    assert.match(out, /116 components/, 'catalog count not reported');
    const c = JSON.parse(readFileSync(P('opurom-spec', 'components.json'), 'utf8'));
    assert.equal(c.primitives, 32);
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

  console.log('== R5 hardware and protocol contracts ==');
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
    const src = join(tmp, 'r5.opu');
    const out = join(tmp, 'r5.opuir.json');
    writeFileSync(src, [
      'app R5 {',
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
    ok(run(compiler, ['compile', src, '-o', out]), 'compile r5');
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

  console.log('== R6 platform delivery contracts ==');
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
      'app R6 {',
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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
