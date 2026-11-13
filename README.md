# OPUROM Examples

Example applications for the OPUROM framework, a registry that describes them to the toolchain,
and the cross-project verification harness. Each `.opu` file is a complete program that compiles
to IR and renders through the framework's own pipeline.

<div align="center">

![OPUROM full-stack Todo application](./assets/example-full-stack-todo.png)

</div>

## Contents

| File | Purpose |
| --- | --- |
| [counter.opu](counter.opu) | Canonical frontend program: integer state, `add`, nested layout, interpolation |
| [profile.opu](profile.opu) | String state, `bool`, input binding, `set` and `toggle` |
| [todo.opu](todo.opu) | Full-stack application: UI, `model` and `api` in one source file |
| [todo.opuir.json](todo.opuir.json) | Reference full-stack IR for the Todo application |
| [showcase.opu](showcase.opu) | Catalog components, accessibility properties and visual effects |
| [gallery.opu](gallery.opu) | One instance of each of the 100 distinct primitive kinds, grouped by family |
| [calculator.opu](calculator.opu) | State-driven arithmetic with computed expressions and themed controls |
| [photos.opu](photos.opu) | State-driven selection across a responsive image gallery |
| [animation.opu](animation.opu) | Deterministic entry animation with spring and easing curves |
| [form.opu](form.opu) | Input binding, computed values and conditional rendering |
| [examples.json](examples.json) | Application registry consumed by the CLI |
| [test/cross-layer.mjs](test/cross-layer.mjs) | Cross-project verification harness |

The canonical frontend IR lives in
[counter.opuir.json](https://github.com/opurom/opurom-spec/blob/main/counter.opuir.json); the
compiler lowers `counter.opu` to a JSON representation equal to it.

## Running the examples

From the umbrella workspace root, the CLI lists every registered application and runs their
registered tests in parallel:

```sh
node opurom-cli/bin/opurom.mjs examples
node opurom-cli/bin/opurom.mjs test --examples
```

Filter to one application or control the number of parallel jobs:

```sh
node opurom-cli/bin/opurom.mjs test --examples --filter calculator --jobs 4
node opurom-cli/bin/opurom.mjs test --examples --verbose
```

Each application registers three tests: `check` type-checks the source, `compile` lowers it to
IR, and `render` produces a deterministic PPM frame. The `--verbose` flag prints the output of
every test; the default prints one status line per test followed by a summary.

To run the cross-project harness directly:

```sh
node opurom-examples/test/cross-layer.mjs
```

The harness re-verifies the compiler, renderer, kernel, platform adapters, service, data layer,
toolchain and component catalog together, and exits nonzero if any assertion fails.

The harness compiles every registered application, lowers each IR to every emitter reported by the
compiler, and checks that each emitted artifact is present and non-empty; emitted JavaScript is
syntax-checked and emitted JSON is parsed. A companion check passes a registry entry whose source
file does not exist and an incomplete artifact list to the same code path, asserting that both are
rejected.

## Application previews

<div align="center">

![OPUROM Calculator with themed controls](./assets/example-calculator.png)

![OPUROM Photo Wall with a selected gradient](./assets/example-photo-wall.png)

![OPUROM component gallery](./assets/example-component-gallery.png)

</div>

## Registry format

`examples.json` follows a CMake-style registration model. Each application declares its name,
source path, target emitters and an ordered list of tests. Commands use `{source}` and `{tmp}`
placeholders plus tool aliases resolved by the CLI at runtime, so the same registry works on any
host with the toolchain installed.

```json
{
  "version": 1,
  "apps": [
    {
      "name": "counter",
      "source": "counter.opu",
      "required": true,
      "targets": ["web", "native"],
      "tests": [
        { "id": "counter.check", "cmd": ["opuromc", "check", "{source}"],
          "description": "type-check the source with opuromc" }
      ]
    }
  ]
}
```

Adding an application means adding its source file and one registry entry; the CLI then includes
it in `examples` and `test --examples` without further configuration.

## Reference

- [OPUROM organization](https://github.com/opurom) — framework overview and project index
- [LANG_SPEC.md](https://github.com/opurom/opurom-spec/blob/main/LANG_SPEC.md) — language syntax
- [IR_SCHEMA.md](https://github.com/opurom/opurom-spec/blob/main/IR_SCHEMA.md) — IR contract
- [ARCHITECTURE.md](https://github.com/opurom/opurom-spec/blob/main/ARCHITECTURE.md) — layer boundaries
