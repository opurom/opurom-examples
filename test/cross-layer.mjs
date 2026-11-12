#!/usr/bin/env node
// Cross-project verification: every repo's tests + the IR contract between layers.
import { spawnSync } from 'node:child_process';
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
  'opurom-lsp', 'opurom-debug',
];
const RUST_REPOS = ['opurom-core', 'opurom-lang', 'opurom-render', 'opurom-platform',
  'opurom-server', 'opurom-db', 'opurom-runtime-adapters'];
const NODE_REPOS = ['opurom-cli', 'opurom-ide-plugins', 'opurom-plugins', 'opurom-lsp',
  'opurom-debug'];
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
    ok(run('cargo', ['build', '--release', '--manifest-path', join(dir, 'Cargo.toml')]), 'build service');
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
    assert.equal(new Set(c.components.map(x => x[1])).size, 24, 'expected 24 primitives');
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
    const out = ok(run('node', [P('opurom-cli', 'bin', 'opurom.mjs'), 'bench', '--full']), 'bench --full');
    assert.match(out, /\|/m, 'no markdown table');
    assert.match(out, /\d/, 'no measured numbers');
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
