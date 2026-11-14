# Relay — Full-Stack Discussion Forum Design

## 1. Overview

Relay is a community discussion forum application built on OPUROM, the single-source
declarative language in which one `.opu` source tree defines the user interface, the relational
data model, and the HTTP service boundary. The compiler lowers that source to one intermediate
representation (IR); frontend types and backend types therefore share one source of truth.

Relay is an original OPUROM demo with its own brand, palette, and screen names. It does not
reproduce any third-party product's identity, logo, or trademark. The design note in section 10
restates this boundary.

Source layout under `apps/forum/`:

- `main.opu` — the entry file. It imports the model, state and theme modules, declares the
  reusable components, and holds the app tree that renders every screen.
- `models/forum.opu` — the entity models and their HTTP `api` routes.
- `views/state.opu` — the view state every screen reads: navigation flags, session, feed
  controls, selections, composer and auth fields, and the compile-time record lists.
- `views/theme.opu` — the theme block and the named surface/ink color tokens.

## 2. Screen map

Each screen is a real, reachable surface switched by one state flag.

| Screen | Entry control | Renders |
| --- | --- | --- |
| Feed | `Home` / brand | Sort controls, tag strip, stats, discussion cards, load-more |
| Discussion detail | `Open` on a card | Post body, author, reactions, moderator tools, reply composer, nested replies |
| Composer | `New` / `New discussion` | Title, body, tag radio, validation note, publish/cancel |
| Login | `Sign out` then header, or direct | Handle and password fields, sign-in and register links |
| Register | `Create account` on login | Handle, name, email, password, create/cancel |
| Profile | `@{meHandle}` or a member `View` | Identity card, bio, follow/block, stats, activity feed |
| Notifications | `Bell {unreadCount}` | Unread summary, mark-all-read, notification rows |
| Search | `Search` | Query box and mixed discussion/member results |
| Moderation | `Moderation` quick link | Queue note, flagged items, delete/dismiss/mute actions |

## 3. Feature list

- Discussion list: card-based feed with title, author, tag chip, like/reply/view counts and
  relative time; tag filter bar; sort (latest, top, unanswered); search box; paged load-more.
- Post detail: full body, author header, like/reply/save/edit actions, view and reply counts,
  lock/delete/flag moderation tools, reply composer, and a nested reply thread.
- Tags: a tag catalogue with per-tag color accents, tag chips on cards, tag filtering, and tag
  pages selected through the tag chip control.
- User profile: avatar, bio, role, join date, statistics (discussions, replies, likes), follow
  and block state, message action, and an activity feed.
- Notifications: unread count in the header, notification kinds (reply, mention, follow),
  per-item mark-read, and a mark-all-read action.
- Auth flow: login screen, register screen, a signed-in header with a user menu entry, and a
  sign-out action that drops the session tier to guest.
- Composer: create-discussion composer with title, body, tag selection and a validation note,
  plus a reply composer inside the detail surface.
- Search: a query box in the header and on the search screen, with live results across both
  discussions and members.
- Moderation panel: a queue of flagged posts with delete, dismiss and mute-user actions, plus a
  note that reflects the latest moderation action.

## 4. Data model

Entities are declared in `models/forum.opu` and lowered into IR `models` and `api`.

| Model | Key fields | Relations |
| --- | --- | --- |
| `User` | `id`, `handle`, `displayName`, `role`, `bio`, `joined`, counters, `followed`, `blocked`, `muted` | — |
| `Tag` | `id`, `slug`, `label`, `color`, `discussionCount` | — |
| `Discussion` | `id`, `tagId`, `author`, `title`, `body`, `likes`, `replies`, `views`, `pinned`, `locked`, `flagged`, `createdAt` | `tagId → Tag.id` |
| `Reply` | `id`, `discussionId`, `parentId`, `author`, `body`, `likes`, `edited`, `flagged`, `createdAt` | `discussionId → Discussion.id`, `parentId → Reply.id` |
| `Reaction` | `id`, `targetType`, `targetId`, `owner` | polymorphic target |
| `Bookmark` | `id`, `discussionId`, `owner` | `discussionId → Discussion.id` |
| `Follow` | `id`, `follower`, `following` | — |
| `Notification` | `id`, `owner`, `kind`, `actor`, `subject`, `read`, `createdAt` | — |
| `Flag` | `id`, `targetType`, `targetId`, `reporter`, `reason`, `resolved` | polymorphic target |
| `Session` | `id`, `handle`, `token`, `issuedAt` | — |

The `api` block declares list, get, create, update and delete routes for these entities, for
example `GET/POST /relay/discussions`, `GET/PUT/DELETE /relay/discussions/:id`,
`GET/POST /relay/discussions/:id/replies`, and `GET /relay/notifications`. Collection routes
carry `list`/`create`; item routes carry `get`/`update`/`delete`.

### 4.1 View state

`views/state.opu` holds the client store the screens read and patch. Navigation uses one bool per
screen (`showFeed`, `showLogin`, `showRegister`, `showProfile`, `showNotifications`, `showSearch`,
`showCompose`, `showModeration`) plus a `view` label, and a `viewFeedDetail` flag for the detail
surface. Session state is `sessionActive`, `role` and the `isModerator` bool that mirrors the
tier. Feed controls are `sortBy`, `tagFilter`, `searchText`, `searchQuery`, `page` and `hasMore`.
Selection state names the open discussion (`selectedTitle`, `selectedAuthor`, `selectedBody`,
`selectedTag`, `selectedLikes`, `selectedReplies`, `selectedViews`, `selectedPinned`,
`selectedLocked`). Composer and auth fields bind to inputs and carry an inline validation note.

Seeded records are compiled as parallel string lists (feed cards, tag labels, reply thread,
search results, notifications, activity, moderation queue, active members) that the compiler
unrolls into literal nodes at compile time.

## 5. UI and theme

- Layout: a persistent header sits above one shell `Row`. On a wide viewport the shell lays a
  fixed-width side panel beside the main column; at the compact breakpoint the `Row` stacks the
  two panes vertically, giving a single-column layout on narrow screens.
- Header: brand mark, `Home`, search box and `Search`, a `Bell` button carrying the unread count,
  `New`, the signed-in `@{meHandle}` menu entry, and `Sign out`.
- Side panel: tag catalogue, a community stats card, an `Active now` member list, and quick links
  to Feed, Notifications, Profile and Moderation.
- Card surfaces: rounded cards with a soft shadow and a hairline border, divider-separated lists,
  avatar circles, colored tag chips, and hover/active states on buttons.
- Footer: a dark strip with the brand mark, a one-line tagline and secondary links.
- Theme block (`views/theme.opu`): `mode: light`, `accent: #E4572E`, `radius: 16`, `fontScale:
  1.0`. Named tokens give the demo a cohesive identity: ink `#1B1F2A`, muted `#6B7280`, line
  `#E6E4EF`, surface `#FFFFFF`, wash `#F6F4FB`, accent `#E4572E`, accent-soft `#FDEAE2`,
  accent-deep `#B83E1C`, plum `#5B3FD1`, plum-soft `#EDE8FF`.

## 6. Interaction model

- Every nav control sets its own bool flag true and (where relevant) `viewFeedDetail` false, so
  exactly one main surface is composited at a time.
- Opening a card copies its title, author and tag into the selection state and sets
  `viewFeedDetail` true while clearing `showFeed`, so the detail surface takes the column.
- Likes increment `selectedLikes`; `Save` records a bookmark note; `Reply` reveals the reply
  composer; posting a reply increments `selectedReplies` and clears the draft.
- Follow and block toggle their profile flags; mark-read decrements `unreadCount`; moderation
  actions decrement `flaggedCount` and update `moderatorNote`.
- Composer and auth forms report a validation note through a bool flag (`draftInvalid`,
  `authInvalid`) because `if` guards read a single bool state.

## 7. Architecture and request flow

One request passes through the lowered service and reconciles into the same state map the client
displays.

1. Input — a bound `Input` patches its state through the renderer `input` event.
2. Intent — a `Button` tap runs an ordered action list on `tap`.
3. Fetch — the client issues an HTTP call to the matching `api` path.
4. Route match — the generated router matches method and path against the IR `api` array,
   including `:id` parameters.
5. Middleware — session authentication resolves the caller, validation checks the body against
   the `model` field types, and the error handler maps failures to JSON.
6. Repository — the handler runs the query through a transaction, applying pagination for list
   handlers and relation loading for detail handlers.
7. Response and sync — the handler returns JSON (or SSR HTML for the `/ssr` route); the client
   reconciles the response into the same typed state map.

## 8. Framework capability coverage

- Server HTTP (`opurom-server`): routing over IR `api`, request middleware, validation against
  model field types, session cookie resolution, typed error responses.
- Database (`opurom-db`): a typed repository generated from `model`, relation joins for
  discussion → replies and reply → parent reply, transactions for multi-row writes, and offset
  pagination with `page`/`pageSize`.
- Frontend (`opurom-render`): the IR `state` map as the single client store, `if`/`for` rendering,
  conditional subtrees, responsive reflow across the breakpoints, and SSR from the same IR.
- Type sync: the `model` and `api` declarations are the only source for client request types,
  server handler signatures and migration columns.

## 9. Roadmap

The following capabilities are planned for later milestones and are modeled here as data and
state.

- Session middleware and request validation in the generated service.
- A PostgreSQL driver, typed repository and transactional writes.
- A migration ledger runner with automatic apply at start.
- Multipart upload for avatars and post images, plus a typed client network wrapper.
- Cursor pagination for the high-churn activity stream.

## 10. Brand and identity note

Relay is an original OPUROM demo application. It has its own name, brand mark, palette, screen
names and copy. It is a clean-room functional and layout study and does not reproduce any
third-party product's identity, logo, trademarks, or source. All names, colors and text in this
application are original to the Relay demo.
