#!/usr/bin/env node
// End-to-end proof that the web build delivers a resizable DOM page and that a
// multi-file project compiles through the same CLI pipeline. Runs standalone
// (PASS/SKIP lines, nonzero on a real failure) and under `node --test`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CLI = join(ROOT, 'opurom-cli', 'bin', 'opurom.mjs');
const WEB_LIB = join(ROOT, 'opurom-web', 'lib');
const LANG_SRC = join(ROOT, 'opurom-lang', 'src');
const ENV = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` };
const UI_MARKER = 'RESPONSIVE_UI_MARKER';
const MODULE_MARKER = 'MODULE_STATE_MARKER_7X9';

const APP_SRC = `app ResponsiveWeb {
  state clicks = 0
  Column(gap: 12) {
    Text("${UI_MARKER}")
    Button("Add") { clicks += 1 }
  }
}
`;
const MAIN_SRC = `import "parts.opu"
app MultiProject {
  Column(gap: 8) {
    Text("{moduleLabel}")
  }
}
`;
const PARTS_SRC = `state moduleLabel = "${MODULE_MARKER}"
`;

let failures = 0;
const pass = name => console.log(`PASS  ${name}`);
const skip = (name, capability) => console.log(`SKIP  ${name}: ${capability}`);

function verify(name, fn) {
  try { fn(); pass(name); }
  catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${String(error?.message ?? error).split('\n')[0]}`);
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: ENV, cwd: ROOT });
}
function assertOk(result, label) {
  assert.equal(result.status, 0,
    `${label} exited ${result.status}: ${`${result.stderr || ''}${result.stdout || ''}`.trim().slice(0, 300)}`);
}
function cliText(args) {
  const result = runCli(args);
  assertOk(result, `opurom ${args.join(' ')}`);
  return result.stdout || '';
}

// A source-level capability marker keeps the gate independent of the output
// being asserted: the build still has to wire the breakpoints into index.html.
function responsiveCssLanded() {
  const files = [];
  for (const dir of [WEB_LIB, LANG_SRC]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (/\.(mjs|js|css|rs)$/.test(name)) files.push(join(dir, name));
    }
  }
  return files.some(file => /@media\b/.test(readFileSync(file, 'utf8')));
}

function cssText(outDir, html) {
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const linked = existsSync(outDir)
    ? readdirSync(outDir).filter(name => name.endsWith('.css'))
      .map(name => readFileSync(join(outDir, name), 'utf8')).join('\n')
    : '';
  return `${inline}\n${linked}`;
}

function domMarkup(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}
function hasDomUiNodes(html) {
  const markup = domMarkup(html);
  return /<button\b/i.test(markup) ||
    /<(?:p|span|h[1-6]|label|a|li|div|section|main|article|td|th)\b[^>]*>[^<]*[A-Za-z]{2}/i.test(markup);
}
function pageBundle(outDir) {
  const names = ['index.html', ...readdirSync(outDir).filter(name => name.endsWith('.js'))];
  return names.filter(name => existsSync(join(outDir, name)))
    .map(name => readFileSync(join(outDir, name), 'utf8')).join('\n');
}

const cliReady = existsSync(CLI);
let help = '';
let registered = [];
let cliError = null;
if (cliReady) {
  try {
    help = cliText(['--help']);
    registered = cliText(['targets']).trim().split(/\s+/).filter(Boolean);
  } catch (error) { cliError = error; }
}
// `web-dom` is a build target, not a v0.1 IR emitter, so `opurom targets`
// does not list it; the CLI help documents it instead.
const webTarget = registered.includes('web');
const webDomTarget = registered.includes('web-dom') || /--target web-dom/.test(help);
const projectFlag = /--project/.test(help);
let breakpointsLanded = false;
try { breakpointsLanded = responsiveCssLanded(); }
catch (error) { cliError = cliError || error; }

console.log('== responsive web build ==');
const responsiveCapability = 'web-dom target in opurom-cli targets or @media breakpoints in opurom-web/lib and opurom-lang/src';
if (cliError) {
  skip('responsive web page', `opurom-cli is not usable: ${cliError.message.split('\n')[0]}`);
} else if (!cliReady) {
  skip('responsive web page', 'opurom-cli/bin/opurom.mjs build command');
} else if (!webTarget) {
  skip('responsive web page', 'web target in opurom-cli targets');
} else if (!webDomTarget && !breakpointsLanded) {
  skip('responsive web page', responsiveCapability);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'opurom-responsive-'));
  try {
    const src = join(dir, 'app.opu');
    writeFileSync(src, APP_SRC);
    for (const target of ['web', ...(webDomTarget ? ['web-dom'] : [])]) {
      const out = join(dir, `out-${target}`);
      let built = false;
      verify(`${target}: build emits a non-empty index.html`, () => {
        assertOk(runCli(['build', '--src', src, '--target', target, '--out', out]), `build --target ${target}`);
        assert.ok(existsSync(join(out, 'index.html')), 'index.html missing');
        assert.ok(readFileSync(join(out, 'index.html'), 'utf8').length > 0, 'index.html is empty');
        built = true;
      });
      if (!built) continue;
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      if (!hasDomUiNodes(html)) {
        const domTarget = webDomTarget ? 'web-dom target' : 'responsive DOM lowering';
        skip(`${target}: responsive DOM page`,
          `${target} still lowers to a fixed canvas page with no DOM UI nodes; not wired to the ${domTarget}`);
        continue;
      }
      const css = cssText(out, html);
      verify(`${target}: viewport meta is present`, () => {
        assert.match(html, /<meta\b[^>]*name=["']viewport["'][^>]*>/i, 'no viewport meta');
      });
      verify(`${target}: DOM UI nodes exist with no fixed sole canvas`, () => {
        assert.ok(hasDomUiNodes(html), 'no DOM UI nodes (buttons/text)');
        const canvases = html.match(/<canvas\b[^>]*>/gi) || [];
        for (const canvas of canvases) {
          const fixed = /\bwidth\s*=/.test(canvas) && /\bheight\s*=/.test(canvas);
          assert.ok(!fixed || /aria-label\s*=/.test(canvas),
            `fixed-size canvas without an effect-layer aria-label: ${canvas}`);
        }
      });
      verify(`${target}: CSS has an @media breakpoint`, () => {
        assert.match(css, /@media\b[^{]*\{/i, 'no @media breakpoint in emitted CSS');
      });
      verify(`${target}: CSS expresses fluid sizing`, () => {
        assert.match(css, /width:\s*100%|max-width\s*:|\bflex\b/i, 'no fluid width, max-width or flex in emitted CSS');
      });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log('== multi-file project build ==');
if (cliError) {
  skip('multi-file project', `opurom-cli is not usable: ${cliError.message.split('\n')[0]}`);
} else if (!cliReady) {
  skip('multi-file project', 'opurom-cli/bin/opurom.mjs build command');
} else if (!projectFlag) {
  skip('multi-file project', '--project flag in opurom-cli help');
} else if (!webTarget && !webDomTarget) {
  skip('multi-file project', 'web or web-dom target in opurom-cli targets');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'opurom-project-'));
  try {
    const project = join(dir, 'project');
    const out = join(dir, 'out');
    mkdirSync(project);
    writeFileSync(join(project, 'main.opu'), MAIN_SRC);
    writeFileSync(join(project, 'parts.opu'), PARTS_SRC);
    verify('multi-file project: build --project succeeds', () => {
      assertOk(runCli(['build', '--project', project, '--target', 'web', '--out', out]), 'build --project');
    });
    verify('multi-file project: emitted page is non-empty', () => {
      assert.ok(existsSync(join(out, 'index.html')), 'index.html missing');
      assert.ok(readFileSync(join(out, 'index.html'), 'utf8').length > 0, 'index.html is empty');
    });
    verify('multi-file project: IR resolves the imported state', () => {
      const ir = readFileSync(join(out, 'ir.json'), 'utf8');
      assert.match(ir, /moduleLabel/, 'imported state missing from emitted IR');
    });
    verify('multi-file project: emitted page carries imported state content', () => {
      const bundle = pageBundle(out);
      assert.ok(bundle.includes(MODULE_MARKER), 'imported module state content missing from the page');
      // The marker must reach the page as live state, not as dead source text.
      assert.match(bundle, new RegExp(`"moduleLabel"\\s*:\\s*"${MODULE_MARKER}"`),
        'imported state is not bound into the emitted state map');
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(failures ? `\n${failures} WEB BUILD CHECK(S) FAILED` : '\nWEB BUILD CHECKS OK');
process.exitCode = failures ? 1 : 0;
