# OPUROM Examples

Golden programs, the full-stack Todo application and the cross-project verification harness.
Every file here is executable evidence, not a mockup.

| File | Purpose |
| --- | --- |
| [counter.opu](counter.opu) | Canonical frontend program: int state, `add`, nested layout, interpolation |
| [profile.opu](profile.opu) | Second golden: string state, `bool`, input binding, `set`, `toggle` |
| [todo.opu](todo.opu) | Full-stack app: UI + `model` + `api` in one source file |
| [todo.opuir.json](todo.opuir.json) | Golden full-stack IR for the Todo app |
| [showcase.opu](showcase.opu) | Showcase: catalog components, a11y props, effects |
| [test/cross-layer.mjs](test/cross-layer.mjs) | Runs every project's tests + cross-layer assertions |

The canonical frontend IR lives in
[counter.opuir.json](https://github.com/opurom/opurom-spec/blob/main/counter.opuir.json); the
compiler must lower `counter.opu` to a JSON deep-equal to it.

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cd opurom-examples
node test/cross-layer.mjs
```

This harness fails loudly (nonzero exit) if any project is missing, uncommitted, or its tests
fail. It reports SKIP only for checks whose tool is genuinely absent, never for a failed
assertion.

Status: the frontend slice and the full-stack Todo chain are verified end to end. GPU backends,
OS-native adapters, cloud deployment, a 100+ component library and a debugger are later rounds.
See the [umbrella README](https://github.com/opurom/opurom) and
[ARCHITECTURE.md](https://github.com/opurom/opurom-spec/blob/main/ARCHITECTURE.md).
