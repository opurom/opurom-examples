# Golden test fixtures

Minimal, version-pinned test data shared by the render, platform, CLI and
cross-layer test suites:

- `counter.opu` — the smallest full-stack program: one state, two buttons.
- `counter.opuir.json` — the IR that `counter.opu` compiles to.
- `components.json` — the built-in component catalog that renderer tests
  validate their drawing against.

`counter.opu` here is the minimal regression fixture; the sibling
`counter.opu` at the repository root is the polished showcase example and is
a different program. When the compiler intentionally changes IR output,
regenerate `counter.opuir.json` here and update dependent suites in the same
commit.
