# Halcyon — OPUROM Desktop Music Player Design

## 1. Overview

Halcyon is a full-feature desktop music player demonstration authored in OPUROM. The
application presents a single-window desktop experience with a left navigation rail, a
central content region, a right lyrics and playlist panel, and a persistent bottom
now-playing bar. The source tree defines the interface, the relational data model, and the
service boundary in one declarative language, so screen state, entities, and routes share a
single contract.

The demonstration covers library browsing, online source discovery, playlist management,
favorites, listening history, synchronized lyrics, playback transport, and settings. Each
capability is expressed through OPUROM state, model, api, computed, theme, and node
declarations. Cover art, gradients, badges, cards, switches, sliders, radio groups, and
scroll surfaces are composed from OPUROM primitives.

## 2. Brand and originality

Halcyon is an original OPUROM demonstration with its own brand name, visual identity,
accent palette, source names, track catalog, and lyric writing. It does not reproduce the
name, logo, trademarks, or assets of any third-party product. The three-region shell,
transport bar, song rows, and side panels follow a general desktop music-player layout
studied as a clean-room functional reference. The brand name Halcyon and every catalog
entry are original to this demonstration.

## 3. Source layout

| File | Role |
| --- | --- |
| `apps/music/main.opu` | Entry file: module imports, reusable components, theme, computed value, and the complete application tree. |
| `apps/music/models/library.opu` | Entity models and the HTTP service routes. |
| `apps/music/views/state.opu` | Screen flags, catalog values, playlist slots, presence flags, and settings. |
| `apps/music/views/player.opu` | Transport, now-playing, lyric, and play-queue values. |
| `apps/music/DESIGN.md` | This design document. |

Components remain in the entry file because imported modules carry data declarations only.
The entry file imports the model module and both view-state modules, then merges their
declarations with the application tree.

## 4. Screen map

| Region | Screens and surfaces |
| --- | --- |
| Brand header | Halcyon brand banner, gradient accent, now-playing subtitle, desktop music badge. |
| Left rail | Search, Online Library, Local Playlists, Favorites, History, Settings; active-item marker, now-playing summary, library summary. |
| Center: Search | Search field, column sort header, query and sort badges, multi-select panel, stat tiles, song list with column headings. |
| Center: Online Library | Source selector, browse tabs for Category, Hot, and New, category selector, stat tiles, featured song list, source name list. |
| Center: Local Playlists | Create field, add-track picker, and cards for every playlist with rename, delete, add, remove, and reorder controls. |
| Center: Favorites | Favorite songs with unfavorite actions, clear-all and restore-selection actions, stat tiles. |
| Center: History | Recently played rows with clear-history and restore-selection actions. |
| Center: Settings | Playback defaults, appearance with light and dark palette previews, and source management. |
| Right panel | Now-playing detail card, Lyrics and Queue tab buttons, synchronized lyrics panel, play queue panel. |
| Bottom bar | Persistent now-playing bar shared by every screen. |

Each left-rail item switches the center region to its own screen. The right panel and the
bottom bar stay reachable from every screen, so lyrics, the queue, and transport controls
remain available while any center view is active.

## 5. Full feature list

### 5.1 Left navigation

- Six reachable destinations: Search, Online Library, Local Playlists, Favorites,
  History, and Settings.
- An active-item marker on the current destination.
- A now-playing summary card and a library summary card.
- Icon-led buttons with rounded surfaces and consistent accent treatment.

### 5.2 Song list view

- Rows with gradient cover art, title, artist, album, and duration.
- A sort header with Title, Artist, Album, and Duration columns.
- Multi-select checkboxes for six rows with Select all and Clear selection actions.
- A search input with query and sort indicators.
- Column headings for cover, title, artist, album, and duration.
- Rounded interactive row cards with borders, shadows, and accent play controls.
- A scroll surface sized for the desktop content region.

### 5.3 Persistent now-playing bar

- Gradient cover tile, title, artist, album, and current track index.
- Play and pause toggle.
- Previous and next transport with per-track target records.
- Draggable seek slider with elapsed, total, and remaining readouts.
- Waveform visualization.
- Volume slider with percentage readout.
- Sequence, loop, and shuffle mode radio group.
- Repeat-one switch.
- A queue switch that opens the play queue panel.
- One derived value for remaining time.

### 5.4 Lyrics panel

- Six synchronized lyric lines with exclusive current-line highlighting.
- A selectable control on each line that moves the highlight.
- A scroll surface for the lyric sheet.
- An equalizer visualization and a now-playing caption.

### 5.5 Playlist management

- Create a custom playlist from a name field.
- Rename any playlist through an inline save field.
- Delete any playlist.
- Add a track from a six-entry picker.
- Remove a track from a playlist.
- Move up and move down reorder controls with an order indicator.
- Track-count badges and empty-playlist messaging.
- Per-playlist song rows with play actions.

### 5.6 Favorites and history

- A favorites view with unfavorite actions on each row.
- Clear-all and restore-selection actions for favorites.
- A recently played view with clear-history and restore-selection actions.
- Stat tiles summarizing the favorite catalog.

### 5.7 Online sources

- Four original-named source entries: Aurora FM, Lumen Sound, Northwave Radio, and
  Echo Cache.
- A source selector bound to the active source.
- A category selector with Pop, Rock, Jazz, and Electronic entries.
- Browse tabs for Category, Hot, and New with an active tab badge.
- Featured lists, stat tiles, and a source-name list.

### 5.8 Settings

- Playback defaults for volume, startup mode, shuffle on startup, crossfade, and prefetch.
- Slider, radio group, and switch controls bound to settings values.
- A theme toggle with dark and light palette previews.
- Source management switches with per-source enable state.
- Rounded setting cards with labels and readouts.

### 5.9 Theme and visual system

- A dark default theme with a cool indigo accent, a fourteen-unit corner radius, and a
  unit font scale.
- A light palette block with pale surfaces and indigo accents.
- Gradient brand banners with a bounded particle field.
- Gradient cover tiles generated from two-stop color pairs.
- Rounded cards, badges, chips, dividers, and consistent accent buttons.
- Scroll surfaces, grids, and stat tiles across the content region.

## 6. Data model

Eight entities describe the catalog, playlists, sources, lyrics, favorites, history, and
the play queue.

| Model | Fields |
| --- | --- |
| `Track` | `id` int primary, `title` string, `artist` string, `album` string, `duration` int, `path` string |
| `Playlist` | `id` int primary, `name` string, `owner` string, `createdAt` string |
| `PlaylistTrack` | `id` int primary, `playlistId` int, `trackId` int, `position` int |
| `Source` | `id` int primary, `name` string, `kind` string, `enabled` bool |
| `LyricLine` | `id` int primary, `trackId` int, `text` string, `startMs` int |
| `Favorite` | `id` int primary, `trackId` int, `owner` string |
| `HistoryEntry` | `id` int primary, `trackId` int, `playedAt` string |
| `QueueItem` | `id` int primary, `trackId` int, `position` int |

Fifteen service routes expose list, get, create, update, and delete handlers:

| Route | Handlers |
| --- | --- |
| `/music/tracks` | list Track, create Track |
| `/music/tracks/:id` | get Track, update Track, delete Track |
| `/music/playlists` | list Playlist, create Playlist |
| `/music/playlists/:id` | get Playlist, update Playlist, delete Playlist |
| `/music/playlists/:id/tracks` | list PlaylistTrack, create PlaylistTrack |
| `/music/playlists/:id/tracks/:trackId` | update PlaylistTrack, delete PlaylistTrack |
| `/music/sources` | list Source, create Source |
| `/music/sources/:id` | get Source, update Source, delete Source |
| `/music/lyrics` | list LyricLine |
| `/music/favorites` | list Favorite, create Favorite |
| `/music/favorites/:id` | delete Favorite |
| `/music/history` | list HistoryEntry, create HistoryEntry |
| `/music/history/:id` | delete HistoryEntry |
| `/music/queue` | list QueueItem, create QueueItem |
| `/music/queue/:id` | update QueueItem, delete QueueItem |

## 7. State and interaction model

View state is organized into named groups:

- Six screen flags, exactly one active at a time, and two right-panel tab flags.
- Transport values for the current index, play state, position, duration, volume, mode,
  and repeat-one.
- A now-playing record with title, artist, and album, plus six per-track presence flags
  that drive previous and next transport.
- Search, sort, source, category, browse-tab, source-name, and category-name values.
- Three playlist slots, each with a name, visibility, count, two track fields, presence
  flags, an order flag, an extra track field, and rename values.
- Six selection flags, six favorite flags, six history flags, and six lyric flags.
- A play-queue title list with six inclusion flags.
- Settings values for theme, volume, mode, and four source enable switches.

A play action writes the now-playing record, the current index, and the presence flags in
one tap, so the bar, the right panel, and the transport variants all read the same values.
Previous and next actions write the neighboring track record. Clear, restore, reset,
create, rename, delete, add, remove, and reorder actions each update the corresponding
state group directly. One derived value, remaining time, subtracts position from duration.

## 8. Roadmap

The following capabilities are planned for subsequent releases:

- Audio decoding and platform media engine bindings.
- Persistent library, playlist, favorite, and history storage across sessions.
- Streaming adapters for additional online sources.
- Pointer-driven drag-and-drop ordering for playlist and queue rows.
- Lyric timing derived from media metadata and translation sheets.
- System tray, global shortcut, and multi-window integration.
- User accounts with cross-device synchronization.
