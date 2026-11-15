# music — desktop music player MVP

A single-file Opurom program that drives the four desktop native capabilities
the framework exposes through `opurom-platform`. The program is the UI and the
state contract; each capability fills the state it reads and answers the
controls it renders. One source, one IR, identical behaviour on every target.

## What the program shows

- **Library scan** (`filesystem`): the `Scan` action reports the tracks found
  under a local folder and their parsed metadata. The scanner is the real
  recursive walk in `opurom-platform/src/filesystem.rs`; it reads ID3v2 tags
  from MP3 and `VORBIS_COMMENT`/`STREAMINFO` from FLAC.
- **Transport** (`audio`): play/pause, position seek, volume and repeat mode
  bind to the shared `Transport` state machine in
  `opurom-platform/src/audio.rs`. The macOS adapter drives a real
  `AVAudioPlayer`; other targets keep the pure transport (documented degrade).
- **Playlist** (`tray` + playlist state): the tray menu mirrors the current
  track; its `Play`/`Pause`/`Quit` items map onto the same state this screen
  edits, and `quit_id` becomes `QuitRequested`.
- **Metadata panel**: title, artist, album and codec of the selected track.

## State contract

| State | Capability | Meaning |
| --- | --- | --- |
| `tracks` | filesystem | count of scanned audio files |
| `folder` | filesystem | scanned library root |
| `playing` | audio | transport play/pause |
| `position`, `duration` | audio | seek position and track length |
| `volume` | audio | output volume, 0..100 |
| `repeat`, `shuffle` | audio | repeat mode and shuffle flag |
| `selected`, `artist`, `album`, `bits` | filesystem | metadata of the current track |

The desktop capability matrix the application targets is reported by
`opurom-platform --desktop`: `tray`, `global_hotkey`, `filesystem`, `audio`,
each with its per-build status.

## Packages

- `opurom-ui` — the dark theme (`theme/dark.opu`) is imported once.
- `opurom-icons` — media glyphs (`play`, `pause`, `disc`, `music`,
  `skip-back`, `skip-forward`, `volume-off`, `repeat`, `shuffle`,
  `list-music`, `headphone`, `album`, `folder`) come from the icon package.

Both are vendored under `registry/` and declared in `opurom.json`, so the
source resolves and compiles offline.

## Verify

```sh
opuromc check apps/music/main.opu
opuromc compile apps/music/main.opu -o /tmp/music.opuir.json
opurom-render /tmp/music.opuir.json 390 844 /tmp/music.ppm
```

The cross-layer harness (`opurom-examples/test/cross-layer.mjs`) compiles this
app and lowers it to every emitter, and asserts the platform `--desktop`
matrix reports all four desktop capabilities.
