# Circle Community Mini-Program: MVP Design and Implementation Plan

## 1. Overview and Goals

This document defines the MVP for a lightweight circle-community mini-program built on the
OPUROM framework. The product is a small social space organized around topics: members publish
image-and-text posts into a topic, browse a topic feed, open a post, react to it, and manage a
personal profile with saved posts.

The plan covers four layers: application architecture, the MVP business code expressed in
OPUROM syntax, the mini-program platform adapter, and build optimization. It also separates what
the current framework delivers today from the capabilities that are pending, and it analyzes three
engineering exploration points with a recommended option for each.

The MVP is deliberately scoped to the smallest set of flows that form a complete circle:
publish, browse, react, and personalize. Everything else is treated as a later-stage extension.

## 2. Application Architecture and Module Division

### 2.1 Architecture model

OPUROM follows a single-source, compile-time-lowering pipeline. One source tree of `.opu` files is
parsed, merged, type-checked and lowered to a single IR document. The IR is the contract between
the compiler, the renderer, the adapters, the toolchain and the IDE. The IR is then lowered by a
target emitter into platform artifacts. The framework ships nine emitters: `native`, `web`, the six
mini-programs (`wechat`, `alipay`, `qq`, `douyin`, `baidu`, `kuaishou`) and `wasm`.

The mini-program adapter is the only platform-specific layer. It exposes the platform adapter ABI:
a viewport, a polled unified input stream, a present call, and a capabilities record. Adapters
normalize host input into the unified input events (`tap`, `input`, `key`, `resize`, `lifecycle`)
and never mutate state directly. This keeps the business logic platform-neutral and lets one IR
reflow to every target.

The MVP architecture therefore has three tiers:

1. **Source tier** — declarative OPUROM modules: data contracts (models, API routes, shared state)
   and the UI tree (components and the app shell).
2. **IR tier** — the single lowered document, produced at compile time. Component declarations are
   expanded inline, `for` loops and list values unroll into literal nodes, and conditions lower to
   per-node visibility flags. No runtime interpreter is required.
3. **Delivery tier** — the emitter and adapter pair. The emitter lowers IR to the target's markup,
   style and script files; the adapter provides the platform services (input, presentation,
   lifecycle, and the capability probes) that the generated code calls.

### 2.2 Module division

The MVP source tree is split by responsibility, mirroring the project layout used by the existing
workbench and dashboard examples:

| Module | Responsibility | OPUROM declarations |
| --- | --- | --- |
| `main.opu` | App shell and reusable view components: topic tabs, post feed, post detail, personal center | `app`, `component` |
| `models/circle.opu` | Circle entities, API routes and cross-view counters | `model`, `api`, `state` |
| `views/feed.opu` | Feed and topic presentation state, theme tokens | `state`, `theme` |
| `views/profile.opu` | Personal-center presentation state | `state` |

The split follows one rule: an imported module may declare only `state`, `model`, `api`, `theme`
and `imports`. Reusable UI nodes and components stay in the importing entry file, because an
imported module may not carry UI nodes. Data contracts live in `models/circle.opu` so that every
view reads one shared contract. Presentation state lives in `views/` so the entry file stays a
pure composition of the shell.

### 2.3 Data flow

State is a flat, strongly typed map. An event applies its action atomically and produces a patch
list; the renderer consumes patches and never mutates state. The flow for the MVP is:

1. A platform input event (a tap on a topic tab, a like button, a refresh control) enters the
   adapter and is normalized to a unified input event.
2. The event resolves to an IR action, possibly a multi-action sequence, and is applied to state.
3. The renderer re-renders the affected nodes from the patch. Conditions and list reads resolve
   against the current state at render time.
4. Network operations are declared with the async effect layer (`await delay(...)`,
   `await fetch(path, into)`). They are compile-time lowered into the event record and executed by
   each target's native async facility.

### 2.4 Deliverable skeleton

The compiled skeleton delivered alongside this plan maps one-to-one onto the module division above:

| File | Content |
| --- | --- |
| `main.opu` | `component` definitions and the `app Circle` shell: topic tabs, feed, detail, personal center |
| `models/circle.opu` | `Post`, `Comment`, `User`, `Topic`, `Bookmark` models, API routes, shared state |
| `views/feed.opu` | Feed and topic state, theme declaration |
| `views/profile.opu` | Personal-center state |

## 3. MVP Business Code Design

This section describes each MVP flow and its OPUROM shape. The snippets are representative; the
delivered skeleton contains the complete, compiling version.

### 3.1 Content system

#### 3.1.1 Image-and-text post publishing

A post is an entity with a title, a text body, an author, a topic, and counters. The publish screen
presents an input for the title and body, a topic selector, and a submit action. The entity contract
lives in the model layer:

```opu
model Post {
  id: int primary
  title: string
  body: string
  topic: string
  author: string
  likes: int = 0
  comments: int = 0
  liked: bool = false
}
```

The publish form binds two string states to inputs and a topic to a radio group, then submits with
a multi-action handler that records the draft and acknowledges the server response:

```opu
Button("Publish", bg: "#2A5BD7", animate: spring) {
  draftTitle = titleInput
  draftBody = bodyInput
  publishCount += 1
}
```

Image attachment is handled through the platform file-upload interface described in section 4. The
attachment list is a string state holding asset identifiers; the language-level list state is
compile-time fixed, so a runtime attachment list is a pending framework capability.

#### 3.1.2 Post list and post detail

The feed lists posts in reverse-chronological order. Each list entry is a card showing the author,
topic badge, body preview and reaction counts. In the current language, a list-valued state is
unrolled at compile time, so the feed renders with a `for` loop over a fixed list:

```opu
for (i in 4) {
  PostCard("{feedTitles[i]}", "{feedAuthors[i]}", "{feedTopics[i]}", feedLikes[i])
}
```

Selecting a post opens a detail surface. Detail state holds the selected identifier and a comment
composer bound to a string state. The like control toggles a boolean:

```opu
Button("Like") {
  liked.toggle()
}
```

#### 3.1.3 Topic categories

Topics are the primary navigation unit. A `Tabs` control binds a string state to the selected topic,
and a topic catalog model supplies the catalog:

```opu
model Topic {
  id: int primary
  name: string
  posts: int = 0
}

Tabs(labels: "All,Travel,Food,Tech", bind: activeTopic)
```

Because conditions require boolean state, the topic-filtered surfaces are gated by boolean states
that the shell sets. The `Tabs` control records the selection; the shell exposes a matching action to
align the filter with the selection.

### 3.2 Interaction system

#### 3.2.1 Post like

Like is a boolean flag on the post plus a counter. The action is a toggle paired with a conditional
counter update, which lowers to a multi-action event:

```opu
Button("Like") {
  liked.toggle()
  if (liked) { likeCount += 1 } else { likeCount -= 1 }
}
```

#### 3.2.2 Comment reply

A comment is an entity scoped to a post. The detail surface binds a composer input to a string state
and appends the comment through the API route. The reply control sets the reply target and the
composer content in one handler:

```opu
Button("Reply") {
  replyTo = selectedPost
  commentDraft = commentText
}
```

```opu
model Comment {
  id: int primary
  postId: int
  author: string
  body: string
}
```

#### 3.2.3 User follow

Follow is a boolean flag on the user entity, toggled through a single action:

```opu
model User {
  id: int primary
  name: string
  handle: string
  followers: int = 0
  following: bool = false
}

Button("Follow") { following.toggle() }
```

### 3.3 Personal center

The personal center has three surfaces: my posts, my bookmarks, and basic settings. A segmented
control selects the active surface, and conditional blocks render the matching surface:

```opu
state activeSurface = "posts"

if (showMyPosts) {
  for (i in 3) {
    PostCard("{myPostTitles[i]}", "{myPostAuthors[i]}", "{myPostTopics[i]}", myPostLikes[i])
  }
}

if (showMyBookmarks) {
  for (i in 3) {
    PostCard("{bookmarkTitles[i]}", "{bookmarkAuthors[i]}", "{bookmarkTopics[i]}", bookmarkLikes[i])
  }
}
```

Basic settings exposes a dark-mode switch, a notifications switch, and a display-name input, each
bound directly to state.

### 3.4 Content browsing

#### 3.4.1 Pull-to-refresh

Pull-to-refresh is a gesture, not a button. The current adapter input set carries tap, input, key,
resize and lifecycle events; a dedicated pull gesture is a pending framework capability. The MVP
delegates the gesture to the adapter and models the refresh action in the shell:

```opu
Button("Refresh") async {
  await delay(50)
  await fetch("/circle/feed", feedStatus)
  refreshCount += 1
}
```

The async effect layer lowers the sequence into the event record; each target executes it with its
native async facility. Once a pull-gesture event is available, the same action attaches to the
gesture instead of a button.

#### 3.4.2 Load-more on scroll

Load-more is a scroll-driven pagination action. The shell tracks the current page in an integer
state and appends the next page. Because list state is compile-time fixed, a runtime-appended feed
is a pending framework capability; the MVP renders a fixed window and exposes the page counter:

```opu
state page = 1

Button("Load more") {
  page += 1
  refreshCount += 1
}
```

When runtime-list state is available, the same handler appends the fetched slice to the feed state
and the renderer reflows the list without source changes.

## 4. Mini-Program Platform Adapter Design

The adapter is the single platform-specific layer. It implements the platform adapter ABI: a name, a
capabilities record, a viewport, an event poll and a present call. The MVP adapter proposals below
cover the six mini-program targets with one shared design and per-platform variations.

### 4.1 DOM and API difference polyfill

Mini-program runtimes do not expose a browser DOM. The adapter provides a minimal, explicit
compatibility surface for the constructs the emitted code relies on:

- **Node model** — the adapter maps IR node kinds to the host's component tree, preserving ids so
  hit-testing can resolve a `tap` to the correct node.
- **Style model** — the canonical style props (padding, margin, color, radius, shadow, gradient,
  opacity, border) are translated into the host's style properties. Effects outside a target's
  drawing set degrade to the documented fallback rather than failing.
- **Input model** — host touch, input and lifecycle callbacks are normalized into the unified input
  events. The adapter resolves coordinates to logical pixels and resolves the node id.
- **Capability probe** — the adapter reports `gpu`, `native_embed`, `multi_window`, `lifecycle` and
  `dpi_scale`, so the generated code can select an implementation path without hard-coding a
  platform.

The polyfill is deliberately narrow: it covers the framework contract, not the full web platform.
This keeps the payload small and the behavior deterministic.

### 4.2 Rendering-layer adaptation

The mini-program emitter lowers IR nodes into the host markup (`wxml`, `axml`, `swan`, `ksml`,
`qml`, `ttml`), style and script files using a per-platform table of extensions and binding
directives. The adapter renders the resulting tree. Visual determinism is preserved by drawing
effects (gradients, shadows, particles) through integer-only arithmetic in the host drawing surface.
Rendering adaptation is analyzed in depth in exploration point 1.

### 4.3 Native mini-program component integration

For surfaces that benefit from host components — image pickers, video players, maps, location
pickers — the adapter exposes a native-embed path. The `native_embed` capability records whether the
host can host a system widget. When the host provides the widget, the adapter routes the IR node to
the native component and bridges its events back into the unified input stream; the adapter uses a
framework-drawn equivalent otherwise, so one source tree keeps working on every target.

### 4.4 Platform login

Login is a platform service with a per-host credential contract. The adapter exposes a single
`login` entry point that returns a normalized session object (an identifier, a display name and an
auth token). The generated code calls this entry point at startup and stores the result in string
state, which the API routes then attach to requests. The adapter normalizes the three dominant
login styles — a silent session, a code exchange and an explicit authorization — behind one contract
so the business code stays platform-neutral.

### 4.5 File upload

Publishing image-and-text posts requires uploading media. The adapter exposes an `upload` entry point
that accepts a local asset identifier and a destination path, performs the host transfer, and
returns a remote asset identifier. The generated publish flow obtains a local asset through the
native component bridge, calls `upload`, and stores the returned identifier in the attachment list.
Errors are values, never panics, so a failed transfer is reported to the UI through state.

### 4.6 Share interfaces

Sharing is a platform capability with a per-host payload schema. The adapter exposes a single `share`
entry point that accepts a title, a summary, a path and optional media. The adapter maps this
payload to the host's share sheet. The generated share control calls the entry point and reports the
result through state, keeping the caller platform-neutral.

## 5. Build Optimization Proposals

### 5.1 Code sub-packaging

Mini-program platforms support splitting an application into a main package and subpackages that load
on demand. The MVP groups code into a main package (shell, topic tabs, feed) and subpackages for the
post detail and personal center surfaces. The emitter emits the package manifest and the per-package
page set. Code sub-packaging is a pending emitter capability; the plan and acceptance criteria are
in section 11.

### 5.2 Asset compression

Media dominates package size. The asset pipeline compresses images to the smallest acceptable format
and dimensions before they enter the package, and the optimizer removes generated assets that no
emitted page references. Assets that are fetched at runtime from a remote origin stay out of the
package entirely.

### 5.3 Package-size reduction

Three additive techniques reduce generated package size:

- **Compile-time tree-shaking** — the optimizer drops IR nodes, state entries and generated assets
  that the entry surface does not reference, before the emitter runs.
- **Minification** — a zero-dependency minifier removes comments and insignificant whitespace from
  generated script without identifier mangling, so generated script still passes syntax checks.
- **Shared-code factoring** — platform-neutral business logic is emitted once and referenced by the
  shells, avoiding duplicated logic across surfaces.

### 5.4 Measured before/after methodology

Every optimization is measured, not assumed:

1. **Baseline** — build the target from the unmodified source and record the total generated byte
   count and the per-category byte counts (script, markup, style, assets).
2. **Apply** — enable exactly one optimization at a time and rebuild.
3. **Measure** — record the new byte counts with the toolchain size command and compute the absolute
   and percentage reduction.
4. **Verify** — confirm the optimized artifact still passes syntax checks and the end-to-end
   rendering suite, so a size reduction never changes observable behavior.
5. **Compare** — aggregate the per-optimization reductions and confirm the combined reduction is not
   less than the sum of the isolated reductions; a shortfall indicates an interaction that needs a
   different ordering.

The report records measured values only. Where a value is not recorded, the report states the
reason instead of an estimated number.

## 6. Capability Boundary

### 6.1 Implementable with the current framework today

- The complete declarative UI model: `Column`, `Row`, `Container`, `Text`, `Button`, `Input`,
  `Image`, `Spacer` and the sixteen interactive kinds (`Card`, `Divider`, `Icon`, `Badge`,
  `Progress`, `Switch`, `Slider`, `Checkbox`, `Radio`, `Dialog`, `Tabs`, `List`, `Grid`, `Scroll`,
  `Avatar`, `Spinner`).
- Static strong typing, type inference, theme blocks, theme tokens and atomic style shortcuts.
- Multi-action handlers, state-to-state actions, conditional nodes, compile-time `for` loops and
  list-valued state unrolling.
- Custom components with typed parameters, expanded at compile time.
- Async effect declarations (`delay`, `fetch`) lowered into event records.
- Modules and imports with duplicate-name, traversal and cycle diagnostics.
- IR lowering and the nine emitters, including the six mini-program emitters.
- Compile-time build-size optimization (tree-shaking, minification, unused-asset removal) and the
  measured size report.

### 6.2 Requires a pending framework capability

- **Runtime-list state** — list state is fixed at compile time; feeds that append data at runtime
  require a runtime list capability.
- **Pull-gesture input** — the unified input set carries tap, input, key, resize and lifecycle
  events; a dedicated pull or scroll gesture event is pending.
- **Platform services** — platform login, file upload and share entry points require the adapter
  contract to expose them as first-class adapter methods.
- **Native component bridging** — hosting host-native widgets and bridging their events requires the
  `native_embed` capability to be implemented per target.
- **Code sub-packaging** — emitting a split package manifest requires emitter support for the
  sub-package schema.
- **Shared business-logic modules** — reusing plain logic across targets alongside the single-source
  UI model requires a second module mechanism or a shared-code emission path.
- **Per-target effect parity** — the async effect declarations are available at the language level;
  full per-target execution parity is tracked per emitter.

## 7. Framework Capability Analysis and Priority Ranking

The ranking reflects MVP reach: the capability that unlocks the largest number of user-visible flows
first.

| Priority | Capability | Unlocks | Status |
| --- | --- | --- | --- |
| P0 | Declarative UI, types, components, theme | The whole screen surface | Available |
| P0 | Multi-action handlers, conditions, compile-time loops | Feed, detail, personal center rendering | Available |
| P0 | Mini-program emitters and adapter ABI | Delivering to the six targets | Available |
| P0 | Platform adapter input and present path | Tap and scroll interaction | Available |
| P1 | Async effect layer (`delay`, `fetch`) | Refresh and data loading | Available |
| P1 | Compile-time size optimization and size report | Package-budget discipline | Available |
| P1 | Platform login entry point | Signed-in personal center | Pending |
| P1 | File upload entry point | Image-and-text publishing | Pending |
| P2 | Share entry point | Post sharing | Pending |
| P2 | Runtime-list state | Dynamic feed pagination | Pending |
| P2 | Pull-gesture input | Native pull-to-refresh | Pending |
| P2 | Code sub-packaging | Initial-package budget | Pending |
| P2 | Native component bridging | Media-rich surfaces | Pending |
| P3 | Shared business-logic modules | Cross-target logic reuse | Pending |
| P3 | Per-target effect parity | Uniform async behavior | Pending |

## 8. Exploration Point 1: Mini-Program Rendering-Layer Adaptation

Three implementation paths are compared. The comparison covers performance, development cost,
framework intrusiveness and maintainability.

| Path | Performance | Development Cost | Framework Intrusiveness | Maintainability |
| --- | --- | --- | --- | --- |
| A. Emitter-driven native markup rendering | Highest: no runtime, native components, smallest payload | Moderate: per-platform table and emitter tests | Low: uses the existing emitter contract | High: one table and one test set per target |
| B. Canvas rendering inside the mini-program | Moderate: single rendering code, higher CPU per frame | Moderate: one renderer, hit-testing and text handling | High: a new rendering backend in the adapter | Moderate: pixel parity is easy, interaction and accessibility need separate work |
| C. WebView-hosted DOM rendering | Lowest: webview overhead, larger payload, gesture variance | Lowest to start: reuse the web emitter | High: bypasses the native emitter path | Low: web semantics drift from mini-program expectations |

**Recommended option: A, emitter-driven native markup rendering.**

Rationale: path A sits exactly on the framework's contract. The compiler lowers IR to a per-platform
markup, style and script set through the existing table of extensions and directives, and the adapter
presents the native tree. It keeps the payload minimal, preserves native accessibility and input
handling, and requires no runtime interpreter. Path B is retained as a complement for highly visual,
pixel-deterministic surfaces. Path C is not adopted for the MVP because it duplicates the delivery
path and weakens input and lifecycle fidelity.

## 9. Exploration Point 2: Package-Size Optimization Strategy

Three implementation paths are compared.

| Path | Performance | Development Cost | Framework Intrusiveness | Maintainability |
| --- | --- | --- | --- | --- |
| A. Compile-time tree-shaking and unused-asset removal | Neutral: smaller download and parse time | Moderate: static IR analysis plus emitter changes | Moderate: touches the optimizer and emitter | High: deterministic, applies to every target |
| B. Runtime lazy loading and code sub-packaging | High initial-download gain: the entry package is smaller | High: manifest emission and per-page routing | High: emitter support for the package schema | Moderate: per-platform manifest differences |
| C. Asset-side compression only | Moderate: bounded by media weight | Low: asset pipeline work only | Low: orthogonal to code generation | High: simple and predictable |

**Recommended option: a layered application of A, then B, then C.**

Rationale: path A gives a deterministic, measurable code-size reduction at compile time and applies to
every target, so it is applied first. Path B then reduces the initial download for the
content-heavy surfaces, which is where the user-perceived gain is largest. Path C is applied
last because it is orthogonal and bounded. Each layer has its own measured acceptance metric, so the
combined effect is verifiable.

## 10. Exploration Point 3: Isomorphic-Code Compatibility Handling

Three implementation paths are compared.

| Path | Performance | Development Cost | Framework Intrusiveness | Maintainability |
| --- | --- | --- | --- | --- |
| A. Single-source IR with per-target emitters | Highest: native facilities, no runtime shim | Moderate: emitter table and per-target tests | Low: the canonical model | High: one source, one IR, nine emitters |
| B. Shared runtime compatibility layer (DOM-like shim) | Lower: shim overhead, larger runtime | Moderate to high: shim plus normalization | High: a runtime layer outside the emitter contract | Low: platform quirks concentrate in the shim |
| C. Shared business logic plus thin per-target UI shells | High: native UI, shared logic | Moderate: a second shared-logic module | Moderate: splits the single-source model | Moderate: logic and UI can diverge |

**Recommended option: A for the UI and rendering, combined with C for platform-neutral business
logic.**

Rationale: path A preserves the framework's compile-time lowering and pixel determinism, keeps the
payload minimal and confines platform code to the adapter. Path C is added for the model, API and
service layer, which is genuinely platform-neutral and benefits from a single implementation. Path B
is not adopted because a full DOM-like runtime contradicts the emitter contract and adds weight that
the mini-program targets do not require.

## 11. Build-Optimization Plan and Acceptance Criteria

### 11.1 Plan

1. **Baseline capture.** Build the mini-program targets from the unmodified skeleton and record the
   total generated byte count and per-category byte counts.
2. **Code optimization.** Enable compile-time tree-shaking and minification. Rebuild and record the
   reduction. Confirm the minified script still passes a syntax check.
3. **Asset optimization.** Compress the media set and remove generated assets that no emitted page
   references. Rebuild and record the reduction.
4. **Sub-packaging.** Once the emitter supports the package schema, split the detail and personal
   surfaces into subpackages and record the initial-package reduction.
5. **Verification.** Run the end-to-end rendering suite against the optimized build and confirm the
   observable frames are unchanged.
6. **Report.** Publish the measured before/after byte table and the combined reduction.

### 11.2 Acceptance criteria

- The optimized build is smaller than the baseline build, and the report states the measured
  absolute and percentage reduction.
- The optimized generated script passes a syntax check, and the end-to-end rendering suite passes
  against the optimized build.
- Every generated artifact that the emitted page set references is present; no referenced artifact
  is dropped.
- The size report records measured values only, and any value that is not recorded is
  stated with its reason.
- The optimization order is documented, and the combined reduction is compared against the sum of
  the isolated reductions.

## 12. Roadmap

Planned capabilities, in the order the MVP adopts them:

1. Platform login, file upload and share adapter entry points.
2. Runtime-list state and dynamic feed pagination.
3. Pull-gesture and scroll-driven input events.
4. Emitter support for code sub-packaging and the split package manifest.
5. Native component bridging through the `native_embed` capability.
6. Shared business-logic modules for cross-target logic reuse.
7. Per-target async effect parity across the six mini-program emitters.

Each planned capability is additive: existing IR, existing emitters and existing tests remain valid
as it lands.
