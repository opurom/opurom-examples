# OPUROM Community Forum — Full-Stack MVP Design

## 1. Overview

This document specifies a community forum application built on OPUROM, the single-source
declarative language in which one `.opu` source tree defines the user interface, the relational
data model, and the HTTP service boundary, and the compiler lowers that source to one intermediate
representation (IR). Frontend types and backend types therefore have one source of truth.

The application is named **Forum**. Its source lives under the `apps/forum/` project:

- `apps/forum/main.opu` — the entry file. It imports the model and view-state modules, declares the
  reusable components, and holds the app tree for the list, detail, composer and profile screens.
- `apps/forum/models/forum.opu` — the entity models (`User`, `Board`, `Post`, `Comment`,
  `Bookmark`) and their HTTP `api` routes.
- `apps/forum/views/state.opu` — the view state every screen reads: navigation, paging, session,
  composer and profile values.

The shipped skeleton is a compilable OPUROM program. It models the forum entities with their routes
and renders the forum interface — paginated list, post detail with comments, a composer, and a
profile — in declarative OPUROM syntax. Features that depend on backend capabilities planned for
the runtime (session transport, relational queries against PostgreSQL, transactions, server-side
validation) are modelled as data and state here and specified in this document.

## 2. Application architecture

### 2.1 Layering

OPUROM keeps a single source of truth for types, layout and service routes. The compiler lowers
that source into one IR document that carries `models`, `api`, `state`, `tree` and `theme`. The
frontend branch (renderer and platform adapters) consumes the `tree` and `state`; the backend
branch (service and data layers) consumes the `models` and `api` arrays. Neither branch imports the
other's source. The `opuromc` toolchain and the `opurom build --target full` command place the
frontend bundle, the server crate and the migrations side by side from the same IR.

| Application concern | OPUROM representation | Delivered by |
| --- | --- | --- |
| Entity types | `model` declarations in `models/forum.opu` | Compiler, merged into IR `models` |
| Row data and counters | `state` declarations and model rows | State map in IR |
| Screens and controls | Node tree with `if`/`for` and components | Renderer |
| Service boundary | `api` declarations and route handlers | Lowered service (`opurom-server`) |
| Persistence and schema | `model` declarations | `opurom-db` migrations and repository |
| Session, validation, upload | Backend runtime middleware (planned) | `opurom-server` layered features |

### 2.2 Directory structure

The project follows the multi-file module layout used by the reference workbench and dashboard
examples: an entry file plus `models/` and `views/` modules, with a server and data layer section
that the full-stack lowering fills in.

```
apps/forum/
  main.opu                 entry: components and the app tree
  models/
    forum.opu              User, Board, Post, Comment, Bookmark + api routes
  views/
    state.opu              navigation, paging, session, composer and profile state
  server/                  generated service (not committed; lowered from IR)
    src/                   router, handlers, session middleware, validation
  migrations/              generated SQL, one file per model, ordered by prefix
    001_create_user.sql
    002_create_board.sql
    003_create_post.sql
    004_create_comment.sql
    005_create_bookmark.sql
```

The `server/` and `migrations/` directories are build artifacts of `opurom build --target full`
and `opurom-migrate`; they are regenerated from the IR and are never edited by hand. The source
tree under `models/` and `views/` is the only authored input.

### 2.3 Request flow

One request passes through the lowered service and returns to the same rendered state map that the
client already displays.

1. **Input.** The user types into an `Input` bound to `draftTitle` or `draftBody`; the renderer
   emits an `input` action that patches the bound state.
2. **Intent.** A `Button` tap runs an ordered action list on the `tap` event: for example, the
   `Publish` handler clears the composer flags and returns the list view to foreground.
3. **Fetch.** The client issues an HTTP call to the matching `api` path (`POST /forum/posts`).
   The network wrapper serializes the JSON body from current state.
4. **Route match.** The generated router matches the method and path against the IR `api` array,
   including `:id` parameters.
5. **Middleware.** Session authentication resolves the caller, request validation checks the body
   against the `model` field types, and the error handler maps failures to JSON responses.
6. **Repository.** The handler runs the ORM-style query through a transaction against PostgreSQL,
   applying pagination for list handlers and relation loading for detail handlers.
7. **Response and sync.** The handler returns JSON for the client, or SSR HTML for the `/ssr`
   route; the client reconciles the response into the same typed state map.

## 3. MVP business code design in OPUROM

The business design below is expressed in the same syntax the skeleton compiles. Entity models and
routes are declared in the model module; screens and handlers live in the entry file. Each
subsection names the model fields and the state that drive it.

### 3.1 User system

The user system covers register, login, logout, permission tiers and profile. The `User` model
holds the durable identity; the session and role are view state and server session data.

```opu
model User {
  id: int primary
  handle: string
  displayName: string
  role: string
  bio: string
}

api "/forum/users" {
  list User
  create User
}

api "/forum/users/:id" {
  get User
  update User
}
```

The `role` field carries the permission tier: `guest`, `member`, `moderator`, or `admin`. The
register and login handlers are `create` against `/forum/users` (register) and a session login
route (a planned `opurom-server` feature that sets the session cookie). The session state drives
the header and the conditional controls:

```opu
if (sessionActive) {
  Text("Signed in as {profileName}", size: 12, color: "#0F172A")
  Button("Log out") { sessionActive = false }
}
Button("Register / Log in") { sessionActive = true; role = "member" }
```

A `role` with the value `admin` reveals the moderation panel through its own bool flag. Profile
edit is an `update` against `/forum/users/:id`, bound to `profileName` and `profileBio`.

### 3.2 Content system

The content system covers posts, a paginated list, post detail, comments and boards.

```opu
model Board {
  id: int primary
  slug: string
  title: string
  description: string
}

model Post {
  id: int primary
  boardId: int
  author: string
  title: string
  body: string
  likes: int = 0
  replies: int = 0
  pinned: bool = false
}

model Comment {
  id: int primary
  postId: int
  author: string
  body: string
  likes: int = 0
}

api "/forum/posts" { list Post; create Post }
api "/forum/posts/:id" { get Post; update Post; delete Post }
api "/forum/posts/:id/comments" { list Comment; create Comment }
api "/forum/comments/:id" { update Comment; delete Comment }
```

The list screen reads the paged slice and renders each post through the `PostCard` component; the
detail screen loads one `Post` and its `Comment` rows; the composer writes a new `Post`. Paging,
board filtering and the active post are state:

```opu
state page = 1
state pageSize = 10
state boardFilter = "general"
state selectedPost = "1"
```

Boards are a `Board` list; the `BoardChip` component sets `boardFilter` and resets `page` to 1 so a
board switch starts a fresh page sequence.

### 3.3 Interaction

Interaction covers post likes, comment likes and bookmarks. Likes are counter fields on `Post` and
`Comment`. Bookmarks are their own relationship entity.

```opu
model Bookmark {
  id: int primary
  postId: int
  owner: string
}

api "/forum/bookmarks" { list Bookmark; create Bookmark }
api "/forum/bookmarks/:id" { delete Bookmark }
```

The `Like` handler increments the current counter; the `Save` handler creates a `Bookmark`; the
detail screen reflects `bookmarked` and `liked` flags. A like toggle on the server is an `update`
against the target row; the client applies the patch to the same counter state.

### 3.4 Moderation

Moderation is available to the `moderator` and `admin` tiers: delete a post, remove a comment and
mute an author. The destructive routes reuse the `delete` verb on posts and comments; author mute
is an `update` of the `User.role` to a muted value or a dedicated mute flag in the planned schema.

```opu
if (showModeration) {
  Card(p: 14, rounded: 12, bg: "#FEF2F2") {
    Column(gap: 6) {
      Text("Moderation", size: 12, color: "#B91C1C")
      Button("Remove post") { viewDetail = false; viewList = true }
      Button("Mute author") { viewDetail = false; viewList = true }
    }
  }
}
```

The visible panel is gated by the moderation flag; the server enforces the same tier on every
destructive handler through session middleware, so hiding the control is convenience and the
authorisation check is authoritative.

### 3.5 Persistence and migrations

PostgreSQL persistence is generated from the `model` declarations. Each model becomes one ordered
migration and one repository type. The plan:

| Step | Source | Output |
| --- | --- | --- |
| Schema generation | IR `models` | `migrations/NNN_create_<model>.sql`, one file per model in declaration order |
| Migration apply | Migration files | Ordered, idempotent `CREATE TABLE` with a versioned ledger table |
| Query layer | IR `models` | Typed repository with relation joins and transactions |
| Pagination | `api` `list` handlers | `LIMIT`/`OFFSET` with a `page`/`pageSize` contract |

Automatic migrations run at service start: the ledger records the last applied version, and each
pending file is applied inside one transaction so a failed migration rolls back and stops the
service. Foreign keys follow the relationship fields (`Post.boardId → Board.id`,
`Comment.postId → Post.id`, `Bookmark.postId → Post.id`). The migration plan is additive: new
fields append a new migration file, and existing files are never rewritten.

## 4. Database model and migration plan

### 4.1 Tables

| Table | Key columns | Relations | Indexes |
| --- | --- | --- | --- |
| `user` | `id` PK, `handle` unique, `displayName`, `role`, `bio` | — | unique `handle` |
| `board` | `id` PK, `slug` unique, `title`, `description` | — | unique `slug` |
| `post` | `id` PK, `boardId`, `author`, `title`, `body`, `likes`, `replies`, `pinned` | `boardId → board.id` | `boardId`, `(pinned, id desc)` |
| `comment` | `id` PK, `postId`, `author`, `body`, `likes` | `postId → post.id` | `postId` |
| `bookmark` | `id` PK, `postId`, `owner` | `postId → post.id` | unique `(postId, owner)` |

`author` and `owner` are handles resolved to `user.id` by the repository at write time, or stored
as denormalised handles when a fast read path is preferred; the plan uses a resolved foreign key
with a projection that joins the handle for display.

### 4.2 Migration sequence

1. `001_create_user.sql` — create `user`, unique index on `handle`.
2. `002_create_board.sql` — create `board`, unique index on `slug`.
3. `003_create_post.sql` — create `post`, foreign key to `board`, indexes on `boardId` and
   `(pinned, id desc)`.
4. `004_create_comment.sql` — create `comment`, foreign key to `post`, index on `postId`.
5. `005_create_bookmark.sql` — create `bookmark`, foreign key to `post`, unique `(postId, owner)`.

Each migration is transactional. The ledger table `schema_migrations(version, applied_at)` records
applied versions, and the runner applies every pending version in file order.

## 5. Framework capability coverage

The application drives the following framework capabilities. Each is grouped by the layer that
owns it.

### 5.1 Server HTTP layer (`opurom-server`)

- **Routing.** Method plus path matching over the IR `api` array, including `:id` parameters and
  the five CRUD verbs (`list`, `get`, `create`, `update`, `delete`).
- **Middleware.** An ordered request pipeline: request id, structured logging, session
  authentication, body limits, and a central error handler.
- **Validation.** Request bodies are checked against `model` field types before a handler runs; a
  mismatch returns a typed `422` JSON error naming the field.
- **Session authentication.** A signed session cookie resolved to a `User` and a `role` tier;
  destructive handlers require the moderator or admin tier.
- **Error handling.** Typed errors map to JSON responses; a handler panic is isolated and returns a
  `500` without stopping the process.
- **File upload.** Multipart image upload for post bodies and avatars, stored under a media root
  and referenced by URL; size and content-type are validated at the boundary.

### 5.2 Database layer (`opurom-db`)

- **PostgreSQL driver.** A pooled wire-protocol client with prepared statements and typed parameter
  binding.
- **ORM-style relational queries.** A typed repository generated from the `model` declarations,
  with relation joins (post → board, post → comments) and projection into the shared field types.
- **Transactions.** A scoped transaction handle that commits on success and rolls back on error,
  used for multi-row writes such as creating a post while incrementing a board counter.
- **Pagination.** A `list` handler takes `page` and `pageSize`, clamps `pageSize`, and returns the
  page slice with a total count.
- **Migrations.** Schema generated from IR and applied at start under the ledger described in
  section 4.2.

### 5.3 Frontend layer (`opurom-render`)

- **Route navigation.** The view flags (`viewList`, `viewDetail`, `viewCompose`, `viewProfile`)
  switch the rendered subtree; a URL route binding maps each flag to a path.
- **Global state.** The IR `state` map is the single client store; every screen reads and patches
  the same map.
- **Form validation.** Bound inputs validate against field types and required rules before an
  action list is submitted.
- **Network wrapper.** A typed fetch helper derives the request and response shape from the `api`
  and `model` declarations, so no DTO is written by hand.
- **Conditional rendering.** `if` guards on bool state show and hide subtrees.
- **SSR.** The `/ssr` route renders the same IR to HTML with the same theme tokens as the client.

### 5.4 Full-stack type sync

The `model` and `api` declarations are the only source for client request types, server handler
signatures and migration columns. One IR carries all three, so a field change propagates to every
layer in one lowering pass.

## 6. Exploration points

Each exploration point gives at least two implementation paths and compares them on performance,
development cost, framework intrusiveness and maintainability, then states a recommendation.

### 6.1 User authentication

**Path A — Server session with an HTTP-only cookie.** Login verifies credentials and the server
stores a session record, returning an opaque session id in a signed, HTTP-only, SameSite cookie.
Each request resolves the cookie to a session and a user.

**Path B — Stateless JSON Web Token.** Login returns a signed token that the client stores and
sends in an `Authorization` header. The server verifies the signature and reads the claims on each
request without a session store.

| Criterion | Path A: session cookie | Path B: JWT |
| --- | --- | --- |
| Performance | One session-store lookup per request; revocable instantly | No store lookup; signature verification only; revocation needs a denylist |
| Development cost | Low; cookie handling, a session table and a resolve middleware | Moderate; key management, claim schema, refresh and rotation flow |
| Framework intrusiveness | Low; a cookie and a session record in the existing middleware chain | Moderate; a token codec and cross-origin header policy |
| Maintainability | Simple mental model; server owns lifecycle and logout | Stateless and easy to scale, but revocation and expiry edge cases add burden |

**Recommended option: Path A (server session cookie) for the MVP.** The forum is a same-origin web
application where instant logout, server-side revocation and simple tier checks matter more than
horizontal statelessness. The cookie path adds one session table and one resolve middleware, matches
the generated service model, and keeps the client free of token storage. Path B is the planned
option when a separate API client needs stateless auth across origins.

### 6.2 ORM relational query mechanism

**Path A — Generated typed repository with explicit query methods.** The compiler generates a
repository type per model with named methods (`findById`, `listPage`, `commentsFor`, `create`,
`update`, `delete`) and explicit join helpers. Call sites are typed and the SQL is fixed at
generation time.

**Path B — Query builder over a schema description.** A runtime query builder composes SQL from a
schema descriptor and operator functions (`where`, `join`, `orderBy`, `limit`). Call sites assemble
queries in code.

**Path C — Raw SQL with typed row mapping.** Handwritten SQL strings are mapped to model structs by
a typed decoder generated from the `model` declarations.

| Criterion | Path A: generated repository | Path B: query builder | Path C: raw SQL + mapping |
| --- | --- | --- | --- |
| Performance | Highest; statements prepared once and reused; no runtime composition | Good; composition cost per query; prepared caching possible | Highest; fully hand-tuned, but tuning is manual per query |
| Development cost | Low for the common paths; new access patterns need a generator change | Moderate; builders are flexible but every query is authored | Moderate to high; every query and mapping written and reviewed |
| Framework intrusiveness | Low; generation stays inside `opurom-db` | Higher; a builder surface and operator set become public API | Lowest; no new surface, but no reuse |
| Maintainability | Strong; the schema is the only source and joins are named | Flexible; ad hoc queries drift from the schema | Weakest; SQL duplicates the schema and drifts silently |

**Recommended option: Path A with Path C as the documented escape hatch.** The generated typed
repository keeps the `model` declarations as the single source for columns and joins, gives the
best performance through prepared statements, and prevents schema drift. A raw-SQL escape hatch
covers the rare reporting query the generator does not model, marked at the call site. Path B is
not chosen for the MVP because its runtime composition duplicates a schema the generator already
owns.

### 6.3 Pagination API design

**Path A — Offset pagination (`page`/`pageSize`).** The `list` handler takes `page` and `pageSize`,
returns the row slice plus `total`, `page` and `pageSize`. The client renders numbered pages.

**Path B — Cursor pagination (`after` cursor).** The `list` handler takes an opaque cursor (the
last seen sort key) and a `limit`, and returns the next slice plus a `nextCursor`. The client
appends or replaces a continuous stream.

| Criterion | Path A: offset | Path B: cursor |
| --- | --- | --- |
| Performance | `OFFSET` scans and discards skipped rows; degrades on deep pages | Constant cost per page through an indexed seek; stable on deep pages |
| Development cost | Lowest; simple contract with total counts and jump-to-page | Moderate; cursor encode/decode, stable sort key and no random access |
| Framework intrusiveness | Lowest; a `LIMIT`/`OFFSET` clause on the generated list handler | Moderate; a cursor codec and a keyset query in the generated handler |
| Maintainability | Simple; totals are easy; duplicates or skips under concurrent inserts | Stronger consistency under inserts; cursor shape is tied to the sort key |

**Recommended option: Path A (offset paging) for the MVP, with Path B planned for the activity
stream.** A forum list is read-mostly, users expect numbered pages and a total count, and the board
filter keeps result sets shallow, so offset cost is acceptable and the contract is the simplest to
ship. Path B is the planned option for the high-churn "latest activity" feed where deep pages and
concurrent inserts make offset unsound.

## 7. Priority roadmap

The roadmap orders delivery so each milestone is independently usable.

| Milestone | Scope | Deliverables |
| --- | --- | --- |
| M1 — Read-only forum | Entities, routes, list and detail screens | `models/forum.opu`, list and detail views, SSR of the list |
| M2 — Accounts and posting | Register, login, session tier, composer, comments | Session middleware, `create` handlers, composer view, validation |
| M3 — Interaction | Likes, comment likes, bookmarks | Counter updates and `Bookmark` entity with unique guard |
| M4 — Moderation | Delete, remove, mute for elevated tiers | Authorisation checks and the moderation panel |
| M5 — Persistence hardening | PostgreSQL pool, transactions, migrations | Generated repository, ledger migrations, transactional writes |
| M6 — Uploads and polish | Image upload, pagination tuning, accessibility pass | Multipart upload, cursor option, a11y roles on controls |

## 8. Acceptance criteria

| Acceptance criterion | Verification |
| --- | --- |
| Every `.opu` file type-checks | `opuromc check apps/forum/main.opu` exits 0, validating imported modules |
| The project compiles to one IR | `opuromc compile apps/forum/main.opu` exits 0 |
| The IR declares five models and their routes | Inspect the compiled IR `models` and `api` arrays |
| The list, detail, composer and profile render | Lower the IR and assert the node tree contains the four subtrees |
| List paging changes the visible page | Tap `Next page` and assert the `page` state patch and rendered label |
| A post opens the detail view | Tap `Open` on a post and assert `viewDetail` becomes true |
| Session state gates the signed-in controls | Toggle `sessionActive` and assert the conditional subtree |
| The admin tier reveals moderation | Set `role` to `admin` and assert the moderation panel |
| Authentication, validation and upload pass end to end | Service test: register, login, create post, upload image, delete as admin |
| Migrations apply cleanly on an empty database | Run the migration runner and assert every version is in the ledger |

## 9. Implementable with the current framework today

The following are expressed entirely in OPUROM and compile in the shipped skeleton:

- The entity models `User`, `Board`, `Post`, `Comment` and `Bookmark`, with their HTTP `api` routes.
- The list screen with pagination controls, the post detail screen with comments, the composer
  screen and the profile screen.
- The navigation flags, session state, paging state, composer fields and moderation flag.
- The reusable components `BoardChip`, `PostCard`, `CommentRow` and `StatTile`.
- The responsive shell that stacks a sidebar and a content column from compact to wide widths.
- The single-source type and route contract, lowered to one IR document.

## 10. Requires a pending framework capability

The following depend on backend runtime capabilities that are planned and are modelled here as
data and state:

- Server session transport and the cookie-session middleware (`opurom-server`).
- PostgreSQL pooled driver and ORM-style relational queries (`opurom-db`).
- Transactional multi-row writes and the migration ledger runner (`opurom-db`).
- Server-side request validation against `model` field types (`opurom-server`).
- Multipart file upload for images (`opurom-server`).
- Typed network wrapper and URL route binding on the client (`opurom-render`).
- `if` over a comparison expression rather than a single bool state, which the current grammar
  expresses through one flag state per view.

The OPUROM source declares the models, routes and state each capability consumes, so adding the
capability completes the loop without changing the screens or the models.

## 11. Roadmap of planned framework capabilities

The framework capabilities above are delivered in the order below.

- P1 — Session middleware and request validation in the generated service.
- P2 — PostgreSQL driver, typed repository and transactional writes.
- P3 — Migration ledger runner and automatic apply at start.
- P4 — Multipart upload and the typed client network wrapper.
- P5 — Comparison expressions in `if` guards and cursor pagination for activity streams.
