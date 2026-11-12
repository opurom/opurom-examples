# OPUROM Examples

Golden programs and the cross-project verification harness. Every file here is executable
evidence, not a mockup.

| File | Purpose |
| --- | --- |
| [counter.opu](counter.opu) | Canonical program: int state, `add`, nested layout, interpolation |
| [profile.opu](profile.opu) | Second golden: string state, `bool`, input binding, `set`, `toggle` |
| [test/cross-layer.mjs](test/cross-layer.mjs) | Runs every project's tests + cross-layer assertions |

The canonical IR lives in `../opurom-spec/counter.opuir.json`; the compiler must lower
`counter.opu` to a JSON deep-equal to it.

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cd /Users/mac/work/opurom/opurom-examples
node test/cross-layer.mjs
```

This harness fails loudly (nonzero exit) if any project is missing, uncommitted, or its tests
fail. It reports SKIP only for checks whose tool is genuinely absent, never for a failed
assertion.

Status: the v0.1 slice is verified end to end; GPU backends, OS-native adapters, animation,
component library and debugger are later rounds. See `../README.md` and
`../opurom-spec/ARCHITECTURE.md`.
