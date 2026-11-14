# OPUROM Desktop Music Player — MVP Design and Implementation Plan

## 1. Overview

This document defines the minimum viable product for a cross-desktop music streaming
player built on OPUROM. The product is a single-window desktop application that manages a
local media library, plays local audio through a native audio engine, manages playlists,
and exposes desktop integration such as resizable windows, minimize-to-tray, and a global
hotkey.

The plan separates three concerns:

- **Business design**: the media library, playback core, playlist management and desktop
  basics, expressed in OPUROM syntax.
- **Platform design**: the native capabilities the desktop adapter must expose, and how
  they cross the plugin/native-capability boundary.
- **Framework analysis**: what the current OPUROM language and toolchain provide today,
  what requires a pending framework capability, and the recommended direction for each
  exploration point.

The companion OPUROM skeleton under `apps/music` models the data and view layers and
presents the player surface. Each file is a self-contained `app` so it can be checked
independently.

## 2. Application Architecture and Module Division

### 2.1 Layered architecture

The application is organized in four layers. The OPUROM program is platform-neutral; the
platform adapter is the only platform-specific code.

| Layer | Responsibility | OPUROM carrier |
| --- | --- | --- |
| Presentation | Declarative UI, player surface, lists, controls | `main.opu`, `views/` |
| Domain | Media library, playback core, playlist rules | `models/`, state, computed |
| Service | Library and playlist service routes | `model` and `api` declarations |
| Platform | Window, GPU presentation, input, lifecycle, native capabilities | Platform adapter (Rust ABI) |

The OPUROM program lowers to IR. The IR is the single contract between the compiler, the
kernel, the renderer and the adapters. The adapter implements the `PlatformAdapter` trait
and is the only component that touches operating-system APIs.

### 2.2 Module division

The multi-file layout mirrors the workbench example and keeps declarations in the layer
that owns them.

| File | Layer | Contents |
| --- | --- | --- |
| `apps/music/main.opu` | Entry | Merged declarations and the full application shell: header, library list, now-playing surface, playlists, desktop controls |
| `apps/music/models/library.opu` | Domain | `Track` and `Playlist` models, `/music/library` and `/music/playlists` service routes, library classification state |
| `apps/music/views/player.opu` | Presentation | Playback state, transport controls, seek, volume and mode controls |

In a production build the entry app imports the domain and presentation modules. Imported
modules may declare `state`, `model`, `api`, `theme` and `imports`; UI nodes, components
and event handlers remain in the importing entry file. The skeleton keeps each file as a
standalone `app` so that the compiler can check every file individually; the declaration
set is identical to the imported form.

### 2.3 Mapping to the desktop targets

The `PlatformAdapter` trait defines the platform contract:

```rust
pub trait PlatformAdapter {
    fn name(&self) -> &str;
    fn capabilities(&self) -> Capabilities;
    fn viewport(&self) -> Size;
    fn poll_event(&mut self) -> Option<InputEvent>;
    fn present(&mut self, frame: FrameView<'_>) -> Result<(), AdapterError>;
}
```

| Desktop concern | Adapter surface | OPUROM mapping |
| --- | --- | --- |
| Native window | `viewport`, window lifecycle, `Resize` events; multi-window via a window set | The renderer reflows the same IR at every viewport width; the shell uses responsive `Row` and `Column` layout |
| GPU presentation | `present(FrameView)` receives an RGBA8 pixel view; a GPU backend rasterizes the display list | The renderer emits the display list; the same IR produces byte-identical output on the software and GPU paths |
| Input | `InputEvent::Tap`, `Input`, `Key`, `Resize`, `Lifecycle`; hit-testing resolves `node_id` | `Button`, `Input`, `Slider`, `Radio`, `Switch`, `Checkbox`, `Tabs` lower to `tap` and `input` actions against state |
| Lifecycle | `Lifecycle::Resumed`, `Paused`, `Destroyed` | Drives background-playback persistence and state save on pause or destroy |
| Native capability boundary | Capability flags plus native service methods exposed by the adapter | Business code calls capability services; the OPUROM program never imports platform headers |

`Capabilities` reports `gpu`, `native_embed`, `multi_window`, `lifecycle` and `dpi_scale`.
The music player depends on `gpu`, `lifecycle` and `multi_window`; the adapter declares
what it can host, and the application degrades gracefully when a capability is absent.

### 2.4 Plugin and native-capability boundary

The boundary is explicit:

- **Inside the boundary**: IR, the kernel, the renderer and the language. These are
  platform-neutral and identical across desktop targets.
- **On the boundary**: the platform adapter and the capability services it registers.
- **Outside the boundary**: operating-system windowing, audio, filesystem, notification
  and hotkey APIs.

Native capabilities are proposed as typed services registered by the adapter and invoked
from the OPUROM program through effect or action calls. The business code remains
platform-neutral and receives results as ordinary state updates.

## 3. MVP Business Design in OPUROM Syntax

The snippets in this section use the current declarative language for models, state,
computed values, components and UI. Native capability calls are shown as proposed effect
names and are specified in section 4; they are not part of the current grammar and are
listed as pending framework capabilities in section 8.

### 3.1 Local media library

The library layer owns the media record, the service routes and the classification
state. The `Track` record carries the required metadata: title, artist, album and
duration, plus a filesystem path for the audio source.

```opu
model Track {
  id: int primary
  title: string
  artist: string
  album: string
  duration: int
  path: string
}

model Playlist {
  id: int primary
  name: string
  trackId: int
}

api "/music/library" {
  list Track
  create Track
}

api "/music/playlists" {
  list Playlist
  create Playlist
}
```

Library scanning is an asynchronous native operation. The design scans a user-selected
directory recursively, extracts metadata for each audio file, and stores the resulting
records in library state. Classification is derived from the record fields:

- **By artist**: group records on `artist`.
- **By album**: group records on `album`.
- **By playlist**: resolve records referenced by a `Playlist`.

```opu
// Proposed effect: the adapter walks the directory and returns Track records.
state library = "pending"
state libraryPath = "music"
state scanProgress = 0

Button("Scan library") async {
  await native.scanMedia(libraryPath, library)
  scanProgress += 1
}
```

The current language already supports `async` handlers with `delay` and `fetch`. The
scanning effect follows the same lowering pattern: the handler becomes an event carrying
`async: true` and an `effects` list, and the adapter performs the native work.

### 3.2 Playback core

The playback core owns transport, position, volume and playback mode. State is flat and
typed; actions apply atomically and the renderer consumes the resulting patches.

```opu
state playing = true
state position = 62
state duration = 214
state volume = 40
state mode = "sequence"

computed remaining = duration - position
```

Transport controls map directly to actions:

```opu
Button("Play") { playing = false }
Button("Pause") { playing = true }
Button("Previous") { position -= 30 }
Button("Next") { position += 30 }
Slider(bind: position, min: 0, max: 240)
Slider(bind: volume, min: 0, max: 100)
```

Playback mode switches between sequence, loop and shuffle through a string state bound to
radio controls:

```opu
Radio(bind: mode, value: "sequence")
Radio(bind: mode, value: "loop")
Radio(bind: mode, value: "shuffle")
```

The playback engine itself is a native service (section 4.5). The OPUROM state mirrors the
engine state: `playing` mirrors the transport state, `position` mirrors the playback
clock, and `mode` selects the engine's sequencing policy. Seek and volume changes are
applied as state updates that the adapter observes and forwards to the engine.

### 3.3 Playlist management

Playlists are user-facing collections of track references. The `Playlist` model holds a
name and an ordered reference to a track. Playlist management consists of creating,
renaming, adding tracks, removing tracks and reordering entries.

```opu
state playlists = ["Road Trip", "Focus Loop", "Late Night"]
state selectedPlaylist = "Road Trip"
state playlistTrack = "Aurora Lights"

Button("Add to playlist") { playlistTrack = nowPlaying }
Button("Remove from playlist") { playlistTrack = "" }
```

The playlist view lists entries in a scroll container and offers add and remove actions.
Reordering is a state update on the ordered track reference list; the native service
persists the order.

### 3.4 Desktop basics

Desktop basics are modeled as state and driven by native capabilities:

```opu
state alwaysOnTop = true
state trayHidden = false
state hotkeyEnabled = true
state globalHotkey = "Ctrl+Shift+P"
```

- **Window resizing**: the adapter emits `Resize` events; the renderer reflows the shell
  and the same IR reflows at every breakpoint tier.
- **Minimize-to-tray**: the `trayHidden` state is set when the window is minimized to the
  system tray; the adapter hides the window and keeps the audio engine running.
- **Global hotkey**: the `globalHotkey` string registers a system-wide shortcut with the
  adapter; the `hotkeyEnabled` state toggles registration. The adapter delivers the
  shortcut as a `Key` input event, which the application maps to a transport action.

## 4. Desktop Native Capability API Proposals

The adapter exposes the following capability services. Each proposal states the operation,
the data it exchanges and the desktop mapping.

### 4.1 Filesystem read and write

| Proposal | Operation | Data | Notes |
| --- | --- | --- | --- |
| `fs.readText(path)` | Read a text file | `string` result | Used for playlist manifests and persisted state |
| `fs.writeText(path, value)` | Write a text file | `string` input | Used for playlists and resume state |
| `fs.listDir(path)` | List a directory | `string[]` names | Basis for library scanning |
| `fs.stat(path)` | File metadata | size, extension, mtime | Filters audio extensions before extraction |

### 4.2 System notification

`notify(title, body)` posts a desktop notification. The adapter maps it to the platform
notification service. Used for track changes, scan completion and playback errors.

### 4.3 Global hotkeys

`hotkey.register(key, action)` binds a system-wide key combination to a named action. The
adapter installs the system hook and delivers the event as `InputEvent::Key`, which the
application routes to the named transport action. `hotkey.unregister(key)` releases the
binding.

### 4.4 Window control

| Proposal | Operation | Effect |
| --- | --- | --- |
| `window.setAlwaysOnTop(bool)` | Toggle always-on-top | Keeps the player above other windows |
| `window.minimize()` | Minimize the window | Hides the window; the app continues |
| `window.toTray()` | Minimize to the system tray | Hides the window and keeps playback active |
| `window.restore()` | Restore from tray | Shows the window again |
| `window.onResize(handler)` | Subscribe to resize | Delivers `Resize` events to the renderer |

### 4.5 Audio decoding and playback interface

The audio capability is the core of the player. The proposed interface is a typed
transport service:

| Proposal | Operation | Data |
| --- | --- | --- |
| `audio.load(path)` | Load a decoded track | `duration` in seconds |
| `audio.play()` | Start playback | — |
| `audio.pause()` | Pause playback | — |
| `audio.seek(seconds)` | Move the playback clock | `int` seconds |
| `audio.setVolume(level)` | Set output level | `int` 0..100 |
| `audio.setMode(mode)` | Select sequencing policy | `"sequence"`, `"loop"`, `"shuffle"` |
| `audio.onPosition(handler)` | Subscribe to clock updates | `int` seconds |

The adapter owns the decode and output pipeline. The OPUROM state mirrors the transport
and the position subscription updates `position`.

### 4.6 Background-playback persistence

`session.save(state)` and `session.restore()` serialize and restore application state. The
adapter persists the payload to the platform application-data directory and reloads it on
startup. The lifecycle `Resumed`, `Paused` and `Destroyed` events drive the save points:
`Paused` saves transport state, `Destroyed` saves the full session, and `Resumed` restores
it.

## 5. Framework Capability Coverage and Priority Ranking

This section maps two required capabilities to the current framework surface and ranks
the work.

### 5.1 Frontend long-list virtual scrolling and large-dataset rendering

| Current framework surface | Coverage |
| --- | --- |
| `Scroll(height)` container | Provides a clipped viewport for a scrollable region |
| `for (i in N)` and `for (item in list)` | Unrolls at compile time into literal nodes |
| List-valued state | Stores a compile-time string list; contents are fixed at compile time |
| `computed` | Derives `int`, `bool` or `string` from `+`, `-`, `*`, integer literals and state |

The current language renders list rows by unrolling at compile time. That approach suits a
bounded, known set of rows and does not carry a runtime dataset of thousands of library
records. A runtime list state, windowed rendering and row recycling are required for the
library browser.

**Priority: P1.** The library and playlist lists are the primary navigation surface. Without
windowed rendering, a large scanned library cannot be browsed at the frame budget.

### 5.2 Local large-capacity cache and embedded database

| Current framework surface | Coverage |
| --- | --- |
| `model` declarations | Define the data contract and service routes |
| `api` routes | Declare list and create operations against a model |
| `computed` | Derives values in memory |

The current language declares data contracts and routes but does not provide a local
persistent store. A large-capacity cache and an embedded database are provided by a native
capability: the filesystem service for manifest and resume files, and an embedded database
adapter for the library index, play counts and playlists.

**Priority: P2.** Persistence matters for library stability and resume behavior, but the
player can launch against a freshly scanned library before the database lands.

### 5.3 Ranking summary

| Rank | Capability | Rationale |
| --- | --- | --- |
| P1 | Long-list virtual scrolling and large-dataset rendering | Directly determines whether the library browser meets the frame budget |
| P2 | Local large-capacity cache and embedded database | Improves launch time, resume behavior and library durability |
| P3 | GPU-side list batching | Reduces per-frame draw work after windowed rendering exists |

## 6. Performance Optimization Plan and Acceptance Criteria

The optimization plan targets three budgets: frame time, scroll cost and memory.

### 6.1 Frame budget

| Metric | Target |
| --- | --- |
| Idle frame time | 4 ms or less for a static frame |
| Scrolling frame time | 8 ms or less at the 95th percentile while scrolling |
| Target refresh | 60 frames per second |
| Presentation path | Display list rasterized by the software or GPU backend with byte-identical output |

### 6.2 Scroll cost

| Metric | Target |
| --- | --- |
| Row construction | Only the visible slice of rows is constructed per frame |
| Row recycle | Reused row slots avoid rebuilding layout nodes while scrolling |
| Scroll latency | Under 8 ms at the 95th percentile for a 10,000-row library |
| Layout work | Relayout is confined to the changed slice and the viewport |

### 6.3 Memory

| Metric | Target |
| --- | --- |
| Baseline application memory | Stable across a one-hour session |
| Library metadata cache | Bounded to the scanned record set with a documented cap |
| Thumbnail and art cache | Bounded with eviction; no unbounded growth |
| Resume state | Bounded to transport state and playlist references |

### 6.4 Acceptance criteria

1. A 10,000-row library renders and scrolls within the 8 ms scrolling frame budget at the
   95th percentile.
2. Static frames remain within the 4 ms idle budget.
3. A one-hour browsing and playback session shows no unbounded growth in application
   memory.
4. The same IR produces byte-identical output on the software and GPU presentation paths
   for the player surface.
5. Window resize and breakpoint transitions reflow the shell without rebuilding the
   underlying IR.

## 7. Exploration Points: Options and Recommendations

### 7.1 Local audio file scanning mechanism

**Path A — Recursive filesystem scan with a native metadata extractor.**

The adapter walks the selected directory recursively, filters audio extensions, reads
each file's metadata through a native decoder, and returns `Track` records. The OPUROM
side receives the records and stores them in library state.

**Path B — Operating-system metadata index query.**

The adapter queries the platform metadata index for audio files under the directory and
maps indexed fields to the `Track` record.

**Path C — Sidecar manifest scanning.**

The adapter reads playlist manifest files (for example `.m3u` or a project manifest) and
resolves the referenced audio paths, rather than scanning audio files directly.

| Dimension | Path A: recursive scan | Path B: OS index | Path C: sidecar manifests |
| --- | --- | --- | --- |
| Performance | Linear in file count; can be incremental | Fast, index-backed, no per-file read | Fast; bounded by manifest size |
| Development cost | Moderate; one walker plus a metadata reader | Low for the query, high for field mapping across platforms | Low; a manifest parser plus path resolution |
| Framework intrusiveness | Low; one native capability and a state update | Medium; capability exposes platform-specific fields | Low; capability reads text files |
| Maintainability | High; deterministic and cross-platform | Medium; field coverage and behavior vary per platform | Medium; depends on user-maintained manifests |
| Coverage | Every audio file in the tree | Whatever the index indexes | Only files referenced by a manifest |

**Recommended option: Path A.** A recursive scan with a native metadata extractor gives
deterministic, cross-platform coverage of every audio file and a single, consistent field
mapping for title, artist, album and duration. Path B is a suitable later acceleration for
large libraries once field mapping is stable. Path C complements Path A as an import path
for user-curated collections.

### 7.2 Audio playback capability encapsulation scheme

**Path A — In-process native transport service.**

The adapter owns a native audio engine behind the typed `audio.*` transport interface
defined in section 4.5. The OPUROM state mirrors the engine, and the adapter forwards
state changes to the engine and publishes clock updates back as state.

**Path B — Native media surface node.**

The `Player` primitive is backed by a native media view owned by the adapter; the OPUROM
program drives the node through props and events, and the adapter renders the surface.

**Path C — Out-of-process background media service.**

Playback runs in a background media service with an inter-process bridge; the application
sends transport commands and receives clock and state updates over the bridge.

| Dimension | Path A: in-process transport | Path B: native media node | Path C: out-of-process service |
| --- | --- | --- | --- |
| Performance | Low overhead; direct calls | Low overhead; direct surface ownership | Higher overhead from the bridge |
| Development cost | Moderate; one typed interface | Moderate; node lifecycle plus surface ownership | High; service lifecycle and IPC contract |
| Framework intrusiveness | Low; a capability service and effect calls | Medium; a primitive backed by a native view | Medium; a bridge and lifecycle contract |
| Maintainability | High; a single typed interface and deterministic state | Medium; native view lifecycle is coupled to the node | Medium; two processes to keep consistent |
| Background behavior | Requires a lifecycle-aware engine | Tied to the surface lifetime | Native background media policy |

**Recommended option: Path A.** A typed in-process transport service gives deterministic
control over load, play, pause, seek, volume and mode, keeps the OPUROM state as the single
source of truth, and is straightforward to test. Path C is the right direction for
background-playback persistence and system-media-policy integration once the transport
contract is stable.

### 7.3 Long-list performance optimization

**Path A — Renderer-side windowed virtual scrolling.**

The renderer keeps a viewport of constructed rows, recycles row slots as the scroll
offset changes, and only lays out the visible slice plus an overscan margin.

**Path B — Compile-time unrolled list with paging.**

The list is rendered in fixed-size pages through compile-time `for` unrolling, and the
scroll container shows one page at a time.

**Path C — GPU-side list batching with dirty-rect updates.**

List rows are emitted as display-list commands and batched by the GPU backend; only
changed rows repaint through dirty-rect tracking.

| Dimension | Path A: windowed virtual scroll | Path B: unrolled paging | Path C: GPU batching |
| --- | --- | --- | --- |
| Performance | Excellent; bounded row count regardless of dataset size | Good for bounded pages; poor for large datasets | Excellent draw throughput; depends on Path A for row count |
| Development cost | Moderate; viewport math plus row recycling | Low; uses existing `for` unrolling | High; batching and dirty-rect bookkeeping |
| Framework intrusiveness | Medium; renderer and scroll container changes | Low; language-level only | High; renderer and GPU backend changes |
| Maintainability | High; one windowing policy | High; simple but scales poorly | Medium; complex but centralized |
| Dataset size | Thousands to hundreds of thousands of rows | Bounded by compile-time unrolling | Thousands to hundreds of thousands of rows |

**Recommended option: Path A.** Windowed virtual scrolling in the renderer bounds the number
of constructed rows and keeps scroll cost independent of library size, which is the
requirement behind the P1 priority. Path C is a natural follow-up that reduces draw work
once windowed rendering exists. Path B is acceptable for a small, fixed sample but does
not satisfy the large-library target.

## 8. Implementation Split: Current Framework and Pending Capabilities

### 8.1 Implementable with the current framework today

- Declarative UI shells, responsive layout, `Scroll` viewports and component composition.
- Flat typed state, `computed` derived values, multi-statement event handlers and `toggle`.
- `model` and `api` declarations for the `Track` and `Playlist` data contracts and service
  routes.
- Theme tokens, atomic style shortcuts and the player visual primitives.
- Compile-time sample library data, playlist entries and classification state.
- The player surface, transport controls, seek and volume controls, and playback mode
  controls as declarative nodes.
- Desktop capability state (always-on-top, tray, global hotkey) and its controls.
- The OPUROM skeleton under `apps/music`, checked with the compiler.

### 8.2 Requires a pending framework capability

- Runtime media-library data and recursive file scanning (native filesystem and metadata
  extraction).
- Audio decoding and the playback transport (native audio engine).
- Native window control: always-on-top, minimize and tray.
- Global hotkey registration and delivery.
- System notification.
- Background-playback persistence and session save/restore.
- Runtime list state and windowed virtual scrolling for large libraries.
- Local large-capacity cache and embedded database adapter.

## 9. Roadmap

The following capabilities are planned for the framework and the application, in
dependency order:

1. Native filesystem and metadata capability, enabling recursive library scanning.
2. Native audio transport capability, enabling playback, seek, volume and mode control.
3. Runtime list state and windowed virtual scrolling, enabling large-library browsing.
4. Embedded database adapter, enabling library indexing, play counts and playlist
   persistence.
5. Window-control, tray and global-hotkey capabilities, enabling the desktop basics.
6. System notification and background-playback persistence, enabling session continuity.
7. GPU-side list batching, reducing per-frame draw work for large lists.

## 10. Skeleton

The skeleton under `apps/music` presents the player UI and models the media library and
playlist state:

- `apps/music/main.opu` — the application shell with the library list, now-playing
  surface, playlist list and desktop controls.
- `apps/music/models/library.opu` — the `Track` and `Playlist` models, the service routes
  and the library classification state.
- `apps/music/views/player.opu` — the playback state and the transport, seek, volume and
  mode controls.

Each file declares its own `model`, `api`, state and UI so that it can be checked
individually. The declaration set matches the imported form used by a production build.
