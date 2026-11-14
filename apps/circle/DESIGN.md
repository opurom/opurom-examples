# Orbit Circle Community Mini-Program

## 1. Overview

Orbit is a full-feature circle-community mini-program demo built with the OPUROM
declarative language. One source tree defines the user interface, the entity data
model, the API surface and the shared state. The compiler lowers that tree into a
single intermediate representation, which the nine emitters deliver to native,
web, six mini-program platforms and WebAssembly targets.

The application presents a phone-style single-column layout. A bottom tab bar
switches between the feed, the topic square, the activity square, notifications
and the personal center. Detail, compose, editor and settings screens open as
overlay surfaces above the tab layer and return to the originating tab.

## 2. Brand and identity

Orbit is an original OPUROM demo with its own brand name, visual identity, member
names, circle names, activity names and editorial content. The demo does not
reproduce the name, logo, trademarks, trade dress or content of any third-party
product. The reference material was consulted only to study the functional scope
and the structural layout of a local circle-community application; the delivered
source, screens and copy are independent.

## 3. Screen map

| Screen | Entry point | Purpose |
| --- | --- | --- |
| Home feed | Feed tab | Topic tabs, sort, refresh, post cards and load-more |
| Post detail | Open on a post card, notification or search result | Full post, image grid, reactions, comments, replies and report |
| Search | Feed search control | Keyword query and result list |
| Topic square | Circles tab | Circle search, category strip, cover grid and circle creation |
| Circle detail | Enter on a circle card | Cover, description, membership, members and in-circle posts |
| Create circle | New circle control | Name, description, cover and submission |
| Activity square | Activity tab | Search, category, status, sort filters and event cards |
| Activity detail | Details on an event card | Event description, participants, comments, favorite and join |
| Activity editor | Create activity control | Full event form with save |
| Compose | New post control or floating action | Title, body, topic, image attachment and publish |
| Notifications | Notices tab | Interaction list with unread count and read-all |
| Personal center | Me tab | Avatar, bio, statistics, posts, favorites, follows and follow control |
| Edit profile | Edit in the personal center | Display name and bio |
| Settings | Settings in the personal center | Appearance, motion, density, notifications and text scale |

Every listed screen is reachable from the tab bar, from a card control or from a
personal-center control. Overlay screens carry a back control that restores the
tab they were opened from.

## 4. Feature list

### 4.1 Home feed

- Topic tab strip with seven topics and a bound selection state.
- Latest and hot sort options through a radio group.
- Image-and-text post cards with author avatar, name, handle, timestamp, topic
  badge, title, body and a three-image grid.
- Like and save actions with paired active and inactive controls and live counts.
- Comment count and an open control that navigates to post detail.
- Pull-to-refresh modelled as an async refresh control with a spinner and a
  status string populated by a fetch effect.
- Load-more control that reveals a second page of cards and advances the page
  counter.

### 4.2 Post detail

- Author row with avatar, handle, timestamp, view count and topic badge.
- Full post body and a three-image grid.
- Like, save and share actions with counters, plus a report action that reveals
  a report state with a clear control.
- Comment list with per-row reply controls, a reply context bar, a comment
  composer and a send action that increments the comment and notification totals.

### 4.3 Circle and topic

- Topic square with search, a category tab strip and a two-column cover grid.
- Circle detail with cover, description, creation date, member count, a join and
  leave toggle, a member avatar row and a list of in-circle posts.
- Create-circle surface with a cover, name, description and submission feedback.

### 4.4 Compose

- Post editor with title, body, a six-topic radio selector, an image attachment
  preview and a publish action.
- Publish increments the post total, advances the refresh counter and shows a
  confirmation with the selected topic.

### 4.5 Activity

- Activity square with search, category tab strip, status radios, sort radios and
  event cards carrying cover, category, price, time, location, organizer and
  participant count.
- Activity detail with cover, status badge, price, category, schedule, location,
  organizer, full description, a participant avatar row, comments and a comment
  composer.
- Favorite, join and share actions with a participant counter.
- Activity editor with title, category radios, schedule, location, capacity,
  price, details, contact and a save action.

### 4.6 User profile

- Gradient identity card with avatar, display name, handle, bio and four stat
  tiles.
- Follow toggle with a follower counter, plus a settings entry.
- My posts, favorites and following lists rendered through shared post cards.
- Edit-profile surface with display name and bio bound to the profile state.
- Settings surface with dark appearance, reduced motion, compact density and
  interaction notification switches, a text-scale slider and an about panel.

### 4.7 Interactions

- Like, save, follow, favorite, join, comment, reply, share and report actions.
- Notifications for likes, comments, replies, follows and mentions, with an
  unread count and a read-all action.
- Keyword search across posts with a result list.
- Shared reaction counters and a computed reaction total that keep the feed,
  detail and personal-center numbers consistent.

## 5. Data model

The model module declares seven entities and their API routes.

| Entity | Key fields | Relations |
| --- | --- | --- |
| `Post` | `id`, `title`, `content`, `author`, `authorHandle`, `topic`, `cover`, `images`, `time`, `likes`, `comments`, `liked`, `saved` | Author of a comment and bookmark target |
| `Comment` | `id`, `postId`, `author`, `body`, `replyTo`, `time`, `likes` | `postId` to `Post` |
| `User` | `id`, `name`, `handle`, `bio`, `posts`, `followers`, `following` | Circle member and activity organizer |
| `Circle` | `id`, `name`, `description`, `cover`, `members`, `created` | Home of a post set |
| `Activity` | `id`, `title`, `category`, `startTime`, `endTime`, `location`, `organizer`, `content`, `cover`, `price`, `participants`, `capacity`, `status` | Participant list |
| `Bookmark` | `id`, `postId`, `owner`, `savedAt` | `postId` to `Post` |
| `Notification` | `id`, `actor`, `kind`, `text`, `time`, `read` | Interaction event |

### 5.1 API surface

| Route | Verbs |
| --- | --- |
| `/orbit/posts` | `list`, `create` |
| `/orbit/posts/:id` | `get`, `update`, `delete` |
| `/orbit/posts/:id/comments` | `list`, `create` |
| `/orbit/circles` | `list`, `create` |
| `/orbit/circles/:id` | `get`, `update` |
| `/orbit/circles/:id/members` | `list` |
| `/orbit/activities` | `list`, `create` |
| `/orbit/activities/:id` | `get`, `update`, `delete` |
| `/orbit/activities/:id/comments` | `list`, `create` |
| `/orbit/users` | `list`, `create` |
| `/orbit/users/:id` | `get`, `update` |
| `/orbit/users/:id/follow` | `update` |
| `/orbit/bookmarks` | `list`, `create` |
| `/orbit/bookmarks/:id` | `delete` |
| `/orbit/notifications` | `list` |
| `/orbit/search` | `list` |

### 5.2 State model

State is a flat, strongly typed map. Navigation flags select exactly one tab and
at most one overlay. Interaction state holds the reaction booleans and counters,
the comment and reply drafts, the report flag, the join and participation flags,
the notification totals and the publish total. Content lists are string-valued
parallel arrays; the compiler unrolls each `for` loop into literal nodes, so
every feed, circle, activity, comment and notification row is present in the
lowered tree.

## 6. Theme and visual system

One theme block defines the light mode, accent, corner radius and font scale.
The palette combines an indigo accent, a blue gradient identity band, white
cards, pale blue surfaces, slate text tones and semantic colors for positive,
warning and negative states. Shared components keep the card padding, radius,
shadow, spacing and type scale consistent across every screen. The bottom tab bar
uses an active accent variant and an inactive neutral variant.

## 7. Module layout

| Module | Responsibility |
| --- | --- |
| `main.opu` | Entry file: reusable components and the app tree |
| `models/circle.opu` | Seven entities, API routes and cross-screen interaction state |
| `views/nav.opu` | Tab and overlay navigation flags |
| `views/feed.opu` | Theme block and feed content lists |
| `views/detail.opu` | Post, circle, activity and editor content |
| `views/browse.opu` | Topic square, activity square and search content |
| `views/profile.opu` | Personal-center, notification, settings and compose content |

An imported module declares only state, model, api, theme and imports; reusable
components and the app tree therefore live in the entry file.

## 8. Roadmap

The following additions are planned as neutral extensions of the current design:

- Deeper per-member activity history and moderation controls.
- Richer media handling for covers and image attachments.
- Expanded notification categories and delivery preferences.
- Additional topic and activity discovery filters.
