# Relay — OPUROM Instant Messaging Demo

## Overview

Relay is an original instant-messaging demonstration application authored for the OPUROM
framework. It presents a complete single-column mobile messaging client: a persistent bottom tab
bar, list screens, a conversation view, contact and group management, a call screen,
notifications and a settings area. Every surface is reachable from the entry tree, and every
interactive control mutates declared OPUROM state.

The screen inventory and interaction vocabulary were derived from a clean-room functional study
of a general-purpose mobile messaging client, covering conversation lists, threaded bubbles,
contact directories, group administration, call controls, notification badges and preference
panels. Relay is an original OPUROM demo with its own brand, name, color system and copy. It does
not reproduce any third-party product's name, logo, trademark or identity, and it ships no
third-party assets.

## Screen map

| Surface | Entry point | Purpose |
| --- | --- | --- |
| Chats | Chats tab | Conversation list, search, mark-all-read, opening a thread |
| Chat view | Conversation row, contact row, call return | Threaded bubbles, composer, message actions |
| New chat | Chats tab, sidebar, Contacts tab | Contact search, add contact, start conversation |
| Create group | New chat, sidebar | Group name, notice, member selection |
| Group info | Chat view, Chats tab | Group name and notice editing, avatar, member list |
| Contacts | Contacts tab | Searchable directory with profile and chat entries |
| Contact profile | Contact row | Presence, statistics, chat, call, block and unblock |
| Call screen | Chat view, sidebar, Discover, contact profile | Caller card, timer, mute, speaker, end |
| Discover | Discover tab | Feature cards, call log, notification and settings entries |
| Me | Me tab | Account card, statistics, profile edit, preferences |
| Notifications | Sidebar, Discover, Me | Unread counts, message list, mark-all-read, channels |
| Settings | Sidebar, Discover, Me | Profile, privacy, theme, cache management |

The root tab bar hosts four destinations: Chats, Contacts, Discover and Me. Detail screens replace
the tab content and expose a back control that returns to the root tab. A persistent left rail
holds the account card, unread statistics, quick actions and an appearance summary; the main
column renders the selected screen.

## Full feature list

### Navigation and shell

- Four-tab bottom navigation with an active-state highlight driven by dedicated bool state.
- One bool per tab and one bool per detail screen, resolved by a single conditional router.
- Persistent account card, unread counter tiles, quick actions and appearance token summary.
- A segmented tab selector and a contextual status line at the top of the content column.
- Back controls that clear every detail flag and restore the root view.

### Chats

- Conversation rows with avatar circle, display name, conversation kind, last-message preview,
  timestamp and unread badge.
- Per-row open action that selects the peer, avatar, presence and conversation index.
- Conversation search bound to a query state with a results panel and a clear action.
- Mark-all-read action that clears the unread counter and switches badge rendering.
- Entries to the new-chat flow and to group information.

### Chat view

- Header with back control, avatar, peer name, presence and typing text, plus call and group-info
  entries.
- Aligned message bubbles: incoming bubbles on the left with an avatar, outgoing bubbles on the
  right with a timestamp and a read-receipt badge.
- Delivery states shown per message: received, read, delivered and sending.
- Tap-to-expand long message with a collapse control.
- Message action menu opened from each outgoing bubble, with copy, delete, recall and close
  actions, plus inline notices for the resulting state.
- Typing indicator with a spinner and a stop control.
- Emoji picker with a grid of tokens that populate the composer and close the picker.
- Bound text input, an asynchronous send action with a delay effect, a draft readout and a
  mark-read action that advances the delivery state.
- Deleted-message and recalled-message placeholders.

### New chat, contacts and groups

- Contact search with a results panel and a clear action.
- Add-contact form with name and handle inputs plus a confirmation state.
- Contact directory rows with avatar, handle, note, presence badge, profile and chat actions.
- Contact profile with avatar, handle, presence, statistics, chat, call, block and unblock.
- Group creation with name and notice inputs, per-person member checkboxes and a confirmation.
- Group information with editable name and notice, avatar choices, a member list, add-member,
  remove-member, admin-role and mute actions, and an open-chat entry.

### Calls, notifications and Discover

- Call screen with caller avatar, elapsed timer, mute and speaker switches, an end-call control,
  an incoming-call simulation, a quality indicator and a return-to-chat action.
- Recent call log rendered from the call records with kind, timestamp and outcome.
- Notifications with unread badges, a mark-all-read action, per-channel preference switches and
  an open-message entry.
- Discover grid with feature cards for moments, channels, files, events, alerts and settings,
  plus direct entries to notifications and settings.

### Me and Settings

- Account card with avatar, name, handle, note, presence badge and statistics tiles.
- Profile edit with display name, handle and about inputs, three avatar choices and a saved state.
- Privacy switches for read receipts, typing indicators, online presence, group invites and push
  notifications.
- Theme selector with three accent presets, a dark preview toggle, radius, spacing and font-scale
  sliders, and three mode radios.
- Storage panel with cache size, a progress indicator, clear-cache and save-settings actions.

### Status, typing and delivery

- Presence text, typing text, a typing bubble, delivery labels on outgoing bubbles, a send-state
  readout and sent counters.
- Unread badges, notification badges and read flags on the notification list.
- Delivery state transitions driven by the send, mark-read and recall actions.

## Data model

The `models/chat.opu` module declares nine typed models. Each model carries one primary key and
typed fields with defaults where a value is meaningful at creation time.

| Model | Fields |
| --- | --- |
| Account | id, name, handle, avatar, note, online |
| Conversation | id, peer, kind, preview, stamp, unread, pinned, muted, draft |
| Message | id, conversation, author, body, stamp, direction, state, expanded |
| Contact | id, name, handle, avatar, note, online, blocked |
| Group | id, name, avatar, memberCount, notice |
| Member | id, group, name, avatar, role |
| CallRecord | id, peer, kind, stamp, outcome |
| Notification | id, title, body, stamp, kind, read |
| Setting | id, key, value |

### HTTP surface

Fifteen API blocks back the screens with list, get, create, update and delete handlers.

| Route | Handlers |
| --- | --- |
| `/account/:id` | get, update |
| `/conversations` | list, create |
| `/conversations/:id` | get, update |
| `/conversations/:id/messages` | list, create |
| `/messages/:id` | get, update, delete |
| `/contacts` | list, create |
| `/contacts/:id` | get, update |
| `/groups` | list, create |
| `/groups/:id` | get, update |
| `/groups/:id/members` | list, create |
| `/members/:id` | delete |
| `/calls` | list, create |
| `/notifications` | list |
| `/notifications/:id` | update |
| `/settings/:id` | list, update |

### Seed roster

The web product path cannot emit runtime list-typed state, so the demo declares no `state` list.
Each row-bearing screen instead renders one explicit row component call per entry, written out at
source level: five conversation rows, six contact rows, four member rows, three call rows, four
notification rows and the emoji presets. Every row carries its own literal text, tint and target,
so each list screen stays populated and every row opens its own destination after compilation.

### View state

`views/state.opu` holds scalar state grouped by concern: per-destination navigation booleans and
the root flag that anchors the tab bar; conversation, contact and group selection; search queries
and composer content; message interaction, delivery and action-sheet state; contact and group
management flags; per-member selection; notification read flags; call session state; account
profile and preference values; and unread counters. The `main.opu` entry file owns the components
and the app tree, reads these values through interpolation and mutates them through tap, input,
toggle and slider events.

## Visual system

The theme block declares a calm light mode, a restrained teal accent (#1F6F5C) and an 18px corner
radius. One cohesive palette runs across every surface: a #F5F6F8 page, white cards with hairline
#EEF0F3 borders, ink #101828 titles, secondary #8A91A0 text, soft avatar tints in teal, slate,
amber and violet, and low-area teal used only for accents, badges and outgoing bubbles. Type
follows a clear hierarchy: 20px screen titles, 15-16px row and section titles, 12-14px body,
10-12px captions. Spacing is generous: 12px card padding, 14-16px card radius, 8-12px inter-card
gaps and comfortable 46px avatar rows, with shadows kept soft. Spacing and radius are still driven
by settings sliders through the theme tokens, and the entry tree uses shared padding, gap and
radius values so list rows, cards and bubbles read as one family.

## Interaction flows

- Opening a conversation from either the Chats tab or the Contacts tab selects the peer and
  routes to the chat view; the composer sends through an asynchronous action that advances the
  delivery state.
- Message actions open a dialog over the thread; copy, delete and recall update the thread with
  inline placeholders.
- A call can be launched from the chat header, the sidebar, Discover or a contact profile; ending
  a call returns to the root view, while the return-to-chat action reopens the thread.
- Group creation selects members through checkboxes, then opens group information where name,
  notice and membership are editable.
- Mark-all-read clears unread counters and changes badge rendering in both the tab bar and the
  notification list.
- Theme controls update accent, radius, spacing, font scale and mode state, and switch between
  light and dark preview cards.

## Roadmap

Planned capabilities for later iterations:

- Live transport binding between the declared HTTP routes and the seed roster.
- Rich media message kinds with image, voice and file bubbles.
- Animated transitions between root tabs and detail screens.
- Conversation pinning, muting and draft persistence across sessions.
- Push delivery integration for notification badges.
- Accessible high-contrast and large-type presets applied across every screen.
